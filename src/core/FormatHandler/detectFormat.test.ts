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

  it('still refuses an extension nothing claims', () => {
    expect(findMatchingFormat([new File(['x'], 'thing.zzz')], options)).toBe(-1);
  });
});
