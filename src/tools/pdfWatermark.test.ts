import { describe, it, expect, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  watermark,
  hexToRgb,
  detectImageMime,
  placementCoords,
  tilePositions,
  WatermarkValidationError,
  type PdfWatermarkOptions,
} from './pdfWatermark.ts';
import { PdfEditCancelled } from './cancellation.ts';

/** AbortSignal-like that reports aborted only after its `aborted` getter has
 *  been read more than `n` times - lets a test cancel mid-loop deterministically. */
function abortAfter(n: number): AbortSignal {
  let reads = 0;
  return { get aborted() { return ++reads > n; } } as AbortSignal;
}

// Tiny 1x1 transparent PNG (67 bytes).
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// Smallest valid JPEG (~125 bytes, 1x1 white).
const TINY_JPEG_B64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQBAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhADEAAAAAA//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQI//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwE//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwE//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwI//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyE//9oADAMBAAIAAwAAABAP/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxA//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxA//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA//9k=';

const b64ToBytes = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

async function makePdf(pageCount: number, sizes?: Array<[number, number]>): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    const size = sizes?.[i] ?? [612, 792];
    doc.addPage(size);
  }
  return new Uint8Array(await doc.save());
}

const baseTextOpts: PdfWatermarkOptions = {
  source: { type: 'text', text: 'CONFIDENTIAL', fontSize: 64, color: { r: 0.5, g: 0.5, b: 0.5 } },
  opacity: 0.2,
  rotationDegrees: -45,
  pageNums: [1],
};

describe('hexToRgb', () => {
  it('parses #FFFFFF as white', () => {
    expect(hexToRgb('#FFFFFF')).toEqual({ r: 1, g: 1, b: 1 });
  });

  it('parses #000000 as black', () => {
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('parses #808080 as ~0.502 grey', () => {
    const rgb = hexToRgb('#808080');
    expect(rgb.r).toBeCloseTo(128 / 255, 3);
    expect(rgb.g).toBeCloseTo(128 / 255, 3);
    expect(rgb.b).toBeCloseTo(128 / 255, 3);
  });

  it('expands #RGB shorthand', () => {
    expect(hexToRgb('#fff')).toEqual({ r: 1, g: 1, b: 1 });
    expect(hexToRgb('#000')).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('accepts hex without leading #', () => {
    expect(hexToRgb('FFFFFF')).toEqual({ r: 1, g: 1, b: 1 });
  });

  it('rejects 4-char hex', () => {
    expect(() => hexToRgb('#8080')).toThrow(WatermarkValidationError);
  });

  it('rejects non-hex chars', () => {
    expect(() => hexToRgb('xyz')).toThrow(WatermarkValidationError);
    expect(() => hexToRgb('#ZZZZZZ')).toThrow(WatermarkValidationError);
  });
});

describe('detectImageMime', () => {
  it('detects PNG by 8-byte signature', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    expect(detectImageMime(png)).toBe('image/png');
  });

  it('detects JPEG by 3-byte signature', () => {
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0]);
    expect(detectImageMime(jpg)).toBe('image/jpeg');
  });

  it('returns null for unknown bytes', () => {
    expect(detectImageMime(new Uint8Array([0, 0, 0, 0]))).toBeNull();
    expect(detectImageMime(new Uint8Array([]))).toBeNull();
  });

  it('detects PNG in fixture', () => {
    expect(detectImageMime(b64ToBytes(TINY_PNG_B64))).toBe('image/png');
  });

  it('detects JPEG in fixture', () => {
    expect(detectImageMime(b64ToBytes(TINY_JPEG_B64))).toBe('image/jpeg');
  });
});

describe('placementCoords', () => {
  const args = { pageW: 600, pageH: 800, wmW: 200, wmH: 100, margin: 36 };

  it('center anchors at page center minus half-bbox', () => {
    expect(placementCoords({ ...args, placement: 'center' })).toEqual({ x: 200, y: 350 });
  });

  it('top-left at margin, top edge', () => {
    expect(placementCoords({ ...args, placement: 'top-left' })).toEqual({ x: 36, y: 664 });
  });

  it('top-right at right edge minus bbox, top edge', () => {
    expect(placementCoords({ ...args, placement: 'top-right' })).toEqual({ x: 364, y: 664 });
  });

  it('bottom-left at both margins', () => {
    expect(placementCoords({ ...args, placement: 'bottom-left' })).toEqual({ x: 36, y: 36 });
  });

  it('bottom-right at right edge minus bbox', () => {
    expect(placementCoords({ ...args, placement: 'bottom-right' })).toEqual({ x: 364, y: 36 });
  });
});

describe('tilePositions', () => {
  it('returns at least one position for any sane page', () => {
    const out = tilePositions({ pageW: 600, pageH: 800, wmW: 200, wmH: 100, rotationDegrees: 0 });
    expect(out.length).toBeGreaterThan(0);
  });

  it('produces more tiles for a larger page given fixed watermark size', () => {
    const small = tilePositions({ pageW: 400, pageH: 400, wmW: 100, wmH: 50, rotationDegrees: 0 });
    const big = tilePositions({ pageW: 1200, pageH: 1200, wmW: 100, wmH: 50, rotationDegrees: 0 });
    expect(big.length).toBeGreaterThan(small.length);
  });

  it('produces more tiles when rotated 0° than when rotated 45° (smaller AABB)', () => {
    const flat = tilePositions({ pageW: 800, pageH: 800, wmW: 200, wmH: 50, rotationDegrees: 0 });
    const tilted = tilePositions({ pageW: 800, pageH: 800, wmW: 200, wmH: 50, rotationDegrees: 45 });
    // 45°-rotated text has a larger AABB, so fewer tiles fit.
    expect(flat.length).toBeGreaterThan(tilted.length);
  });

  it('returns finite x/y for every tile', () => {
    const out = tilePositions({ pageW: 600, pageH: 800, wmW: 200, wmH: 100, rotationDegrees: -45 });
    for (const p of out) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });
});

describe('watermark()', () => {
  it('stamps text on every page when pageNums covers all', async () => {
    const bytes = await makePdf(5);
    const result = await watermark(bytes, 'doc.pdf', {
      ...baseTextOpts,
      pageNums: [1, 2, 3, 4, 5],
    });
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    const reloaded = await PDFDocument.load(new Uint8Array(result.bytes));
    expect(reloaded.getPageCount()).toBe(5);
  });

  it('stamps only the selected page subset', async () => {
    const bytes = await makePdf(5);
    const result = await watermark(bytes, 'doc.pdf', { ...baseTextOpts, pageNums: [1, 3] });
    const reloaded = await PDFDocument.load(new Uint8Array(result.bytes));
    expect(reloaded.getPageCount()).toBe(5);
  });

  it('handles mixed page sizes', async () => {
    const bytes = await makePdf(3, [[612, 792], [400, 600], [800, 400]]);
    const result = await watermark(bytes, 'doc.pdf', { ...baseTextOpts, pageNums: [1, 2, 3] });
    const reloaded = await PDFDocument.load(new Uint8Array(result.bytes));
    expect(reloaded.getPageCount()).toBe(3);
  });

  it('produces filename "<base>_watermarked.pdf"', async () => {
    const bytes = await makePdf(1);
    const result = await watermark(bytes, 'report.pdf', baseTextOpts);
    expect(result.name).toBe('report_watermarked.pdf');
  });

  it('handles names without extension', async () => {
    const bytes = await makePdf(1);
    const result = await watermark(bytes, 'noext', baseTextOpts);
    expect(result.name).toBe('noext_watermarked.pdf');
  });

  it('defaults to every page when pageNums is omitted', async () => {
    const bytes = await makePdf(4);
    const omitted: PdfWatermarkOptions = {
      source: { type: 'text', text: 'X', fontSize: 32, color: { r: 0, g: 0, b: 0 } },
      opacity: 0.5,
      rotationDegrees: 0,
    };
    const result = await watermark(bytes, 'd.pdf', omitted);
    const reloaded = await PDFDocument.load(new Uint8Array(result.bytes));
    expect(reloaded.getPageCount()).toBe(4);
  });

  it('treats empty pageNums as "all pages"', async () => {
    const bytes = await makePdf(3);
    const result = await watermark(bytes, 'd.pdf', { ...baseTextOpts, pageNums: [] });
    const reloaded = await PDFDocument.load(new Uint8Array(result.bytes));
    expect(reloaded.getPageCount()).toBe(3);
  });

  it('rejects out-of-range pageNums', async () => {
    const bytes = await makePdf(3);
    await expect(watermark(bytes, 'd.pdf', { ...baseTextOpts, pageNums: [99] }))
      .rejects.toThrow(/page 99/);
    await expect(watermark(bytes, 'd.pdf', { ...baseTextOpts, pageNums: [0] }))
      .rejects.toThrow(/page 0/);
  });

  it('rejects empty text in text mode', async () => {
    const bytes = await makePdf(1);
    await expect(watermark(bytes, 'd.pdf', {
      ...baseTextOpts,
      source: { type: 'text', text: '', fontSize: 64, color: { r: 0, g: 0, b: 0 } },
    })).rejects.toThrow(/non-empty text/);
  });

  it('rejects opacity outside [0, 1]', async () => {
    const bytes = await makePdf(1);
    await expect(watermark(bytes, 'd.pdf', { ...baseTextOpts, opacity: 1.5 }))
      .rejects.toThrow(/opacity/);
    await expect(watermark(bytes, 'd.pdf', { ...baseTextOpts, opacity: -0.1 }))
      .rejects.toThrow(/opacity/);
  });

  it('stamps a PNG image watermark', async () => {
    const bytes = await makePdf(1);
    const png = b64ToBytes(TINY_PNG_B64);
    const result = await watermark(bytes, 'd.pdf', {
      source: { type: 'image', imageBytes: png, scale: 0.3 },
      opacity: 0.5,
      rotationDegrees: 0,
      pageNums: [1],
    });
    const reloaded = await PDFDocument.load(new Uint8Array(result.bytes));
    expect(reloaded.getPageCount()).toBe(1);
  });

  it('rejects image bytes that are not actually PNG/JPEG', async () => {
    const bytes = await makePdf(1);
    const fake = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    await expect(watermark(bytes, 'd.pdf', {
      source: { type: 'image', imageBytes: fake, scale: 0.3 },
      opacity: 0.2, rotationDegrees: 0, pageNums: [1],
    })).rejects.toThrow(WatermarkValidationError);
  });

  it('repeat: true tiles the watermark and produces more drawing than single', async () => {
    const bytes = await makePdf(1);
    const single = await watermark(bytes, 'd.pdf', { ...baseTextOpts, repeat: false });
    const tiled = await watermark(bytes, 'd.pdf', { ...baseTextOpts, repeat: true });
    // Tiled output should have more drawing operations, so .save() bytes are
    // strictly larger. The assertion is loose to tolerate compression noise.
    expect(tiled.bytes.byteLength).toBeGreaterThan(single.bytes.byteLength);
    const reloaded = await PDFDocument.load(new Uint8Array(tiled.bytes));
    expect(reloaded.getPageCount()).toBe(1);
  });

  it('rejects non-boolean repeat', async () => {
    const bytes = await makePdf(1);
    await expect(watermark(bytes, 'd.pdf', { ...baseTextOpts, repeat: 'yes' as any }))
      .rejects.toThrow(/repeat/);
  });

  it('rejects scale out of (0, 1]', async () => {
    const bytes = await makePdf(1);
    const png = b64ToBytes(TINY_PNG_B64);
    await expect(watermark(bytes, 'd.pdf', {
      source: { type: 'image', imageBytes: png, scale: 0 },
      opacity: 0.2, rotationDegrees: 0, pageNums: [1],
    })).rejects.toThrow(/scale/);
    await expect(watermark(bytes, 'd.pdf', {
      source: { type: 'image', imageBytes: png, scale: 1.5 },
      opacity: 0.2, rotationDegrees: 0, pageNums: [1],
    })).rejects.toThrow(/scale/);
  });

  it('produces byte-identical output whether or not a (non-aborted) signal is passed', async () => {
    const bytes = await makePdf(1);
    // pdf-lib stamps CreationDate/ModDate with the real clock at save() time;
    // pin it so two calls a few ms apart can't disagree on that alone. Only
    // Date is faked - checkpoint()'s internal setTimeout must still fire on
    // its own for the awaited promise to resolve.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    try {
      const withoutSignal = await watermark(bytes, 'd.pdf', baseTextOpts);
      const withSignal = await watermark(bytes, 'd.pdf', baseTextOpts, new AbortController().signal);
      expect(withSignal.bytes).toEqual(withoutSignal.bytes);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops mid-loop and produces no output when the signal is aborted', async () => {
    const bytes = await makePdf(11);
    const opts = { ...baseTextOpts, pageNums: Array.from({ length: 11 }, (_, i) => i + 1) };
    // First checkpoint (before page 1) passes, second (before page 11) aborts.
    await expect(watermark(bytes, 'd.pdf', opts, abortAfter(1))).rejects.toThrow(PdfEditCancelled);
  });
});
