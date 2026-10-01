import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { writeFile } from "fs/promises";
import { merge } from "../../tools/pdfMerge.ts";
import { buildSourceFiles, enforceSandboxedPath, fileInputSchema, ValidationError } from "../core/fileInput.ts";
import { toUserErrorText, appendSupportContact, FEEDBACK_CONTACT_TEXT } from "../../components/utils/index.ts";

export function registerPdfMergeTool(server: McpServer) {
    server.tool(
        "pdf_merge",
        "Merge multiple PDFs into a single PDF, concatenating pages in input order.",
        {
            inputs: z.array(fileInputSchema).min(2).describe("PDFs to merge, in order"),
            outputFilePath: z.string().optional().describe("Absolute path to save merged PDF. If omitted, returns base64."),
        },
        async ({ inputs, outputFilePath }) => {
            try {
                const sourceFiles = await buildSourceFiles(inputs);
                const result = await merge(sourceFiles);

                if (outputFilePath) {
                    // Matching the REST route for the same operation.
                    // FROGCONVERT_SANDBOX_ROOT is documented as
                    // defense-in-depth for untrusted clients reaching the
                    // local surfaces; it was applied on every REST write path
                    // and on only one MCP tool, so the MCP server ignored it.
                    const safeOut = enforceSandboxedPath(outputFilePath);
                    await writeFile(safeOut, result.bytes);
                    return { content: [{ type: "text", text: JSON.stringify({ savedTo: [safeOut] }) }] };
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
