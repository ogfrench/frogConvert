import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

// The modern pdfjs-dist build uses JavaScript built-ins newer than several
// supported browsers and the desktop app's Chromium (see
// src/tools/pdfThumbnails.ts). One stray import of it brings that back.
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.(ts|js|mjs)$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [p] : [];
  });
}

describe('pdfjs-dist imports', () => {
  it('disables PDF document scripting at every getDocument call site', () => {
    const offenders: string[] = [];
    let checked = 0;
    for (const file of sourceFiles(resolve(__dirname, '..'))) {
      const text = readFileSync(file, 'utf8');
      if (!text.includes('pdfjs-dist/legacy/build/pdf.mjs')) continue;
      for (const match of text.matchAll(/getDocument\s*\(\s*\{([\s\S]*?)\}\s*\)/g)) {
        checked++;
        if (!/enableScripting\s*:\s*false/.test(match[1])) offenders.push(file);
      }
    }
    expect(checked).toBeGreaterThanOrEqual(5);
    expect(offenders).toEqual([]);
  });

  it('every import uses the legacy build', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(resolve(__dirname, '..'))) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/["']pdfjs-dist(\/[^"']*)?["']/g)) {
        if (!(m[1] ?? '').startsWith('/legacy/')) offenders.push(`${file}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
