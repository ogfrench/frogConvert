import { describe, it, expect, beforeAll } from "vitest";
import { imageHeavyPdf } from "../../../test/fixtures/imageHeavyPdf.ts";

/**
 * Does the level the user picked actually change the file?
 *
 * This is its own file rather than a case in `pipeline.integration.test.ts`
 * for a physical reason: every run instantiates its own 16 MB WASM module and
 * Emscripten memory cannot be reclaimed inside a fork worker (see
 * `vmMemoryLimit` in vite.config.js). Past about two runs the worker is killed
 * mid-file, which surfaces as a crash rather than a failure and reads like
 * flakiness. A separate file gets a separate worker and its own budget.
 *
 * ## Why size and not flags
 *
 * The "level does nothing" defect shipped **three times** in one release:
 * video levels produced byte-identical output under 75 MB, and later both the
 * PostScript conversion routes did the same. In every case a unit test
 * asserting the arguments passed while the output bytes were identical,
 * because the level has to survive the whole trip - the store,
 * `extractQualityPreset`, the plan, the engine - and any one link can drop it
 * silently.
 *
 * So this asserts on bytes. It is slow and it is worth it.
 */

let pdf: Uint8Array;
beforeAll(async () => { pdf = await imageHeavyPdf(); }, 180_000);

async function compress(level: "low" | "high") {
    const { default: GhostscriptNodeHandler } = await import("../../handlers/ghostscript.node.ts");
    const { compressBatch } = await import("./compressBatch.ts");
    const { default: CommonFormats } = await import("../CommonFormats/CommonFormats.ts");

    const handler = new GhostscriptNodeHandler();
    await handler.init();
    const format = CommonFormats.PDF.supported("pdf", true, true);
    (globalThis as unknown as { window: Record<string, unknown> }).window ??= {};

    return compressBatch(
        [{ name: "report.pdf", format, size: pdf.byteLength, read: async () => pdf.slice() }],
        {
            options: [{ format, handler }],
            level,
            run: async (_n, files, inFmt, outFmt, args) => handler.doConvert(files, inFmt, outFmt, args),
        },
    );
}

describe("the compression level changes the bytes", () => {
    it("makes Smallest file genuinely smaller than High quality", async () => {
        // Two levels, not four: the ceiling above is real, and two ends of the
        // ladder are enough to catch a level that has stopped being wired
        // through. Verified in a browser across all four - Convert at
        // lossless/auto/high/medium/low gave 2,132,172 / 417,150 / 839,253 /
        // 417,150 / 246,795 bytes on a 5.3 MB photo, with auto landing on
        // medium by design.
        const low = await compress("low");
        const high = await compress("high");

        expect(low[0].reason).toBeUndefined();
        expect(high[0].reason).toBeUndefined();
        expect(low[0].bytes.byteLength).not.toBe(high[0].bytes.byteLength);
        // The labels promise a direction, not just a difference.
        expect(low[0].bytes.byteLength).toBeLessThan(high[0].bytes.byteLength);
        // Both still real PDFs.
        for (const r of [low, high]) {
            expect(String.fromCharCode(...r[0].bytes.slice(0, 5))).toBe("%PDF-");
        }
    }, 1_200_000);
});
