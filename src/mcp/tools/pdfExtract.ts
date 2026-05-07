import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { writeFile } from "fs/promises";
import { join } from "path";
import { extract } from "../../tools/pdfExtract.ts";
import { resolveBytes, stripExt, fileInputSchema, ValidationError } from "../core/fileInput.ts";
import { toUserErrorText, appendSupportContact, FEEDBACK_CONTACT_TEXT } from "../../components/utils/index.ts";

export function registerPdfExtractTool(server: McpServer) {
    server.tool(
        "pdf_extract",
        "Extract selected pages from a PDF. Returns one PDF per page by default, or a single combined PDF when groupAsOne is true.",
        {
            input: fileInputSchema.describe("Source PDF"),
            pageNums: z.array(z.number().int().positive()).min(1).describe("1-indexed page numbers to extract"),
            baseName: z.string().optional().describe("Base name for output files; defaults to input filename stem"),
            groupAsOne: z.boolean().default(false),
            outputDir: z.string().optional().describe("Absolute directory to save outputs. If omitted, returns base64."),
        },
        async ({ input, pageNums, baseName, groupAsOne, outputDir }) => {
            try {
                const { bytes, name } = await resolveBytes(input);
                const effectiveBase = baseName ?? stripExt(name);
                const results = await extract(bytes, pageNums, effectiveBase, groupAsOne);

                if (outputDir) {
                    const paths = await Promise.all(results.map(async f => {
                        const p = join(outputDir, f.name);
                        await writeFile(p, f.bytes);
                        return p;
                    }));
                    return { content: [{ type: "text", text: JSON.stringify({ savedTo: paths }) }] };
                }

                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify(results.map(f => ({
                            fileName: f.name,
                            base64Bytes: Buffer.from(f.bytes).toString("base64"),
                        }))),
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
