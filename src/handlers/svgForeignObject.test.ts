import { describe, it, expect } from 'vitest';
import svgForeignObjectHandler, { findPageBreak, printableDocument } from './svgForeignObject.ts';
import CommonFormats from '../core/CommonFormats/CommonFormats.ts';

const HTML = CommonFormats.HTML.supported('html', true, false);
const SVG = CommonFormats.SVG.supported('svg', false, true, true);

async function toSvg(html: string): Promise<string> {
  const handler = new svgForeignObjectHandler();
  await handler.init();
  const [out] = await handler.doConvert([{ name: 'page.html', bytes: new TextEncoder().encode(html) }], HTML, SVG);
  return new TextDecoder().decode(out.bytes);
}

describe('svgForeignObject', () => {
  it('keeps the head stylesheet and the body element (#65)', async () => {
    // It used to keep only body.innerHTML, so every <style> in <head> and the
    // body's class were dropped and the picture came out as bare text.
    const svg = await toSvg(
      '<html><head><style>.card { background: #1f6f43 } :root { --c: red }</style></head>' +
      '<body class="theme"><div class="card">Hi</div></body></html>');
    expect(svg).toContain('.card { background: #1f6f43 }');
    expect(svg).toContain('html { --c: red }');
    expect(svg).toMatch(/<body class="theme">/);
  });

  it('strips external fetches from a stylesheet but keeps its rules', async () => {
    const svg = await toSvg(
      '<html><head><link rel="stylesheet" href="https://example.com/x.css"><style>' +
      '@import url("https://fonts.googleapis.com/css2?family=Inter");' +
      '.bg { background-image: url(https://example.com/t.png) } p { color: blue }' +
      '</style></head><body><p class="bg">x</p></body></html>');
    expect(svg).not.toMatch(/example\.com|googleapis/);
    expect(svg).toContain('p { color: blue }');
  });

  it('strips every attribute that would fetch from another site', async () => {
    const svg = await toSvg(
      '<body background="https://example.com/bg.png"><video poster="https://example.com/p.png"></video>' +
      '<svg><image xlink:href="https://example.com/i.png"/></svg>' +
      '<form action="https://example.com/f"><button formaction="https://example.com/g">x</button></form>' +
      '<a href="#here" ping="https://example.com/ping">a</a>' +
      '<div style="background-image: image-set(\'https://example.com/a.png\' 1x)">x</div>' +
      '<img data-src="//example.com/lazy.png" src="ftp://example.com/f.png"></body>' +
      '<style>.h { background: image-set("https://example.com/b.png" 1x) }</style>');
    expect(svg).not.toMatch(/example\.com/);
  });

  it('does not wait forever on a video that never loads', async () => {
    // A <video> with only a poster fires neither load nor error; waiting on
    // it hung the conversion for good.
    const svg = await toSvg('<body><video poster="data:image/png;base64,AA=="></video><p>after</p></body>');
    expect(svg).toContain('after');
  });

  it('a printed copy stays inert when read back (mutation XSS)', () => {
    const doc = printableDocument('<math><mtext><table><mglyph><style><img src=x onerror="alert(1)"></style></mglyph></table></mtext></math>');
    // Parse it again as the print frame would, and look for live handlers.
    const reparsed = new DOMParser().parseFromString(doc, 'text/html');
    const live = [...reparsed.querySelectorAll('*')].filter(el => [...el.attributes].some(a => a.name.startsWith('on')));
    expect(live).toHaveLength(0);
  });

  it('breaks a page on the lowest flat row in its bottom quarter', () => {
    // 4 px wide, 8 rows: row 6 is flat, rows 5 and 7 have a dark pixel in them.
    const w = 4, h = 8;
    const px = new Uint8ClampedArray(w * h * 4).fill(255);
    for (const y of [5, 7]) px.set([0, 0, 0, 255], (y * w + 2) * 4);
    expect(findPageBreak(px, w, h)).toBe(7);
    // No flat row low enough: break at the page height.
    for (const y of [6]) px.set([0, 0, 0, 255], (y * w + 1) * 4);
    expect(findPageBreak(px, w, h)).toBe(h);
  });

  it('makes a print-ready page: A4, backgrounds on, no Chrome stamps, no scripts', () => {
    const doc = printableDocument(
      '<html><head><style>p{color:red}</style><script>alert(1)</script></head>' +
      '<body onload="x()"><p>Hi</p><img src="https://example.com/t.gif"></body></html>', 'notes');
    expect(doc).toMatch(/^<!doctype html>/);
    expect(doc).toContain('<title>notes</title>');
    expect(doc).toMatch(/@page \{ size: A4; margin: 10mm; @top-left \{ content: ""; \}/);
    expect(doc).toContain('print-color-adjust: exact');
    // Ours first, so the page's own print styles still win.
    expect(doc.indexOf('@page')).toBeLessThan(doc.indexOf('p{color:red}'));
    expect(doc).not.toMatch(/<script|onload|example\.com/);
  });
});
