import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { writeFile } from "fs/promises";
import { merge } from "../../tools/pdfMerge.ts";
import { buildSourceFiles, ValidationError } from "../core/fileInput.ts";
import { toUserErrorText, appendSupportContact, FEEDBACK_CONTACT_TEXT } from "../../components/utils/index.ts";

const inputSchema = z.object({
    filePath: z.string().optional(),
    base64Bytes: z.string().optional(),
    fileName: z.string().optional(),
});

export function registerPdfMergeTool(server: McpServer) {
    server.tool(
        "pdf_merge",
        "Merge multiple PDFs into a single PDF, concatenating pages in input order.",
        {
            inputs: z.array(inputSchema).min(2).describe("PDFs to merge, in order"),
            outputFilePath: z.string().optional().describe("Absolute path to save merged PDF. If omitted, returns base64."),
        },
        async ({ inputs, outputFilePath }) => {
            try {
                const sourceFiles = await buildSourceFiles(inputs);
                const result = await merge(sourceFiles);

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
