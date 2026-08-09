import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFHexString } from 'pdf-lib';
import { loadEditablePdf } from './pdfSource.ts';
import { merge } from './pdfMerge.ts';

async function pdfWithPages(n: number): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    for (let i = 0; i < n; i++) doc.addPage([612, 792]);
    return doc.save();
}

/** A real PDF carrying a standard-security `/Encrypt` dict, built not committed. */
async function encryptedPdf(n = 1): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    for (let i = 0; i < n; i++) doc.addPage([612, 792]);
    const ctx = doc.context;
    ctx.trailerInfo.Encrypt = ctx.register(ctx.obj({
        Filter: 'Standard',
        V: 1,
        R: 2,
        O: PDFHexString.of('00'.repeat(32)),
        U: PDFHexString.of('00'.repeat(32)),
        P: -1,
    }));
    return doc.save();
}

describe('loadEditablePdf', () => {
    it('loads an ordinary PDF', async () => {
        const doc = await loadEditablePdf(await pdfWithPages(3), 'ok.pdf');
        expect(doc.getPageCount()).toBe(3);
    });

    /**
     * `ignoreEncryption: true` suppresses the throw but supplies no password,
     * so the page tree reads and the content streams do not. Editing tools that
     * trusted the flag copied structurally correct, entirely blank pages.
     */
    it('refuses an encrypted PDF instead of yielding blank pages', async () => {
        await expect(loadEditablePdf(await encryptedPdf(), 'secret.pdf'))
            .rejects.toThrow(/secret\.pdf is password-protected/);
    });

    it('falls back to a readable subject when no filename is given', async () => {
        await expect(loadEditablePdf(await encryptedPdf()))
            .rejects.toThrow(/This PDF is password-protected/);
    });
});

describe('merge, with an encrypted source', () => {
    /**
     * Measured before the guard: merging a LibreOffice password-protected file
     * with a 4-page document produced all 5 pages, of which pages 2-5 carried
     * 3,930 / 3,953 / 3,953 / 2,635 characters and page 1 carried zero. The
     * user got a plausible file with their protected page silently emptied.
     */
    it('refuses rather than silently emptying the protected pages', async () => {
        await expect(merge([
            { id: 'a', name: 'payslip.pdf', bytes: await encryptedPdf() },
            { id: 'b', name: 'notes.pdf', bytes: await pdfWithPages(4) },
        ] as never)).rejects.toThrow(/payslip\.pdf is password-protected/);
    });

    it('still merges ordinary documents', async () => {
        const out = await merge([
            { id: 'a', name: 'one.pdf', bytes: await pdfWithPages(2) },
            { id: 'b', name: 'two.pdf', bytes: await pdfWithPages(3) },
        ] as never);
        expect((await PDFDocument.load(out.bytes)).getPageCount()).toBe(5);
    });
});
