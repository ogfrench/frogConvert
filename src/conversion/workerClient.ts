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
 * the whole convert pipeline. The worker itself is format-agnostic - it just
 * resolves a handler by name and calls doConvert - so a single shared instance
 * serves every surface. Jobs are serialised onto one queue (see `queueTail`),
 * which is what makes sharing the cancellation singletons safe.
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

/**
 * Tail of the job queue. Every call chains onto it, so exactly one job occupies
 * the worker at a time.
 *
 * This used to be an assumption rather than a mechanism. The module header
 * asserted that "only one surface is active at a time", and everything below
 * depended on it: `workerCancelCallback`, `forceCleanupCallback` and
 * `workerErrorCallback` are all single slots, so a second concurrent job would
 * overwrite the first's error handling and the first's cleanup would clear the
 * second's cancel hook. Nothing enforced it - the invariant was maintained by
 * the fact that each surface happens to put a blocking modal on screen.
 *
 * There are three callers now (Convert, Compress, and the PDF editor's save-time
 * compression) and a playbook telling the next person to add a fourth. Serialising
 * here makes the single slots correct **by construction** instead of by
 * convention, and costs nothing real: the worker resolves one handler and calls
 * `doConvert`, and the WASM engines behind it are not re-entrant anyway, so
 * genuine parallelism was never on the table.
 *
 * The chain always advances - every job carries a timeout - so a wedged job
 * cannot strand the queue permanently.
 */
let queueTail: Promise<unknown> = Promise.resolve();

/**
 * Terminate hook for whichever job currently holds the worker. Safe as a single
 * slot only because of the serialisation above.
 *
 * Separate from the `cancellation.ts` singleton on purpose. That one is the
 * *convert flow's* cancel: it flips the global `isCancelled`, swaps the popup
 * for the cancelling UI, and arms a watchdog. A caller that only wants to abandon
 * its own engine run - the PDF editor's optional compression, which has its own
 * popup and must not disturb the finished edit behind it - needs the terminate
 * without the ceremony.
 */
let activeJobCancel: (() => void) | null = null;

/**
 * Abandon the engine run currently in the worker, if any.
 *
 * The job's promise rejects with "Cancelled"; it is the caller's business what
 * that means. Returns whether there was anything to cancel.
 */
export function cancelActiveWorkerJob(): boolean {
    const cancel = activeJobCancel;
    if (!cancel) return false;
    cancel();
    return true;
}

export function runInWorker(handlerName: string, inputFiles: FileData[], inputFormat: FileFormat, outputFormat: FileFormat, args?: string[], onProgress?: (p: ProgressEvent) => void): Promise<FileData[]> {
    const start = () => startWorkerJob(handlerName, inputFiles, inputFormat, outputFormat, args, onProgress);
    // Runs whether the predecessor resolved or rejected: one caller's failure
    // must not strand everyone behind it.
    const queued = queueTail.then(start, start);
    // The chain itself must never carry a rejection forward, or the next
    // `.then` would skip its job and reject with someone else's error.
    queueTail = queued.then(() => {}, () => {});
    return queued;
}

function startWorkerJob(handlerName: string, inputFiles: FileData[], inputFormat: FileFormat, outputFormat: FileFormat, args?: string[], onProgress?: (p: ProgressEvent) => void): Promise<FileData[]> {
    const worker = getConversionWorker();
    const id = ++workerMsgId;
    return new Promise((resolve, reject) => {
        // Checked here rather than at enqueue time: a job that waited behind
        // others may have been cancelled while it sat in the queue, and
        // starting it would burn an engine run nobody is waiting for.
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
            activeJobCancel = null;
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
        const abandon = () => {
            cleanup();
            try { worker.terminate(); } catch { /* already gone */ }
            conversionWorker = null;
            reject(new Error("Cancelled"));
        };
        activeJobCancel = abandon;
        setWorkerCancelCallback(abandon);
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
