import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FormatHandler, FileFormat } from "../../core/FormatHandler/FormatHandler.ts";
import type { TraversionGraph } from "../../core/TraversionGraph/TraversionGraph.ts";

import { findFormatAndHandler } from "../core/utils.ts";

export function registerFindConversionPathTool(server: McpServer, handlers: FormatHandler[], graph: TraversionGraph) {
    server.tool(
        "find_conversion_path",
        "Find the step-by-step conversion path between two formats.",
        {
            inputMime: z.string().describe("Input MIME type (e.g. image/jpeg)"),
            inputExtension: z.string().describe("Input file extension (e.g. jpeg)"),
            outputMime: z.string().describe("Output MIME type (e.g. image/png)"),
            outputExtension: z.string().describe("Output file extension (e.g. png)")
        },
        async ({ inputMime, inputExtension, outputMime, outputExtension }) => {
            const inputMatch = findFormatAndHandler(handlers, inputMime, inputExtension, 'from');
            const outputMatch = findFormatAndHandler(handlers, outputMime, outputExtension, 'to');

            if (!inputMatch) {
                return { content: [{ type: "text", text: `Error: Input format ${inputMime} (${inputExtension}) not found or supported.` }], isError: true };
            }
            if (!outputMatch) {
                return { content: [{ type: "text", text: `Error: Output format ${outputMime} (${outputExtension}) not found or supported.` }], isError: true };
            }

            const { format: fromFormat, handler: fromHandler } = inputMatch;
            const { format: toFormat, handler: toHandler } = outputMatch;

            const pathsGenerator = graph.searchPath(
                { format: fromFormat, handler: fromHandler },
                { format: toFormat, handler: toHandler },
                false
            );

            const pathResult = await pathsGenerator.next();
            if (pathResult.done || !pathResult.value) {
                return { content: [{ type: "text", text: `No path found between ${inputMime} and ${outputMime}` }], isError: true };
            }

            const pathText = pathResult.value.map((p: any) => `${p.handler.name} (${p.format.mime})`).join(" -> ");

            return {
                content: [{ type: "text", text: `Path: ${pathText}` }]
            };
        }
    );
}
