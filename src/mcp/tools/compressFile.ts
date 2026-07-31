import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { writeFile } from "fs/promises";
import mime from "mime";
import type { McpContext } from "../core/types.ts";
import { resolveBytes } from "../core/fileInput.ts";
import { compressForAgents, type AgentCompressInput } from "../../core/compression/compressForAgents.ts";

/**
 * `compress_file` - make a file smaller without changing what it is.
 *
 * ## Why this is not `convert_file` with matching formats
 *
 * That was the documented approach and it never worked. A same-format request
 * resolves to a zero-hop path through the conversion graph, and the runner
 * skips a path with no steps - so the input came straight back. Measured: a
 * 10 MB image-heavy PDF returned byte-identical at every preset while the
 * browser shrank it by 89%.
 *
 * Compression also wants a different answer shape. A conversion either
 * produces the requested format or fails; a compression frequently succeeds
 * while doing nothing, and the useful reply is *why* - the file was already
 * minimal, there is no compressor for it, the result would have been bigger.
 * `convert_file` has nowhere to put that.
 */

/** Matches the web UI's Compress surface, which offers no `lossless`. */
const LEVELS = ["auto", "high", "medium", "low"] as const;

export function registerCompressFileTool(server: McpServer, initPromise: Promise<McpContext>) {
    server.tool(
        "compress_file",
        "Make files smaller without changing their format (images, audio, video, PDFs). "
        + "Returns each file with a report saying whether it shrank and, if not, why. "
        + "Use this instead of convert_file when the input and output format are the same.",
        {
            fileName: z.string().optional()
                .describe("Name of the input file (e.g. photo.jpg). Optional when filePath is given; the extension is how the format is identified."),
            base64Bytes: z.string().optional()
                .describe("Base64-encoded file content. Optional when filePath is given."),
            filePath: z.string().optional()
                .describe("Absolute path to a local file. Prefer this over base64Bytes for large files to avoid context limits."),
            filePaths: z.array(z.string()).optional()
                .describe("Absolute paths to compress as one batch. Each format is routed to its own engine in a single pass."),
            outputFilePath: z.string().optional()
                .describe("Absolute path to write the result to. If omitted, bytes come back as base64. Ignored when compressing a batch, which writes beside each source."),
            level: z.enum(LEVELS).optional()
                .describe("How hard to squeeze. 'auto' (default) probes each file and picks a level for it, matching the web UI. 'high' keeps original dimensions, 'medium' is the balanced default, 'low' resizes and visibly reduces quality. There is no 'lossless': as a compression level it would mean doing nothing."),
        },
        async ({ fileName, base64Bytes, filePath, filePaths, outputFilePath, level }) => {
            const { handlers } = await initPromise;

            // Gather the inputs. A batch is the case the Compress surface is
            // built around, and a script compressing a folder should not have
            // to make one call per file.
            const inputs: AgentCompressInput[] = [];
            const sourcePaths: (string | undefined)[] = [];
            try {
                const sources = filePaths?.length
                    ? filePaths.map(p => ({ filePath: p }))
                    : [{ filePath, base64Bytes, fileName }];
                for (const source of sources) {
                    const { bytes, name } = await resolveBytes(source);
                    const extension = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
                    inputs.push({
                        name,
                        bytes,
                        mime: mime.getType(name) || "application/octet-stream",
                        extension,
                    });
                    sourcePaths.push(source.filePath);
                }
            } catch (err: any) {
                return { content: [{ type: "text", text: `Error: ${err?.message ?? err}` }], isError: true };
            }

            const results = await compressForAgents(inputs, { handlers, level: level ?? "auto" });

            // Writing to disk is the point for a batch - handing an agent
            // several megabytes of base64 it did not ask for wastes its context.
            const single = results.length === 1;
            const payload = await Promise.all(results.map(async (r, i) => {
                const saved = r.originalSize - r.bytes.byteLength;
                const report: Record<string, unknown> = {
                    fileName: r.name,
                    originalSize: r.originalSize,
                    compressedSize: r.bytes.byteLength,
                    savedBytes: saved,
                    savedPercent: r.originalSize > 0 ? Number(((saved / r.originalSize) * 100).toFixed(1)) : 0,
                    shrunk: r.shrunk,
                };
                if (r.reason) report.reason = r.reason;
                if (r.warning) report.warning = r.warning;

                const target = single ? outputFilePath : undefined;
                if (target) {
                    await writeFile(target, r.bytes);
                    report.savedTo = target;
                } else if (!single && sourcePaths[i]) {
                    // Beside the source, never over it: overwriting an input is
                    // not something a tool should do without being asked.
                    const src = sourcePaths[i]!;
                    const dot = src.lastIndexOf(".");
                    const out = dot > 0 ? `${src.slice(0, dot)}-compressed${src.slice(dot)}` : `${src}-compressed`;
                    await writeFile(out, r.bytes);
                    report.savedTo = out;
                } else {
                    report.base64Bytes = Buffer.from(r.bytes).toString("base64");
                }
                return report;
            }));

            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({ level: level ?? "auto", files: payload }),
                }],
            };
        },
    );
}
