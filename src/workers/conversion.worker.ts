import type { FileData, FileFormat, FormatHandler } from "../core/FormatHandler/FormatHandler.ts";
import handlers, { loadBackgroundHandlers } from "../handlers/index.ts";

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
    | { id: number; type: "error"; error: string; };

// Shared promise so concurrent requests don't trigger multiple background loads
let backgroundHandlersPromise: Promise<void> | null = null;

async function getHandler(name: string): Promise<FormatHandler | undefined> {
    // Check statically imported handlers first
    let handler = handlers.find(h => h.name === name);
    if (handler) {
        if (!handler.ready) {
            await handler.init();
        }
        return handler;
    }

    // Load background handlers once; concurrent calls await the same promise
    if (!backgroundHandlersPromise) {
        backgroundHandlersPromise = loadBackgroundHandlers();
    }
    await backgroundHandlersPromise;

    handler = handlers.find(h => h.name === name);
    if (handler) {
        if (!handler.ready) {
            await handler.init();
        }
        return handler;
    }
    return undefined;
}

self.onmessage = async (ev: MessageEvent<ConvertRequestMessage>) => {
    const msg = ev.data;
    const { id, handlerName, inputFiles, inputFormat, outputFormat, args } = msg;

    try {
        const handler = await getHandler(handlerName);
        if (!handler) {
            throw new Error(`Handler "${handlerName}" not found in worker.`);
        }

        if (handler.requiresMainThread) {
            throw new Error(`Handler "${handlerName}" requires the main thread and cannot be run in a worker.`);
        }

        const outputFiles = await handler.doConvert(inputFiles, inputFormat, outputFormat, args);

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
