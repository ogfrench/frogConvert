/**
 * Unit tests for pure utility functions in store.ts.
 * Run with: bun test src/components/store/store.test.ts
 */

import { describe, it, expect } from "vitest";
import { escapeHTML, shortenFileName, formatBytes, getFormatCategory, checkFileSizeLimits, formatDisplayName, DEFAULT_UPLOAD_TEXT, DEFAULT_UPLOAD_LABEL } from "./store.ts";
import type { FileFormat } from "../../core/FormatHandler/FormatHandler.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFormat(overrides: Partial<FileFormat> = {}): FileFormat {
    return {
        name: "Test Format",
        format: "test",
        extension: "test",
        mime: "",
        internal: "test",
        from: true,
        to: true,
        lossless: false,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// escapeHTML
// ---------------------------------------------------------------------------

describe("escapeHTML", () => {
    it("escapes ampersands", () => {
        expect(escapeHTML("a & b")).toBe("a &amp; b");
    });

    it("escapes less-than and greater-than", () => {
        expect(escapeHTML("<script>")).toBe("&lt;script&gt;");
    });

    it("escapes double quotes", () => {
        expect(escapeHTML('"hello"')).toBe("&quot;hello&quot;");
    });

    it("escapes single quotes", () => {
        expect(escapeHTML("it's")).toBe("it&#39;s");
    });

    it("leaves plain strings unchanged", () => {
        expect(escapeHTML("hello world")).toBe("hello world");
    });

    it("handles the empty string", () => {
        expect(escapeHTML("")).toBe("");
    });
});

// ---------------------------------------------------------------------------
// shortenFileName
// ---------------------------------------------------------------------------

describe("shortenFileName", () => {
    it("returns short names unchanged", () => {
        expect(shortenFileName("hello.txt", 24)).toBe("hello.txt");
    });

    it("returns the name unchanged when length equals maxLength", () => {
        const name = "a".repeat(24);
        expect(shortenFileName(name, 24)).toBe(name);
    });

    it("truncates long names with ellipsis in the middle", () => {
        const name = "abcdefghijklmnopqrstuvwxyz.txt"; // 30 chars
        const result = shortenFileName(name, 10);
        expect(result.length).toBe(10);
        expect(result).toContain("...");
    });

    it("uses default maxLength of 24 when not specified", () => {
        const name = "a".repeat(30);
        const result = shortenFileName(name);
        expect(result.length).toBe(24);
    });
});

// ---------------------------------------------------------------------------
// formatBytes
// ---------------------------------------------------------------------------

describe("formatBytes", () => {
    it("formats bytes below 1 MB as KB", () => {
        expect(formatBytes(512 * 1024)).toBe("~512 KB");
    });

    it("formats bytes in the MB range", () => {
        expect(formatBytes(10 * 1024 * 1024)).toBe("~10 MB");
    });

    it("formats bytes in the GB range", () => {
        expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe("~2.0 GB");
    });
});

// ---------------------------------------------------------------------------
// getFormatCategory
// ---------------------------------------------------------------------------

describe("getFormatCategory", () => {
    it("uses category field when present", () => {
        expect(getFormatCategory(makeFormat({ category: "video" }))).toBe("video");
    });

    it("falls back to MIME prefix for images", () => {
        expect(getFormatCategory(makeFormat({ mime: "image/png" }))).toBe("image");
    });

    it("falls back to MIME prefix for audio", () => {
        expect(getFormatCategory(makeFormat({ mime: "audio/mpeg" }))).toBe("audio");
    });

    it("falls back to MIME prefix for video", () => {
        expect(getFormatCategory(makeFormat({ mime: "video/mp4" }))).toBe("video");
    });

    it("maps application/pdf to document", () => {
        expect(getFormatCategory(makeFormat({ mime: "application/pdf" }))).toBe("document");
    });

    it("maps application/json to data", () => {
        expect(getFormatCategory(makeFormat({ mime: "application/json" }))).toBe("data");
    });

    it("maps zip MIME to archive", () => {
        expect(getFormatCategory(makeFormat({ mime: "application/zip" }))).toBe("archive");
    });

    it("returns 'other' for unknown MIME types", () => {
        expect(getFormatCategory(makeFormat({ mime: "application/x-unknown-thing" }))).toBe("other");
    });
});

// ---------------------------------------------------------------------------
// Copy constants - regression guards
// ---------------------------------------------------------------------------

describe("copy constants", () => {
    it("DEFAULT_UPLOAD_TEXT matches the HTML drop zone text", () => {
        expect(DEFAULT_UPLOAD_TEXT).toBe("Drop your files here");
    });

    it("DEFAULT_UPLOAD_LABEL is 'Your file'", () => {
        expect(DEFAULT_UPLOAD_LABEL).toBe("Your file");
    });
});

// ---------------------------------------------------------------------------
// checkFileSizeLimits
// ---------------------------------------------------------------------------

describe("checkFileSizeLimits", () => {
    function makeFile(sizeBytes: number): File {
        return { size: sizeBytes } as File;
    }

    it("returns ok for files well below the threshold", () => {
        const files = [makeFile(100 * 1024 * 1024)]; // 100 MB
        expect(checkFileSizeLimits(files).level).toBe("ok");
    });

    it("returns warning when total size exceeds 3.6 GB", () => {
        const GB = 1024 * 1024 * 1024;
        const files = [makeFile(3.7 * GB)];
        expect(checkFileSizeLimits(files).level).toBe("warning");
    });

    it("accumulates sizes across multiple files", () => {
        const GB = 1024 * 1024 * 1024;
        const files = [makeFile(2 * GB), makeFile(2 * GB)]; // 4 GB total
        expect(checkFileSizeLimits(files).level).toBe("warning");
    });

    it("returns the correct totalSize", () => {
        const files = [{ size: 500 } as File, { size: 300 } as File];
        expect(checkFileSizeLimits(files).totalSize).toBe(800);
    });
});

// ---------------------------------------------------------------------------
// formatDisplayName
// ---------------------------------------------------------------------------

describe("formatDisplayName", () => {
    it("returns FORMAT - Name for a normal format", () => {
        const fmt = makeFormat({ format: "mp3", name: "MPEG Audio" });
        expect(formatDisplayName(fmt)).toBe("MP3 - MPEG Audio");
    });

    it("strips parenthetical notes from the name", () => {
        const fmt = makeFormat({ format: "ogg", name: "Ogg Vorbis (compressed)" });
        const result = formatDisplayName(fmt);
        expect(result).toContain("OGG");
        expect(result).not.toContain("(compressed)");
    });

    it("upper-cases the format identifier", () => {
        const fmt = makeFormat({ format: "webp", name: "WebP Image" });
        expect(formatDisplayName(fmt).startsWith("WEBP")).toBe(true);
    });

    it("handles a name with no parenthetical notes", () => {
        const fmt = makeFormat({ format: "bmp", name: "Bitmap Image" });
        expect(formatDisplayName(fmt)).toBe("BMP - Bitmap Image");
    });

    it("handles a name with multiple parenthetical groups", () => {
        const fmt = makeFormat({ format: "wav", name: "Waveform (PCM) Audio (uncompressed)" });
        const result = formatDisplayName(fmt);
        expect(result).not.toContain("(");
        expect(result).toContain("Waveform");
        expect(result).toContain("Audio");
    });
});

// ---------------------------------------------------------------------------
// getFormatCategory - additional edge cases
// ---------------------------------------------------------------------------

describe("getFormatCategory edge cases", () => {
    it("maps font/ttf to font", () => {
        expect(getFormatCategory(makeFormat({ mime: "font/ttf" }))).toBe("font");
    });

    it("maps text/x-python to code", () => {
        expect(getFormatCategory(makeFormat({ mime: "text/x-python" }))).toBe("code");
    });

    it("maps application/x-sh to code", () => {
        expect(getFormatCategory(makeFormat({ mime: "application/x-sh" }))).toBe("code");
    });

    it("maps application/vnd.ms-excel to document", () => {
        expect(getFormatCategory(makeFormat({ mime: "application/vnd.ms-excel" }))).toBe("document");
    });

    it("maps MIME with 'compressed' to archive", () => {
        expect(getFormatCategory(makeFormat({ mime: "application/x-lzh-compressed" }))).toBe("archive");
    });

    it("handles category as an array", () => {
        expect(getFormatCategory(makeFormat({ category: ["image", "vector"] }))).toBe("image");
    });

    it("maps application/xml to data", () => {
        expect(getFormatCategory(makeFormat({ mime: "application/xml" }))).toBe("data");
    });

    it("maps application/yaml to data", () => {
        expect(getFormatCategory(makeFormat({ mime: "application/yaml" }))).toBe("data");
    });
});

// ---------------------------------------------------------------------------
// checkFileSizeLimits - edge cases
// ---------------------------------------------------------------------------

describe("checkFileSizeLimits edge cases", () => {
    it("returns ok with totalSize 0 for an empty array", () => {
        const result = checkFileSizeLimits([]);
        expect(result.level).toBe("ok");
        expect(result.totalSize).toBe(0);
    });

    it("returns ok at exactly the threshold", () => {
        const threshold = 3.6 * 1024 * 1024 * 1024;
        const result = checkFileSizeLimits([{ size: threshold } as File]);
        expect(result.level).toBe("ok");
    });

    it("returns warning at one byte above the threshold", () => {
        const threshold = 3.6 * 1024 * 1024 * 1024;
        const result = checkFileSizeLimits([{ size: threshold + 1 } as File]);
        expect(result.level).toBe("warning");
    });
});

// ---------------------------------------------------------------------------
// shortenFileName - edge cases
// ---------------------------------------------------------------------------

describe("shortenFileName edge cases", () => {
    it("handles a very small maxLength gracefully", () => {
        const result = shortenFileName("abcdefg", 5);
        expect(result.length).toBe(5);
        expect(result).toContain("...");
    });

    it("handles name one char over maxLength", () => {
        const result = shortenFileName("abcde", 4);
        expect(result.length).toBe(4);
        expect(result).toContain("...");
    });
});
