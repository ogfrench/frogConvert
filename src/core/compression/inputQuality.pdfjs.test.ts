import { describe, it, expect, vi } from "vitest";

/**
 * The pdf.js fallback path in `probePdf`, isolated in its own file because it
 * needs `pdfjs-dist` mocked at module scope.
 *
 * pdf.js takes ownership of the `data` buffer it is handed: it transfers it to
 * its worker, and the caller's view comes back detached with byteLength 0.
 * This mock reproduces that faithfully, because the real bug it caused was
 * invisible to any test that did not.
 *
 * What went wrong in production: a PDF whose page count is not in the trailer
 * scan window reached this path, pdf.js detached the file's bytes, and
 * `probePdf` then divided a now-zero length by the page count. Every such
 * document was reported "minimal" - already as small as it gets - and skipped.
 * Worse, the detached buffer *was the file*, so the compression that followed
 * would have been handed an empty document.
 */
vi.mock("pdfjs-dist", () => ({
  getDocument: ({ data }: { data: Uint8Array }) => {
    // Exactly what pdf.js does: take the buffer away from the caller.
    structuredClone(data, { transfer: [data.buffer] });
    return { promise: Promise.resolve({ numPages: 59, destroy: () => Promise.resolve() }) };
  },
}));

const { probePdf } = await import("./inputQuality.ts");

/** >1MB so the probe runs, and deliberately no `/Count` anywhere, so the cheap
 *  trailer scan misses and the pdf.js fallback is the path under test. */
function pdfWithoutTrailerCount(totalBytes: number): Uint8Array {
  const buf = new Uint8Array(totalBytes);
  buf.set(new TextEncoder().encode("%PDF-1.7"), 0);
  return buf;
}

describe("probePdf via the pdf.js fallback", () => {
  it("does not hand the caller's buffer to pdf.js", async () => {
    const bytes = pdfWithoutTrailerCount(6_027_691);
    await probePdf(bytes);
    // If this is 0 the file has been destroyed, not merely mis-measured.
    expect(bytes.byteLength).toBe(6_027_691);
  });

  it("tiers on the real size, not the post-detach zero", async () => {
    // 6,027,691 bytes over 59 pages is ~102 kB/page: an ordinary designed
    // document that compresses by about a third. Reading it as 0 bytes/page
    // put it in "minimal" and skipped it.
    const probe = await probePdf(pdfWithoutTrailerCount(6_027_691));
    expect(probe.inputTier).toBe("low");
    expect(probe.detail.pages).toBe(59);
    expect(Number(probe.detail.bpp)).toBeGreaterThan(100_000);
  });
});
