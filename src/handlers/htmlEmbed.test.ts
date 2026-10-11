import { describe, it, expect } from 'vitest';
import htmlEmbedHandler from './htmlEmbed.ts';
import CommonFormats from '../core/CommonFormats/CommonFormats.ts';

const PNG = CommonFormats.PNG.supported('png', true, false);
const HTML = CommonFormats.HTML.supported('html', false, true, true);

describe('htmlEmbed', () => {
  it('puts each page image in its own paragraph', async () => {
    // pdf -> pptx/docx routes through here (pdftoimg -> htmlEmbed -> pandoc).
    // Pandoc reads <img><br><img><br> as one paragraph, and its pptx writer
    // turned a 4-page PDF into 2 slides, one empty. One block per image is
    // what makes it emit one slide per page.
    const handler = new htmlEmbedHandler();
    await handler.init();
    const pages = [1, 2, 3, 4].map(n => ({ name: `doc_${n}.png`, bytes: new Uint8Array([n]) }));
    const [out] = await handler.doConvert(pages, PNG, HTML);
    const html = new TextDecoder().decode(out.bytes);
    expect(html.match(/<p><img /g)).toHaveLength(4);
    expect(html).not.toContain('<br>');
    expect(out.name).toBe('doc_1.html');
  });
});
