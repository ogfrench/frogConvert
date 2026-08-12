import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
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

/**
 * The PDF editor is the one place this guard can be bypassed by accident.
 *
 * `src/tools/pdf{Merge,Organize,Extract,Watermark}.ts` all go through
 * `loadEditablePdf`, so the MCP and REST paths are safe by construction. The
 * browser editor loads PDFs itself, and for two legitimate reasons: it reads a
 * page count at intake and a page size when inserting a blank. Those are
 * *measurements*, and the flag is correct for them - encryption does not hide
 * the page tree.
 *
 * Editing is the other case, and it is where a bare
 * `PDFDocument.load(bytes, { ignoreEncryption: true })` produces structurally
 * perfect blank pages and reports success. Extract's "Combined PDF" branch did
 * exactly that: its sibling per-source branch went through `extract()` and was
 * fine, so the two halves of one button behaved differently on a
 * password-protected file, and only one of them said so.
 *
 * Asserted at the source level rather than through the DOM because the defect
 * is "which loader did this call site pick", which is a property of the call
 * site. If this fails because you added a genuine measuring read, raise the
 * count and say which line it is - the point is that the choice gets made
 * deliberately rather than by copy-paste.
 */
describe('the PDF editor never loads an about-to-be-edited PDF unguarded', () => {
    const src = fs.readFileSync(
        path.resolve(__dirname, '../components/PdfWorkspace/PdfWorkspace.ts'), 'utf8');

    it('routes editing paths through loadEditablePdf', () => {
        expect(src).toContain("import { loadEditablePdf }");
        expect(src).toMatch(/await loadEditablePdf\(sf\.bytes, sf\.name\)/);
    });

    it('keeps raw ignoreEncryption loads to the two measuring reads', () => {
        const raw = [...src.matchAll(/PDFDocument\.load\([^)]*ignoreEncryption/g)];
        expect(
            raw.length,
            `Expected exactly 2 raw ignoreEncryption loads in PdfWorkspace.ts (the page-count ` +
            `read at intake and the page-size read for blank insertion), found ${raw.length}. ` +
            `A third is either another measurement - in which case raise this number - or an ` +
            `edit, in which case it must use loadEditablePdf or it will emit blank pages for a ` +
            `password-protected source and call it a success.`,
        ).toBe(2);
    });
});
