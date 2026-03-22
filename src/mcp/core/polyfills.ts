import { createWorkerHandler } from '../../workers/route-search.worker.ts';

// Ensure harmless browser globals exist for WASM libraries running in Bun/Node MCP

if (typeof globalThis.self === 'undefined') {
    (globalThis as any).self = globalThis;
}
if (typeof globalThis.window === 'undefined') {
    (globalThis as any).window = globalThis;
}

if (typeof (globalThis as any).location === 'undefined') {
    (globalThis as any).location = {
        href: 'http://localhost/',
        origin: 'http://localhost',
        protocol: 'http:',
        host: 'localhost',
        hostname: 'localhost',
        port: '',
        pathname: '/',
        search: '',
        hash: ''
    };
}

if (typeof globalThis.Blob === 'undefined') {
    const { Blob } = require('buffer');
    (globalThis as any).Blob = Blob;
}

if (typeof URL.createObjectURL === 'undefined') {
    (URL as any).createObjectURL = (blob: any) => {
        return `blob:http://localhost/${crypto.randomUUID()}`;
    };
    (URL as any).revokeObjectURL = () => { };
}

if (typeof globalThis.document === 'undefined') {
    (globalThis as any).document = {
        createElement: () => ({}),
        addEventListener: () => { },
        removeEventListener: () => { },
    };
}

// Redirect all console.log output to stderr in the MCP environment because
// SDK StdioServerTransport requires stdout to be strictly reserved for JSON-RPC messages.
// Any plain string logged to stdout will crash the client connection.
if (typeof process !== 'undefined') {
    console.log = (...args) => console.error(...args);
}

// Polyfill fetch to intercept WASM requests that normally go to the dev server
// Node's native fetch does not support relative URLs like /wasm/magick.wasm
const originalFetch = globalThis.fetch;

Object.defineProperty(globalThis, 'fetch', {
    enumerable: true,
    configurable: true,
    writable: true,
    value: async (input: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;

        let normalizedUrl = urlStr;
        if (urlStr.startsWith('http://localhost')) {
            normalizedUrl = urlStr.substring('http://localhost'.length);
        } else if (urlStr.startsWith('blob:http://localhost')) {
            return new Response(new Uint8Array(), { status: 200 });
        }

        if (normalizedUrl.startsWith('/wasm/')) {
            const path = await import('path');
            const filename = path.basename(normalizedUrl);
            const fileMap: Record<string, string> = {
                'magick.wasm': 'node_modules/@imagemagick/magick-wasm/dist/magick.wasm',
                'pandoc.wasm': 'src/handlers/pandoc/pandoc.wasm',
                'ffmpeg-core.js': 'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js',
                'ffmpeg-core.wasm': 'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm',
            };

            const sourcePath = fileMap[filename];

            if (sourcePath) {
                const fs = await import('fs');
                // Resolve relative to the package root (src/mcp/core/ → src/mcp/ → src/ → pkgRoot)
                const { fileURLToPath: _fileURLToPath } = await import('url');
                const pkgRoot = path.resolve(path.dirname(_fileURLToPath(import.meta.url)), '../../..');

                // For node_modules paths, walk UP the directory tree to find the actual
                // location. This handles both nested installs (local repo, Bun cache) and
                // hoisted/flat installs (bunx temp dir) where deps are siblings of the package,
                // not children. This mirrors how Node.js module resolution works.
                let fullPath: string;
                if (sourcePath.startsWith('node_modules/')) {
                    const moduleRelPath = sourcePath.slice('node_modules/'.length);
                    let found: string | null = null;
                    let dir = pkgRoot;
                    while (true) {
                        const candidate = path.join(dir, 'node_modules', moduleRelPath);
                        if (fs.existsSync(candidate)) { found = candidate; break; }
                        const parent = path.dirname(dir);
                        if (parent === dir) break;
                        dir = parent;
                    }
                    fullPath = found ?? path.join(pkgRoot, sourcePath);
                } else {
                    fullPath = path.join(pkgRoot, sourcePath);
                }
                try {
                    const buffer = await fs.promises.readFile(fullPath);
                    return new Response(buffer, {
                        status: 200,
                        headers: { 'Content-Type': 'application/wasm' }
                    });
                } catch (err) {
                    console.warn(`[MCP Polyfill] Failed to read ${fullPath}`);
                    return new Response(null, { status: 404 });
                }
            } else {
                return new Response(null, { status: 404 });
            }
        }

        return originalFetch(input, init);
    }
});

if (typeof globalThis.Worker === 'undefined') {
    class MockWorker {
        __isMockWorker = true;
        onmessage: ((ev: MessageEvent) => any) | null = null;
        private listeners: Record<string, Function[]> = {};
        private handler: (e: MessageEvent) => void;

        constructor(_url: string | URL, _options?: WorkerOptions) {
            this.handler = createWorkerHandler((data: any) => {
                const event = { data } as MessageEvent;
                if (this.onmessage) this.onmessage(event);
                (this.listeners['message'] || []).forEach(l => l(event));
            });
        }

        postMessage(data: any) {
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
}
