import {
    OFFICE_ENGINE_BASE, OFFICE_ENGINE_CACHE, OFFICE_ENGINE_FILES, OFFICE_ENGINE_API,
    OFFICE_ENGINE_MANIFEST_URL, OFFICE_ENGINE_VERSION, type OfficeEngineFile, type OfficeEngineManifest,
} from "./officeEngineAssets.ts";

/**
 * The browser Office engine: LibreOffice compiled to WebAssembly, downloaded
 * once on request and kept in Cache Storage.
 *
 * UI-free on purpose, like src/core/compression: the Converter asks
 * `officeEngineSupport()` what to offer, calls `downloadOfficeEngine()` when the
 * user agrees, and the libreoffice handler calls `openOfficeEngine()`.
 *
 * Requires SharedArrayBuffer (cross-origin isolation, set in netlify.toml),
 * peaks around 1.5 GB of memory, and is ~78 MB to fetch. The download is
 * user-initiated on every device; a touchscreen is not a capability failure.
 */

export type OfficeEngineSupport = "unsupported" | "available" | "cached";

export interface OfficeEngineProgress {
    loaded: number;
    total: number;
    stage?: "downloading" | "unpacking" | "saving";
}

/** The subset of the package's WorkerBrowserConverter this app uses. */
export interface OfficeConverter {
    initialize(): Promise<void>;
    convert(
        data: Uint8Array,
        options: { outputFormat: string; inputFormat?: string },
        filename?: string,
    ): Promise<{ data: Uint8Array }>;
    destroy(): Promise<void> | void;
}

type ConverterModule = {
    WorkerBrowserConverter: new (options: Record<string, string>) => OfficeConverter;
};

const fileUrl = (name: string) => `${OFFICE_ENGINE_BASE}/${name}`;

/** Big files are handed to the engine as blob: URLs; these are the ones fetched from the server as is. */
const BLOB_FILES = new Set<string>([OFFICE_ENGINE_FILES.sofficeWasm, OFFICE_ENGINE_FILES.sofficeData]);

export function canRunOfficeEngine(): boolean {
    return typeof window !== "undefined"
        && window.crossOriginIsolated === true
        && typeof caches !== "undefined"
        && typeof DecompressionStream !== "undefined"
        && typeof SharedArrayBuffer !== "undefined"
        && typeof Worker !== "undefined"
        && typeof WebAssembly !== "undefined";
}

/** Refuse hostile or stale manifests before allocating any binary buffers. */
function validManifest(value: unknown): value is OfficeEngineManifest {
    if (!value || typeof value !== "object") return false;
    const m = value as OfficeEngineManifest;
    if (m.version !== OFFICE_ENGINE_VERSION || !Array.isArray(m.files)
        || !Number.isSafeInteger(m.downloadSize) || m.downloadSize <= 0
        || m.downloadSize > 350 * 1024 * 1024) return false;
    const required = new Set(BLOB_FILES);
    let sum = 0;
    for (const file of m.files) {
        if (!file || typeof file.name !== "string") return false;
        if (!BLOB_FILES.has(file.name)) continue;
        if (!required.delete(file.name) || !file.gzip || !Number.isSafeInteger(file.size)
            || file.size <= 0 || file.size > 350 * 1024 * 1024
            || !Array.isArray(file.parts) || file.parts.length === 0) return false;
        for (const part of file.parts) {
            if (!part || typeof part.name !== "string"
                || !part.name.startsWith(file.name + ".gz.")
                || !/^soffice\.(wasm|data)\.gz\.\d{3}$/.test(part.name)
                || !Number.isSafeInteger(part.size) || part.size <= 0 || part.size > 21 * 1024 * 1024
                || (part.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(part.sha256))) return false;
            sum += part.size;
        }
    }
    return required.size === 0 && sum <= m.downloadSize;
}

async function fetchManifest(): Promise<OfficeEngineManifest | null> {
    try {
        const resp = await fetch(OFFICE_ENGINE_MANIFEST_URL, { cache: "no-cache" });
        if (!resp.ok) return null;
        const manifest: unknown = await resp.json();
        return validManifest(manifest) ? manifest : null;
    } catch {
        return null;
    }
}

/** The manifest is stored last, so its presence in the cache means every file made it. */
async function cachedManifest(): Promise<OfficeEngineManifest | null> {
    try {
        const cache = await caches.open(OFFICE_ENGINE_CACHE);
        const resp = await cache.match(OFFICE_ENGINE_MANIFEST_URL);
        if (!resp) return null;
        const manifest: unknown = await resp.json();
        if (!validManifest(manifest)) return null;
        for (const f of manifest.files) {
            if (BLOB_FILES.has(f.name) && !(await cache.match(fileUrl(f.name)))) return null;
        }
        return manifest;
    } catch {
        return null;
    }
}

export async function isOfficeEngineCached(): Promise<boolean> {
    return canRunOfficeEngine() && (await cachedManifest()) !== null;
}

let supportProbe: Promise<OfficeEngineSupport> | null = null;

/** What the Converter can offer. Cached per page load once it reaches a verdict. */
export function officeEngineSupport(): Promise<OfficeEngineSupport> {
    supportProbe ??= (async (): Promise<OfficeEngineSupport> => {
        if (!canRunOfficeEngine()) return "unsupported";
        if (await cachedManifest()) return "cached";
        return (await fetchManifest()) ? "available" : "unsupported";
    })();
    return supportProbe;
}

/** Bytes the download will take, for the button label. Null when the engine is not deployed. */
export async function officeEngineDownloadSize(): Promise<number | null> {
    return (await fetchManifest())?.downloadSize ?? null;
}

class OfficePartError extends Error {
    constructor(message: string, readonly retryable = false) { super(message); }
}

/** A 20 MiB compressed part is the upper bound on JS download buffering. */
async function readPart(
    part: OfficeEngineFile["parts"][number],
    signal: AbortSignal | undefined,
    onBytes: (n: number) => void,
): Promise<Uint8Array> {
    const url = fileUrl(part.name);
    for (let attempt = 0; attempt < 3; attempt++) {
        signal?.throwIfAborted();
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal?.addEventListener("abort", abort, { once: true });
        let timer: ReturnType<typeof setTimeout> | undefined;
        const resetTimeout = () => {
            clearTimeout(timer);
            timer = setTimeout(abort, 60_000);
        };
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        try {
            resetTimeout();
            const resp = await fetch(url, { signal: controller.signal });
            if (!resp.ok || !resp.body) throw new OfficePartError(
                `Office engine part ${part.name} returned HTTP ${resp.status}.`,
                resp.status === 408 || resp.status === 429 || resp.status >= 500,
            );
            const bytes = new Uint8Array(part.size);
            reader = resp.body.getReader();
            let received = 0;
            for (;;) {
                const { done, value } = await reader.read();
                signal?.throwIfAborted();
                if (done) break;
                resetTimeout();
                if (received + value.byteLength > bytes.length) {
                    throw new OfficePartError(`Office engine part ${part.name} exceeded its expected size.`);
                }
                bytes.set(value, received);
                received += value.byteLength;
                onBytes(received);
            }
            if (received !== part.size) throw new OfficePartError(
                `Office engine part ${part.name} was incomplete (${received} of ${part.size} bytes).`, true,
            );
            if (part.sha256) {
                const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
                const actual = Array.from(hash, n => n.toString(16).padStart(2, "0")).join("");
                if (actual !== part.sha256) throw new OfficePartError(
                    `Office engine part ${part.name} failed integrity verification.`, true,
                );
            }
            return bytes;
        } catch (error) {
            if (signal?.aborted) throw new DOMException("Office engine download aborted", "AbortError");
            const failure = error instanceof OfficePartError ? error : new OfficePartError(
                `Could not fetch Office engine part ${part.name}: ${String(error)}`, true,
            );
            if (!failure.retryable || attempt === 2) throw failure;
            onBytes(0);
            await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener("abort", abort);
            await reader?.cancel().catch(() => {});
        }
    }
    throw new Error("Office engine retry limit reached.");
}

function contentType(name: string): string {
    if (name.endsWith(".wasm")) return "application/wasm";
    if (name.endsWith(".js")) return "text/javascript";
    return "application/octet-stream";
}

/**
 * Stream compressed parts through gzip and into Cache Storage. A part is
 * fully validated before it enters the stream. The completion manifest is last.
 */
export async function downloadOfficeEngine(
    onProgress?: (p: OfficeEngineProgress) => void,
    signal?: AbortSignal,
): Promise<void> {
    const install = async () => {
        signal?.throwIfAborted();
        if (await cachedManifest()) return;
        const manifest = await fetchManifest();
        if (!manifest) throw new Error("The Office engine manifest is missing or invalid.");
        const total = manifest.downloadSize;
        let loaded = 0;
        const cache = await caches.open(OFFICE_ENGINE_CACHE);
        const report = (stage: OfficeEngineProgress["stage"], bytes = loaded) =>
            onProgress?.({ loaded: bytes, total, stage });
        try {
            // CacheStorage can exist in private mode while writes fail.
            const probeUrl = fileUrl(".storage-probe");
            await cache.put(probeUrl, new Response("ok"));
            await cache.delete(probeUrl);

            for (const file of manifest.files) {
                if (!BLOB_FILES.has(file.name)) continue;
                let index = 0;
                const parts = new ReadableStream<Uint8Array>({
                    async pull(controller) {
                        try {
                            signal?.throwIfAborted();
                            if (index === file.parts.length) {
                                controller.close();
                                report("unpacking");
                                return;
                            }
                            const part = file.parts[index++];
                            const bytes = await readPart(part, signal, current => report("downloading", loaded + current));
                            loaded += bytes.byteLength;
                            controller.enqueue(bytes);
                        } catch (error) {
                            controller.error(error);
                        }
                    },
                });
                let expanded = 0;
                const verifySize = new TransformStream<Uint8Array, Uint8Array>({
                    transform(bytes, controller) {
                        expanded += bytes.byteLength;
                        if (expanded > file.size) {
                            throw new Error(`Office engine ${file.name} exceeded its expected unpacked size.`);
                        }
                        controller.enqueue(bytes);
                    },
                    flush() {
                        if (expanded !== file.size) throw new Error(
                            `Office engine download was incomplete (${file.name}: ${expanded} of ${file.size} bytes).`,
                        );
                    },
                });
                // Cache.put consumes the response body; never build a ~250 MB JS Blob.
                const unpacked = parts.pipeThrough(new DecompressionStream("gzip")).pipeThrough(verifySize);
                await cache.put(fileUrl(file.name), new Response(unpacked, {
                    headers: { "content-type": contentType(file.name) },
                }));
                report("saving");
            }
            signal?.throwIfAborted();
            await cache.put(OFFICE_ENGINE_MANIFEST_URL, new Response(JSON.stringify(manifest), {
                headers: { "content-type": "application/json" },
            }));
        } catch (err) {
            await caches.delete(OFFICE_ENGINE_CACHE).catch(() => {});
            if (err instanceof DOMException && err.name === "QuotaExceededError") {
                throw new Error("Not enough browser storage for the Office engine. Private mode may have a lower limit.");
            }
            if (signal?.aborted) throw new DOMException("Office engine download aborted", "AbortError");
            if (err instanceof OfficePartError) throw err;
            throw new Error(`Office engine unpacking or storage failed: ${String(err)}`);
        }
        supportProbe = Promise.resolve("cached");
        await navigator.storage?.persist?.().catch(() => false);
    };
    // Same-origin tabs must not race while clearing an incomplete installation.
    if (navigator.locks?.request) {
        await navigator.locks.request("frogconvert-office-engine-install", { mode: "exclusive" }, install);
    } else {
        await install();
    }
}

/**
 * Start the engine from the cached files. The big files go in as blob: URLs
 * (the server only has their gzipped parts); the small scripts load from the
 * server, so they stay under the CSP's script-src 'self'.
 */
export async function openOfficeEngine(): Promise<OfficeConverter> {
    const cache = await caches.open(OFFICE_ENGINE_CACHE);
    const urls: Record<string, string> = {};
    const blobUrls: string[] = [];
    let released = false;
    const release = () => {
        if (released) return;
        released = true;
        for (const url of blobUrls) URL.revokeObjectURL(url);
    };
    // WorkerBrowserConverter 2.7.2 uses a TS-private (not #private) worker.
    // Its destroy() waits for an acknowledgement before terminate(), which
    // never arrives if LibreOfficeKit is hung. The asset version is pinned.
    type BrowserWorkerConverter = OfficeConverter & { worker?: Worker | null };
    let converter: BrowserWorkerConverter | undefined;
    const terminateWorker = () => {
        const worker = converter?.worker;
        if (!worker) return false;
        worker.terminate();
        return true;
    };

    try {
        for (const [option, name] of Object.entries(OFFICE_ENGINE_FILES)) {
            if (!BLOB_FILES.has(name)) {
                urls[option] = new URL(fileUrl(name), location.href).href;
                continue;
            }
            const resp = await cache.match(fileUrl(name));
            if (!resp) throw new Error("The Office engine isn't downloaded on this device.");
            const url = URL.createObjectURL(await resp.blob());
            blobUrls.push(url);
            urls[option] = url;
        }
        const mod = await import(/* @vite-ignore */ fileUrl(OFFICE_ENGINE_API)) as ConverterModule;
        converter = new mod.WorkerBrowserConverter(urls) as BrowserWorkerConverter;
        let startupTimer: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([
                converter.initialize(),
                new Promise<never>((_, reject) => {
                    startupTimer = setTimeout(() => reject(new Error(
                        "Office engine initialization timed out. Reload the page and try again.",
                    )), 60_000);
                }),
            ]);
        } finally {
            clearTimeout(startupTimer);
        }
        const active = converter;
        // Keep the binary blob URLs alive until the worker is actually stopped.
        return {
            initialize: () => active.initialize(),
            convert: (data, options, filename) => active.convert(data, options, filename),
            destroy: async () => {
                let stopTimer: ReturnType<typeof setTimeout> | undefined;
                try {
                    await Promise.race([
                        active.destroy(),
                        new Promise<never>((_, reject) => {
                            stopTimer = setTimeout(() => reject(new Error("Worker did not stop")), 3_000);
                        }),
                    ]);
                } catch {
                    // Do not start another ~1.5 GB engine unless termination
                    // can be confirmed. The pinned 2.7.2 converter exposes its
                    // worker as a TS-private property.
                    if (!terminateWorker()) {
                        throw new Error("The Office engine could not be stopped safely. Reload the page before retrying.");
                    }
                } finally {
                    clearTimeout(stopTimer);
                    release();
                }
            },
        };
    } catch (err) {
        terminateWorker();
        release();
        throw err;
    }
}
