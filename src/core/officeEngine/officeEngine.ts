import {
    OFFICE_ENGINE_BASE, OFFICE_ENGINE_CACHE, OFFICE_ENGINE_FILES, OFFICE_ENGINE_API,
    OFFICE_ENGINE_MANIFEST_URL, type OfficeEngineManifest,
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

export interface OfficeEngineProgress { loaded: number; total: number }

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

async function fetchManifest(): Promise<OfficeEngineManifest | null> {
    try {
        const resp = await fetch(OFFICE_ENGINE_MANIFEST_URL, { cache: "no-cache" });
        if (!resp.ok) return null;
        const manifest = await resp.json() as OfficeEngineManifest;
        return Array.isArray(manifest?.files) ? manifest : null;
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
        const manifest = await resp.json() as OfficeEngineManifest;
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

async function readPart(url: string, signal: AbortSignal | undefined, onBytes: (n: number) => void): Promise<Uint8Array[]> {
    const resp = await fetch(url, { signal });
    if (!resp.ok || !resp.body) throw new Error(`Couldn't download the Office engine (${resp.status} on ${url})`);
    const chunks: Uint8Array[] = [];
    const reader = resp.body.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        onBytes(value.byteLength);
    }
    return chunks;
}

function contentType(name: string): string {
    if (name.endsWith(".wasm")) return "application/wasm";
    if (name.endsWith(".js")) return "text/javascript";
    return "application/octet-stream";
}

/**
 * Download the engine, join and decompress its parts, check each file's size
 * against the manifest, and store it. Throws on any failure and leaves no
 * half-stored engine behind.
 */
export async function downloadOfficeEngine(
    onProgress?: (p: OfficeEngineProgress) => void,
    signal?: AbortSignal,
): Promise<void> {
    const manifest = await fetchManifest();
    if (!manifest) throw new Error("The Office engine isn't available on this site.");
    const total = manifest.downloadSize;
    let loaded = 0;
    const cache = await caches.open(OFFICE_ENGINE_CACHE);
    try {
        for (const file of manifest.files) {
            if (!BLOB_FILES.has(file.name)) continue;
            const chunks: Uint8Array[] = [];
            for (const part of file.parts) {
                chunks.push(...await readPart(fileUrl(part.name), signal, n => {
                    loaded += n;
                    onProgress?.({ loaded, total });
                }));
            }
            let blob = new Blob(chunks as BlobPart[]);
            if (file.gzip) {
                blob = await new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).blob();
            }
            if (blob.size !== file.size) {
                throw new Error(`The Office engine download was incomplete (${file.name}: ${blob.size} of ${file.size} bytes).`);
            }
            await cache.put(fileUrl(file.name), new Response(blob, { headers: { "content-type": contentType(file.name) } }));
        }
        await cache.put(OFFICE_ENGINE_MANIFEST_URL, new Response(JSON.stringify(manifest), {
            headers: { "content-type": "application/json" },
        }));
    } catch (err) {
        await caches.delete(OFFICE_ENGINE_CACHE).catch(() => {});
        if (err instanceof DOMException && err.name === "QuotaExceededError") {
            throw new Error("There isn't enough free storage on this device for the Office engine.");
        }
        throw err;
    }
    supportProbe = Promise.resolve("cached");
    // Ask the browser not to evict ~250 MB under storage pressure. Best effort:
    // a refusal only means the engine may have to be downloaded again later.
    await navigator.storage?.persist?.().catch(() => false);
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
