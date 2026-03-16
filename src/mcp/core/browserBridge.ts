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
 * 3. Loads /convert/headless/ which initialises ALL handlers including browser-only ones
 * 4. Delegates conversions to window.__frogConvertHeadless() via page.evaluate()
 *
 * Requires a production build (bun run build) to be present in dist/.
 */

import { createServer, type Server } from "http";
import { readFile, existsSync, statSync } from "fs";
import { join, extname } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DIST_DIR = join(__dirname, "..", "..", "..", "dist");

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

// Singleton state
let staticServer: Server | null = null;
let browser: import("puppeteer").Browser | null = null;
let bridgePage: import("puppeteer").Page | null = null;
let initPromise: Promise<void> | null = null;
let signalHandlersRegistered = false;

// Serialise concurrent page.evaluate() calls so conversions don't interleave
let conversionQueue: Promise<unknown> = Promise.resolve();

function startStaticServer(): Promise<number> {
    return new Promise((resolve, reject) => {
        if (!existsSync(DIST_DIR)) {
            reject(new Error(
                "Browser bridge requires a production build. Run `bun run build` first."
            ));
            return;
        }

        const server = createServer((req, res) => {
            // Strip the /convert/ base path
            const urlPath = (req.url ?? "/").replace(/\?.*$/, "");
            const relative = urlPath.startsWith("/convert/")
                ? urlPath.slice("/convert/".length)
                : urlPath.slice(1);

            // Try the exact path, then index.html for directory requests
            const candidates = [
                join(DIST_DIR, relative),
                join(DIST_DIR, relative, "index.html"),
            ];

            let filePath: string | null = null;
            for (const candidate of candidates) {
                if (existsSync(candidate) && statSync(candidate).isFile()) {
                    filePath = candidate;
                    break;
                }
            }

            if (!filePath) {
                res.writeHead(404);
                res.end("Not found");
                return;
            }

            const ext = extname(filePath).toLowerCase();
            const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
            readFile(filePath, (err, data) => {
                if (err) {
                    res.writeHead(500);
                    res.end("Read error");
                    return;
                }
                res.writeHead(200, { "Content-Type": contentType });
                res.end(data);
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

    // Register cleanup handlers once — only when the bridge is first used
    if (!signalHandlersRegistered) {
        signalHandlersRegistered = true;
        process.on("exit", () => {
            browser?.close().catch(() => {});
            staticServer?.close();
        });
        process.on("SIGINT",  () => process.exit(0));
        process.on("SIGTERM", () => process.exit(0));
    }

    const attempt = (async () => {
        const port = await startStaticServer();

        // Dynamically import puppeteer to avoid loading it at module parse time
        const puppeteer = (await import("puppeteer")).default;

        browser = await puppeteer.launch({ headless: true });
        bridgePage = await browser.newPage();

        // Suppress noisy console output from the headless page
        bridgePage.on("console", msg => {
            if (msg.text() === "frogConvert headless ready") {
                process.stderr.write("[bridge] headless page ready\n");
            }
        });

        await bridgePage.goto(`http://127.0.0.1:${port}/convert/headless/`, {
            waitUntil: "load",
            timeout: 120_000,
        });

        // Wait for all handlers to initialise (set by src/headless/index.ts)
        await bridgePage.waitForFunction(
            () => (window as any).__headlessReady === true,
            { timeout: 120_000 }
        );
    })();

    // Cache the promise but clear it on failure so callers can retry
    initPromise = attempt.catch(err => {
        initPromise = null;
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
    outputExtension: string
): Promise<BridgeResult[]> {
    await ensureInitialized();

    // Serialise calls so concurrent conversions don't interleave on the shared page.
    // conversionQueue must always stay fulfilled so subsequent items aren't skipped
    // on failure — keep the queue chain alive by catching errors on the queue ref,
    // while the caller-facing result promise still rejects normally.
    const result = conversionQueue.then(() =>
        bridgePage!.evaluate(
            (fn, fm, b64, im, ie, om, oe) =>
                (window as any)[fn](fm, b64, im, ie, om, oe),
            "__frogConvertHeadless",
            fileName,
            base64Bytes,
            inputMime,
            inputExtension,
            outputMime,
            outputExtension
        )
    );
    conversionQueue = result.catch(() => {});

    return result as Promise<BridgeResult[]>;
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
        // Bridge not running — don't start it just for a path check.
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
