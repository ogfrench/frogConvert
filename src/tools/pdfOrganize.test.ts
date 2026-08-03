import { describe, it, expect, vi } from 'vitest';
import { PDFDocument, degrees } from 'pdf-lib';
import { organize } from './pdfOrganize.ts';
import { PdfEditCancelled } from './cancellation.ts';
import type { PageEntry, SourceFile } from './types.ts';

/** AbortSignal-like that reports aborted only after its `aborted` getter has
 *  been read more than `n` times - lets a test cancel mid-loop deterministically. */
function abortAfter(n: number): AbortSignal {
  let reads = 0;
  return { get aborted() { return ++reads > n; } } as AbortSignal;
}

/** Create a minimal PDF with N blank pages. */
async function makePdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage();
  return new Uint8Array(await doc.save());
}

function sf(id: number, name: string, bytes: Uint8Array, pageCount: number): SourceFile {
  return { id, name, size: bytes.length, bytes, pageCount, firstPageThumb: null };
}

function page(fileId: number, pageNum: number, opts?: Partial<PageEntry>): PageEntry {
  return {
    type: 'source', sourceFileId: fileId, sourcePageNum: pageNum,
    thumbnail: null, deleted: false, rotation: 0, ...opts,
  };
}

function blankPage(opts?: Partial<PageEntry>): PageEntry {
  return {
    type: 'blank', sourceFileId: -1, sourcePageNum: 0,
    thumbnail: null, deleted: false, rotation: 0, ...opts,
  };
}

describe('pdfOrganize', () => {
  it('reorders pages in reverse', async () => {
    const bytes = await makePdf(3);
    const file = sf(1, 'doc.pdf', bytes, 3);
    const pages = [page(1, 3), page(1, 2), page(1, 1)];
    const result = await organize([file], pages);
    const out = await PDFDocument.load(result.bytes);
    expect(out.getPageCount()).toBe(3);
  });

  it('produces only non-deleted pages', async () => {
    const bytes = await makePdf(3);
    const file = sf(1, 'doc.pdf', bytes, 3);
    // Caller filters deleted pages before calling organize
    const pages = [page(1, 1), page(1, 3)];
    const result = await organize([file], pages);
    const out = await PDFDocument.load(result.bytes);
    expect(out.getPageCount()).toBe(2);
  });

  it('rotates a page 90 degrees', async () => {
    const bytes = await makePdf(1);
    const file = sf(1, 'doc.pdf', bytes, 1);
    const pages = [page(1, 1, { rotation: 90 })];
    const result = await organize([file], pages);
    const out = await PDFDocument.load(result.bytes);
    const outPage = out.getPage(0);
    expect(outPage.getRotation().angle).toBe(90);
  });

  it('stacks rotation with existing page rotation', async () => {
    // Create a PDF with a page already rotated 90 degrees
    const doc = await PDFDocument.create();
    const p = doc.addPage();
    p.setRotation(degrees(90));
    const bytes = new Uint8Array(await doc.save());
    const file = sf(1, 'rotated.pdf', bytes, 1);
    const pages = [page(1, 1, { rotation: 180 })];
    const result = await organize([file], pages);
    const out = await PDFDocument.load(result.bytes);
    expect(out.getPage(0).getRotation().angle).toBe(270); // 90 + 180
  });

  it('inserts a blank page with specified dimensions', async () => {
    const bytes = await makePdf(1);
    const file = sf(1, 'doc.pdf', bytes, 1);
    const pages = [
      page(1, 1),
      blankPage({ blankPageSize: { width: 400, height: 600 } }),
    ];
    const result = await organize([file], pages);
    const out = await PDFDocument.load(result.bytes);
    expect(out.getPageCount()).toBe(2);
    const blank = out.getPage(1);
    expect(blank.getWidth()).toBeCloseTo(400);
    expect(blank.getHeight()).toBeCloseTo(600);
  });

  it('uses A4 default for blank page without explicit size', async () => {
    const pages = [blankPage()];
    const result = await organize([], pages);
    const out = await PDFDocument.load(result.bytes);
    const p = out.getPage(0);
    expect(p.getWidth()).toBeCloseTo(595.28, 1);
    expect(p.getHeight()).toBeCloseTo(841.89, 1);
  });

  it('names output "{base}_organized_pdfs.pdf" for single source file', async () => {
    const bytes = await makePdf(2);
    const file = sf(1, 'report.pdf', bytes, 2);
    const pages = [page(1, 2), page(1, 1)];
    const result = await organize([file], pages);
    expect(result.name).toMatch(/^report_organized_pdfs-\d{8}-\d{6}\.pdf$/);
  });

  it('names output "organized_pdfs.pdf" for multiple source files', async () => {
    const a = await makePdf(1);
    const b = await makePdf(1);
    const pages = [page(1, 1), page(2, 1)];
    const result = await organize([sf(1, 'a.pdf', a, 1), sf(2, 'b.pdf', b, 1)], pages);
    expect(result.name).toMatch(/^organized_pdfs-\d{8}-\d{6}\.pdf$/);
  });

  it('names output "organized_pdfs.pdf" when all pages are blank', async () => {
    const pages = [blankPage(), blankPage()];
    const result = await organize([], pages);
    expect(result.name).toMatch(/^organized_pdfs-\d{8}-\d{6}\.pdf$/);
  });

  it('silently skips pages with missing source file ID', async () => {
    const bytes = await makePdf(1);
    const file = sf(1, 'doc.pdf', bytes, 1);
    // Page references file ID 99 which doesn't exist
    const pages = [page(1, 1), page(99, 1)];
    const result = await organize([file], pages);
    const out = await PDFDocument.load(result.bytes);
    // Only the valid page should be in the output
    expect(out.getPageCount()).toBe(1);
  });

  it('produces byte-identical output whether or not a (non-aborted) signal is passed', async () => {
    const bytes = await makePdf(3);
    const file = sf(1, 'doc.pdf', bytes, 3);
    const pages = [page(1, 3), page(1, 2), page(1, 1)];
    // pdf-lib stamps CreationDate/ModDate with the real clock at save() time;
    // pin it so two calls a few ms apart can't disagree on that alone. Only
    // Date is faked - checkpoint()'s internal setTimeout must still fire on
    // its own for the awaited promise to resolve.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    try {
      const withoutSignal = await organize([file], pages);
      const withSignal = await organize([file], pages, new AbortController().signal);
      expect(withSignal.bytes).toEqual(withoutSignal.bytes);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops mid-loop and produces no output when the signal is aborted', async () => {
    const bytes = await makePdf(11);
    const file = sf(1, 'doc.pdf', bytes, 11);
    const pages = Array.from({ length: 11 }, (_, i) => page(1, i + 1));
    // The load-phase checkpoint passes, the page-loop one aborts.
    await expect(organize([file], pages, abortAfter(1))).rejects.toThrow(PdfEditCancelled);
  });
});
