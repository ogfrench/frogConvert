import { describe, it, expect } from "vitest";
import {
    isCategoryVisible, isFormatVisible, type FormatMode,
    checkFileSizeLimits, sortFilesByName, formatDisplayName, getFormatCategory,
    isLoadingHandlers,
} from "./store.ts";
import type { FileFormat } from "../../core/FormatHandler/FormatHandler.ts";

describe("store visibility logic", () => {
    const mockFormat = (format: string, mime?: string) => ({
        format,
        name: "Mock",
        extension: format,
        mime: mime || (format === "png" || format === "webp" || format === "tiff" ? `image/${format}` :
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
            expect(isFormatVisible(mockFormat("webp"), "core")).toBe(false);
            expect(isFormatVisible(mockFormat("pdf"), "core")).toBe(true);
        });

        it("shows PLUS_FORMATS in 'plus' mode", () => {
            expect(isFormatVisible(mockFormat("png"), "plus")).toBe(true);
            expect(isFormatVisible(mockFormat("webp"), "plus")).toBe(true);
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
// isLoadingHandlers — reactive state
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
