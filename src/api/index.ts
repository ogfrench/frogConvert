import '../mcp/core/polyfills.ts';

import { loadMcpHandlers } from '../mcp/core/handlers.ts';
import { TraversionGraph } from '../core/TraversionGraph/TraversionGraph.ts';
import type { FileFormat } from '../core/FormatHandler/FormatHandler.ts';

import { handleFormats } from './routes/formats.ts';
import { handlePath } from './routes/path.ts';
import { handleConvert } from './routes/convert.ts';
import { handleCompress } from './routes/compress.ts';
import { handlePdfMerge, handlePdfOrganize, handlePdfExtract, handlePdfWatermark } from './routes/pdf.ts';
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

            // DNS-rebinding / cross-origin guard. The server binds to 127.0.0.1,
            // but a hostile page in the user's browser can still issue fetches
            // to http://127.0.0.1:<port>. Reject anything whose Origin or Host
            // header doesn't look like a legitimate local caller. `null` Origin
            // covers MCP / direct curl invocations which omit it entirely.
            const origin = req.headers.get("origin");
            const host   = req.headers.get("host") ?? "";
            const originOk = origin === null
                || origin === "null"
                || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin);
            const hostOk = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
            if (!originOk || !hostOk) {
                return Response.json(
                    { error: "Forbidden: cross-origin request rejected" },
                    { status: 403 }
                );
            }

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

            if (req.method === "POST" && url.pathname === "/compress") {
                return handleCompress(req, handlers);
            }

            if (req.method === "POST" && url.pathname === "/pdf/merge") {
                return handlePdfMerge(req);
            }

            if (req.method === "POST" && url.pathname === "/pdf/organize") {
                return handlePdfOrganize(req);
            }

            if (req.method === "POST" && url.pathname === "/pdf/extract") {
                return handlePdfExtract(req);
            }

            if (req.method === "POST" && url.pathname === "/pdf/watermark") {
                return handlePdfWatermark(req);
            }

            return Response.json({ error: "Not found" }, { status: 404 });
        }
    });

    console.error(`frogConvert API server running at http://127.0.0.1:${server.port}`);
    console.error(`Loaded handlers: ${handlers.map(h => h.name).join(", ")}`);

    // Start browser warm-up immediately, don't await, let it run in parallel
    // with the transport setup and user think time before the first request.
    warmUpBridge();
}

main().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
});
