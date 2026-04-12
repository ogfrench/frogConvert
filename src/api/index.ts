import '../mcp/core/polyfills.ts';

import { loadMcpHandlers } from '../mcp/core/handlers.ts';
import { TraversionGraph } from '../core/TraversionGraph/TraversionGraph.ts';
import type { FileFormat } from '../core/FormatHandler/FormatHandler.ts';

import { handleFormats } from './routes/formats.ts';
import { handlePath } from './routes/path.ts';
import { handleConvert } from './routes/convert.ts';
import { warmUpBridge } from '../mcp/core/browserBridge.ts';

async function main() {
    const { ready: handlers, all: allHandlers } = await loadMcpHandlers();

    const supportedFormatCache = new Map<string, FileFormat[]>();
    handlers.forEach(h => supportedFormatCache.set(h.name, h.supportedFormats || []));

    const graph = new TraversionGraph();
    graph.init(supportedFormatCache, handlers, false);

    const port = Number(process.env.PORT ?? 3000);

    const server = Bun.serve({
        port,
        hostname: "127.0.0.1",
        async fetch(req) {
            const url = new URL(req.url);

            if (req.method === "GET" && url.pathname === "/health") {
                return Response.json({
                    status: "ok",
                    handlers: handlers.map(h => h.name)
                });
            }

            if (req.method === "GET" && url.pathname === "/formats") {
                return handleFormats(handlers);
            }

            if (req.method === "GET" && url.pathname === "/path") {
                return handlePath(url, handlers, graph);
            }

            if (req.method === "POST" && url.pathname === "/convert") {
                return handleConvert(req, handlers, graph, allHandlers);
            }

            return Response.json({ error: "Not found" }, { status: 404 });
        }
    });

    console.error(`frogConvert API server running at http://127.0.0.1:${server.port}`);
    console.error(`Loaded handlers: ${handlers.map(h => h.name).join(", ")}`);

    // Start browser warm-up immediately — don't await, let it run in parallel
    // with the transport setup and user think time before the first request.
    warmUpBridge();
}

main().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
});
