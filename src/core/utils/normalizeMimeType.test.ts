/**
 * Unit tests for normalizeMimeType - the MIME alias normaliser.
 * Run with: bun test src/core/utils/normalizeMimeType.test.ts
 */

import { describe, it, expect } from "vitest";
import normalizeMimeType from "./normalizeMimeType.ts";

describe("normalizeMimeType", () => {
    // Audio aliases
    it("normalises audio/x-wav → audio/wav", () => {
        expect(normalizeMimeType("audio/x-wav")).toBe("audio/wav");
    });

    it("normalises audio/vnd.wave → audio/wav", () => {
        expect(normalizeMimeType("audio/vnd.wave")).toBe("audio/wav");
    });

    it("normalises audio/x-flac → audio/flac", () => {
        expect(normalizeMimeType("audio/x-flac")).toBe("audio/flac");
    });

    it("normalises audio/x-quicktime → video/quicktime", () => {
        expect(normalizeMimeType("audio/x-quicktime")).toBe("video/quicktime");
    });

    // Image aliases
    it("normalises image/x-icon → image/vnd.microsoft.icon", () => {
        expect(normalizeMimeType("image/x-icon")).toBe("image/vnd.microsoft.icon");
    });

    it("normalises image/x-icns → image/icns", () => {
        expect(normalizeMimeType("image/x-icns")).toBe("image/icns");
    });

    it("normalises image/qoi → image/x-qoi", () => {
        expect(normalizeMimeType("image/qoi")).toBe("image/x-qoi");
    });

    it("normalises image/aseprite → image/x-aseprite", () => {
        expect(normalizeMimeType("image/aseprite")).toBe("image/x-aseprite");
    });

    it("normalises application/x-aseprite → image/x-aseprite", () => {
        expect(normalizeMimeType("application/x-aseprite")).toBe("image/x-aseprite");
    });

    // Archive aliases
    it("normalises application/x-gzip → application/gzip", () => {
        expect(normalizeMimeType("application/x-gzip")).toBe("application/gzip");
    });

    it("normalises application/x-lharc → application/x-lzh-compressed", () => {
        expect(normalizeMimeType("application/x-lharc")).toBe("application/x-lzh-compressed");
    });

    it("normalises application/lha → application/x-lzh-compressed", () => {
        expect(normalizeMimeType("application/lha")).toBe("application/x-lzh-compressed");
    });

    it("normalises application/x-lha → application/x-lzh-compressed", () => {
        expect(normalizeMimeType("application/x-lha")).toBe("application/x-lzh-compressed");
    });

    it("normalises application/x-lzh → application/x-lzh-compressed", () => {
        expect(normalizeMimeType("application/x-lzh")).toBe("application/x-lzh-compressed");
    });

    // Font aliases
    it("normalises application/font-sfnt → font/ttf", () => {
        expect(normalizeMimeType("application/font-sfnt")).toBe("font/ttf");
    });

    it("normalises application/x-font-ttf → font/ttf", () => {
        expect(normalizeMimeType("application/x-font-ttf")).toBe("font/ttf");
    });

    it("normalises application/x-font-opentype → font/otf", () => {
        expect(normalizeMimeType("application/x-font-opentype")).toBe("font/otf");
    });

    it("normalises application/font-woff → font/woff", () => {
        expect(normalizeMimeType("application/font-woff")).toBe("font/woff");
    });

    it("normalises application/font-woff2 → font/woff2", () => {
        expect(normalizeMimeType("application/font-woff2")).toBe("font/woff2");
    });

    // Video aliases
    it("normalises video/bink → video/vnd.radgamettools.bink", () => {
        expect(normalizeMimeType("video/bink")).toBe("video/vnd.radgamettools.bink");
    });

    // Music XML
    it("normalises application/musicxml → application/vnd.recordare.musicxml+xml", () => {
        expect(normalizeMimeType("application/musicxml")).toBe("application/vnd.recordare.musicxml+xml");
    });

    it("normalises application/musicxml+xml → application/vnd.recordare.musicxml+xml", () => {
        expect(normalizeMimeType("application/musicxml+xml")).toBe("application/vnd.recordare.musicxml+xml");
    });

    // Pass-through
    it("returns already-canonical MIME types unchanged", () => {
        expect(normalizeMimeType("image/png")).toBe("image/png");
        expect(normalizeMimeType("video/mp4")).toBe("video/mp4");
        expect(normalizeMimeType("audio/mpeg")).toBe("audio/mpeg");
        expect(normalizeMimeType("application/pdf")).toBe("application/pdf");
    });

    it("returns unrecognised MIME types unchanged", () => {
        expect(normalizeMimeType("application/x-custom-thing")).toBe("application/x-custom-thing");
    });

    it("handles an empty string", () => {
        expect(normalizeMimeType("")).toBe("");
    });

    // Additional alias coverage
    it("normalises video/binka \u2192 audio/vnd.radgamettools.bink", () => {
        expect(normalizeMimeType("video/binka")).toBe("audio/vnd.radgamettools.bink");
    });

    it("normalises application/x-mtga \u2192 application/vnd.sqlite3", () => {
        expect(normalizeMimeType("application/x-mtga")).toBe("application/vnd.sqlite3");
    });

    it("normalises text/mathml \u2192 application/mathml+xml", () => {
        expect(normalizeMimeType("text/mathml")).toBe("application/mathml+xml");
    });

    it("normalises application/x-font-woff \u2192 font/woff", () => {
        expect(normalizeMimeType("application/x-font-woff")).toBe("font/woff");
    });

    it("normalises application/x-font-woff2 \u2192 font/woff2", () => {
        expect(normalizeMimeType("application/x-font-woff2")).toBe("font/woff2");
    });

    it("normalises audio/x-flo \u2192 audio/flo", () => {
        expect(normalizeMimeType("audio/x-flo")).toBe("audio/flo");
    });

    it("normalises application/x-flo \u2192 audio/flo", () => {
        expect(normalizeMimeType("application/x-flo")).toBe("audio/flo");
    });

    it("normalises image/vtf \u2192 image/x-vtf", () => {
        expect(normalizeMimeType("image/vtf")).toBe("image/x-vtf");
    });
});
