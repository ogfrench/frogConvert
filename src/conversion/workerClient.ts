import type { FileData, FileFormat, ProgressEvent } from "../core/FormatHandler/FormatHandler.ts";
import {
    isCancelled,
    setWorkerCancelCallback,
    setForceCleanupCallback,
} from "./cancellation.ts";

/**
 * Shared client for the conversion worker.
 *
 * Extracted from actions.ts so surfaces other than the Convert card (the
 * Compress workspace) can run a handler off the main thread without importing
 * the whole convert pipeline. The worker itself is format-agnostic — it just
 * resolves a handler by name and calls doConvert — so a single shared instance
 * serves every surface. Only one surface is active at a time, which is also
 * what makes sharing the cancellation singletons safe.
 */

let conversionWorker: Worker | null = null;
let workerMsgId = 0;
export const WORKER_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
let workerErrorCallback: ((e: ErrorEvent) => void) | null = null;

function getConversionWorker(): Worker {
    if (!conversionWorker) {
        conversionWorker = new Worker(new URL("../workers/conversion.worker.ts", import.meta.url), { type: "module" });
        conversionWorker.onerror = (err) => {
            // Worker crashed - reject the in-flight promise with a real error, then discard the dead worker
            const cb = workerErrorCallback;
            workerErrorCallback = null;
            setWorkerCancelCallback(null);
            conversionWorker = null;
            cb?.(err);
        };
    }
    return conversionWorker;
}

// bfcache restore: drop stale worker ref so getConversionWorker() re-spawns.
if (typeof window !== "undefined") {
    window.addEventListener("pageshow", (ev) => {
        if ((ev as PageTransitionEvent).persisted) {
            if (conversionWorker) {
                try { conversionWorker.terminate(); } catch { /* already gone */ }
                conversionWorker = null;
            }
        }
    });
}

export async function runInWorker(handlerName: string, inputFiles: FileData[], inputFormat: FileFormat, outputFormat: FileFormat, args?: string[], onProgress?: (p: ProgressEvent) => void): Promise<FileData[]> {
    const worker = getConversionWorker();
    const id = ++workerMsgId;
    return new Promise((resolve, reject) => {
        if (isCancelled) { reject(new Error("Cancelled")); return; }

        const cleanup = () => {
            clearTimeout(timeoutId);
            worker.removeEventListener("message", onMessage);
            setWorkerCancelCallback(null);
            // Also cleared: a stale force-cleanup callback still holds this
            // promise's reject and would terminate the shared worker on a
            // later hard-cancel that has nothing to do with this call. Only
            // the convert flow's resetCancellation() used to clear it, so a
            // Compress run left one behind indefinitely.
            setForceCleanupCallback(null);
            workerErrorCallback = null;
        };

        const onMessage = (ev: MessageEvent) => {
            const msg = ev.data;
            if (msg.id !== id) return;
            if (msg.type === "progress") {
                onProgress?.({ ratio: msg.ratio, detail: msg.detail });
                return;
            }
            cleanup();
            if (msg.type === "success") {
                resolve(msg.outputFiles);
            } else {
                reject(msg.error);
            }
        };

        const timeoutId = setTimeout(() => {
            cleanup();
            reject(new Error(`Conversion timed out after ${WORKER_TIMEOUT_MS / 60000} minutes.`));
        }, WORKER_TIMEOUT_MS);

        worker.addEventListener("message", onMessage);
        setWorkerCancelCallback(() => {
            cleanup();
            worker.terminate();
            conversionWorker = null;
            reject(new Error("Cancelled"));
        });
        // Hard-cancel fallback if the normal cancel path doesn't bring us down.
        setForceCleanupCallback(() => {
            cleanup();
            try { worker.terminate(); } catch { /* already terminated */ }
            conversionWorker = null;
            reject(new Error("Cancelled (forced)"));
        });
        workerErrorCallback = (err: ErrorEvent) => {
            cleanup();
            reject(new Error(`Conversion worker crashed: ${err.message}`));
        };
        // Copy bytes before transferring - originals must remain usable if this path fails and another is retried
        const inputCopies = inputFiles.map(f => ({ ...f, bytes: f.bytes.slice() }));
        const transferables = inputCopies.map(f => f.bytes.buffer).filter(b => b.byteLength > 0);
        worker.postMessage({ id, handlerName, inputFiles: inputCopies, inputFormat, outputFormat, args }, transferables);
    });
}
