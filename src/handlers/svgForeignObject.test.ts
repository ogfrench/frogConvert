import { describe, it, expect } from 'vitest';
import svgForeignObjectHandler from './svgForeignObject.ts';
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
});
