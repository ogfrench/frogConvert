import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { writeFile } from "fs/promises";
import { organize } from "../../tools/pdfOrganize.ts";
import type { CorePageEntry } from "../../tools/types.ts";
import { buildSourceFiles, fileInputSchema, ValidationError } from "../core/fileInput.ts";
import { toUserErrorText, appendSupportContact, FEEDBACK_CONTACT_TEXT } from "../../components/utils/index.ts";

const pageSchema = z.object({
    sourceIndex: z.number().int().describe("Index into inputs[], or -1 for a blank page"),
    pageNum: z.number().int().describe("1-indexed page number in the source PDF, 0 for blank"),
    rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
    blank: z.boolean().optional(),
    blankSize: z.object({ width: z.number(), height: z.number() }).optional(),
});

export function registerPdfOrganizeTool(server: McpServer) {
    server.tool(
        "pdf_organize",
        "Build a new PDF by reordering, rotating, deleting, or inserting blank pages from one or more source PDFs.",
        {
            inputs: z.array(fileInputSchema).min(1).describe("Source PDFs"),
            pages: z.array(pageSchema).min(1).describe("Ordered page manifest"),
            outputFilePath: z.string().optional(),
        },
        async ({ inputs, pages, outputFilePath }) => {
            try {
                const sourceFiles = await buildSourceFiles(inputs);

                const manifest: CorePageEntry[] = pages.map((p, idx) => {
                    const isBlank = p.blank || p.sourceIndex === -1;
                    if (!isBlank && (p.sourceIndex < 0 || p.sourceIndex >= inputs.length)) {
                        throw new ValidationError(`pages[${idx}].sourceIndex ${p.sourceIndex} out of range (inputs.length=${inputs.length})`);
                    }
                    return {
                        type: isBlank ? "blank" : "source",
                        sourceFileId: isBlank ? -1 : p.sourceIndex,
                        sourcePageNum: isBlank ? 0 : p.pageNum,
                        rotation: (p.rotation ?? 0) as 0 | 90 | 180 | 270,
                        blankPageSize: p.blankSize,
                    };
                });

                const result = await organize(sourceFiles, manifest);

                if (outputFilePath) {
                    await writeFile(outputFilePath, result.bytes);
                    return { content: [{ type: "text", text: JSON.stringify({ savedTo: [outputFilePath] }) }] };
                }

                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify([{
                            fileName: result.name,
                            base64Bytes: Buffer.from(result.bytes).toString("base64"),
                        }]),
                    }],
                };
            } catch (err: any) {
                if (err instanceof ValidationError) {
                    return {
                        content: [{ type: "text", text: `Error: ${err.message}` }],
                        isError: true,
                    };
                }
                const msg = toUserErrorText(err) || (err instanceof Error ? err.message : String(err));
                return {
                    content: [{ type: "text", text: appendSupportContact(`Error: ${msg}`, FEEDBACK_CONTACT_TEXT) }],
                    isError: true,
                };
            }
        }
    );
}
