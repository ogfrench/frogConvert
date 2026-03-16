/**
 * frogConvert headless entry point.
 *
 * Loads ALL handlers (including browser-only ones that require Canvas/WebGL/
 * AudioContext) and exposes a conversion API on window for use by the
 * Puppeteer browser bridge (src/mcp/core/browserBridge.ts).
 *
 * This module is built as a separate Vite MPA entry and served at
 * /convert/headless/ so that WASM assets at /convert/wasm/ are reachable
 * from the same origin.
 *
 * Init strategy: fetch cache.json to build the TraversionGraph immediately
 * (no handler.init() calls), signal __headlessReady, then pre-warm all handlers
 * in parallel in the background so WASM is compiled before the first conversion.
 */

import type { FileData, FileFormat, FormatHandler } from "../core/FormatHandler/FormatHandler.ts";
import { TraversionGraph } from "../core/TraversionGraph/TraversionGraph.ts";
import handlers, { loadBackgroundHandlers } from "../handlers/index.ts";

let graph: TraversionGraph | null = null;
let supportedFormatCache: Map<string, FileFormat[]> | null = null;

// Module-level map so the same handler is never inited twice across calls
const handlerInitPromises = new Map<FormatHandler, Promise<void>>();

async function init() {
    try {
        // Run background handler loading and cache fetch in parallel.
        // BASE_URL is injected by Vite (e.g. "/convert/") so cache.json is
        // always found relative to the deployment root regardless of page location.
        const [, cacheData] = await Promise.all([
            loadBackgroundHandlers(),
            fetch(import.meta.env.BASE_URL + "cache.json").then(r => {
                if (!r.ok) throw new Error(`cache.json fetch failed: ${r.status} ${r.statusText}`);
                return r.json();
            })
        ]);

        // cacheData is a JSON-serialised Map — array of [handlerName, FileFormat[]] pairs
        supportedFormatCache = new Map<string, FileFormat[]>(cacheData);
        window.supportedFormatCache = supportedFormatCache;

        graph = new TraversionGraph();
        graph.init(supportedFormatCache, handlers, false);
        window.traversionGraph = graph;

        console.log("frogConvert headless ready");
    } catch (e) {
        console.error("frogConvert headless init failed:", e);
    } finally {
        // Always signal readiness so the bridge doesn't hang on init failure.
        // If graph is null, subsequent conversion calls will throw a clear error.
        (window as any).__headlessReady = true;
    }

    // Pre-warm all handlers in parallel so WASM is compiled before the first
    // conversion request arrives. Errors are swallowed — lazy init per-conversion
    // will surface them with a clear message if a handler truly can't be used.
    Promise.all(handlers.map(h => ensureHandlerReady(h).catch(() => {})));
}

/** Encode Uint8Array to base64 without O(n²) string concatenation. */
function uint8ToBase64(bytes: Uint8Array): string {
    const chunkSize = 0x8000; // 32 KB chunks to avoid stack overflow on large arrays
    let binary = "";
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

/**
 * Look up a format+handler pair from the pre-fetched cache.
 *
 * Heavy handlers (FFmpeg, pandoc, …) only populate handler.supportedFormats
 * after init() runs, so we cannot search handler instances directly.
 * Instead we search supportedFormatCache (fetched from cache.json) and
 * resolve the handler object by name — no init() required.
 */
function findFromCache(
    mime: string,
    extension: string,
    direction: 'from' | 'to'
): { format: FileFormat; handler: FormatHandler } | undefined {
    if (!supportedFormatCache) return undefined;
    for (const [handlerName, formats] of supportedFormatCache) {
        const handler = handlers.find(h => h.name === handlerName);
        if (!handler) continue;
        for (const f of formats) {
            if (f.mime === mime && (f.extension === extension || f.format === extension)) {
                if (direction === 'from' && !f.from) continue;
                if (direction === 'to'   && !f.to)   continue;
                return { format: f, handler };
            }
        }
    }
    return undefined;
}

/** Ensure a handler is initialised, deduplicating concurrent init calls. */
async function ensureHandlerReady(handler: FormatHandler): Promise<void> {
    if (handler.ready) return;
    if (!handler.init) return;
    if (!handlerInitPromises.has(handler)) {
        handlerInitPromises.set(handler, handler.init());
    }
    await handlerInitPromises.get(handler);
    if (!handler.ready) {
        throw new Error(`Handler '${handler.name}' failed to initialise`);
    }
}

(window as any).__frogConvertHeadless = async (
    fileName: string,
    base64: string,
    inputMime: string,
    inputExt: string,
    outputMime: string,
    outputExt: string
): Promise<Array<{ fileName: string; base64Bytes: string }>> => {
    if (!graph) throw new Error("Headless not yet initialized");

    // Resolve formats from cache — handler.supportedFormats may be empty for
    // heavy handlers (FFmpeg, pandoc) until their init() has run.
    const inputMatch  = findFromCache(inputMime,  inputExt,  'from');
    const outputMatch = findFromCache(outputMime, outputExt, 'to');

    if (!inputMatch)  throw new Error(`Input format ${inputMime} (${inputExt}) not found`);
    if (!outputMatch) throw new Error(`Output format ${outputMime} (${outputExt}) not found`);

    const pathsGen = graph.searchPath(
        { format: inputMatch.format,  handler: inputMatch.handler  },
        { format: outputMatch.format, handler: outputMatch.handler },
        false
    );

    const pathResult = await pathsGen.next();
    if (pathResult.done || !pathResult.value) {
        throw new Error(`No conversion path found between ${inputMime} and ${outputMime}`);
    }

    const path = pathResult.value;

    // Decode base64 → Uint8Array
    const binaryStr = atob(base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

    let currentFiles: FileData[] = [{ name: fileName, bytes }];

    for (let i = 1; i < path.length; i++) {
        const stepHandler = path[i].handler;
        const prevFormat  = path[i - 1].format;
        const nextFormat  = path[i].format;

        // Lazy init: only initialise the handler when we actually need it.
        // Throws clearly if init fails rather than silently continuing.
        await ensureHandlerReady(stepHandler);

        currentFiles = await stepHandler.doConvert(currentFiles, prevFormat, nextFormat);
    }

    return currentFiles.map(f => ({
        fileName:    f.name,
        base64Bytes: uint8ToBase64(f.bytes),
    }));
};

(window as any).__frogConvertCanConvert = async (
    inputMime: string,
    inputExt: string,
    outputMime: string,
    outputExt: string
): Promise<boolean> => {
    if (!graph) return false;

    const inputMatch  = findFromCache(inputMime,  inputExt,  'from');
    const outputMatch = findFromCache(outputMime, outputExt, 'to');

    if (!inputMatch || !outputMatch) return false;

    const pathsGen = graph.searchPath(
        { format: inputMatch.format,  handler: inputMatch.handler  },
        { format: outputMatch.format, handler: outputMatch.handler },
        false
    );

    const pathResult = await pathsGen.next();
    return !pathResult.done && !!pathResult.value;
};

init();
