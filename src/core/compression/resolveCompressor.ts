import type { FileFormat, FormatHandler, QualityPreset } from "../FormatHandler/FormatHandler.ts";
import { DEFAULT_PRESET } from "../FormatHandler/qualityPresets.ts";
import { allOptionsRef } from "../../components/store/store.ts";

/**
 * Compression engine — dispatch layer. Maps a format to the handler that can
 * recompress it in place (same format in, same format out) and the args to
 * drive it. Extracted from the convert flow so any surface (the Convert card,
 * a dedicated Compress view, MCP/REST) can route to the compressor without
 * pulling in the format-picker UI.
 */

export type SameFormatDispatch = { handler: FormatHandler; args: string[] };

const SAME_FORMAT_IMAGE_WHITELIST = new Set([
    "png", "jpeg", "jpg", "webp", "tiff", "tif", "bmp",
]);
const SAME_FORMAT_ANIMATED = new Set(["gif", "apng"]);

function findHandlerByName(name: string): FormatHandler | null {
    for (const opt of allOptionsRef.value) {
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
export function resolveSameFormatHandler(format: FileFormat): SameFormatDispatch | null {
    const fmt = (format.format || "").toLowerCase();
    const mime = (format.mime || "").toLowerCase();
    const quality: QualityPreset = format.lossless ? "lossless" : DEFAULT_PRESET;
    const baseArgs = ["--quality", quality];

    if (SAME_FORMAT_ANIMATED.has(fmt)) {
        const h = findHandlerByName("FFmpeg");
        if (!h || !handlerSupportsFormat(h, format)) return null;
        return { handler: h, args: baseArgs };
    }

    if (SAME_FORMAT_IMAGE_WHITELIST.has(fmt) && mime.startsWith("image/")) {
        const h = findHandlerByName("ImageMagick");
        if (!h || !handlerSupportsFormat(h, format)) return null;
        return { handler: h, args: baseArgs };
    }

    if (mime.startsWith("video/")) {
        const h = findHandlerByName("FFmpeg");
        if (!h || !handlerSupportsFormat(h, format)) return null;
        // Force re-encode: stream-copy fast path would remux without shrinking.
        return { handler: h, args: [...baseArgs, "--no-stream-copy"] };
    }

    if (mime.startsWith("audio/")) {
        const h = findHandlerByName("FFmpeg");
        if (!h || !handlerSupportsFormat(h, format)) return null;
        return { handler: h, args: baseArgs };
    }

    return null;
}

/** Category-agnostic check, used by the format modal to decide whether to show the "Compress" button copy. */
export function isSameFormatCompressible(format: FileFormat): boolean {
    return resolveSameFormatHandler(format) !== null;
}
