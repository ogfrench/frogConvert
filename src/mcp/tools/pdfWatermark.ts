import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { writeFile } from "fs/promises";
import {
  watermark,
  hexToRgb,
  WATERMARK_DEFAULTS,
  WatermarkValidationError,
} from "../../tools/pdfWatermark.ts";
import { resolveBytes, enforceSandboxedPath, fileInputSchema, ValidationError } from "../core/fileInput.ts";
import { toUserErrorText, appendSupportContact, FEEDBACK_CONTACT_TEXT } from "../../components/utils/index.ts";

export function registerPdfWatermarkTool(server: McpServer) {
  server.tool(
    "pdf_watermark",
    "Apply a text watermark to selected pages of a PDF. Watermarks are visual marks; they do not encrypt or restrict copying.",
    {
      input: fileInputSchema.describe("Source PDF"),
      text: z.string().min(1).describe("Watermark text (e.g. 'CONFIDENTIAL')"),
      fontSize: z.number().positive().default(WATERMARK_DEFAULTS.fontSize).describe("Font size in points"),
      colorHex: z.string().default(WATERMARK_DEFAULTS.colorHex).describe("Color as #RRGGBB hex"),
      opacity: z.number().min(0).max(1).default(WATERMARK_DEFAULTS.opacity).describe("Opacity 0-1"),
      rotationDegrees: z.number().default(WATERMARK_DEFAULTS.rotationDegrees).describe("Rotation in degrees, e.g. -45 for diagonal"),
      repeat: z.boolean().default(WATERMARK_DEFAULTS.repeat).describe("Tile the watermark across each page with internal spacing"),
      pageNums: z.array(z.number().int().positive()).optional().describe("1-indexed pages to watermark; omit for all pages"),
      outputFilePath: z.string().optional().describe("Absolute path to save output. If omitted, returns base64."),
    },
    async ({ input, text, fontSize, colorHex, opacity, rotationDegrees, repeat, pageNums, outputFilePath }) => {
      try {
        const { bytes, name } = await resolveBytes(input);

        let color;
        try {
          color = hexToRgb(colorHex);
        } catch (e: any) {
          throw new ValidationError(`colorHex: ${e.message}`);
        }

        const result = await watermark(bytes, name, {
          source: { type: "text", text, fontSize, color },
          opacity,
          rotationDegrees,
          repeat,
          pageNums,
        });

        if (outputFilePath) {
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
        if (err instanceof ValidationError || err instanceof WatermarkValidationError) {
          return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
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
