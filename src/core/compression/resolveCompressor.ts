import type { FileFormat, FormatHandler, QualityPreset } from "../FormatHandler/FormatHandler.ts";
import { DEFAULT_PRESET } from "../FormatHandler/qualityPresets.ts";

/**
 * Compression engine — dispatch layer. Maps a format to the handler that can
 * recompress it in place (same format in, same format out) and the args to
 * drive it. Extracted from the convert flow so any surface (the Convert card,
 * a dedicated Compress view, MCP/REST) can route to the compressor without
 * pulling in the format-picker UI.
 *
 * Takes the loaded handler/format list as a parameter rather than reading the
 * UI store on purpose: `src/core/` must not depend on `src/components/`.
 */

export type SameFormatDispatch = {
    handler: FormatHandler;
    args: string[];
    /**
     * Only used when `handler` cannot run at all (e.g. its payload could not be
     * fetched). Deliberately not a quality choice — a fallback is always worse
     * than the primary, or it would be the primary.
     */
    fallback?: { handler: FormatHandler; args: string[]; warning: string };
};

/** One entry of the app's loaded handler/format list (`allOptionsRef.value`). */
export type HandlerOption = { format: FileFormat; handler: FormatHandler };

const SAME_FORMAT_IMAGE_WHITELIST = new Set([
    "png", "jpeg", "jpg", "webp", "tiff", "tif", "bmp",
]);
const SAME_FORMAT_ANIMATED = new Set(["gif", "apng"]);

function findHandlerByName(name: string, options: readonly HandlerOption[]): FormatHandler | null {
    for (const opt of options) {
        if (opt.handler.name === name) return opt.handler;
    }
    return null;
}

export function handlerSupportsFormat(handler: FormatHandler, format: FileFormat): FileFormat | null {
    const cached = window.supportedFormatCache?.get(handler.name);
    const formats = cached ?? handler.supportedFormats ?? [];
    return formats.find(f =>
        f.mime === format.mime
        && f.format === format.format
        && f.from
        && f.to,
    ) ?? null;
}

/**
 * Route a same-format pick (png→png, mp4→mp4, etc.) to a compressing
 * handler. Returns null when the format isn't a compressible raster/media
 * type or when the required handler isn't loaded. Whitelist-based on
 * purpose: SVG/PSD/raw etc. would get rasterised or flattened, so they
 * stay in pass-through mode.
 */
export function resolveSameFormatHandler(
    format: FileFormat,
    options: readonly HandlerOption[],
): SameFormatDispatch | null {
    const fmt = (format.format || "").toLowerCase();
    const mime = (format.mime || "").toLowerCase();
    const quality: QualityPreset = format.lossless ? "lossless" : DEFAULT_PRESET;
    const baseArgs = ["--quality", quality];

    if (SAME_FORMAT_ANIMATED.has(fmt)) {
        const h = findHandlerByName("FFmpeg", options);
        if (!h || !handlerSupportsFormat(h, format)) return null;
        return { handler: h, args: baseArgs };
    }

    if (SAME_FORMAT_IMAGE_WHITELIST.has(fmt) && mime.startsWith("image/")) {
        const h = findHandlerByName("ImageMagick", options);
        if (!h || !handlerSupportsFormat(h, format)) return null;
        return { handler: h, args: baseArgs };
    }

    if (mime.startsWith("video/")) {
        const h = findHandlerByName("FFmpeg", options);
        if (!h || !handlerSupportsFormat(h, format)) return null;
        // Force re-encode: stream-copy fast path would remux without shrinking.
        return { handler: h, args: [...baseArgs, "--no-stream-copy"] };
    }

    if (mime.startsWith("audio/")) {
        const h = findHandlerByName("FFmpeg", options);
        if (!h || !handlerSupportsFormat(h, format)) return null;
        return { handler: h, args: baseArgs };
    }

    if (fmt === "pdf" || mime === "application/pdf") {
        // Ghostscript is the only route that compresses a PDF *as a PDF*.
        const h = findHandlerByName("Ghostscript", options);
        if (!h || !handlerSupportsFormat(h, format)) return null;

        // The canvas route rasterises pages, which is not really compression —
        // it throws the document away and keeps a picture of it. It is offered
        // strictly as a fallback for when the 16 MB Ghostscript payload cannot
        // be fetched (offline, blocked), never as an alternative the user is
        // silently given instead.
        const alt = findHandlerByName("PdfCanvasCompress", options);
        const fallback = alt && handlerSupportsFormat(alt, format)
            ? {
                handler: alt,
                args: baseArgs,
                warning: "Couldn't reach the PDF compressor, so pages were turned into images. "
                    + "The text is no longer selectable or searchable. Reconnect and run it again for a proper compression.",
            }
            : undefined;

        return { handler: h, args: baseArgs, fallback };
    }

    return null;
}

/** Category-agnostic check, used by the format modal to decide whether to show the "Compress" button copy. */
export function isSameFormatCompressible(
    format: FileFormat,
    options: readonly HandlerOption[],
): boolean {
    return resolveSameFormatHandler(format, options) !== null;
}
