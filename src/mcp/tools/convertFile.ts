import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile, writeFile } from "fs/promises";
import { basename, dirname, join } from "path";
import type { FileData } from "../../core/FormatHandler/FormatHandler.ts";
import type { McpContext } from "../core/types.ts";

import { findFormatAndHandler } from "../core/utils.ts";
import { convertViaBrowser } from "../core/browserBridge.ts";

async function serializeResults(files: FileData[], outputFilePath?: string) {
    if (outputFilePath && files.length > 0) {
        const firstFile = files[0];
        const outDir = dirname(outputFilePath);
        const paths: string[] = [];

        await writeFile(outputFilePath, firstFile.bytes);
        paths.push(outputFilePath);

        for (let i = 1; i < files.length; i++) {
            const extra = join(outDir, files[i].name);
            await writeFile(extra, files[i].bytes);
            paths.push(extra);
        }

        return { content: [{ type: "text" as const, text: JSON.stringify({ savedTo: paths }) }] };
    }

    const results = files.map(f => ({
        fileName: f.name,
        base64Bytes: Buffer.from(f.bytes).toString('base64')
    }));
    return { content: [{ type: "text" as const, text: JSON.stringify(results) }] };
}

export function registerConvertFileTool(server: McpServer, initPromise: Promise<McpContext>) {
    server.tool(
        "convert_file",
        "Convert a file by providing its base64-encoded bytes or a local file path.",
        {
            fileName: z.string().optional().describe("The name of the input file (e.g. image.jpg). Optional when filePath is provided."),
            base64Bytes: z.string().optional().describe("Base64 encoded bytes of the file content. Optional when filePath is provided."),
            filePath: z.string().optional().describe("Absolute path to a local file to read directly. Use this instead of base64Bytes for large files to avoid context window limits."),
            inputMime: z.string().describe("Input MIME type"),
            inputExtension: z.string().describe("Input format extension"),
            outputMime: z.string().describe("Output MIME type"),
            outputExtension: z.string().describe("Output format extension"),
            outputFilePath: z.string().optional().describe("Absolute path where the output file should be saved. If omitted, the result is returned as base64.")
        },
        async ({ fileName, base64Bytes, filePath, inputMime, inputExtension, outputMime, outputExtension, outputFilePath }) => {
            // Resolve file content: from filePath or base64Bytes
            if (filePath) {
                try {
                    const diskBytes = await readFile(filePath);
                    base64Bytes = diskBytes.toString('base64');
                    if (!fileName) fileName = basename(filePath);
                } catch (err: any) {
                    return {
                        content: [{ type: "text", text: `Error reading filePath: ${err?.message ?? err}` }],
                        isError: true
                    };
                }
            }

            if (!base64Bytes) {
                return {
                    content: [{ type: "text", text: "Error: Either base64Bytes or filePath must be provided." }],
                    isError: true
                };
            }

            if (!fileName) {
                return {
                    content: [{ type: "text", text: "Error: fileName must be provided when using base64Bytes." }],
                    isError: true
                };
            }

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

                        return await serializeResults(currentFiles, outputFilePath);
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
                if (outputFilePath && bridgeResults.length > 0) {
                    return await serializeResults(
                        bridgeResults.map((r: { fileName: string; base64Bytes: string }) => ({
                            name: r.fileName,
                            bytes: new Uint8Array(Buffer.from(r.base64Bytes, 'base64'))
                        })),
                        outputFilePath
                    );
                }
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
