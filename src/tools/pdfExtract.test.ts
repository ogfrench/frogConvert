import { describe, it, expect, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { extract } from './pdfExtract.ts';
import { PdfEditCancelled } from './cancellation.ts';

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

describe('pdfExtract', () => {
  it('extracts a single page with correct naming', async () => {
    const bytes = await makePdf(5);
    const results = await extract(bytes, [3], 'doc');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('doc_page_3.pdf');
    const out = await PDFDocument.load(results[0].bytes);
    expect(out.getPageCount()).toBe(1);
  });

  it('extracts multiple pages as separate files when groupAsOne=false', async () => {
    const bytes = await makePdf(5);
    const results = await extract(bytes, [1, 3, 5], 'doc', false);
    expect(results).toHaveLength(3);
    expect(results[0].name).toBe('doc_page_1.pdf');
    expect(results[1].name).toBe('doc_page_3.pdf');
    expect(results[2].name).toBe('doc_page_5.pdf');
    for (const r of results) {
      const out = await PDFDocument.load(r.bytes);
      expect(out.getPageCount()).toBe(1);
    }
  });

  it('extracts multiple pages into one PDF when groupAsOne=true', async () => {
    const bytes = await makePdf(5);
    const results = await extract(bytes, [2, 3, 4], 'doc', true);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('doc_pages_2-4.pdf');
    const out = await PDFDocument.load(results[0].bytes);
    expect(out.getPageCount()).toBe(3);
  });

  it('omits page suffix when extracting all pages as one', async () => {
    const bytes = await makePdf(3);
    const results = await extract(bytes, [1, 2, 3], 'doc', true);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('doc.pdf');
  });

  it('page numbers are 1-indexed', async () => {
    // Extracting page 1 should not throw (0-indexed would be out of range for copyPages)
    const bytes = await makePdf(2);
    const results = await extract(bytes, [1], 'test');
    expect(results).toHaveLength(1);
    const out = await PDFDocument.load(results[0].bytes);
    expect(out.getPageCount()).toBe(1);
  });

  it('extracts non-contiguous pages in correct order', async () => {
    const bytes = await makePdf(10);
    const results = await extract(bytes, [1, 5, 10], 'doc', true);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('doc_pages_1-10.pdf');
    const out = await PDFDocument.load(results[0].bytes);
    expect(out.getPageCount()).toBe(3);
  });

  it('produces byte-identical output whether or not a (non-aborted) signal is passed', async () => {
    const bytes = await makePdf(5);
    // pdf-lib stamps CreationDate/ModDate with the real clock at save() time;
    // pin it so two calls a few ms apart can't disagree on that alone. Only
    // Date is faked - checkpoint()'s internal setTimeout must still fire on
    // its own for the awaited promise to resolve.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    try {
      const withoutSignal = await extract(bytes, [1, 3, 5], 'doc', true);
      const withSignal = await extract(bytes, [1, 3, 5], 'doc', true, new AbortController().signal);
      expect(withSignal[0].bytes).toEqual(withoutSignal[0].bytes);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops mid-loop and produces no output when the signal is aborted (groupAsOne)', async () => {
    const bytes = await makePdf(11);
    const pageNums = Array.from({ length: 11 }, (_, i) => i + 1);
    // First checkpoint (before page 0) passes, second (before page 10) aborts.
    await expect(extract(bytes, pageNums, 'doc', true, abortAfter(1))).rejects.toThrow(PdfEditCancelled);
  });

  it('stops mid-loop and produces no output when the signal is aborted (per-page)', async () => {
    const bytes = await makePdf(11);
    const pageNums = Array.from({ length: 11 }, (_, i) => i + 1);
    await expect(extract(bytes, pageNums, 'doc', false, abortAfter(1))).rejects.toThrow(PdfEditCancelled);
  });
});
