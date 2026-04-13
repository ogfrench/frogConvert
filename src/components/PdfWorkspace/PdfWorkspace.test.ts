import { vi, describe, it, expect } from 'vitest';

// Mock pdfjs-dist to avoid DOMMatrix error in jsdom
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: vi.fn(),
}));

import { parsePageRange, setToRangeString } from './PdfWorkspace.ts';

describe('parsePageRange', () => {
  it('parses a basic range "1-5"', () => {
    const result = parsePageRange('1-5', 10);
    expect(result).toEqual(new Set([1, 2, 3, 4, 5]));
  });

  it('parses individual pages "1, 3, 5"', () => {
    const result = parsePageRange('1, 3, 5', 10);
    expect(result).toEqual(new Set([1, 3, 5]));
  });

  it('parses mixed ranges and pages "1-5, 8"', () => {
    const result = parsePageRange('1-5, 8', 10);
    expect(result).toEqual(new Set([1, 2, 3, 4, 5, 8]));
  });

  it('returns null for page below minimum (0)', () => {
    expect(parsePageRange('0-5', 10)).toBeNull();
  });

  it('returns null for page above maximum', () => {
    expect(parsePageRange('1-11', 10)).toBeNull();
  });

  it('returns null for reversed range "5-3"', () => {
    expect(parsePageRange('5-3', 10)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parsePageRange('', 10)).toBeNull();
  });

  it('returns null for non-numeric input', () => {
    expect(parsePageRange('abc', 10)).toBeNull();
  });
});

describe('setToRangeString', () => {
  it('collapses contiguous indices into ranges', () => {
    // Indices are 0-based, output is 1-based
    const selected = new Set([0, 1, 2, 4]);
    expect(setToRangeString(selected, 10)).toBe('1-3, 5');
  });

  it('returns empty string for empty set', () => {
    expect(setToRangeString(new Set(), 10)).toBe('');
  });

  it('returns "1-N" when all are selected', () => {
    const all = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(setToRangeString(all, 10)).toBe('1-10');
  });

  it('handles a single selected page', () => {
    expect(setToRangeString(new Set([3]), 10)).toBe('4');
  });

  it('handles non-contiguous single pages', () => {
    expect(setToRangeString(new Set([0, 5, 9]), 10)).toBe('1, 6, 10');
  });
});
