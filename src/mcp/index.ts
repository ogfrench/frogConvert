import './core/polyfills.ts';

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadMcpHandlers } from './core/handlers.ts';
import { TraversionGraph } from '../core/TraversionGraph/TraversionGraph.ts';
import type { FileFormat } from '../core/FormatHandler/FormatHandler.ts';

import { registerListFormatsTool } from './tools/listFormats.ts';
import { registerFindConversionPathTool } from './tools/findConversionPath.ts';
import { registerConvertFileTool } from './tools/convertFile.ts';

async function main() {
    const server = new McpServer({
        name: "frogConvert-MCP",
        version: "1.0.0"
    });

    const handlers = await loadMcpHandlers();

    const supportedFormatCache = new Map<string, FileFormat[]>();
    handlers.forEach(h => supportedFormatCache.set(h.name, h.supportedFormats || []));

    const graph = new TraversionGraph();
    graph.init(supportedFormatCache, handlers, false);

    registerListFormatsTool(server, handlers);
    registerFindConversionPathTool(server, handlers, graph);
    registerConvertFileTool(server, handlers, graph);

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("frogConvert MCP Server running on stdio");
}

main().catch((err) => {
    console.error("Fatal error in main():", err);
    process.exit(1);
});
