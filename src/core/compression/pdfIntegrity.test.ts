import { describe, it, expect } from "vitest";
import { PDFDocument, PDFHexString } from "pdf-lib";
import { pdfPageCount, assertPdfPagesPreserved } from "./pdfIntegrity.ts";

/** A real PDF with `n` blank pages. */
async function pdfWithPages(n: number): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    for (let i = 0; i < n; i++) doc.addPage([612, 792]);
    return doc.save();
}

/**
 * A real PDF carrying a standard-security `/Encrypt` dictionary, which is the
 * one thing `isEncrypted` consults. Built rather than committed as a binary so
 * the fixture is readable, and so the test cannot quietly start passing against
 * a file nobody can inspect.
 */
async function encryptedPdfWithPages(n: number): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    for (let i = 0; i < n; i++) doc.addPage([612, 792]);
    const ctx = doc.context;
    ctx.trailerInfo.Encrypt = ctx.register(ctx.obj({
        Filter: "Standard",
        V: 1,
        R: 2,
        O: PDFHexString.of("00".repeat(32)),
        U: PDFHexString.of("00".repeat(32)),
        P: -1,
    }));
    return doc.save();
}

describe("pdfPageCount", () => {
    it("counts the pages of a real PDF", async () => {
        expect(await pdfPageCount(await pdfWithPages(7))).toBe(7);
    });

    it("returns null rather than throwing for bytes that are not a PDF", async () => {
        expect(await pdfPageCount(new TextEncoder().encode("not a pdf"))).toBeNull();
    });

    it("returns null for a truncated PDF", async () => {
        const full = await pdfWithPages(5);
        expect(await pdfPageCount(full.slice(0, Math.floor(full.length / 3)))).toBeNull();
    });
});

describe("assertPdfPagesPreserved", () => {
    it("accepts a compression that kept every page", async () => {
        const before = await pdfWithPages(12);
        const after = await pdfWithPages(12);
        await expect(assertPdfPagesPreserved(before, after, "doc.pdf")).resolves.toBeUndefined();
    });

    /**
     * The defect this guard exists for. Ghostscript hands a damaged PDF back as
     * a single blank page, exits 0, and writes a valid `%PDF-` header - so the
     * return code, the header check and the 98% keep-threshold all pass it, and
     * the surface reports a 99% saving over a blank page.
     */
    it("rejects the blank-page substitution a damaged input produces", async () => {
        const before = await pdfWithPages(84);
        const after = await pdfWithPages(1);
        await expect(assertPdfPagesPreserved(before, after, "report.pdf"))
            .rejects.toThrow(/lost pages \(84 -> 1\)/);
    });

    it("names the file it refused, so a batch says which one", async () => {
        const before = await pdfWithPages(3);
        const after = await pdfWithPages(2);
        await expect(assertPdfPagesPreserved(before, after, "invoice.pdf"))
            .rejects.toThrow(/invoice\.pdf/);
    });

    /**
     * An input no parser will read, that Ghostscript nonetheless "recovered"
     * into a clean PDF, is precisely the blank-page shape - there is no way to
     * check it, so it cannot be reported as a saving.
     */
    it("refuses a compression it cannot verify against the original", async () => {
        const damaged = (await pdfWithPages(9)).slice(0, 400);
        await expect(assertPdfPagesPreserved(damaged, await pdfWithPages(1), "torn.pdf"))
            .rejects.toThrow(/damaged/);
    });

    it("rejects an output that is not a readable PDF", async () => {
        await expect(assertPdfPagesPreserved(
            await pdfWithPages(4), new TextEncoder().encode("%PDF-but not really"), "x.pdf",
        )).rejects.toThrow(/wasn't a readable PDF/);
    });

    /** Compression never adds pages, but gaining one is not the harm guarded against. */
    it("does not reject an output with more pages than the input", async () => {
        await expect(assertPdfPagesPreserved(await pdfWithPages(2), await pdfWithPages(3), "x.pdf"))
            .resolves.toBeUndefined();
    });

    /**
     * The blank-page substitution in the one disguise page count cannot see.
     *
     * Ghostscript has no password, so on an encrypted document it reads the
     * page tree, fails to decrypt the content streams, and writes out that many
     * *empty* pages. Page count is preserved exactly, so every other check here
     * passes it - and the output is no longer encrypted.
     *
     * Measured in the built app on a LibreOffice password-protected file:
     * 12,783 bytes and one page of text became 2,188 bytes, one blank page,
     * zero extractable characters and `isEncrypted` false, reported to the user
     * as an 83% saving and offered for download.
     */
    describe("encrypted input", () => {
        it("is refused even when the page count matches perfectly", async () => {
            const encrypted = await encryptedPdfWithPages(2);
            const blankButSameShape = await pdfWithPages(2);

            // The point of the case: page count alone sees nothing wrong here.
            expect(await pdfPageCount(encrypted)).toBe(2);
            expect(await pdfPageCount(blankButSameShape)).toBe(2);

            await expect(assertPdfPagesPreserved(encrypted, blankButSameShape, "secret.pdf"))
                .rejects.toThrow(/password-protected/);
        });

        it("names the file, and says the original was kept encrypted", async () => {
            await expect(assertPdfPagesPreserved(
                await encryptedPdfWithPages(1), await pdfWithPages(1), "payslip.pdf",
            )).rejects.toThrow(/payslip\.pdf.*still encrypted/s);
        });

        it("leaves an ordinary unencrypted PDF alone", async () => {
            await expect(assertPdfPagesPreserved(await pdfWithPages(3), await pdfWithPages(3), "ok.pdf"))
                .resolves.toBeUndefined();
        });
    });
});
