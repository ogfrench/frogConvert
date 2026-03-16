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
 */

import type { FileData, FileFormat } from "../core/FormatHandler/FormatHandler.ts";
import { TraversionGraph } from "../core/TraversionGraph/TraversionGraph.ts";
import handlers, { loadBackgroundHandlers } from "../handlers/index.ts";
import { findFormatAndHandler } from "../mcp/core/utils.ts";

let graph: TraversionGraph | null = null;
let readyHandlers: typeof handlers = [];

async function init() {
    try {
        // Load all handlers (background phase loads remaining ones including browser-only)
        await loadBackgroundHandlers();

        // Initialize every handler
        await Promise.all(
            handlers.map(h => h.init ? h.init().catch(() => {}) : Promise.resolve())
        );

        readyHandlers = handlers.filter(h => h.ready);

        // Build the format cache
        const supportedFormatCache = new Map<string, FileFormat[]>();
        readyHandlers.forEach(h => supportedFormatCache.set(h.name, h.supportedFormats || []));

        // Store on window so the app's own code can access it if needed
        window.supportedFormatCache = supportedFormatCache;

        graph = new TraversionGraph();
        graph.init(supportedFormatCache, readyHandlers, false);
        window.traversionGraph = graph;

        console.log("frogConvert headless ready");
    } catch (e) {
        console.error("frogConvert headless init failed:", e);
    } finally {
        // Always signal readiness so the bridge doesn't hang 120s on init failure.
        // If graph is null, subsequent conversion calls will throw a clear error.
        (window as any).__headlessReady = true;
    }
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

(window as any).__frogConvertHeadless = async (
    fileName: string,
    base64: string,
    inputMime: string,
    inputExt: string,
    outputMime: string,
    outputExt: string
): Promise<Array<{ fileName: string; base64Bytes: string }>> => {
    if (!graph) throw new Error("Headless not yet initialized");

    const inputMatch = findFormatAndHandler(readyHandlers, inputMime, inputExt, 'from');
    const outputMatch = findFormatAndHandler(readyHandlers, outputMime, outputExt, 'to');

    if (!inputMatch) throw new Error(`Input format ${inputMime} (${inputExt}) not found`);
    if (!outputMatch) throw new Error(`Output format ${outputMime} (${outputExt}) not found`);

    const pathsGen = graph.searchPath(
        { format: inputMatch.format, handler: inputMatch.handler },
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
        const prevFormat = path[i - 1].format;
        const nextFormat = path[i].format;
        currentFiles = await stepHandler.doConvert(currentFiles, prevFormat, nextFormat);
    }

    return currentFiles.map(f => ({
        fileName: f.name,
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

    const inputMatch = findFormatAndHandler(readyHandlers, inputMime, inputExt, 'from');
    const outputMatch = findFormatAndHandler(readyHandlers, outputMime, outputExt, 'to');

    if (!inputMatch || !outputMatch) return false;

    const pathsGen = graph.searchPath(
        { format: inputMatch.format, handler: inputMatch.handler },
        { format: outputMatch.format, handler: outputMatch.handler },
        false
    );

    const pathResult = await pathsGen.next();
    return !pathResult.done && !!pathResult.value;
};

init();
