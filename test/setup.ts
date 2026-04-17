/**
 * Preload script for Vitest (using jsdom).
 */

if (typeof navigator !== 'undefined' && !(navigator as any).deviceMemory) {
    Object.defineProperty(navigator, 'deviceMemory', { value: 4, configurable: true });
}

// pdfjs-dist references DOMMatrix at module-load time; jsdom doesn't provide it.
if (typeof (globalThis as any).DOMMatrix === 'undefined') {
    (globalThis as any).DOMMatrix = class DOMMatrix {
        constructor(_init?: unknown) {}
    };
}

// jsdom ships HTMLCanvasElement but not its 2D drawing context — getContext()
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
        return null; // WebGL/bitmaprenderer not stubbed — tests that need it must opt in
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
