import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FileData, FileFormat } from "../core/FormatHandler/FormatHandler.ts";

/**
 * The worker client is a module singleton shared by every surface, so these
 * tests care about the protocol (message correlation, transfer safety) and the
 * teardown paths (cancel, crash, timeout) that decide whether the singleton is
 * still usable afterwards.
 *
 * `cancellation.ts` is mocked: the real module pulls in the store, CSS and the
 * popup system, none of which this seam actually depends on.
 */

let cancelled = false;
let workerCancelCb: (() => void) | null = null;
let forceCleanupCb: (() => void) | null = null;

vi.mock("./cancellation.ts", () => ({
    get isCancelled() { return cancelled; },
    setWorkerCancelCallback: (cb: (() => void) | null) => { workerCancelCb = cb; },
    setForceCleanupCallback: (cb: (() => void) | null) => { forceCleanupCb = cb; },
}));

class FakeWorker {
    static instances: FakeWorker[] = [];
    listeners: Array<(ev: MessageEvent) => void> = [];
    posted: any[] = [];
    transfers: any[][] = [];
    terminated = false;
    onerror: ((e: any) => void) | null = null;

    constructor() { FakeWorker.instances.push(this); }
    addEventListener(_type: string, fn: (ev: MessageEvent) => void) { this.listeners.push(fn); }
    removeEventListener(_type: string, fn: (ev: MessageEvent) => void) {
        this.listeners = this.listeners.filter(l => l !== fn);
    }
    postMessage(msg: any, transfer?: any[]) { this.posted.push(msg); this.transfers.push(transfer ?? []); }
    terminate() { this.terminated = true; }

    /** Deliver a message from "the worker". */
    emit(data: any) { for (const l of [...this.listeners]) l({ data } as MessageEvent); }
    get lastPost() { return this.posted[this.posted.length - 1]; }
}

const fmt = (mime: string, format: string) =>
    ({ mime, format, extension: format, from: true, to: true } as unknown as FileFormat);
const PNG = fmt("image/png", "png");
const JPEG = fmt("image/jpeg", "jpeg");

const file = (name: string, size = 8): FileData =>
    ({ name, bytes: new Uint8Array(size).fill(7) } as unknown as FileData);

let runInWorker: typeof import("./workerClient.ts").runInWorker;
let WORKER_TIMEOUT_MS: number;

beforeEach(async () => {
    cancelled = false;
    workerCancelCb = null;
    forceCleanupCb = null;
    FakeWorker.instances = [];
    vi.stubGlobal("Worker", FakeWorker);
    // The worker handle is module state; a fresh module per test keeps the
    // singleton from leaking a terminated worker into the next case.
    vi.resetModules();
    const mod = await import("./workerClient.ts");
    runInWorker = mod.runInWorker;
    WORKER_TIMEOUT_MS = mod.WORKER_TIMEOUT_MS;
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

/**
 * Kick off a run and hand back the promise plus the worker it spawned.
 *
 * Async because jobs are queued: `runInWorker` chains onto the serialisation
 * tail, so the job starts a microtask after the call rather than inside it.
 * Draining here keeps every test below written against a started job.
 */
async function start(files: FileData[] = [file("a.png")], args?: string[], onProgress?: any) {
    const promise = runInWorker("ImageMagick", files, PNG, JPEG, args, onProgress);
    promise.catch(() => { /* asserted by the caller; avoids an unhandled rejection here */ });
    await flushQueue();
    return { promise, worker: FakeWorker.instances[FakeWorker.instances.length - 1] };
}

/** Let the queue hand the next job to the worker. */
async function flushQueue() {
    await Promise.resolve();
    await Promise.resolve();
}

describe("runInWorker - request", () => {
    it("posts the handler, formats and args, and resolves with the worker's output", async () => {
        const { promise, worker } = await start([file("a.png")], ["--quality", "low"]);
        const post = worker.lastPost;
        expect(post.handlerName).toBe("ImageMagick");
        expect(post.inputFormat).toEqual(PNG);
        expect(post.outputFormat).toEqual(JPEG);
        expect(post.args).toEqual(["--quality", "low"]);

        const out = [{ name: "a.jpeg", bytes: new Uint8Array(3) }];
        worker.emit({ id: post.id, type: "success", outputFiles: out });
        await expect(promise).resolves.toEqual(out);
    });

    it("copies input bytes so the caller's originals survive the transfer", async () => {
        const original = file("a.png");
        const { promise, worker } = await start([original]);
        const sent = worker.lastPost.inputFiles[0];

        // A copy, not the caller's array - transferring the caller's buffer
        // would detach it and break any retry down a different route.
        expect(sent.bytes).not.toBe(original.bytes);
        expect(Array.from(sent.bytes)).toEqual(Array.from(original.bytes));
        expect(original.bytes.byteLength).toBe(8);

        worker.emit({ id: worker.lastPost.id, type: "success", outputFiles: [] });
        await promise;
    });

    it("does not list empty buffers as transferables", async () => {
        const { promise, worker } = await start([file("empty.png", 0), file("real.png", 4)]);
        expect(worker.transfers[0]).toHaveLength(1);
        worker.emit({ id: worker.lastPost.id, type: "success", outputFiles: [] });
        await promise;
    });

    it("reuses one worker across sequential calls", async () => {
        const first = await start();
        first.worker.emit({ id: first.worker.lastPost.id, type: "success", outputFiles: [] });
        await first.promise;

        const second = await start();
        expect(FakeWorker.instances).toHaveLength(1);
        second.worker.emit({ id: second.worker.lastPost.id, type: "success", outputFiles: [] });
        await second.promise;
    });

    it("rejects without spawning a worker when already cancelled", async () => {
        cancelled = true;
        await expect(runInWorker("ImageMagick", [file("a.png")], PNG, JPEG))
            .rejects.toThrow("Cancelled");
    });
});

describe("runInWorker - message correlation", () => {
    it("ignores messages belonging to another request", async () => {
        const { promise, worker } = await start();
        const id = worker.lastPost.id;

        // A late reply from a previous, abandoned run must not settle this one.
        worker.emit({ id: id + 999, type: "success", outputFiles: [{ name: "wrong" }] });
        let settled = false;
        promise.then(() => { settled = true; }, () => { settled = true; });
        await Promise.resolve();
        expect(settled).toBe(false);

        worker.emit({ id, type: "success", outputFiles: [{ name: "right" }] });
        await expect(promise).resolves.toEqual([{ name: "right" }]);
    });

    it("forwards progress without settling the promise", async () => {
        const onProgress = vi.fn();
        const { promise, worker } = await start([file("a.png")], undefined, onProgress);
        const id = worker.lastPost.id;

        worker.emit({ id, type: "progress", ratio: 0.25, detail: "frame 1" });
        worker.emit({ id, type: "progress", ratio: 0.75, detail: "frame 2" });
        expect(onProgress).toHaveBeenCalledTimes(2);
        expect(onProgress).toHaveBeenLastCalledWith({ ratio: 0.75, detail: "frame 2" });

        worker.emit({ id, type: "success", outputFiles: [] });
        await expect(promise).resolves.toEqual([]);
    });

    it("stops listening once a request settles", async () => {
        const { promise, worker } = await start();
        worker.emit({ id: worker.lastPost.id, type: "success", outputFiles: [] });
        await promise;
        expect(worker.listeners).toHaveLength(0);
    });

    it("rejects with the worker's error payload", async () => {
        const { promise, worker } = await start();
        worker.emit({ id: worker.lastPost.id, type: "error", error: new Error("bad magic") });
        await expect(promise).rejects.toThrow("bad magic");
    });
});

describe("runInWorker - teardown paths", () => {
    it("cancelling terminates the worker and rejects", async () => {
        const { promise, worker } = await start();
        expect(workerCancelCb).toBeTypeOf("function");
        workerCancelCb!();

        await expect(promise).rejects.toThrow("Cancelled");
        expect(worker.terminated).toBe(true);

        // The terminated worker must not be handed to the next caller.
        const next = await start();
        expect(next.worker).not.toBe(worker);
        next.worker.emit({ id: next.worker.lastPost.id, type: "success", outputFiles: [] });
        await next.promise;
    });

    it("the force-cleanup fallback also terminates and rejects", async () => {
        const { promise, worker } = await start();
        expect(forceCleanupCb).toBeTypeOf("function");
        forceCleanupCb!();
        await expect(promise).rejects.toThrow("Cancelled (forced)");
        expect(worker.terminated).toBe(true);
    });

    it("a worker crash rejects with a real error rather than hanging", async () => {
        const { promise, worker } = await start();
        worker.onerror?.({ message: "out of memory" });
        await expect(promise).rejects.toThrow("Conversion worker crashed: out of memory");

        // The dead worker is discarded, so the next run gets a fresh one.
        const next = await start();
        expect(next.worker).not.toBe(worker);
        next.worker.emit({ id: next.worker.lastPost.id, type: "success", outputFiles: [] });
        await next.promise;
    });

    it("rejects when the worker never replies", async () => {
        vi.useFakeTimers();
        const { promise, worker } = await start();
        const assertion = expect(promise).rejects.toThrow("timed out after 10 minutes");
        await vi.advanceTimersByTimeAsync(WORKER_TIMEOUT_MS + 1);
        await assertion;
        expect(worker.listeners).toHaveLength(0);
    });

    it("a completed run does not fire the timeout later", async () => {
        vi.useFakeTimers();
        const { promise, worker } = await start();
        worker.emit({ id: worker.lastPost.id, type: "success", outputFiles: [] });
        await expect(promise).resolves.toEqual([]);
        // If cleanup missed clearTimeout this would produce an unhandled rejection.
        await vi.advanceTimersByTimeAsync(WORKER_TIMEOUT_MS + 1);
    });

    it("a completed run leaves no callbacks behind for the next one to trip over", async () => {
        // Both callbacks close over *this* call's reject and its worker. Left
        // registered after the run settles, a later hard-cancel would terminate
        // a worker that is busy with something else entirely. Only the convert
        // flow's resetCancellation() used to clear the force one, so a Compress
        // run - which never calls it - left a live grenade in the singleton.
        const { promise, worker } = await start();
        worker.emit({ id: worker.lastPost.id, type: "success", outputFiles: [] });
        await promise;

        expect(workerCancelCb).toBeNull();
        expect(forceCleanupCb).toBeNull();
        expect(worker.terminated).toBe(false);
    });
});

describe("runInWorker - serialisation", () => {
    /**
     * The cancellation singletons (`workerCancelCallback`, `forceCleanupCallback`,
     * `workerErrorCallback`) are single slots. That is only sound while one job
     * occupies the worker at a time. This used to be an unenforced assumption
     * documented in a comment; these tests are the enforcement.
     */
    it("does not start a second job while the first is in flight", async () => {
        const { promise: first, worker } = await start([file("a.png")]);
        const second = runInWorker("FFmpeg", [file("b.mp4")], PNG, JPEG);
        second.catch(() => {});
        await flushQueue();

        // One job posted, one worker, second still waiting its turn.
        expect(worker.posted).toHaveLength(1);
        expect(worker.lastPost.handlerName).toBe("ImageMagick");

        worker.emit({ id: worker.lastPost.id, type: "success", outputFiles: [] });
        await first;
        await flushQueue();

        expect(worker.posted).toHaveLength(2);
        expect(worker.lastPost.handlerName).toBe("FFmpeg");
        worker.emit({ id: worker.lastPost.id, type: "success", outputFiles: [] });
        await expect(second).resolves.toEqual([]);
    });

    it("keeps the second job's cancel hook intact once it starts", async () => {
        // The bug this prevents: job A's cleanup calls setWorkerCancelCallback(null),
        // which under concurrency would wipe job B's hook and leave B uncancellable.
        const { promise: first, worker } = await start();
        const second = runInWorker("FFmpeg", [file("b.mp4")], PNG, JPEG);
        second.catch(() => {});

        worker.emit({ id: worker.lastPost.id, type: "success", outputFiles: [] });
        await first;
        await flushQueue();

        expect(workerCancelCb).not.toBeNull();
        workerCancelCb!();
        await expect(second).rejects.toThrow(/Cancelled/);
    });

    it("a failed job does not strand the ones queued behind it", async () => {
        const { promise: first, worker } = await start();
        const second = runInWorker("FFmpeg", [file("b.mp4")], PNG, JPEG);
        second.catch(() => {});

        worker.emit({ id: worker.lastPost.id, type: "error", error: "boom" });
        await expect(first).rejects.toBeDefined();
        await flushQueue();

        // The queue advanced despite the rejection.
        expect(worker.lastPost.handlerName).toBe("FFmpeg");
        worker.emit({ id: worker.lastPost.id, type: "success", outputFiles: [] });
        await expect(second).resolves.toEqual([]);
    });

    it("skips a queued job that was cancelled while it waited", async () => {
        // Checked when the job starts, not when it is enqueued: otherwise a
        // batch cancelled mid-queue still burns an engine run per pending file.
        const { promise: first, worker } = await start();
        const second = runInWorker("FFmpeg", [file("b.mp4")], PNG, JPEG);
        second.catch(() => {});

        cancelled = true;
        worker.emit({ id: worker.lastPost.id, type: "success", outputFiles: [] });
        await first;

        await expect(second).rejects.toThrow(/Cancelled/);
        expect(worker.posted).toHaveLength(1);
    });
});
