import type { FormatHandler, FileFormat } from "../../core/FormatHandler/FormatHandler.ts";

const LIBREOFFICE_EXTS = new Set(["pptx", "docx", "xlsx", "ppt", "odt", "odp", "ods"]);

/**
 * Returns an install hint when an office-to-PDF conversion would succeed with
 * LibreOffice installed but the handler is currently unavailable.
 */
export function libreofficeHint(
    allHandlers: FormatHandler[],
    inputExt: string,
    outputExt: string
): string | null {
    if (!LIBREOFFICE_EXTS.has(inputExt) || outputExt !== "pdf") return null;
    const lo = allHandlers.find(h => h.name === "libreoffice");
    if (lo && !lo.ready) {
        return "Tip: Install LibreOffice (https://libreoffice.org) to enable high-quality office-to-PDF conversion.";
    }
    return null;
}

/**
 * Finds the corresponding FormatHandler and FileFormat for a given mime type and extension.
 *
 * @param handlers - Array of supported FormatHandlers
 * @param mime - The requested MIME type
 * @param extension - The requested file extension
 * @param direction - Optional: 'from' requires the format to support reading, 'to' requires writing
 * @returns An object containing the format and handler if found, otherwise undefined.
 */
export function findFormatAndHandler(
    handlers: FormatHandler[],
    mime: string,
    extension: string,
    direction?: 'from' | 'to'
): { format: FileFormat; handler: FormatHandler } | undefined {
    for (const h of handlers) {
        if (!h.supportedFormats) continue;
        for (const f of h.supportedFormats) {
            if (f.mime === mime && (f.extension === extension || f.format === extension)) {
                if (direction === 'from' && !f.from) continue;
                if (direction === 'to' && !f.to) continue;
                return { format: f, handler: h };
            }
        }
    }
    return undefined;
}
