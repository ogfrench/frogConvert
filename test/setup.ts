/**
 * Preload script for Vitest (using jsdom).
 */

if (!(navigator as any).deviceMemory) {
    Object.defineProperty(navigator, 'deviceMemory', { value: 4, configurable: true });
}

import { createWorkerHandler } from '../src/workers/route-search.worker.ts';

if (typeof window !== 'undefined' && !window.Worker) {
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

    (window as any).Worker = MockWorker;
}
