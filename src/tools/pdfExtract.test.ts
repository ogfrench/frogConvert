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

/** A 50x50 PNG, inlined so the size guard below needs no fixture on disk. */
const SHARED_PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAADIAAAAyCAYAAAAeP4ixAAAACXBIWXMAAC4jAAAuIwF4pT92AAAA' +
    'aklEQVRo3u3YwQkAMQgEQD3Sf8ueJQj5SJglBWRIYNGsiD57kzW73hePBAQEBAQE5CYny4uAgICA' +
    'gIA8A8ke2Xd3e/laICAgICAg82bvXt+9jQ/beBAQEBAQkHFObF/Hm9lBQEBAQEDm+QF1/A5cLul0' +
    'BAAAAABJRU5ErkJggg=='
  ),
  c => c.charCodeAt(0),
);

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

  it('adds the given rotations to each page, in both modes', async () => {
    const pdf = await makePdf(3);
    const [combined] = await extract(pdf, [1, 3], 'doc', true, undefined, [90, 0]);
    const doc = await PDFDocument.load(combined.bytes);
    expect(doc.getPages().map(p => p.getRotation().angle)).toEqual([90, 0]);

    const separate = await extract(pdf, [2, 3], 'doc', false, undefined, [0, 270]);
    const angles = await Promise.all(separate.map(async r =>
      (await PDFDocument.load(r.bytes)).getPage(0).getRotation().angle));
    expect(angles).toEqual([0, 270]);
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
    // This used to assert `doc_pages_1-10.pdf`, which is what the old
    // first-to-last suffix produced and which promised ten pages inside a
    // three-page file. See `pagesSuffix`.
    expect(results[0].name).toBe('doc_pages_1-5-10.pdf');
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

  it('stops before copying anything when the signal is aborted (groupAsOne)', async () => {
    const bytes = await makePdf(11);
    const pageNums = Array.from({ length: 11 }, (_, i) => i + 1);
    // groupAsOne has exactly one checkpoint - see the size test below for why
    // its copy loop must not be broken up - so the first read is the only
    // chance to abort.
    await expect(extract(bytes, pageNums, 'doc', true, abortAfter(0))).rejects.toThrow(PdfEditCancelled);
  });

  it('does not duplicate a shared image once per page (groupAsOne)', async () => {
    // Regression guard. Copying pages one at a time to checkpoint more often
    // looks harmless but silently inflates the output: pdf-lib builds a fresh
    // object copier per `copyPages` call, so a resource shared by every page -
    // a letterhead logo, a scanned background - gets copied once per page
    // instead of once. Measured at +132% before this was fixed.
    const doc = await PDFDocument.create();
    const img = await doc.embedPng(SHARED_PNG);
    const PAGES = 30;
    for (let i = 0; i < PAGES; i++) {
      doc.addPage([595, 842]).drawImage(img, { x: 40, y: 500, width: 200, height: 200 });
    }
    const bytes = new Uint8Array(await doc.save());

    const pageNums = Array.from({ length: PAGES }, (_, i) => i + 1);
    const [out] = await extract(bytes, pageNums, 'doc', true, new AbortController().signal);

    // Re-emitting every page of a document must not meaningfully grow it.
    // The per-page-copy bug lands at ~2.3x; a correct copy sits at ~1.0x.
    expect(out.bytes.byteLength).toBeLessThan(bytes.byteLength * 1.5);
  });

  it('stops mid-loop and produces no output when the signal is aborted (per-page)', async () => {
    const bytes = await makePdf(11);
    const pageNums = Array.from({ length: 11 }, (_, i) => i + 1);
    await expect(extract(bytes, pageNums, 'doc', false, abortAfter(1))).rejects.toThrow(PdfEditCancelled);
  });
});

describe('extract, on pages that are not there', () => {
  it('names the missing page and the real page count', async () => {
    const bytes = await makePdf(3);
    await expect(extract(bytes, [999], 'doc', true)).rejects.toThrow(
      /Page 999 does not exist in this PDF, which has 3 pages\./,
    );
  });

  it('lists several at once rather than one per attempt', async () => {
    const bytes = await makePdf(3);
    await expect(extract(bytes, [4, 7], 'doc')).rejects.toThrow(/Pages 4, 7 do not exist/);
  });

  it('counts a one-page document in the singular', async () => {
    const bytes = await makePdf(1);
    await expect(extract(bytes, [2], 'doc')).rejects.toThrow(/has 1 page\./);
  });

  it('still extracts the last page, which is in range', async () => {
    const bytes = await makePdf(3);
    const out = await extract(bytes, [3], 'doc');
    expect(out).toHaveLength(1);
  });
});

describe('what a combined output is called', () => {
  // The old suffix was `_pages_${first}-${last}` over the array as given, which
  // is a range whether or not the selection is one.
  it('names a contiguous run as a range', async () => {
    const bytes = await makePdf(9);
    const [out] = await extract(bytes, [2, 3, 4], 'doc', true);
    expect(out.name).toBe('doc_pages_2-4.pdf');
  });

  it('spells out a selection that is not a range', async () => {
    const bytes = await makePdf(9);
    const [out] = await extract(bytes, [1, 5, 9], 'doc', true);
    // Not `_pages_1-9`, which promised nine pages and delivered three.
    expect(out.name).toBe('doc_pages_1-5-9.pdf');
  });

  it('sorts a backwards request rather than naming it backwards', async () => {
    const bytes = await makePdf(9);
    const [out] = await extract(bytes, [9, 1], 'doc', true);
    expect(out.name).toBe('doc_pages_1-9.pdf');
  });

  it('says page, singular, for one page', async () => {
    const bytes = await makePdf(9);
    const [out] = await extract(bytes, [4], 'doc', true);
    expect(out.name).toBe('doc_page_4.pdf');
  });

  it('counts them once the list would be longer than it is useful', async () => {
    const bytes = await makePdf(20);
    const [out] = await extract(bytes, [1, 3, 5, 7, 9, 11, 13], 'doc', true);
    expect(out.name).toBe('doc_7_pages.pdf');
  });

  it('drops the suffix only when the selection really is every page', async () => {
    const bytes = await makePdf(3);
    const [all] = await extract(bytes, [1, 2, 3], 'doc', true);
    expect(all.name).toBe('doc.pdf');
    // Three numbers covering two pages is not the whole document, and used to
    // be named as if it were.
    const [dupes] = await extract(bytes, [1, 1, 2], 'doc', true);
    expect(dupes.name).toBe('doc_pages_1-2.pdf');
  });

  it('keeps copying a page asked for twice, and names the pages present', async () => {
    // Multiplicity is left alone: a caller who asks for a page twice gets it
    // twice, as they always have. The name says which pages are in the file,
    // not how many times each appears - and `_pages_1-2` is true of both.
    const bytes = await makePdf(3);
    const [out] = await extract(bytes, [1, 1, 2], 'doc', true);
    const doc = await PDFDocument.load(out.bytes);
    expect(doc.getPageCount()).toBe(3);
    expect(out.name).toBe('doc_pages_1-2.pdf');
  });
});
