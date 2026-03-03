import fs from 'fs';
import path from 'path';

// Polyfill fetch to intercept WASM requests that normally go to the dev server
const originalFetch = globalThis.fetch;

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (urlStr.startsWith('/convert/wasm/') || urlStr.startsWith('/convert/js/')) {
        const filename = path.basename(urlStr);

        // Map of common intercepted files to their source location in the repo
        const fileMap: Record<string, string> = {
            'magick.wasm': 'node_modules/@imagemagick/magick-wasm/dist/magick.wasm',
            'ffmpeg-core.js': 'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js',
            'ffmpeg-core.wasm': 'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm',
            'pandoc.wasm': 'src/handlers/pandoc/pandoc.wasm',
        };

        const sourcePath = fileMap[filename];

        if (sourcePath) {
            const fullPath = path.join(process.cwd(), sourcePath);
            try {
                const buffer = fs.readFileSync(fullPath);
                const mimeType = filename.endsWith('.wasm') ? 'application/wasm' : 'application/javascript';
                return new Response(buffer, {
                    status: 200,
                    headers: { 'Content-Type': mimeType }
                });
            } catch (err) {
                console.error(`[MCP Polyfill] Failed to read ${fullPath}`, err);
                return new Response(null, { status: 404 });
            }
        }
    }

    return originalFetch(input, init);
};

// Polyfill window and document for handlers that check for browser features
if (typeof globalThis.window === 'undefined') {
    (globalThis as any).window = globalThis;
}

if (typeof globalThis.document === 'undefined') {
    (globalThis as any).document = {
        createElement: () => ({}),
    };
}
