/**
 * Unit tests for ConversionActions.ts - findMatchingFormat and download helpers.
 * Run with: bun test src/components/ConversionModal/ConversionActions.test.ts
 */

import { describe, it, expect, beforeEach } from "vitest";
import { findMatchingFormat, setLastConvertedFiles } from "./ConversionActions.ts";
import type { FileFormat, FormatHandler } from "../../core/FormatHandler/FormatHandler.ts";

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
