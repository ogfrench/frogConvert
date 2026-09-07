import { describe, it, expect } from "vitest";
import { readPageLine, ENGINE_NAME } from "./ghostscript.ts";

/**
 * Reported from a phone: compressing a PDF sat on "Compressing <name>" with no
 * further sign of life, and read as a hang.
 *
 * Ghostscript was working the whole time - it just ran under `-dQUIET`, which
 * suppresses the only progress a pdfwrite pass emits. With the flag off it
 * announces the range once and then names each page as it writes it, which is
 * what this reads. The lines arrive synchronously from inside `callMain`; the
 * handler runs in a Worker, so each one reaches the modal while the pass is
 * still going.
 */
describe("readPageLine", () => {
    it("takes the page total from the range line, which says nothing itself", () => {
        const state = { total: 0 };
        expect(readPageLine("Processing pages 1 through 40.", state)).toBeNull();
        expect(state.total).toBe(40);
    });

    it("reports each page against that total", () => {
        const state = { total: 0 };
        readPageLine("Processing pages 1 through 40.", state);
        expect(readPageLine("Page 1", state)).toEqual({ n: 1, total: 40 });
        expect(readPageLine("Page 40", state)).toEqual({ n: 40, total: 40 });
    });

    it("counts a range that does not start at one", () => {
        const state = { total: 0 };
        readPageLine("Processing pages 5 through 9.", state);
        expect(readPageLine("Page 5", state)).toEqual({ n: 5, total: 5 });
    });

    it("ignores the banner and anything else on the stream", () => {
        const state = { total: 0 };
        for (const line of [
            "GPL Ghostscript 9.56.0 (2022-03-29)",
            "Copyright (C) 2022 Artifex Software, Inc.  All rights reserved.",
            "This software is supplied under the GNU AGPLv3 and comes with NO WARRANTY:",
            "see the file COPYING for details.",
            "**** Warning: considering '0000000000 XXXXX n' as a free entry.",
            "",
        ]) expect(readPageLine(line, state)).toBeNull();
    });

    it("says nothing about a page it has no total for", () => {
        // Order is guaranteed by Ghostscript, not by us; a bare "Page 3" with
        // no range would otherwise divide by zero and paint "Infinity%".
        expect(readPageLine("Page 3", { total: 0 })).toBeNull();
    });
});

/**
 * Reported alongside the stuck-looking pass: the same 16 MB was announced
 * twice, seconds apart, under two names, with an unrelated phase between them.
 * Measured on a three-file batch, the modal read:
 *
 *     Downloading the document compressor... | this happens once...
 *     Reading your file...                   | DOC-20250501-WA0012. (1).pdf
 *     Compressing file 1 of 3...             | Fetching the PDF compressor (7%)
 *
 * A download announced, apparently abandoned for a file read, then started
 * again under a second name. The surfaces no longer claim a download before
 * `init()` - see CompressWorkspace and actions.ts - and the engine answers to
 * the same name the category vocabulary uses.
 */
describe("what the engine calls itself", () => {
    it("uses the name the surfaces already use for it", () => {
        // The Compress and Convert surfaces build "<category> <tool>" from
        // CATEGORY_LABELS, which for a PDF is "document".
        expect(ENGINE_NAME.compressor).toBe("document compressor");
    });

    it("keeps a separate name for the conversion routes, which are not compression", () => {
        // Someone who dropped an EPS on the Converter is not compressing
        // anything, and "document compressor" would be wrong there.
        expect(ENGINE_NAME.converter).toBe("PostScript engine");
    });
});
