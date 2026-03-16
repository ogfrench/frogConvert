import './core/polyfills.ts';

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadMcpHandlers } from './core/handlers.ts';
import { TraversionGraph } from '../core/TraversionGraph/TraversionGraph.ts';
import type { FileFormat } from '../core/FormatHandler/FormatHandler.ts';

import { registerListFormatsTool } from './tools/listFormats.ts';
import { registerFindConversionPathTool } from './tools/findConversionPath.ts';
import { registerConvertFileTool } from './tools/convertFile.ts';
import { warmUpBridge } from './core/browserBridge.ts';
import type { McpContext } from './core/types.ts';

export type { McpContext };

async function main() {
    const server = new McpServer({
        name: "frogConvert-MCP",
        version: "1.0.0"
    });

    // Initialize handlers in the background — don't block server startup.
    // Pandoc WASM (~55 MB) can take 30 s – 3 min to compile on cold start;
    // waiting here would make the MCP client time out before the server is ready.
    // Each tool call awaits this promise before processing.
    const initPromise: Promise<McpContext> = (async () => {
        const handlers = await loadMcpHandlers();

        const supportedFormatCache = new Map<string, FileFormat[]>();
        handlers.forEach(h => supportedFormatCache.set(h.name, h.supportedFormats || []));

        const graph = new TraversionGraph();
        graph.init(supportedFormatCache, handlers, false);

        return { handlers, graph };
    })();

    initPromise.catch(err => {
        console.error("[MCP] Handler initialization failed:", err);
    });

    registerListFormatsTool(server, initPromise);
    registerFindConversionPathTool(server, initPromise);
    registerConvertFileTool(server, initPromise);

    // Start browser warm-up immediately — don't await, let it run in parallel
    // with the transport setup and user think time before the first tool call.
    warmUpBridge();

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("frogConvert MCP Server running on stdio");
}

main().catch((err) => {
    console.error("Fatal error in main():", err);
    process.exit(1);
});
