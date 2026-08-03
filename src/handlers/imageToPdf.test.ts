import { describe, it, expect } from "vitest";
import ImageToPdfHandler, { pdfPageSizeFor, PDF_MAX_PAGE_POINTS } from "./imageToPdf.ts";
import { PDFDocument } from "pdf-lib";

/**
 * Reported by a user who converted phone screenshots to PDF and then merged
 * them: the merge came out broken. The merge was faithful - the inputs were
 * pages of 77760x172800pt (1080 by 2400 *inches*), because the producing tool
 * assumed 1 DPI. There was also no route for this in the app at all: the picker
 * offered PDF and the conversion answered "not available yet".
 */
describe("pdfPageSizeFor", () => {
    it("maps one pixel to one point", () => {
        // A screenshot keeps its proportions and its detail; nothing resampled.
        expect(pdfPageSizeFor(1080, 2400)).toEqual({ width: 1080, height: 2400 });
    });

    it("stays far under the page limit for the reported screenshot", () => {
        const { width, height } = pdfPageSizeFor(1080, 2400);
        expect(Math.max(width, height)).toBeLessThanOrEqual(PDF_MAX_PAGE_POINTS);
        // What the bug produced, for contrast: 2400px at 1 DPI.
        expect(2400 * 72).toBe(172800);
    });

    it("scales an over-long image down instead of writing an illegal page", () => {
        const { width, height } = pdfPageSizeFor(5000, 20000);
        expect(height).toBe(PDF_MAX_PAGE_POINTS);
        expect(Math.max(width, height)).toBeLessThanOrEqual(PDF_MAX_PAGE_POINTS);
        // Uniformly: the image is made smaller, never distorted.
        expect(width / height).toBeCloseTo(5000 / 20000, 6);
    });

    it("leaves ordinary images completely alone", () => {
        for (const [w, h] of [[640, 480], [1920, 1080], [4000, 3000]] as [number, number][]) {
            expect(pdfPageSizeFor(w, h)).toEqual({ width: w, height: h });
        }
    });
});

/** A tiny real PNG, so the handler is exercised on bytes rather than a mock. */
async function onePixelPng(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    void doc;
    return new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
        0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
        0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
        0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
}

describe("imageToPdf handler", () => {
    it("declares images in and PDF out, and nothing the other way", async () => {
        const h = new ImageToPdfHandler();
        await h.init();
        expect(h.ready).toBe(true);
        const pdf = h.supportedFormats!.find(f => f.format === "pdf")!;
        // Reading a PDF needs a real engine; this handler only ever writes one.
        expect(pdf.from).toBe(false);
        expect(pdf.to).toBe(true);
        const png = h.supportedFormats!.find(f => f.format === "png")!;
        expect(png.from).toBe(true);
        expect(png.to).toBe(false);
    });

    it("does not claim to honour the quality preset", () => {
        // The bytes are embedded as they arrive, so announcing a compression
        // here would be a claim about work that never happened.
        expect(new ImageToPdfHandler().usesQuality).toBe(false);
    });

    it("turns a PNG into a one-page PDF at one point per pixel", async () => {
        const h = new ImageToPdfHandler();
        await h.init();
        const png = h.supportedFormats!.find(f => f.format === "png")!;
        const pdf = h.supportedFormats!.find(f => f.format === "pdf")!;
        const out = await h.doConvert(
            [{ name: "shot.png", bytes: await onePixelPng() }], png, pdf);

        expect(out).toHaveLength(1);
        expect(out[0].name).toBe("shot.pdf");
        const doc = await PDFDocument.load(out[0].bytes);
        expect(doc.getPageCount()).toBe(1);
        const size = doc.getPage(0).getSize();
        expect(size.width).toBeCloseTo(1, 3);
        expect(size.height).toBeCloseTo(1, 3);
    });

    it("collapses a batch into one document, one page per image", async () => {
        const h = new ImageToPdfHandler();
        await h.init();
        const png = h.supportedFormats!.find(f => f.format === "png")!;
        const pdf = h.supportedFormats!.find(f => f.format === "pdf")!;
        const bytes = await onePixelPng();
        const out = await h.doConvert([
            { name: "a.png", bytes }, { name: "b.png", bytes }, { name: "c.png", bytes },
        ], png, pdf);

        expect(out).toHaveLength(1);
        // The first file's name alone would undersell a three-image document.
        expect(out[0].name).toBe("a_and_2_more.pdf");
        const doc = await PDFDocument.load(out[0].bytes);
        expect(doc.getPageCount()).toBe(3);
    });

    it("reports progress across a batch and stays quiet for one file", async () => {
        const h = new ImageToPdfHandler();
        await h.init();
        const png = h.supportedFormats!.find(f => f.format === "png")!;
        const pdf = h.supportedFormats!.find(f => f.format === "pdf")!;
        const bytes = await onePixelPng();

        const many: any[] = [];
        await h.doConvert([{ name: "a.png", bytes }, { name: "b.png", bytes }], png, pdf, undefined, p => many.push(p));
        expect(many.map(p => p.detail)).toEqual(["Adding image 1 of 2", "Adding image 2 of 2"]);

        const one: any[] = [];
        await h.doConvert([{ name: "a.png", bytes }], png, pdf, undefined, p => one.push(p));
        // A single file has no position worth reporting; a frozen counter or a
        // ratio that cannot move is worse than saying nothing.
        expect(one.every(p => p.detail === undefined && p.ratio === undefined)).toBe(true);
    });

    it("refuses inputs and outputs it cannot honour", async () => {
        const h = new ImageToPdfHandler();
        await h.init();
        const png = h.supportedFormats!.find(f => f.format === "png")!;
        const pdf = h.supportedFormats!.find(f => f.format === "pdf")!;
        const bytes = await onePixelPng();
        await expect(h.doConvert([{ name: "a.png", bytes }], png, png))
            .rejects.toThrow(/only writes PDF/);
        await expect(h.doConvert([{ name: "a.gif", bytes }], { ...png, format: "gif" } as any, pdf))
            .rejects.toThrow(/JPEG or PNG/);
    });
});
