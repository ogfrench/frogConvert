import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FileData } from "../../core/FormatHandler/FormatHandler.ts";
import type { McpContext } from "../core/types.ts";

import { findFormatAndHandler } from "../core/utils.ts";
import { convertViaBrowser } from "../core/browserBridge.ts";

export function registerConvertFileTool(server: McpServer, initPromise: Promise<McpContext>) {
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
            const maxUploadMb = Number(process.env.MAX_UPLOAD_MB ?? 4096);
            if (base64Bytes.length * 0.75 > maxUploadMb * 1024 * 1024) {
                return {
                    content: [{ type: "text", text: `Error: File too large (max ${maxUploadMb} MB)` }],
                    isError: true
                };
            }

            const { handlers, graph } = await initPromise;

            const inputMatch = findFormatAndHandler(handlers, inputMime, inputExtension, 'from');
            const outputMatch = findFormatAndHandler(handlers, outputMime, outputExtension, 'to');

            // Try native path when both formats are known to native handlers
            if (inputMatch && outputMatch) {
                const pathsGenerator = graph.searchPath(
                    { format: inputMatch.format, handler: inputMatch.handler },
                    { format: outputMatch.format, handler: outputMatch.handler },
                    false
                );

                const pathResult = await pathsGenerator.next();
                if (!pathResult.done && pathResult.value) {
                    const path = pathResult.value;
                    const buffer = Buffer.from(base64Bytes, 'base64');
                    const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
                    let currentFiles: FileData[] = [{ name: fileName, bytes }];

                    try {
                        // path[0] is the source node (no conversion step); steps start at index 1
                        for (let i = 1; i < path.length; i++) {
                            const stepHandler = path[i].handler;
                            const prevFormat = path[i - 1].format;
                            const nextFormat = path[i].format;
                            currentFiles = await stepHandler.doConvert(currentFiles, prevFormat, nextFormat);
                        }

                        const results = currentFiles.map(f => ({
                            fileName: f.name,
                            base64Bytes: Buffer.from(f.bytes).toString('base64')
                        }));

                        return { content: [{ type: "text", text: JSON.stringify(results) }] };
                    } catch (nativeErr: any) {
                        // Native execution failed — log for diagnostics and fall through to browser bridge
                        process.stderr.write(`[mcp] Native conversion failed, trying browser bridge: ${nativeErr?.message ?? nativeErr}\n`);
                    }
                }
            }

            // No native path, format unknown to native registry, or native execution failed.
            // The bridge loads ALL handlers including browser-only ones (requiresMainThread=true).
            try {
                const bridgeResults = await convertViaBrowser(
                    fileName, base64Bytes, inputMime, inputExtension, outputMime, outputExtension
                );
                return { content: [{ type: "text", text: JSON.stringify(bridgeResults) }] };
            } catch (bridgeErr: any) {
                return {
                    content: [{ type: "text", text: `Error: ${bridgeErr?.message ?? `No conversion path found between ${inputMime} and ${outputMime}`}` }],
                    isError: true
                };
            }
        }
    );
}
