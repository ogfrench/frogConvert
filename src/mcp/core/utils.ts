import type { FormatHandler, FileFormat } from "../../core/FormatHandler/FormatHandler.ts";

/**
 * Finds the corresponding FormatHandler and FileFormat for a given mime type and extension.
 * 
 * @param handlers - Array of supported FormatHandlers
 * @param mime - The requested MIME type
 * @param extension - The requested file extension
 * @returns An object containing the format and handler if found, otherwise undefined.
 */
export function findFormatAndHandler(
    handlers: FormatHandler[],
    mime: string,
    extension: string
): { format: FileFormat; handler: FormatHandler } | undefined {
    for (const h of handlers) {
        if (!h.supportedFormats) continue;
        for (const f of h.supportedFormats) {
            if (f.mime === mime && (f.extension === extension || f.format === extension)) {
                return { format: f, handler: h };
            }
        }
    }
    return undefined;
}
