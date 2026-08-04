/**
 * Preload script for Vitest (using jsdom).
 */
import { afterAll } from 'vitest';

if (typeof navigator !== 'undefined' && !(navigator as any).deviceMemory) {
    Object.defineProperty(navigator, 'deviceMemory', { value: 4, configurable: true });
}

// pdfjs-dist references DOMMatrix at module-load time; jsdom doesn't provide it.
if (typeof (globalThis as any).DOMMatrix === 'undefined') {
    (globalThis as any).DOMMatrix = class DOMMatrix {
        constructor(_init?: unknown) {}
    };
}

// jsdom ships HTMLCanvasElement but not its 2D drawing context - getContext()
// returns null unless the optional `canvas` npm package is installed. Stub a
// no-op 2D context so tests that render decorative graphics (confetti,
// thumbnails) don't crash on ctx.<method>(). We only need the shape to be
// present; pixel-accurate rendering is out of scope for unit tests.
if (typeof HTMLCanvasElement !== 'undefined' &&
    !(HTMLCanvasElement.prototype.getContext as any).__frogStubbed) {
    const noop = () => {};
    const stub2d: Partial<CanvasRenderingContext2D> = {
        save: noop, restore: noop,
        scale: noop, rotate: noop, translate: noop, transform: noop, setTransform: noop, resetTransform: noop,
        beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
        fill: noop, stroke: noop, clip: noop,
        fillRect: noop, strokeRect: noop, clearRect: noop,
        fillText: noop, strokeText: noop,
        drawImage: noop,
        arc: noop, arcTo: noop, bezierCurveTo: noop, quadraticCurveTo: noop, rect: noop, ellipse: noop,
        measureText: (() => ({ width: 0 })) as any,
        getImageData: (() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })) as any,
        putImageData: noop,
        createImageData: (() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })) as any,
        createLinearGradient: (() => ({ addColorStop: noop })) as any,
        createRadialGradient: (() => ({ addColorStop: noop })) as any,
        createPattern: (() => null) as any,
        globalAlpha: 1, fillStyle: "#000", strokeStyle: "#000", lineWidth: 1,
        font: "10px sans-serif", textAlign: "start", textBaseline: "alphabetic",
        globalCompositeOperation: "source-over",
        imageSmoothingEnabled: true,
    };
    const wrapped = function (this: HTMLCanvasElement, type: string, _options?: unknown) {
        if (type === "2d") return stub2d as CanvasRenderingContext2D;
        return null; // WebGL/bitmaprenderer not stubbed - tests that need it must opt in
    };
    (wrapped as any).__frogStubbed = true;
    HTMLCanvasElement.prototype.getContext = wrapped as any;
}

import { createWorkerHandler } from '../src/workers/route-search.worker.ts';

if (typeof Worker === 'undefined') {
    class MockWorker {
        __isMockWorker = true;
        onmessage: ((ev: MessageEvent) => any) | null = null;
        private listeners: Record<string, Function[]> = {};
        private handler: (e: MessageEvent) => void;

        constructor(url: string | URL, options?: WorkerOptions) {
            this.handler = createWorkerHandler((data: any) => {
                const event = { data } as MessageEvent;
                if (this.onmessage) this.onmessage(event);
                if (this.listeners['message']) {
                    this.listeners['message'].forEach(l => l(event));
                }
            });
        }

        postMessage(data: any) {
            // Fake sending message to worker
            Promise.resolve().then(() => {
                this.handler({ data } as MessageEvent);
            });
        }

        addEventListener(type: string, listener: EventListener) {
            if (!this.listeners[type]) this.listeners[type] = [];
            this.listeners[type].push(listener);
        }

        removeEventListener(type: string, listener: EventListener) {
            if (this.listeners[type]) {
                this.listeners[type] = this.listeners[type].filter(l => l !== listener);
            }
        }

        terminate() { }
    }

    (globalThis as any).Worker = MockWorker;
    if (typeof window !== 'undefined') {
        (window as any).Worker = MockWorker;
    }
}

/**
 * Fail a test file that leaves a long-lived timer running.
 *
 * Two CI runs on the v3 branch reported every test passing and still exited 1,
 * on `ReferenceError: document is not defined` thrown from inside a timer that
 * fired after the environment had been torn down. Each was found only after
 * the previous one was fixed, because removing the timer that threw first just
 * promoted the next one. Guards now stop those particular callbacks reaching
 * for a document that has gone; this stops the *class*, by refusing to let a
 * timer outlive the file that started it.
 *
 * The policy is deliberately narrow, because "no timers at all" is not
 * achievable or useful here:
 *
 * - **Only our own code.** jsdom schedules dozens of internal 0ms timers per
 *   run (Selection, Storage) that no test can control.
 * - **Repeating timers at 100ms or slower.** A repeating timer never stops on
 *   its own, so it is guaranteed to still be there at teardown. The 100ms floor
 *   lets through jsdom's requestAnimationFrame shim, which it implements as a
 *   ~16ms interval - the custom cursor's animation loop is meant to run for the
 *   life of the page and is not a leak.
 * - **One-shot timers of a second or more.** Long enough to outlive the file
 *   that armed it. Short ones have almost always fired by teardown, and
 *   chasing them would mean rewriting tests to satisfy the check rather than
 *   fixing anything real.
 *
 * If a timer genuinely should outlive its test, cancel it in an `afterEach`
 * rather than widening this - that is what the two violations it found were,
 * and both were worth fixing on their own merits.
 */
{
    const REPEATING_FLOOR_MS = 100;
    const ONE_SHOT_FLOOR_MS = 1000;

    type Live = { kind: "interval" | "timeout"; delay: number; origin: string };
    const live = new Map<unknown, Live>();

    const realSetTimeout = globalThis.setTimeout;
    const realSetInterval = globalThis.setInterval;
    const realClearTimeout = globalThis.clearTimeout;
    const realClearInterval = globalThis.clearInterval;

    /** The first frame in this repo that is not a test helper. */
    const originOf = (): string => {
        const frames = (new Error().stack ?? "").split("\n").slice(2);
        for (const frame of frames) {
            if (!frame.includes("/src/") && !frame.includes("/test/")) continue;
            if (frame.includes("node_modules")) continue;
            if (frame.includes("/test/setup.ts")) continue;
            return frame.trim().replace(/^at\s+/, "");
        }
        return "";
    };

    (globalThis as any).setTimeout = (fn: any, delay?: any, ...args: any[]) => {
        const ms = Number(delay) || 0;
        const origin = ms >= ONE_SHOT_FLOOR_MS ? originOf() : "";
        if (!origin || typeof fn !== "function") {
            return (realSetTimeout as any)(fn, delay, ...args);
        }
        // A one-shot that *fires* is finished, and finished is not a leak. The
        // callback is wrapped so the record clears itself: tracking creation
        // and cancellation alone reported every completed sleep as a survivor,
        // which is how the first version of this check failed three files in
        // CI that were doing nothing wrong.
        let id: any;
        const wrapped = (...callArgs: any[]) => { live.delete(id); return fn(...callArgs); };
        id = (realSetTimeout as any)(wrapped, delay, ...args);
        live.set(id, { kind: "timeout", delay: ms, origin });
        return id;
    };
    (globalThis as any).setInterval = (fn: any, delay?: any, ...args: any[]) => {
        const id = (realSetInterval as any)(fn, delay, ...args);
        const ms = Number(delay) || 0;
        // No equivalent for a repeating timer: firing is exactly what it does,
        // and it is still armed afterwards. Only cancellation ends one.
        if (ms >= REPEATING_FLOOR_MS) {
            const origin = originOf();
            if (origin) live.set(id, { kind: "interval", delay: ms, origin });
        }
        return id;
    };
    (globalThis as any).clearTimeout = (id: any) => { live.delete(id); return (realClearTimeout as any)(id); };
    (globalThis as any).clearInterval = (id: any) => { live.delete(id); return (realClearInterval as any)(id); };

    afterAll(() => {
        if (live.size === 0) return;
        const survivors = [...live.values()];
        // Cancel them before failing, so one leak does not go on to poison
        // whatever the runner does next.
        for (const id of live.keys()) {
            (realClearTimeout as any)(id);
            (realClearInterval as any)(id);
        }
        live.clear();
        const listed = survivors
            .map(s => `  - ${s.kind} (${s.delay}ms) from ${s.origin}`)
            .join("\n");
        throw new Error(
            `${survivors.length} timer(s) outlived this test file:\n${listed}\n\n` +
            "A timer that survives teardown fires into an environment with no " +
            "document, and throws where no test can catch it - the run reports " +
            "every test passing and still fails. Cancel it in an afterEach, or " +
            "give the component a teardown path that does.",
        );
    });
}
