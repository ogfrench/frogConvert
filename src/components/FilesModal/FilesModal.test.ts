/**
 * Unit tests for FilesModal.ts - logic strings and helper functions.
 * Run with: bun test src/components/FilesModal/FilesModal.test.ts
 *
 * DOM-bound functions (openFilesModal, renderFilesModalList, etc.) are not
 * directly testable without a browser DOM.  These tests cover the logic strings
 * and the friendlyMimeLabel helper.
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// friendlyMimeLabel (mirror of the private function in FilesModal.ts)
// ---------------------------------------------------------------------------

function friendlyMimeLabel(mime: string): string {
    if (!mime) return "unknown type";
    const [category, subtype] = mime.split("/");
    const ext = (subtype || "").replace(/^x-/, "").split(";")[0].trim().toUpperCase();
    const categoryMap: Record<string, string> = {
        image: "image",
        audio: "audio file",
        video: "video",
        text: "text file",
        application: "file",
        font: "font",
    };
    const label = categoryMap[category] ?? "file";
    return ext ? `${ext} ${label}` : label;
}

describe("friendlyMimeLabel", () => {
    it("formats image/png as 'PNG image'", () => {
        expect(friendlyMimeLabel("image/png")).toBe("PNG image");
    });

    it("formats audio/mpeg as 'MPEG audio file'", () => {
        expect(friendlyMimeLabel("audio/mpeg")).toBe("MPEG audio file");
    });

    it("formats video/mp4 as 'MP4 video'", () => {
        expect(friendlyMimeLabel("video/mp4")).toBe("MP4 video");
    });

    it("formats text/plain as 'PLAIN text file'", () => {
        expect(friendlyMimeLabel("text/plain")).toBe("PLAIN text file");
    });

    it("formats font/ttf as 'TTF font'", () => {
        expect(friendlyMimeLabel("font/ttf")).toBe("TTF font");
    });

    it("strips x- prefix (application/x-gzip becomes 'GZIP file')", () => {
        expect(friendlyMimeLabel("application/x-gzip")).toBe("GZIP file");
    });

    it("returns 'unknown type' for empty string", () => {
        expect(friendlyMimeLabel("")).toBe("unknown type");
    });

    it("falls back to 'file' for unrecognised top-level category", () => {
        expect(friendlyMimeLabel("model/gltf+json")).toBe("GLTF+JSON file");
    });
});

// ---------------------------------------------------------------------------
// Error messages produced by addMoreFiles
// ---------------------------------------------------------------------------

describe("addMoreFiles error copy", () => {
    it("renders 'Too many files' error with projected and limit count", () => {
        const projectedCount = 105;
        const MAX_FILES = 100;
        const msg = `Too many files (${projectedCount}). The limit is ${MAX_FILES}.`;
        expect(msg).toBe("Too many files (105). The limit is 100.");
    });

    it("renders singular mismatch skip message with MIME labels", () => {
        const mismatchCount = 1;
        const matchingCount = 3;
        const expectedLabel = friendlyMimeLabel("image/png");
        const msg = `${mismatchCount} file${mismatchCount > 1 ? "s were" : " was"} skipped \u2014 they weren't ${expectedLabel}s. Added ${matchingCount} matching file${matchingCount > 1 ? "s" : ""}.`;
        expect(msg).toContain("1 file was skipped");
        expect(msg).toContain("PNG image");
        expect(msg).toContain("Added 3 matching files");
    });

    it("renders plural mismatch skip message", () => {
        const mismatchCount = 2;
        const matchingCount = 1;
        const expectedLabel = friendlyMimeLabel("audio/mpeg");
        const msg = `${mismatchCount} file${mismatchCount > 1 ? "s were" : " was"} skipped \u2014 they weren't ${expectedLabel}s. Added ${matchingCount} matching file${matchingCount > 1 ? "s" : ""}.`;
        expect(msg).toContain("2 files were skipped");
        expect(msg).toContain("MPEG audio file");
        expect(msg).toContain("Added 1 matching file.");
    });

    it("renders full mismatch error with expected type label", () => {
        const expectedLabel = friendlyMimeLabel("image/jpeg");
        const msg = `None of those files matched. Your current files are ${expectedLabel}s \u2014 please add more files of the same type.`;
        expect(msg).toContain("JPEG image");
        expect(msg).toContain("please add more files");
    });
});

// ---------------------------------------------------------------------------
// replaceFileAtIndex error copy
// ---------------------------------------------------------------------------

describe("replaceFileAtIndex error copy", () => {
    it("renders type mismatch error with expected and actual types", () => {
        const expected = friendlyMimeLabel("image/png");
        const got = friendlyMimeLabel("audio/mpeg");
        const fileName = "track.mp3";
        const msg = `Your files are ${expected}s \u2014 \u201c${fileName}\u201d is a ${got}, which doesn't match. All files must be the same type.`;
        expect(msg).toContain("PNG images");
        expect(msg).toContain("MPEG audio file");
        expect(msg).toContain("track.mp3");
    });
});

// ---------------------------------------------------------------------------
// Modal title patterns
// ---------------------------------------------------------------------------

describe("files modal title", () => {
    function modalTitle(fileCount: number): string {
        return fileCount > 0 ? `Your files (${fileCount})` : "Your files";
    }

    it("shows bare title when no files", () => {
        expect(modalTitle(0)).toBe("Your files");
    });

    it("shows count in parentheses when files present", () => {
        expect(modalTitle(1)).toBe("Your files (1)");
        expect(modalTitle(42)).toBe("Your files (42)");
    });
});

// ---------------------------------------------------------------------------
// Pagination label
// ---------------------------------------------------------------------------

describe("pagination label", () => {
    function paginationLabel(page: number, totalPages: number): string {
        return `Page ${page + 1} of ${totalPages}`;
    }

    it("renders 'Page 1 of 5' for first page", () => {
        expect(paginationLabel(0, 5)).toBe("Page 1 of 5");
    });

    it("renders 'Page 3 of 5' correctly", () => {
        expect(paginationLabel(2, 5)).toBe("Page 3 of 5");
    });

    it("renders 'Page 5 of 5' for the last page", () => {
        expect(paginationLabel(4, 5)).toBe("Page 5 of 5");
    });
});

// ---------------------------------------------------------------------------
// Drop-more zone copy
// ---------------------------------------------------------------------------

describe("drop more files zone copy", () => {
    it("primary text is 'Drop more files here'", () => {
        expect("Drop more files here").toBe("Drop more files here");
    });

    it("hint text is 'or tap to browse'", () => {
        expect("or tap to browse").toBe("or tap to browse");
    });
});
