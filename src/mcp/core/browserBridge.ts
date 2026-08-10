/**
 * Puppeteer browser bridge for frogConvert.
 *
 * Provides a fallback conversion path for conversions that require browser-only
 * APIs (Canvas, WebGL, AudioContext, DOM). Used when the native Node.js handler
 * chain cannot find a path for the requested conversion.
 *
 * The bridge:
 * 1. Spins up a minimal static HTTP server serving the production dist/
 * 2. Launches a headless Chromium instance (lazy, singleton)
 * 3. Loads /headless/, graph built from cache.json, handlers init lazily on first use
 * 4. Delegates conversions to window.__frogConvertHeadless() via page.evaluate()
 *
 * Requires a production build (bun run build) to be present in dist/.
 */

import { createServer, type Server } from "http";
import { stat, readFile, mkdir } from "fs/promises";
import { join, extname, relative as relPath, resolve as resolvePath } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DIST_DIR = join(__dirname, "..", "..", "..", "dist");
// Persistent Chrome profile: V8 caches compiled WASM here between restarts.
// On a warm restart, Pandoc WASM (~55 MB) compiles in seconds instead of minutes.
const BRIDGE_CACHE_DIR = join(__dirname, "..", "..", "..", ".bridge-cache");
// Required on Linux CI/Docker where unprivileged user namespaces are restricted (AppArmor).
const PUPPETEER_ARGS = ["--no-sandbox", "--disable-setuid-sandbox"];

const MIME_TYPES: Record<string, string> = {
    ".html": "text/html",
    ".js":   "application/javascript",
    ".mjs":  "application/javascript",
    ".css":  "text/css",
    ".wasm": "application/wasm",
    ".json": "application/json",
    ".png":  "image/png",
    ".svg":  "image/svg+xml",
    ".ico":  "image/x-icon",
    ".sf2":  "application/octet-stream",
    ".data": "application/octet-stream",
};

export interface BridgeResult {
    fileName: string;
    base64Bytes: string;
}

// Maximum time a single page.evaluate() conversion may run before the queue is unblocked.
const EVALUATE_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

// Singleton state
let staticServer: Server | null = null;
let browser: import("puppeteer").Browser | null = null;
let bridgePage: import("puppeteer").Page | null = null;
let initPromise: Promise<void> | null = null;
// Anchored on globalThis rather than a module-local `let` so HMR / duplicate
// module instantiation cannot double-register process signal handlers.
const SIGNAL_FLAG = "__frogConvertBridgeSignalsRegistered";
function signalHandlersRegistered(): boolean {
    return (globalThis as any)[SIGNAL_FLAG] === true;
}
function markSignalHandlersRegistered(): void {
    (globalThis as any)[SIGNAL_FLAG] = true;
}

// Serialise concurrent page.evaluate() calls so conversions don't interleave
let conversionQueue: Promise<unknown> = Promise.resolve();

async function startStaticServer(): Promise<number> {
    // Verify dist/ exists before starting the server
    const distStat = await stat(DIST_DIR).catch(() => null);
    if (!distStat?.isDirectory()) {
        throw new Error(
            "Browser bridge requires a production build. Run `bun run build` first."
        );
    }

    return new Promise((resolve, reject) => {
        const server = createServer((req, res) => {
            const urlPath = (req.url ?? "/").replace(/\?.*$/, "");
            const relative = urlPath.slice(1);

            // Try the exact path, then index.html for directory requests
            const candidates = [
                join(DIST_DIR, relative),
                join(DIST_DIR, relative, "index.html"),
            ];

            (async () => {
                let filePath: string | null = null;
                for (const candidate of candidates) {
                    // Prevent path traversal outside DIST_DIR
                    if (relPath(DIST_DIR, resolvePath(candidate)).startsWith('..')) continue;
                    try {
                        const s = await stat(candidate);
                        if (s.isFile()) { filePath = candidate; break; }
                    } catch { /* not found */ }
                }

                if (!filePath) {
                    res.writeHead(404);
                    res.end("Not found");
                    return;
                }

                const ext = extname(filePath).toLowerCase();
                const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
                try {
                    const data = await readFile(filePath);
                    // Vite outputs content-hashed filenames for JS/WASM, safe to
                    // cache indefinitely. HTML and JSON change with each build.
                    const immutable = [".js", ".mjs", ".wasm"].includes(ext);
                    const cacheControl = immutable
                        ? "public, max-age=31536000, immutable"
                        : "no-cache";
                    res.writeHead(200, { "Content-Type": contentType, "Cache-Control": cacheControl });
                    res.end(data);
                } catch {
                    res.writeHead(500);
                    res.end("Read error");
                }
            })().catch(() => {
                if (!res.headersSent) { res.writeHead(500); res.end("Internal error"); }
            });
        });

        server.listen(0, "127.0.0.1", () => {
            const addr = server.address();
            if (!addr || typeof addr === "string") {
                reject(new Error("Failed to get server port"));
                return;
            }
            staticServer = server;
            resolve(addr.port);
        });

        server.on("error", reject);
    });
}

async function ensureInitialized(): Promise<void> {
    if (initPromise) return initPromise;

    // Register cleanup handlers once, only when the bridge is first used.
    // Flag lives on globalThis so HMR/duplicate module instantiation can't
    // double-register these process listeners.
    if (!signalHandlersRegistered()) {
        markSignalHandlersRegistered();
        process.on("exit", () => {
            // browser.close() is async and won't complete in a synchronous exit handler.
            // Kill the underlying child process directly for reliable cleanup.
            browser?.process()?.kill();
            staticServer?.close();
        });
        process.on("SIGINT",  () => process.exit(0));
        process.on("SIGTERM", () => process.exit(0));
    }

    const attempt = (async () => {
        // Ensure the persistent cache directory exists
        await mkdir(BRIDGE_CACHE_DIR, { recursive: true });

        const port = await startStaticServer();

        // Dynamically import puppeteer to avoid loading it at module parse time
        const puppeteer = (await import("puppeteer")).default;

        // userDataDir persists Chrome's HTTP cache and V8's compiled-WASM cache
        // between restarts. On a warm restart, Pandoc (~55 MB) compiles in seconds.
        // Chrome locks its profile dir, if a second server process tries to use the same
        // path (e.g. MCP + API running simultaneously), fall back to a fresh session.
        browser = await puppeteer.launch({ headless: true, userDataDir: BRIDGE_CACHE_DIR, args: PUPPETEER_ARGS })
            .catch(async (lockErr) => {
                process.stderr.write(
                    `[bridge] Persistent cache unavailable (${lockErr?.message ?? lockErr}), launching without cache\n`
                );
                return puppeteer.launch({ headless: true, args: PUPPETEER_ARGS });
            });
        bridgePage = await browser.newPage();

        // Reset ALL singleton state if the page dies so the next caller gets a
        // completely fresh initialization attempt. Critically: staticServer and
        // browser must also be nulled here, ensureInitialized() overwrites both
        // module-level vars on re-init, so without closing them first the old
        // server socket and Chrome process would be permanently leaked.
        const onPageDead = () => {
            process.stderr.write("[bridge] Page died, will re-initialize on next request\n");
            bridgePage = null;
            initPromise = null;
            staticServer?.close();
            staticServer = null;
            // browser.close() is async; kill the child process directly for
            // synchronous cleanup (same pattern used in process.on("exit")).
            browser?.process()?.kill();
            browser = null;
        };
        bridgePage.on("error", onPageDead);
        bridgePage.on("crash", onPageDead);

        // Suppress noisy console output from the headless page
        bridgePage.on("console", msg => {
            if (msg.text() === "frogConvert headless ready") {
                process.stderr.write("[bridge] headless page ready\n");
            }
        });

        // domcontentloaded fires after module scripts execute, sufficient here
        // because waitForFunction(__headlessReady) handles the real readiness check.
        await bridgePage.goto(`http://127.0.0.1:${port}/headless/`, {
            waitUntil: "domcontentloaded",
            timeout: 120_000,
        });

        // Wait for the headless page to signal ready (graph built from cache)
        await bridgePage.waitForFunction(
            () => (window as any).__headlessReady === true,
            { timeout: 120_000 }
        );
    })();

    // Cache the promise; on failure clean up all resources so the next caller
    // gets a completely fresh attempt rather than a half-initialised state.
    // Safe from races: JS is single-threaded, so the cleanup below runs
    // atomically (no await points) before any new ensureInitialized() call.
    initPromise = attempt.catch(err => {
        initPromise = null;
        browser?.close().catch(() => {});
        browser = null;
        bridgePage = null;
        staticServer?.close();
        staticServer = null;
        throw err;
    });

    return initPromise;
}

/**
 * Convert a file using the headless browser. Throws if no conversion path
 * exists in the browser either.
 */
export async function convertViaBrowser(
    fileName: string,
    base64Bytes: string,
    inputMime: string,
    inputExtension: string,
    outputMime: string,
    outputExtension: string,
    quality?: string
): Promise<BridgeResult[]> {
    await ensureInitialized();

    // Serialise calls so concurrent conversions don't interleave on the shared page.
    // conversionQueue must always stay fulfilled so subsequent items aren't skipped
    // on failure, keep the queue chain alive by catching errors on the queue ref,
    // while the caller-facing result promise still rejects normally.
    const result = conversionQueue.then(() => {
        const evaluatePromise = bridgePage!.evaluate(
            (fn, fm, b64, im, ie, om, oe, q) =>
                (window as any)[fn](fm, b64, im, ie, om, oe, q),
            "__frogConvertHeadless",
            fileName,
            base64Bytes,
            inputMime,
            inputExtension,
            outputMime,
            outputExtension,
            quality
        );
        let timeoutId: ReturnType<typeof setTimeout>;
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(
                () => reject(new Error(`Browser conversion timed out after ${EVALUATE_TIMEOUT_MS / 60000} minutes`)),
                EVALUATE_TIMEOUT_MS
            );
        });
        return Promise.race([evaluatePromise, timeoutPromise]).finally(() => clearTimeout(timeoutId!));
    });
    conversionQueue = result.catch(() => {});

    return result as Promise<BridgeResult[]>;
}

/** What the page hands back for one compressed file. */
export type BridgeCompressResult = {
    fileName: string;
    base64Bytes: string;
    originalSize: number;
    shrunk: boolean;
    reason?: string;
    warning?: string;
};

/**
 * Compress one file in the browser, for the formats Node cannot.
 *
 * `ffmpeg.wasm` throws "ffmpeg.wasm does not support nodejs" the moment it is
 * constructed, so video and audio compression over REST and MCP had no engine
 * at all - honestly reported as `unsupported`, but only because of where the
 * process was running. Conversion had solved this years earlier by keeping a
 * real browser to hand; compression simply never got wired to it.
 *
 * Queued on the same chain as `convertViaBrowser`: one page, one job at a time.
 */
export async function compressViaBrowser(
    fileName: string,
    base64Bytes: string,
    mimeType: string,
    extension: string,
    level: string,
): Promise<BridgeCompressResult> {
    await ensureInitialized();

    const result = conversionQueue.then(() => {
        const evaluatePromise = bridgePage!.evaluate(
            (fn, fm, b64, m, e, l) => (window as any)[fn](fm, b64, m, e, l),
            "__frogConvertCompressHeadless",
            fileName,
            base64Bytes,
            mimeType,
            extension,
            level,
        );
        let timeoutId: ReturnType<typeof setTimeout>;
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(
                () => reject(new Error(`Browser compression timed out after ${EVALUATE_TIMEOUT_MS / 60000} minutes`)),
                EVALUATE_TIMEOUT_MS,
            );
        });
        return Promise.race([evaluatePromise, timeoutPromise]).finally(() => clearTimeout(timeoutId!));
    });
    conversionQueue = result.catch(() => {});

    return result as Promise<BridgeCompressResult>;
}

/**
 * Fire-and-forget bridge warm-up. Call at server startup so the browser is
 * already running before the first convert_file tool call arrives.
 */
export function warmUpBridge(): void {
    ensureInitialized().catch(err => {
        process.stderr.write(`[bridge] warm-up failed: ${err?.message ?? err}\n`);
    });
}

/**
 * Returns true if the browser headless page can find a conversion path between
 * the two formats. Returns false when the bridge has not been initialised yet
 * (don't spin up a full browser just for a path check).
 */
export async function canConvertViaBrowser(
    inputMime: string,
    inputExtension: string,
    outputMime: string,
    outputExtension: string
): Promise<boolean> {
    if (!bridgePage) {
        // Bridge not running, don't start it just for a path check.
        return false;
    }

    return bridgePage.evaluate(
        (fn, im, ie, om, oe) => (window as any)[fn](im, ie, om, oe),
        "__frogConvertCanConvert",
        inputMime,
        inputExtension,
        outputMime,
        outputExtension
    ) as Promise<boolean>;
}
