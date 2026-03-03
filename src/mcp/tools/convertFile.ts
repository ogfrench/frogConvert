import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FormatHandler, FileFormat, FileData } from "../../core/FormatHandler/FormatHandler.ts";
import type { TraversionGraph } from "../../core/TraversionGraph/TraversionGraph.ts";

import { findFormatAndHandler } from "../core/utils.ts";

export function registerConvertFileTool(server: McpServer, handlers: FormatHandler[], graph: TraversionGraph) {
    server.tool(
        "convert_file",
        "Convert a file by providing its base64-encoded bytes.",
        {
            fileName: z.string().describe("The name of the input file (e.g. image.jpg)"),
            base64Bytes: z.string().describe("Base64 encoded bytes of the file content"),
            inputMime: z.string().describe("Input MIME type"),
            inputExtension: z.string().describe("Input format extension"),
            outputMime: z.string().describe("Output MIME type"),
            outputExtension: z.string().describe("Output format extension")
        },
        async ({ fileName, base64Bytes, inputMime, inputExtension, outputMime, outputExtension }) => {
            const inputMatch = findFormatAndHandler(handlers, inputMime, inputExtension);
            const outputMatch = findFormatAndHandler(handlers, outputMime, outputExtension);

            if (!inputMatch || !outputMatch) {
                return { content: [{ type: "text", text: `Error: Could not find matching formats.` }], isError: true };
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
                return { content: [{ type: "text", text: `Error: No path found.` }], isError: true };
            }

            const path = pathResult.value;
            const buffer = Buffer.from(base64Bytes, 'base64');
            const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

            let currentFiles: FileData[] = [{ name: fileName, bytes }];

            try {
                for (let i = 1; i < path.length; i++) {
                    const stepHandler = path[i].handler;
                    const prevFormat = path[i - 1].format;
                    const nextFormat = path[i].format;

                    currentFiles = await stepHandler.doConvert(currentFiles, prevFormat, nextFormat);
                }

                const outBase64 = Buffer.from(currentFiles[0].bytes).toString('base64');

                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            fileName: currentFiles[0].name,
                            base64Bytes: outBase64
                        })
                    }]
                };

            } catch (e: any) {
                return { content: [{ type: "text", text: `Conversion failed: ${e?.toString()}` }], isError: true };
            }
        }
    );
}
