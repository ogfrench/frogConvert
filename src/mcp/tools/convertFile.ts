import { hopQualityArgs } from "../../core/compression/hopQuality.ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { writeFile } from "fs/promises";
import { basename, dirname, join } from "path";
import type { FileData } from "../../core/FormatHandler/FormatHandler.ts";
import type { McpContext } from "../core/types.ts";

import { findFormatAndHandler, libreofficeHint } from "../core/utils.ts";
import { convertViaBrowser } from "../core/browserBridge.ts";
import { resolveBytes } from "../core/fileInput.ts";
import { resolveEffectiveQuality } from "../../core/compression/resolveEffectiveQuality.ts";
import { appendSupportContact, toUserErrorInfo } from "../../components/utils/index.ts";

async function serializeResults(files: FileData[], outputFilePath?: string) {
    // Collect warnings from all files (deduped).
    const warnings = Array.from(new Set(files.flatMap(f => f.warnings ?? [])));

    if (outputFilePath && files.length > 0) {
        const firstFile = files[0];
        const outDir = dirname(outputFilePath);
        const paths: string[] = [];

        await writeFile(outputFilePath, firstFile.bytes);
        paths.push(outputFilePath);

        for (let i = 1; i < files.length; i++) {
            const extra = join(outDir, basename(files[i].name));
            await writeFile(extra, files[i].bytes);
            paths.push(extra);
        }

        const payload: Record<string, unknown> = { savedTo: paths };
        if (warnings.length > 0) payload.warnings = warnings;
        return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
    }

    const results = files.map(f => ({
        fileName: f.name,
        base64Bytes: Buffer.from(f.bytes).toString('base64'),
        ...(f.warnings?.length ? { warnings: f.warnings } : {}),
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
            outputFilePath: z.string().optional().describe("Absolute path where the output file should be saved. If omitted, the result is returned as base64."),
            quality: z.enum(["low", "medium", "high", "lossless"]).optional().describe("Quality preset. When omitted for cross-format conversion defaults to 'lossless': a conversion changes the format and nothing else, so pass a level explicitly to also shrink the file. When omitted for same-format compression, the input is probed and the next lower tier is picked automatically (matching the web UI behavior). 'low' trades quality for smaller output and downscales to a 1920px long edge; 'medium' downscales to 2560px; 'high' raises quality and applies no cap; 'lossless' disables lossy compression where the codec supports it. Only affects handlers that re-encode (FFmpeg, ImageMagick, pdftoimg). To shrink a file without changing its format, use compress_file.")
        },
        async ({ fileName, base64Bytes, filePath, inputMime, inputExtension, outputMime, outputExtension, outputFilePath, quality }) => {
            let bytes: Uint8Array;
            let resolvedName: string;
            try {
                const r = await resolveBytes({ filePath, base64Bytes, fileName });
                bytes = r.bytes;
                resolvedName = r.name;
            } catch (err: any) {
                return {
                    content: [{ type: "text", text: `Error: ${err?.message ?? err}` }],
                    isError: true,
                };
            }

            const { handlers, allHandlers, graph } = await initPromise;

            const inputMatch = findFormatAndHandler(handlers, inputMime, inputExtension, 'from');
            const outputMatch = findFormatAndHandler(handlers, outputMime, outputExtension, 'to');
            let nativeFailure: unknown = null;

            const resolved = await resolveEffectiveQuality(quality, bytes, inputMime, outputMime);
            if (resolved === null) {
                return await serializeResults([{ name: resolvedName, bytes }], outputFilePath);
            }

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
                    let currentFiles: FileData[] = [{ name: resolvedName, bytes }];

                    try {
                        // path[0] is the source node (no conversion step); steps start at index 1
                        for (let i = 1; i < path.length; i++) {
                            const stepHandler = path[i].handler;
                            const prevFormat = path[i - 1].format;
                            const nextFormat = path[i].format;
                            currentFiles = await stepHandler.doConvert(currentFiles, prevFormat, nextFormat,
                                hopQualityArgs({ target: nextFormat, isLastHop: i === path.length - 1, requested: resolved }));
                        }

                        return await serializeResults(currentFiles, outputFilePath);
                    } catch (nativeErr: any) {
                        nativeFailure = nativeErr;
                        // Native execution failed, log for diagnostics and fall through to browser bridge
                        process.stderr.write(`[mcp] Native conversion failed, trying browser bridge: ${nativeErr?.message ?? nativeErr}\n`);
                    }
                }
            }

            // No native path, format unknown to native registry, or native execution failed.
            // The bridge loads ALL handlers including browser-only ones (requiresMainThread=true).
            try {
                const bridgeBase64 = Buffer.from(bytes).toString('base64');
                const bridgeResults = await convertViaBrowser(
                    resolvedName, bridgeBase64, inputMime, inputExtension, outputMime, outputExtension, resolved
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
                const bridgeInfo = toUserErrorInfo(bridgeErr);
                const nativeInfo = nativeFailure ? toUserErrorInfo(nativeFailure) : null;
                let msg = nativeInfo?.kind === "unknown" || nativeInfo?.kind === "runtime_failure"
                    ? "Something went wrong while converting this file."
                    : bridgeInfo.message || "Something went wrong while converting this file.";
                const hint = allHandlers && libreofficeHint(allHandlers, inputExtension, outputExtension);
                if (hint) msg += `\n${hint}`;
                return {
                    content: [{ type: "text", text: `Error: ${appendSupportContact(msg)}` }],
                    isError: true
                };
            }
        }
    );
}
