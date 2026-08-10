import { describe, it, expect, beforeAll } from "vitest";
import { imageHeavyPdf } from "../../../test/fixtures/imageHeavyPdf.ts";

/**
 * End-to-end compression with **no mocks**.
 *
 * Every other test in this directory substitutes something: the probe, the tier
 * ladder, the dispatcher, the engine. That is what let four separate defects
 * ship green - the mocks encoded the same wrong assumptions as the code they
 * stood in for, so the suite agreed with the bug. Specifically:
 *
 *  - the probe was mocked, so a veto that overruled explicit levels looked fine
 *  - pdf.js was never loaded, so the buffer it detaches was never observed
 *  - formats were synthesised with `from` and `to` on one entry, a shape the
 *    real FFmpeg parser never produces
 *  - `planVideo` was only ever called with `medium`, so three levels collapsing
 *    to one output was invisible
 *
 * This file runs the real ladder, the real dispatcher and the real Ghostscript
 * build against a real document, and asserts on bytes.
 *
 * ## What is deliberately *not* here
 *
 * The pdf.js half of the probe. Real `pdfjs-dist` cannot load under this
 * runtime: it needs `DOMMatrix` at import time, then `Promise.try`, then
 * `Uint8Array.prototype.toHex` - browser and ES2025 features this Node lacks.
 * Stubbing all three would mean asserting against a hand-built imitation of
 * pdf.js rather than pdf.js, which is how the detach bug survived in the first
 * place.
 *
 * That path is therefore verified where it actually runs, in
 * `test/e2e/compress-real-file.test.ts`. Worth stating plainly: **a library
 * this suite cannot load is a library this suite cannot vouch for**, and the
 * only honest response is a browser test, not a better mock.
 */

let pdf: Uint8Array;
beforeAll(async () => { pdf = await imageHeavyPdf(); }, 180_000);

describe("the whole pipeline, real Ghostscript, real bytes", () => {
    async function compress(level: "low" | "medium" | "high" | "auto") {
        const { default: GhostscriptNodeHandler } = await import("../../handlers/ghostscript.node.ts");
        const { compressBatch } = await import("./compressBatch.ts");
        const { default: CommonFormats } = await import("../CommonFormats/CommonFormats.ts");

        const handler = new GhostscriptNodeHandler();
        await handler.init();
        const format = CommonFormats.PDF.supported("pdf", true, true);
        (globalThis as unknown as { window: Record<string, unknown> }).window ??= {};

        return compressBatch(
            [{
                name: "report.pdf",
                format,
                size: pdf.byteLength,
                // Lazy, exactly as the surface supplies it: read at compress time.
                read: async () => pdf.slice(),
            }],
            {
                options: [{ format, handler }],
                level,
                run: async (_n, files, inFmt, outFmt, args) =>
                    handler.doConvert(files, inFmt, outFmt, args),
            },
        );
    }

    it("makes a real PDF smaller at an explicit level", async () => {
        const out = await compress("low");
        expect(out[0].reason).toBeUndefined();
        expect(out[0].shrunk).toBe(true);
        expect(out[0].bytes.byteLength).toBeLessThan(pdf.byteLength);
        // Still a PDF, not merely a smaller pile of bytes.
        expect(String.fromCharCode(...out[0].bytes.slice(0, 5))).toBe("%PDF-");
    }, 600_000);

    it("does not refuse the file before the engine has had a go", async () => {
        // The regression that mattered most: the probe judged image-heavy PDFs
        // "already minimal" and skipped them at every setting. `already-minimal`
        // here means we never even tried.
        const out = await compress("high");
        expect(out[0].reason).not.toBe("already-minimal");
        expect(out[0].reason).not.toBe("unsupported");
    }, 600_000);
});
