import { describe, it, expect, beforeEach } from "vitest";
import {
    isCategoryVisible, isFormatVisible, type FormatMode,
    checkFileSizeLimits, sortFilesByName, formatDisplayName, getFormatCategory,
    isLoadingHandlers, getMaxFiles,
    convertQuality, setConvertQuality, CONVERT_QUALITY_CHOICES,
    compressLevel, setCompressLevel, COMPRESS_LEVEL_CHOICES,
} from "./store.ts";
import { ABSOLUTE_MAX_FILES } from "../../constants/ui.ts";
import type { FileFormat } from "../../core/FormatHandler/FormatHandler.ts";

describe("store visibility logic", () => {
    const mockFormat = (format: string, mime?: string) => ({
        format,
        name: "Mock",
        extension: format,
        mime: mime || (format === "png" || format === "webp" || format === "tiff" || format === "svg" || format === "ico" ? `image/${format}` :
            format === "pdf" ? "application/pdf" :
                format === "xml" ? "application/xml" :
                    "application/octet-stream"),
        to: true,
        from: true,
        internal: "mock-internal"
    } as any);

    describe("isCategoryVisible", () => {
        it("hides data, font, code, other in 'core' mode", () => {
            expect(isCategoryVisible("image", "core")).toBe(true);
            expect(isCategoryVisible("data", "core")).toBe(false);
            expect(isCategoryVisible("font", "core")).toBe(false);
            expect(isCategoryVisible("code", "core")).toBe(false);
            expect(isCategoryVisible("other", "core")).toBe(false);
        });

        it("hides code and other in 'plus' mode", () => {
            expect(isCategoryVisible("data", "plus")).toBe(true);
            expect(isCategoryVisible("font", "plus")).toBe(true);
            expect(isCategoryVisible("code", "plus")).toBe(false);
            expect(isCategoryVisible("other", "plus")).toBe(false);
        });

        it("shows everything in 'all' mode", () => {
            expect(isCategoryVisible("code", "all")).toBe(true);
            expect(isCategoryVisible("other", "all")).toBe(true);
        });
    });

    describe("isFormatVisible", () => {
        it("blocks formats if their category is hidden", () => {
            const xml = mockFormat("xml"); // 'data' category (by extension logic in store.ts)
            expect(isFormatVisible(xml, "core")).toBe(false);
        });

        it("only shows CORE_FORMATS in 'core' mode", () => {
            expect(isFormatVisible(mockFormat("png"), "core")).toBe(true);
            expect(isFormatVisible(mockFormat("webp"), "core")).toBe(true);
            expect(isFormatVisible(mockFormat("svg"), "core")).toBe(true);
            expect(isFormatVisible(mockFormat("ico"), "core")).toBe(false);
            expect(isFormatVisible(mockFormat("pdf"), "core")).toBe(true);
        });

        it("shows PLUS_FORMATS in 'plus' mode", () => {
            expect(isFormatVisible(mockFormat("png"), "plus")).toBe(true);
            expect(isFormatVisible(mockFormat("ico"), "plus")).toBe(true);
            expect(isFormatVisible(mockFormat("tiff"), "plus")).toBe(false);
        });

        it("shows everything in 'all' mode", () => {
            expect(isFormatVisible(mockFormat("tiff"), "all")).toBe(true);
            expect(isFormatVisible(mockFormat("xml"), "all")).toBe(true);
        });
    });
});

// ---------------------------------------------------------------------------
// checkFileSizeLimits
// ---------------------------------------------------------------------------

function makeFile(name: string, size: number): File {
    return Object.defineProperty(new File([new Uint8Array(0)], name), "size", { value: size });
}

describe("checkFileSizeLimits", () => {
    it("returns ok with totalSize 0 for an empty array", () => {
        expect(checkFileSizeLimits([])).toEqual({ level: "ok", totalSize: 0 });
    });

    it("returns ok when total is below threshold", () => {
        const f = makeFile("small.png", 1024 * 1024); // 1 MB
        expect(checkFileSizeLimits([f])).toEqual({ level: "ok", totalSize: 1024 * 1024 });
    });

    it("returns warning when total exceeds 3.6 GB", () => {
        const big = makeFile("big.bin", 4 * 1024 * 1024 * 1024);
        const result = checkFileSizeLimits([big]);
        expect(result.level).toBe("warning");
        expect(result.totalSize).toBe(4 * 1024 * 1024 * 1024);
    });

    it("sums sizes of multiple files", () => {
        const a = makeFile("a.mp4", 2 * 1024 * 1024 * 1024);
        const b = makeFile("b.mp4", 2 * 1024 * 1024 * 1024);
        const result = checkFileSizeLimits([a, b]);
        expect(result.level).toBe("warning");
        expect(result.totalSize).toBe(4 * 1024 * 1024 * 1024);
    });
});

// ---------------------------------------------------------------------------
// sortFilesByName
// ---------------------------------------------------------------------------

describe("sortFilesByName", () => {
    it("sorts files alphabetically in-place", () => {
        const files = [new File([""], "c.png"), new File([""], "a.png"), new File([""], "b.png")];
        sortFilesByName(files);
        expect(files.map(f => f.name)).toEqual(["a.png", "b.png", "c.png"]);
    });

    it("does not change a single-file array", () => {
        const files = [new File([""], "only.png")];
        sortFilesByName(files);
        expect(files[0].name).toBe("only.png");
    });

    it("handles already-sorted arrays", () => {
        const files = [new File([""], "a.mp3"), new File([""], "b.mp3"), new File([""], "c.mp3")];
        sortFilesByName(files);
        expect(files.map(f => f.name)).toEqual(["a.mp3", "b.mp3", "c.mp3"]);
    });
});

// ---------------------------------------------------------------------------
// formatDisplayName
// ---------------------------------------------------------------------------

describe("formatDisplayName", () => {
    it("produces 'FORMAT - Name'", () => {
        const fmt = { format: "png", name: "Portable Network Graphics" } as FileFormat;
        expect(formatDisplayName(fmt)).toBe("PNG - Portable Network Graphics");
    });

    it("uppercases the format key", () => {
        const fmt = { format: "mp3", name: "MPEG Audio" } as FileFormat;
        expect(formatDisplayName(fmt)).toBe("MP3 - MPEG Audio");
    });

    it("strips parenthetical content from name", () => {
        const fmt = { format: "png", name: "PNG (Lossless)" } as FileFormat;
        expect(formatDisplayName(fmt)).toBe("PNG - PNG");
    });

    it("collapses extra whitespace after stripping parens", () => {
        const fmt = { format: "svg", name: "SVG  (Vector)  Format" } as FileFormat;
        expect(formatDisplayName(fmt)).toBe("SVG - SVG Format");
    });
});

// ---------------------------------------------------------------------------
// getFormatCategory
// ---------------------------------------------------------------------------

function mkfmt(mime: string, category?: string | string[]): FileFormat {
    return { mime, format: "x", name: "x", extension: "x", from: true, to: true, category } as unknown as FileFormat;
}

describe("getFormatCategory", () => {
    it("maps category 'vector' → 'image' via CATEGORY_MAP", () => {
        expect(getFormatCategory(mkfmt("", "vector"))).toBe("image");
    });

    it("maps category 'text' → 'document'", () => {
        expect(getFormatCategory(mkfmt("", "text"))).toBe("document");
    });

    it("maps array category ['audio'] → 'audio'", () => {
        expect(getFormatCategory(mkfmt("", ["audio"]))).toBe("audio");
    });

    it("MIME image/* → 'image'", () => {
        expect(getFormatCategory(mkfmt("image/png"))).toBe("image");
    });

    it("MIME audio/* → 'audio'", () => {
        expect(getFormatCategory(mkfmt("audio/mpeg"))).toBe("audio");
    });

    it("MIME video/* → 'video'", () => {
        expect(getFormatCategory(mkfmt("video/mp4"))).toBe("video");
    });

    it("MIME font/* → 'font'", () => {
        expect(getFormatCategory(mkfmt("font/ttf"))).toBe("font");
    });

    it("MIME text/x-* → 'code'", () => {
        expect(getFormatCategory(mkfmt("text/x-python"))).toBe("code");
    });

    it("MIME application/x-sh → 'code'", () => {
        expect(getFormatCategory(mkfmt("application/x-sh"))).toBe("code");
    });

    it("MIME application/json → 'data'", () => {
        expect(getFormatCategory(mkfmt("application/json"))).toBe("data");
    });

    it("MIME application/zip → 'archive'", () => {
        expect(getFormatCategory(mkfmt("application/zip"))).toBe("archive");
    });

    it("MIME application/pdf → 'document'", () => {
        expect(getFormatCategory(mkfmt("application/pdf"))).toBe("document");
    });

    it("unrecognised MIME → 'other'", () => {
        expect(getFormatCategory(mkfmt("application/x-custom-thing"))).toBe("other");
    });
});

// ---------------------------------------------------------------------------
// isLoadingHandlers - reactive state
// ---------------------------------------------------------------------------

describe("isLoadingHandlers", () => {
    beforeEach(() => { isLoadingHandlers.value = false; });

    it("starts as false in test environment (no main.ts initialization)", () => {
        expect(isLoadingHandlers.value).toBe(false);
    });

    it("can be set and read back", () => {
        isLoadingHandlers.value = true;
        expect(isLoadingHandlers.value).toBe(true);
        isLoadingHandlers.value = false;
        expect(isLoadingHandlers.value).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// getMaxFiles - dynamic file count limit
// ---------------------------------------------------------------------------

describe("getMaxFiles", () => {
    // test/setup.ts mocks navigator.deviceMemory = 4
    // budget = 4 * 0.5 * 1024^3 = 2 GB

    it("returns ABSOLUTE_MAX_FILES for an empty array", () => {
        expect(getMaxFiles([])).toBe(ABSOLUTE_MAX_FILES);
    });

    it("returns ABSOLUTE_MAX_FILES for zero-size files", () => {
        const files = Array.from({ length: 5 }, (_, i) => makeFile(`empty_${i}.png`, 0));
        // Override type to image
        for (const f of files) Object.defineProperty(f, "type", { value: "image/png" });
        expect(getMaxFiles(files)).toBe(ABSOLUTE_MAX_FILES);
    });

    it("caps at ABSOLUTE_MAX_FILES for tiny images", () => {
        const files = Array.from({ length: 10 }, (_, i) => {
            const f = makeFile(`img_${i}.png`, 50 * 1024); // 50 KB
            Object.defineProperty(f, "type", { value: "image/png" });
            return f;
        });
        expect(getMaxFiles(files)).toBe(ABSOLUTE_MAX_FILES);
    });

    it("returns a low limit for large videos", () => {
        const files = Array.from({ length: 10 }, (_, i) => {
            const f = makeFile(`vid_${i}.mp4`, 200 * 1024 * 1024); // 200 MB
            Object.defineProperty(f, "type", { value: "video/mp4" });
            return f;
        });
        const max = getMaxFiles(files);
        // budget 2GB / (200MB * 2) = 5
        expect(max).toBe(5);
    });

    it("returns a moderate limit for medium audio files", () => {
        const files = Array.from({ length: 10 }, (_, i) => {
            const f = makeFile(`audio_${i}.mp3`, 50 * 1024 * 1024); // 50 MB
            Object.defineProperty(f, "type", { value: "audio/mpeg" });
            return f;
        });
        const max = getMaxFiles(files);
        // budget 2GB / (50MB * 1.5) = ~27
        expect(max).toBe(27);
    });

    it("never returns less than 1", () => {
        const f = makeFile("huge.mp4", 10 * 1024 * 1024 * 1024); // 10 GB
        Object.defineProperty(f, "type", { value: "video/mp4" });
        expect(getMaxFiles([f])).toBe(1);
    });

    it("never exceeds ABSOLUTE_MAX_FILES", () => {
        const f = makeFile("tiny.txt", 1); // 1 byte
        Object.defineProperty(f, "type", { value: "text/plain" });
        expect(getMaxFiles([f])).toBe(ABSOLUTE_MAX_FILES);
    });

    it("treats documents with multiplier 1.5", () => {
        const files = Array.from({ length: 5 }, (_, i) => {
            const f = makeFile(`doc_${i}.pdf`, 100 * 1024 * 1024); // 100 MB
            Object.defineProperty(f, "type", { value: "application/pdf" });
            return f;
        });
        const max = getMaxFiles(files);
        // budget 2GB / (100MB * 1.5) = ~13
        expect(max).toBe(13);
    });
});

// ---------------------------------------------------------------------------
// Per-surface quality settings
// ---------------------------------------------------------------------------

describe("convertQuality (Converter)", () => {
    beforeEach(() => setConvertQuality("auto"));

    it("defaults to Automatic, matching the Compress surface", () => {
        expect(convertQuality.value).toBe("auto");
        expect(CONVERT_QUALITY_CHOICES[0].value).toBe("auto");
    });

    it("offers a no-compression option, since converting without shrinking is a real request", () => {
        expect(CONVERT_QUALITY_CHOICES.map(c => c.value)).toEqual(["auto", "lossless", "high", "medium", "low"]);
    });

    it("maps labels to the inverted engine presets", () => {
        // The engine's presets name the quality *target*, so "low" is the most
        // compression. Labels read the same way round, which is why this
        // mapping is worth pinning: swapping two of them would be invisible in
        // review and would quietly invert the whole control.
        const byLabel = Object.fromEntries(CONVERT_QUALITY_CHOICES.map(c => [c.label, c.value]));
        expect(byLabel["Original quality"]).toBe("lossless");
        expect(byLabel["High quality"]).toBe("high");
        expect(byLabel["Balanced"]).toBe("medium");
        expect(byLabel["Smallest file"]).toBe("low");
    });

    it("keeps one vocabulary across both surfaces", () => {
        // A user who sets "Balanced" in Convert and sees "Recommended" in
        // Compress has no way to know they are the same level.
        const convert = new Map(CONVERT_QUALITY_CHOICES.map(c => [c.value as string, c.label]));
        for (const c of COMPRESS_LEVEL_CHOICES) {
            expect(convert.get(c.value)).toBe(c.label);
        }
    });

    it("persists the choice", () => {
        setConvertQuality("lossless");
        expect(localStorage.getItem("convertQuality")).toBe("lossless");
    });
});

describe("compressLevel (Compress surface)", () => {
    beforeEach(() => setCompressLevel("medium"));

    it("offers Automatic, which reads each file instead of applying a fixed tier", () => {
        expect(COMPRESS_LEVEL_CHOICES[0].value).toBe("auto");
        expect(COMPRESS_LEVEL_CHOICES[0].label).toBe("Automatic");
    });

    it("offers three levels and no lossless", () => {
        expect(COMPRESS_LEVEL_CHOICES.map(c => c.value)).toEqual(["auto", "high", "medium", "low"]);
        expect(COMPRESS_LEVEL_CHOICES.map(c => c.value)).not.toContain("lossless");
    });

    it("persists separately from the converter setting", () => {
        setConvertQuality("lossless");
        setCompressLevel("low");
        expect(compressLevel.value).toBe("low");
        expect(convertQuality.value).toBe("lossless");
        expect(localStorage.getItem("compressLevel")).toBe("low");
    });

    it("changing one surface never moves the other", () => {
        setConvertQuality("high");
        setCompressLevel("low");
        expect(convertQuality.value).toBe("high");
        setConvertQuality("low");
        expect(compressLevel.value).toBe("low");
    });
});
