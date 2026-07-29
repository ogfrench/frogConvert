import { describe, it, expect, beforeEach } from "vitest";
import type { FileFormat, FormatHandler } from "../FormatHandler/FormatHandler.ts";
import {
    resolveSameFormatHandler,
    isSameFormatCompressible,
    handlerSupportsFormat,
    type HandlerOption,
} from "./resolveCompressor.ts";

/**
 * This module is the dispatch seam every compressing surface goes through, so
 * the tests pin the routing decisions themselves (which engine, which args)
 * rather than any one caller's behaviour.
 */

function fmt(mime: string, format: string, extra: Partial<FileFormat> = {}): FileFormat {
    return { mime, format, extension: format, from: true, to: true, ...extra } as unknown as FileFormat;
}

function handler(name: string, supported: FileFormat[]): FormatHandler {
    return { name, supportedFormats: supported } as unknown as FormatHandler;
}

/** Build the `allOptionsRef.value`-shaped list the resolver reads. */
function optionsFor(handlers: FormatHandler[]): HandlerOption[] {
    return handlers.flatMap(h =>
        (h.supportedFormats ?? []).map(format => ({ format, handler: h })));
}

const PNG = fmt("image/png", "png");
const JPEG = fmt("image/jpeg", "jpeg");
const WEBP = fmt("image/webp", "webp");
const GIF = fmt("image/gif", "gif");
const MP4 = fmt("video/mp4", "mp4");
const MP3 = fmt("audio/mpeg", "mp3");
const SVG = fmt("image/svg+xml", "svg");

const imageMagick = handler("ImageMagick", [PNG, JPEG, WEBP, SVG]);
const ffmpeg = handler("FFmpeg", [GIF, MP4, MP3]);
const ALL = optionsFor([imageMagick, ffmpeg]);

beforeEach(() => {
    // The cache is consulted before `handler.supportedFormats`; most tests want
    // the declared list, so start each one with the cache empty.
    window.supportedFormatCache = new Map();
});

describe("resolveSameFormatHandler — engine routing", () => {
    it("sends whitelisted raster images to ImageMagick", () => {
        const got = resolveSameFormatHandler(PNG, ALL);
        expect(got?.handler.name).toBe("ImageMagick");
        expect(got?.args).toEqual(["--quality", "medium"]);
    });

    it("sends animated formats to FFmpeg, not ImageMagick", () => {
        // GIF is image/* but ImageMagick would flatten or balloon it, so the
        // animated branch has to win over the raster branch.
        const withGifInMagick = optionsFor([handler("ImageMagick", [GIF]), ffmpeg]);
        expect(resolveSameFormatHandler(GIF, withGifInMagick)?.handler.name).toBe("FFmpeg");
    });

    it("sends video to FFmpeg and forces a re-encode", () => {
        const got = resolveSameFormatHandler(MP4, ALL);
        expect(got?.handler.name).toBe("FFmpeg");
        // Without this, FFmpeg stream-copies and the file comes back the same size.
        expect(got?.args).toContain("--no-stream-copy");
    });

    it("sends audio to FFmpeg without forcing a re-encode", () => {
        const got = resolveSameFormatHandler(MP3, ALL);
        expect(got?.handler.name).toBe("FFmpeg");
        expect(got?.args).not.toContain("--no-stream-copy");
    });

    it("only matches formats as spelled in the registry", () => {
        // The whitelist check lowercases, but the support lookup compares
        // mime/format exactly, so the function is only half case-insensitive.
        // Harmless today — every FileFormat originates from the app's own
        // (lowercase) registry — but worth pinning so the asymmetry is a
        // deliberate limitation rather than a surprise.
        expect(resolveSameFormatHandler(fmt("IMAGE/PNG", "PNG"), ALL)).toBeNull();
        expect(resolveSameFormatHandler(PNG, ALL)?.handler.name).toBe("ImageMagick");
    });
});

describe("resolveSameFormatHandler — refusals", () => {
    it("refuses formats outside the whitelist even when a handler claims them", () => {
        // SVG is in ImageMagick's supported list, but recompressing it would
        // rasterise vector art — pass-through is the correct answer.
        expect(resolveSameFormatHandler(SVG, ALL)).toBeNull();
    });

    it("refuses when the required handler is not loaded", () => {
        const magickOnly = optionsFor([imageMagick]);
        expect(resolveSameFormatHandler(MP4, magickOnly)).toBeNull();
    });

    it("refuses when the handler is loaded but does not support that format", () => {
        const magickWithoutPng = optionsFor([handler("ImageMagick", [JPEG]), ffmpeg]);
        expect(resolveSameFormatHandler(PNG, magickWithoutPng)).toBeNull();
    });

    it("refuses image types the whitelist omits", () => {
        const withHeic = optionsFor([handler("ImageMagick", [fmt("image/heic", "heic")])]);
        expect(resolveSameFormatHandler(fmt("image/heic", "heic"), withHeic)).toBeNull();
    });

    it("refuses non-media formats entirely", () => {
        const withZip = optionsFor([handler("SevenZip", [fmt("application/zip", "zip")])]);
        expect(resolveSameFormatHandler(fmt("application/zip", "zip"), withZip)).toBeNull();
    });

    it("refuses everything when no handlers are loaded", () => {
        expect(resolveSameFormatHandler(PNG, [])).toBeNull();
        expect(resolveSameFormatHandler(MP4, [])).toBeNull();
    });
});

describe("resolveSameFormatHandler — quality argument", () => {
    it("asks for the default preset on lossy formats", () => {
        expect(resolveSameFormatHandler(JPEG, ALL)?.args).toEqual(["--quality", "medium"]);
    });

    it("asks for lossless on formats declared lossless", () => {
        const losslessPng = fmt("image/png", "png", { lossless: true });
        const opts = optionsFor([handler("ImageMagick", [losslessPng])]);
        expect(resolveSameFormatHandler(losslessPng, opts)?.args).toEqual(["--quality", "lossless"]);
    });
});

describe("handlerSupportsFormat", () => {
    it("prefers the runtime cache over the handler's declared list", () => {
        // The cache reflects what the loaded WASM build actually reports, which
        // can be narrower than the static list.
        window.supportedFormatCache = new Map([["ImageMagick", [JPEG]]]);
        expect(handlerSupportsFormat(imageMagick, PNG)).toBeNull();
        expect(handlerSupportsFormat(imageMagick, JPEG)).toEqual(JPEG);
    });

    it("requires the format to be usable in both directions", () => {
        const readOnly = fmt("image/png", "png", { to: false });
        const h = handler("ImageMagick", [readOnly]);
        expect(handlerSupportsFormat(h, readOnly)).toBeNull();
    });

    it("tolerates a handler with no declared formats", () => {
        expect(handlerSupportsFormat(handler("Empty", []), PNG)).toBeNull();
    });
});

describe("isSameFormatCompressible", () => {
    it("agrees with the resolver on every format", () => {
        for (const f of [PNG, JPEG, WEBP, GIF, MP4, MP3, SVG]) {
            expect(isSameFormatCompressible(f, ALL))
                .toBe(resolveSameFormatHandler(f, ALL) !== null);
        }
    });
});
