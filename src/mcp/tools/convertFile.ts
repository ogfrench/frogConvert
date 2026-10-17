import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { writeFile } from "fs/promises";
import { basename, dirname, join } from "path";
import type { FileData } from "../../core/FormatHandler/FormatHandler.ts";
import type { McpContext } from "../core/types.ts";

import { convertForAgents } from "../core/convert.ts";
import { resolveBytes, enforceSandboxedPath } from "../core/fileInput.ts";

async function serializeResults(files: FileData[], outputFilePath?: string, extraWarnings: string[] = []) {
    // The files' own warnings and the route's (deduped).
    const warnings = Array.from(new Set([...files.flatMap(f => f.warnings ?? []), ...extraWarnings]));

    if (outputFilePath && files.length > 0) {
        const firstFile = files[0];
        // Checked once, here, rather than at each write: every path below is
        // derived from this one. FROGCONVERT_SANDBOX_ROOT is documented as
        // containment for untrusted clients reaching the local surfaces, and
        // was honoured on the REST side only - so the MCP server wrote
        // wherever the caller pointed it.
        const safeOut = enforceSandboxedPath(outputFilePath);
        const outDir = dirname(safeOut);
        const paths: string[] = [];

        await writeFile(safeOut, firstFile.bytes);
        paths.push(safeOut);

        for (let i = 1; i < files.length; i++) {
            // basename() already here, and still right: a handler-produced
            // name must not carry path segments out of outDir.
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
        ...(warnings.length ? { warnings } : {}),
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
            quality: z.enum(["low", "medium", "high", "lossless"]).optional().describe("Quality preset. When omitted for cross-format conversion defaults to 'lossless': a conversion changes the format and nothing else, so pass a level explicitly to also compress the file. When omitted for same-format compression, the input is probed and the next lower tier is picked automatically (matching the web UI behavior). 'low' trades quality for smaller output and downscales to a 1920px long edge; 'medium' downscales to 2560px; 'high' raises quality and applies no cap; 'lossless' disables lossy compression where the codec supports it. Only affects handlers that re-encode (FFmpeg, ImageMagick, pdftoimg). To compress a file without changing its format, use compress_file.")
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
            // Shared with REST /convert, so the two surfaces cannot drift again.
            const result = await convertForAgents({
                handlers, graph, allHandlers, fileName: resolvedName, bytes,
                inputMime, inputExt: inputExtension, outputMime, outputExt: outputExtension, quality,
            });
            if ("error" in result) {
                return { content: [{ type: "text", text: `Error: ${result.error}` }], isError: true };
            }
            return await serializeResults(result.files, outputFilePath, result.warnings);
        }
    );
}
