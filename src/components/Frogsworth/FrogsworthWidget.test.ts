/**
 * Unit tests for FrogsworthWidget.ts - pick() quip selection logic.
 * Run with: bun run test src/components/Frogsworth/FrogsworthWidget.test.ts
 *
 * These tests verify the quip selection logic without needing a DOM.
 */

import { describe, it, expect } from "vitest";
import { pick } from "./FrogsworthWidget.ts";

const VALID_FACES = new Set(["idle", "thinking", "happy", "excited", "smug", "hungry"]);

describe("pick() - null/null -> idle quips", () => {
    it("returns a string text when both from and to are null", () => {
        const result = pick(null, null);
        expect(typeof result.text).toBe("string");
        expect(result.text.length).toBeGreaterThan(0);
    });

    it("returns a valid face when both are null", () => {
        const result = pick(null, null);
        expect(VALID_FACES.has(result.face)).toBe(true);
    });
});

describe("pick() - known pair -> PAIR_QUIPS", () => {
    it("matches pdf→docx and returns a pair quip", () => {
        // Run multiple times to get past randomness - at least one call must hit PAIR_QUIPS
        const texts = new Set<string>();
        for (let i = 0; i < 20; i++) texts.add(pick("pdf", "docx").text);
        // PAIR_QUIPS["pdf→docx"] contains "attempting to undo what adobe hath wrought" and "good luck. lower your expectations first"
        const hasPairQuip = [...texts].some(t =>
            t.includes("attempting to undo what adobe hath wrought") ||
            t.includes("good luck. lower your expectations first")
        );
        expect(hasPairQuip).toBe(true);
    });

    it("docx→pdf is a direct key with its own quips", () => {
        const texts = new Set<string>();
        for (let i = 0; i < 20; i++) texts.add(pick("docx", "pdf").text);
        // PAIR_QUIPS["docx→pdf"] has "locking it down forever, very professional" and "committing to permanence"
        const hasPairQuip = [...texts].some(t =>
            t.includes("locking it down forever") ||
            t.includes("committing to permanence")
        );
        expect(hasPairQuip).toBe(true);
    });

    it("uses reverse lookup when only the flipped key exists", () => {
        // "jpeg→png" exists in PAIR_QUIPS, but "png→jpeg" does not.
        // pick("png", "jpeg") should fall back to PAIR_QUIPS["jpeg→png"].
        const texts = new Set<string>();
        for (let i = 0; i < 20; i++) texts.add(pick("png", "jpeg").text);
        const hasPairQuip = [...texts].some(t =>
            t.includes("losslessly preserving a lossy mistake")
        );
        expect(hasPairQuip).toBe(true);
    });

    it("matches png→jpg pair quip", () => {
        const texts = new Set<string>();
        for (let i = 0; i < 20; i++) texts.add(pick("png", "jpg").text);
        const hasPairQuip = [...texts].some(t =>
            t.includes("some pixels will not survive this") ||
            t.includes("trading quality for social acceptance")
        );
        expect(hasPairQuip).toBe(true);
    });

    it("matches mp4→gif pair quip", () => {
        const texts = new Set<string>();
        for (let i = 0; i < 20; i++) texts.add(pick("mp4", "gif").text);
        const hasPairQuip = [...texts].some(t =>
            t.includes("cinema") || t.includes("meme") || t.includes("dignity")
        );
        expect(hasPairQuip).toBe(true);
    });
});

describe("pick() - single known format -> FORMAT_QUIPS", () => {
    it("picks from FORMAT_QUIPS[pdf] when only from is 'pdf'", () => {
        const texts = new Set<string>();
        for (let i = 0; i < 30; i++) texts.add(pick("pdf", null).text);
        const hasFormatQuip = [...texts].some(t =>
            t.includes("adobe") || t.includes("padlock") || t.includes("trap") || t.includes("locked")
        );
        expect(hasFormatQuip).toBe(true);
    });

    it("picks from FORMAT_QUIPS[mp3] when only to is 'mp3'", () => {
        const texts = new Set<string>();
        for (let i = 0; i < 30; i++) texts.add(pick(null, "mp3").text);
        const hasFormatQuip = [...texts].some(t =>
            t.includes("128kbps") || t.includes("compressed") || t.includes("psychoacoustic")
        );
        expect(hasFormatQuip).toBe(true);
    });

    it("picks from FORMAT_QUIPS[png] when only from is 'png'", () => {
        const texts = new Set<string>();
        for (let i = 0; i < 30; i++) texts.add(pick("png", null).text);
        const hasFormatQuip = [...texts].some(t =>
            t.includes("lossless") || t.includes("grudge") || t.includes("transparent") || t.includes("pixel")
        );
        expect(hasFormatQuip).toBe(true);
    });

    it("case-insensitive: 'PDF' matches FORMAT_QUIPS['pdf']", () => {
        const texts = new Set<string>();
        for (let i = 0; i < 30; i++) texts.add(pick("PDF", null).text);
        const hasFormatQuip = [...texts].some(t =>
            t.includes("adobe") || t.includes("padlock") || t.includes("trap")
        );
        expect(hasFormatQuip).toBe(true);
    });
});

describe("pick() - unknown formats -> GENERIC_QUIPS fallback", () => {
    it("falls back to GENERIC_QUIPS when both formats are unknown", () => {
        const texts = new Set<string>();
        for (let i = 0; i < 30; i++) texts.add(pick("xyz123", "abc456").text);
        const hasGenericQuip = [...texts].some(t =>
            t.includes("bold format choice") ||
            t.includes("every file was a different format once") ||
            t.includes("file in, different file out") ||
            t.includes("frog") ||
            t.includes("data wants to be free") ||
            t.includes("interesting. proceed.") ||
            t.includes("ribbit")
        );
        expect(hasGenericQuip).toBe(true);
    });

    it("falls back to GENERIC_QUIPS when one format is unknown and no FORMAT_QUIPS entry", () => {
        // "xyz" is not in FORMAT_QUIPS, "json" IS - so json quips should win
        const texts = new Set<string>();
        for (let i = 0; i < 30; i++) texts.add(pick("xyz", "json").text);
        const hasJsonQuip = [...texts].some(t =>
            t.includes("curly braces") || t.includes("lingua franca") || t.includes("ubiquitous")
        );
        expect(hasJsonQuip).toBe(true);
    });
});

describe("pick() - exclude parameter", () => {
    it("with a 2-item pair array, exclude avoids repeating the excluded text", () => {
        // PAIR_QUIPS["pdf→docx"] has exactly 2 items
        // Run enough times to confirm the excluded quip doesn't dominate
        const firstQuip = "pdf to docx: attempting to undo what adobe hath wrought";
        const secondQuip = "pdf to docx: lower your expectations before you proceed";

        let gotSecond = false;
        for (let i = 0; i < 30; i++) {
            const result = pick("pdf", "docx", firstQuip);
            if (result.text === secondQuip) gotSecond = true;
        }
        expect(gotSecond).toBe(true);
    });

    it("with a 1-item array and matching exclude, still returns the only item", () => {
        // PAIR_QUIPS["wav→mp3"] has exactly 1 item
        const singleQuip = "wav to mp3: you will lose something. your ears probably won't notice.";
        const result = pick("wav", "mp3", singleQuip);
        // Should still return it (no infinite loop / fallback to empty)
        expect(result.text).toBe(singleQuip);
    });

    it("with null exclude, still returns a valid result", () => {
        const result = pick("pdf", "docx", null);
        expect(typeof result.text).toBe("string");
        expect(result.text.length).toBeGreaterThan(0);
    });
});

describe("pick() - pdf-editor tab awareness", () => {
    const collect = (n: number, fn: () => string) => {
        const out = new Set<string>();
        for (let i = 0; i < n; i++) out.add(fn());
        return out;
    };

    it("watermark tab returns watermark-flavored quips at least sometimes", () => {
        const texts = collect(80, () => pick(null, null, null, "pdf-editor", "watermark").text);
        const hit = [...texts].some(t =>
            t.includes("watermark") || t.includes("DRAFT") || t.includes("opacity") ||
            t.includes("confidential") || t.includes("brand") || t.includes("territory") ||
            t.includes("diagonal") || t.includes("45 degrees") || t.includes("stamping") ||
            t.includes("page corners")
        );
        expect(hit).toBe(true);
    });

    it("organize tab returns organize-flavored quips at least sometimes", () => {
        // Matchers must be substrings that appear ONLY in PDF_ORGANIZE_QUIPS,
        // not in PDF_GENERIC_QUIPS - otherwise the test would pass even if the
        // organize pool were never consulted.
        const texts = collect(80, () => pick(null, null, null, "pdf-editor", "organize").text);
        const hit = [...texts].some(t =>
            t.includes("career pivot") || t.includes("drag the pages") || t.includes("right place") ||
            t.includes("three r's") || t.includes("sideways") || t.includes("page 47") ||
            t.includes("reorder") || t.includes("thumbnails below") || t.includes("undo button")
        );
        expect(hit).toBe(true);
    });

    it("merge tab returns merge-flavored quips at least sometimes", () => {
        const texts = collect(80, () => pick(null, null, null, "pdf-editor", "merge").text);
        const hit = [...texts].some(t =>
            t.includes("two pdfs") || t.includes("love story") || t.includes("combine") ||
            t.includes("cell division") || t.includes("extracting pages")
        );
        expect(hit).toBe(true);
    });

    it("watermark tab never serves an organize-only quip", () => {
        const organizeOnly = "i rearrange pages now. career pivot.";
        for (let i = 0; i < 50; i++) {
            expect(pick(null, null, null, "pdf-editor", "watermark").text).not.toBe(organizeOnly);
        }
    });

    it("merge tab never serves a watermark-only quip", () => {
        const watermarkOnly = "DRAFT. DRAFT. DRAFT. DRAFT.";
        for (let i = 0; i < 50; i++) {
            expect(pick(null, null, null, "pdf-editor", "merge").text).not.toBe(watermarkOnly);
        }
    });

    it("pdf-editor with no tool still returns a pdf-editor quip", () => {
        const result = pick(null, null, null, "pdf-editor");
        expect(typeof result.text).toBe("string");
        expect(result.text.length).toBeGreaterThan(0);
        // should not be a convert-page IDLE quip about formats in general
        expect(result.text).not.toBe("drop a file, pick a format");
    });
});

describe("pick() - all results have valid face values", () => {
    it("all faces are one of the 5 valid values across varied inputs", () => {
        const inputs: [string | null, string | null][] = [
            [null, null], ["pdf", "docx"], ["png", "jpg"], ["mp3", null],
            [null, "wav"], ["unknown", "format"], ["gif", "mp4"], ["yaml", "json"],
        ];
        for (const [from, to] of inputs) {
            for (let i = 0; i < 5; i++) {
                const result = pick(from, to);
                expect(VALID_FACES.has(result.face), `face "${result.face}" for pick("${from}", "${to}") is invalid`).toBe(true);
            }
        }
    });
});

// ---------------------------------------------------------------------------
// Compress page quips
// ---------------------------------------------------------------------------

describe("pick() on the compress page", () => {
    it("returns compression-flavoured chatter when no format is selected", () => {
        const seen = new Set<string>();
        for (let i = 0; i < 200; i++) {
            seen.add(pick(null, null, null, "compress").text);
        }
        // The pool is blended with IDLE_QUIPS, so assert the compress pool is
        // actually reachable rather than that every draw is compression copy.
        const compressish = [...seen].filter(t =>
            /squish|smaller|compress|kilobyte|lossless|lossy|jpeg|deflate|diet/i.test(t));
        expect(compressish.length).toBeGreaterThan(0);
    });

    // The rule is about *assumed context*, not vocabulary. A quip from the
    // watermark tool pool ("every page now bears the brand") reads as nonsense
    // on the compress page, because it assumes you are already in the editor
    // with a document open. A capability tip that mentions watermarking in
    // order to point you *at* the editor is the opposite: it is only useful
    // somewhere else. So this matches the tool quips themselves, not the word.
    it("never leaks PDF tool quips onto the compress page", () => {
        for (let i = 0; i < 200; i++) {
            const t = pick(null, null, null, "compress").text;
            expect(t).not.toMatch(/every page now bears the brand|rearrange pages now|two pdfs enter|marking your territory/i);
        }
    });

    it("still tells the compress page about the other modes", () => {
        const seen = new Set<string>();
        for (let i = 0; i < 400; i++) seen.add(pick(null, null, null, "compress").text);
        expect([...seen].some(t => /pdf editor|i also edit pdfs/i.test(t))).toBe(true);
    });
});

describe("capability quips", () => {
    // The whole point of the pool: someone who has never left the Converter is
    // exactly the person who does not know Compress and the PDF editor exist.
    for (const page of ["convert", "compress", "pdf-editor"] as const) {
        it(`surface features on the ${page} page`, () => {
            const seen = new Set<string>();
            for (let i = 0; i < 600; i++) seen.add(pick(null, null, null, page).text);
            const texts = [...seen];
            expect(texts.some(t => /compress mode|smaller, not different/i.test(t))).toBe(true);
            expect(texts.some(t => /dark mode|light, dark/i.test(t))).toBe(true);
            expect(texts.some(t => /settings menu/i.test(t))).toBe(true);
        });
    }

    it("never claims a feature the app does not have", () => {
        // Guards against the tempting-but-false tip. Everything the pool
        // mentions has to be reachable in the shipped UI.
        const seen = new Set<string>();
        for (let i = 0; i < 800; i++) seen.add(pick(null, null, null, "convert").text);
        for (const t of seen) {
            expect(t).not.toMatch(/sign up|account|cloud|upload to|premium|pro plan/i);
        }
    });
});
