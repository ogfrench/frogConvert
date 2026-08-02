import type { FileData, FileFormat, FormatHandler, ProgressEvent } from "../core/FormatHandler/FormatHandler.ts";
import handlers, { loadBackgroundHandlers } from "../handlers/index.ts";
import { ensureHandlerInit } from "./handlerInit.ts";

export type ConvertRequestMessage = {
    id: number;
    handlerName: string;
    inputFiles: FileData[];
    inputFormat: FileFormat;
    outputFormat: FileFormat;
    args?: string[];
};

export type ConvertResponseMessage =
    | { id: number; type: "success"; outputFiles: FileData[]; }
    | { id: number; type: "error"; error: string; }
    | { id: number; type: "progress"; ratio?: number; detail?: string; };

// Shared promise so concurrent requests don't trigger multiple background loads
let backgroundHandlersPromise: Promise<void> | null = null;

async function getHandler(name: string): Promise<FormatHandler | undefined> {
    // Check statically imported handlers first
    let handler = handlers.find(h => h.name === name);
    if (handler) {
        await ensureHandlerInit(handler);
        return handler;
    }

    // Load background handlers once; concurrent calls await the same promise
    if (!backgroundHandlersPromise) {
        backgroundHandlersPromise = loadBackgroundHandlers();
    }
    await backgroundHandlersPromise;

    handler = handlers.find(h => h.name === name);
    if (handler) {
        await ensureHandlerInit(handler);
        return handler;
    }
    return undefined;
}

self.onmessage = async (ev: MessageEvent<ConvertRequestMessage>) => {
    const msg = ev.data;
    const { id, handlerName, inputFiles, inputFormat, outputFormat, args } = msg;

    const post = (m: ConvertResponseMessage) => (self as any).postMessage(m);

    try {
        // The worker keeps its own handler instances, so an engine already
        // loaded on the main thread still has to be fetched and compiled again
        // here - 32 MB for FFmpeg, 14 MB for ImageMagick. `getHandler` awaits
        // that init before `doConvert` is ever called, which put it outside the
        // reach of any progress callback: on both Convert and Compress it was a
        // silent stall with the previous phase's wording still on screen.
        //
        // Ghostscript is unaffected either way - it defers its load to
        // `loadOnce()` inside doConvert, which is why its download percentage
        // has always reached the modal.
        post({ id, type: "progress", detail: "Getting the engine ready" });
        const handler = await getHandler(handlerName);
        if (!handler) {
            throw new Error(`Handler "${handlerName}" not found in worker.`);
        }

        if (handler.requiresMainThread) {
            throw new Error(`Handler "${handlerName}" requires the main thread and cannot be run in a worker.`);
        }

        const onProgress = (p: ProgressEvent) => {
            const msg: ConvertResponseMessage = { id, type: "progress", ratio: p.ratio, detail: p.detail };
            (self as any).postMessage(msg);
        };
        const outputFiles = await handler.doConvert(inputFiles, inputFormat, outputFormat, args, onProgress);

        // Transfer ArrayBuffers back to main thread to avoid copy overhead
        const transferables = outputFiles
            .map(f => f.bytes.buffer)
            .filter((b): b is ArrayBuffer => b instanceof ArrayBuffer && b.byteLength > 0);
        const response: ConvertResponseMessage = { id, type: "success", outputFiles };

        (self as any).postMessage(response, transferables);
    } catch (e: any) {
        const response: ConvertResponseMessage = { id, type: "error", error: String(e) };
        (self as any).postMessage(response);
    }
};
