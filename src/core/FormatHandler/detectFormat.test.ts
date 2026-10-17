import { describe, it, expect } from 'vitest';
import { findMatchingFormat } from './detectFormat.ts';
import CommonFormats from '../CommonFormats/CommonFormats.ts';
import type { FormatHandler } from './FormatHandler.ts';

const handler = {} as FormatHandler;
const options = [
  { format: CommonFormats.PNG.supported('png', true, false), handler },
  { format: CommonFormats.HTML.supported('html', true, false), handler },
];

describe('findMatchingFormat', () => {
  it('reads a .htm with no MIME type as HTML', () => {
    // Some drag-and-drop paths send no type; .htm matched nothing and the
    // file was refused as unsupported.
    expect(findMatchingFormat([new File(['<p>x</p>'], 'page.htm')], options)).toBe(1);
    expect(findMatchingFormat([new File(['<p>x</p>'], 'PAGE.HTM')], options)).toBe(1);
  });

  it('reads the other common spellings of a declared extension', () => {
    const opts = [
      { format: CommonFormats.JPEG.supported('jpeg', true, false), handler },
      { format: CommonFormats.TIFF.supported('tiff', true, false), handler },
    ];
    // JPEG declares .jpg; Windows often saves .jfif. TIFF declares .tiff.
    expect(findMatchingFormat([new File(['x'], 'photo.jfif')], opts)).toBe(0);
    expect(findMatchingFormat([new File(['x'], 'scan.TIF')], opts)).toBe(1);
  });

  it('prefers a format that declares the spelling itself over its alias', () => {
    const opts = [
      { format: CommonFormats.HTML.supported('html', true, false), handler },
      { format: { ...CommonFormats.HTML.supported('htm', true, false), extension: 'htm', format: 'legacy-htm' }, handler },
    ];
    expect(findMatchingFormat([new File(['x'], 'page.htm')], opts)).toBe(1);
  });

  it('still refuses an extension nothing claims', () => {
    expect(findMatchingFormat([new File(['x'], 'thing.zzz')], options)).toBe(-1);
  });
});
