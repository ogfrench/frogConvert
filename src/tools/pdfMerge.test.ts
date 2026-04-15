import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { merge } from './pdfMerge.ts';
import type { SourceFile } from './types.ts';

/** Create a minimal PDF with N blank pages and return its bytes. */
async function makePdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage();
  return new Uint8Array(await doc.save());
}

function sf(id: number, name: string, bytes: Uint8Array, pageCount: number): SourceFile {
  return { id, name, size: bytes.length, bytes, pageCount, firstPageThumb: null };
}

describe('pdfMerge', () => {
  it('merges two single-page PDFs into a 2-page PDF', async () => {
    const a = await makePdf(1);
    const b = await makePdf(1);
    const result = await merge([sf(0, 'a.pdf', a, 1), sf(1, 'b.pdf', b, 1)]);
    const out = await PDFDocument.load(result.bytes);
    expect(out.getPageCount()).toBe(2);
  });

  it('names output "{first}_merged_pdfs.pdf" for exactly 2 files', async () => {
    const a = await makePdf(1);
    const b = await makePdf(1);
    const result = await merge([sf(0, 'report.pdf', a, 1), sf(1, 'appendix.pdf', b, 1)]);
    expect(result.name).toBe('report_merged_pdfs.pdf');
  });

  it('names output "merged_pdfs.pdf" for 3+ files', async () => {
    const bytes = await makePdf(1);
    const files = [sf(0, 'a.pdf', bytes, 1), sf(1, 'b.pdf', bytes, 1), sf(2, 'c.pdf', bytes, 1)];
    const result = await merge(files);
    expect(result.name).toBe('merged_pdfs.pdf');
  });

  it('preserves page order across files', async () => {
    const a = await makePdf(2);
    const b = await makePdf(3);
    const result = await merge([sf(0, 'a.pdf', a, 2), sf(1, 'b.pdf', b, 3)]);
    const out = await PDFDocument.load(result.bytes);
    expect(out.getPageCount()).toBe(5);
  });

  it('handles a single file (degenerate case)', async () => {
    const bytes = await makePdf(3);
    const result = await merge([sf(0, 'only.pdf', bytes, 3)]);
    const out = await PDFDocument.load(result.bytes);
    expect(out.getPageCount()).toBe(3);
  });

  it('handles file names without extension', async () => {
    const a = await makePdf(1);
    const b = await makePdf(1);
    const result = await merge([sf(0, 'noext', a, 1), sf(1, 'b.pdf', b, 1)]);
    // stripExt returns the whole name when no '.' found
    expect(result.name).toBe('noext_merged_pdfs.pdf');
  });
});
