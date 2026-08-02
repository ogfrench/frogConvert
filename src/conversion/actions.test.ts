/**
 * Unit tests for actions.ts - findMatchingFormat and download helpers.
 * Run with: bun test src/conversion/actions.test.ts
 */

import { describe, it, expect, beforeEach } from "vitest";
import { findMatchingFormat, setLastConvertedFiles, getIsConverting, conversionResultText } from "./actions.ts";
import type { FileFormat, FormatHandler, QualityPreset } from "../core/FormatHandler/FormatHandler.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFormat(overrides: Partial<FileFormat> = {}): FileFormat {
    return {
        name: "Test",
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

const dummyHandler: FormatHandler = {
    name: "dummy",
    ready: true,
    init: async () => { },
    doConvert: async (f) => f,
};

function makeFile(name: string, type: string = ""): File {
    return { name, type } as File;
}

// ---------------------------------------------------------------------------
// findMatchingFormat
// ---------------------------------------------------------------------------

describe("findMatchingFormat", () => {
    const allOptions = [
        { format: makeFormat({ mime: "image/png", format: "png", extension: "png" }), handler: dummyHandler },
        { format: makeFormat({ mime: "image/jpeg", format: "jpeg", extension: "jpg" }), handler: dummyHandler },
        { format: makeFormat({ mime: "image/jpeg", format: "jpeg", extension: "jpeg" }), handler: dummyHandler },
        { format: makeFormat({ mime: "audio/mpeg", format: "mp3", extension: "mp3" }), handler: dummyHandler },
        { format: makeFormat({ mime: "video/mp4", format: "mp4", extension: "mp4", from: false }), handler: dummyHandler },
    ];

    it("matches by exact MIME type", () => {
        const files = [makeFile("photo.png", "image/png")];
        expect(findMatchingFormat(files, allOptions)).toBe(0);
    });

    it("tie-breaks ambiguous MIME by extension", () => {
        const files = [makeFile("photo.jpeg", "image/jpeg")];
        const idx = findMatchingFormat(files, allOptions);
        // Should prefer the option with extension "jpeg" (index 2) over "jpg" (index 1)
        expect(idx).toBe(2);
    });

    it("falls back to first MIME match when extension doesn't match any", () => {
        const files = [makeFile("photo.jpe", "image/jpeg")];
        const idx = findMatchingFormat(files, allOptions);
        // Neither "jpg" nor "jpeg" matches "jpe"; falls back to first MIME match
        expect(idx).toBe(1);
    });

    it("falls back to extension when MIME yields no match", () => {
        const files = [makeFile("track.mp3", "audio/unknown")];
        const idx = findMatchingFormat(files, allOptions);
        // MIME doesn't match, but extension "mp3" does
        expect(idx).toBe(3);
    });

    it("returns -1 when nothing matches", () => {
        const files = [makeFile("data.xyz", "application/x-whatever")];
        expect(findMatchingFormat(files, allOptions)).toBe(-1);
    });

    it("skips formats where from is false", () => {
        // mp4 option has from: false, so it should not match
        const files = [makeFile("clip.mp4", "video/mp4")];
        expect(findMatchingFormat(files, allOptions)).toBe(-1);
    });

    it("matches against the first file by MIME", () => {
        const files = [makeFile("a.png", "image/png"), makeFile("b.png", "image/png")];
        expect(findMatchingFormat(files, allOptions)).toBe(0);
    });

    // An explicit extension claim beats a MIME-only guess. The browser's MIME
    // comes from an OS table and is regularly absent or wrong; an extension a
    // format declares is a deliberate statement about what it handles.
    describe("extension vs MIME precedence", () => {
        const withAi = [
            { format: makeFormat({ mime: "application/pdf", format: "pdf", extension: "pdf" }), handler: dummyHandler },
            { format: makeFormat({ mime: "application/illustrator", format: "ai", extension: "ai" }), handler: dummyHandler },
        ];

        it("routes a .ai reported as application/pdf to the AI entry", () => {
            // A modern .ai *is* a PDF internally, so this MIME is not a browser
            // bug - it is accurate and still the wrong destination. Sending it
            // to the plain PDF handler converts it fine and silently discards
            // the Illustrator payload, which is the exact trap #19 called out.
            expect(findMatchingFormat([makeFile("art.ai", "application/pdf")], withAi)).toBe(1);
        });

        it("still routes a real .pdf to the PDF entry", () => {
            expect(findMatchingFormat([makeFile("doc.pdf", "application/pdf")], withAi)).toBe(0);
        });

        it("falls through to MIME when the extension matches nothing", () => {
            expect(findMatchingFormat([makeFile("art.indd", "application/pdf")], withAi)).toBe(0);
        });
    });
});

// ---------------------------------------------------------------------------
// setLastConvertedFiles (round-trip smoke test)
// ---------------------------------------------------------------------------

describe("setLastConvertedFiles", () => {
    it("does not throw when called with an empty array", () => {
        expect(() => setLastConvertedFiles([])).not.toThrow();
    });

    it("does not throw when called with files", () => {
        expect(() => setLastConvertedFiles([
            { name: "out.png", bytes: new Uint8Array([1, 2, 3]) },
        ])).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// getIsConverting
// ---------------------------------------------------------------------------

describe("getIsConverting", () => {
    it("returns false initially (no conversion running in test environment)", () => {
        expect(getIsConverting()).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Success-modal copy
// ---------------------------------------------------------------------------

describe("conversionResultText", () => {
    const base = {
        fileCount: 1,
        outCount: 1,
        firstInputName: "photo.png",
        format: "JPG",
        verb: "converted",
        applied: null as QualityPreset | null,
        requested: "lossless",
    };

    // Measured through the real UI: a 1,207,043-byte JPEG converted to ZIP
    // comes back at 1,207,169 bytes - 126 bytes *larger* - at every one of the
    // four levels, because `jszip` never reads `--quality`. The modal used to
    // announce "Compressed at Smallest file" over the top of that.
    it("never claims a compression the engine could not have performed", () => {
        for (const applied of ["low", "medium", "high"] as QualityPreset[]) {
            const text = conversionResultText({
                ...base, format: "ZIP", applied: null, requested: applied, qualityApplies: false,
            });
            expect(text).not.toMatch(/Compressed at/);
        }
    });

    it("explains that the level does not apply, instead of staying silent", () => {
        expect(conversionResultText({
            ...base, format: "ZIP", applied: null, requested: "low", qualityApplies: false,
        })).toBe("<b>photo.png</b> has been converted to <b>ZIP</b> and is ready to download."
            + " Your compression level doesn't apply to <b>ZIP</b>, so the converted file was not compressed and left as-is.");
    });

    it("says nothing extra when the user never asked for a level", () => {
        // Original quality is the Converter's default. Explaining that a level
        // did not apply, to someone who chose no level, is noise.
        expect(conversionResultText({
            ...base, format: "ZIP", applied: null, requested: "lossless", qualityApplies: false,
        })).toBe("<b>photo.png</b> has been converted to <b>ZIP</b> and is ready to download.");
    });

    it("still reports a level the engine really did apply", () => {
        expect(conversionResultText({
            ...base, format: "WEBP", applied: "low", requested: "low", qualityApplies: true,
        })).toMatch(/Compressed at <b>Smallest file<\/b>\./);
    });

    it("names the file for a single conversion", () => {
        expect(conversionResultText(base))
            .toBe("<b>photo.png</b> has been converted to <b>JPG</b> and is ready to download.");
    });

    it("counts the files for a batch", () => {
        expect(conversionResultText({ ...base, fileCount: 3, outCount: 3 }))
            .toBe("3 files converted to <b>JPG</b> and zipped up, ready to download.");
    });

    it("does not call one file three files when a format is one-per-page", () => {
        // PDF -> EPS is required by the format to emit a file per page. The
        // old copy reported the output count as the input one and announced
        // "3 files converted" to somebody who converted a single document.
        const text = conversionResultText({ ...base, fileCount: 1, outCount: 3, firstInputName: "report.pdf", format: "EPS" });
        expect(text).toBe("<b>report.pdf</b> became <b>3 EPS files</b>, one per page, zipped up and ready to download.");
        expect(text).not.toMatch(/3 files converted/);
    });

    it("counts both sides when a batch fans out", () => {
        expect(conversionResultText({ ...base, fileCount: 2, outCount: 6, format: "EPS" }))
            .toBe("2 files became <b>6 EPS files</b>, one per page, zipped up and ready to download.");
    });

    it("says nothing about compression at the default level", () => {
        // Original quality is the default, and a clause on every conversion
        // saying nothing happened is noise.
        expect(conversionResultText({ ...base, applied: "lossless", requested: "lossless" }))
            .not.toMatch(/Compress/i);
    });

    it("says nothing when no route ran", () => {
        expect(conversionResultText({ ...base, applied: null })).not.toMatch(/Compress/i);
    });

    it("names the level the user chose", () => {
        expect(conversionResultText({ ...base, applied: "medium", requested: "medium" }))
            .toMatch(/Compressed at <b>Balanced<\/b>\.$/);
    });

    it("names Automatic as Automatic, and the tier it picked", () => {
        // "Compressed at Smallest file" alone would look like a setting the
        // user never chose.
        expect(conversionResultText({ ...base, applied: "low", requested: "auto" }))
            .toMatch(/Compressed at <b>Smallest file<\/b> \(Automatic\)\.$/);
    });

    it("reports the level, not a saving it cannot attribute", () => {
        // A PNG -> JPG is smaller because it is a JPEG. Crediting that to the
        // compression dial would be a number the app cannot stand behind.
        const text = conversionResultText({ ...base, applied: "high", requested: "high" });
        expect(text).not.toMatch(/\d+%|smaller|saved/i);
    });

    it("escapes names, since the caller assigns this with innerHTML", () => {
        const text = conversionResultText({ ...base, firstInputName: '<img src=x onerror=alert(1)>.png' });
        expect(text).not.toMatch(/<img/);
        expect(text).toMatch(/&lt;img/);
    });
});

describe("conversionResultText - nothing has downloaded yet", () => {
    it("does not claim a download is under way", () => {
        // No surface hands a file over unasked any more, so copy that says it
        // is "downloading now" describes something that has not happened.
        for (const opts of [
            { fileCount: 1, outCount: 1 },
            { fileCount: 3, outCount: 3 },
            { fileCount: 1, outCount: 4 },
        ]) {
            const text = conversionResultText({
                firstInputName: "a.png", format: "JPG", verb: "converted",
                applied: null, requested: "lossless", ...opts,
            });
            expect(text).not.toMatch(/downloading now|is downloading/i);
            expect(text).toMatch(/ready to download/);
        }
    });
});
