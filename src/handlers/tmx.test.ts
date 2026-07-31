import { expect, test } from 'vitest';
import CommonFormats from '../core/CommonFormats/CommonFormats.ts';

import { hasXlsx, MISSING_DEPS_REASON } from '../../test/helpers/optionalDeps.ts';

/**
 * `xlsx` is not installable in every environment - see MISSING_DEPS_REASON.
 * Both the handler and the library are imported inside the tests rather than
 * at the top of the file, because a static import of either fails the whole
 * file at transform time instead of skipping it.
 */
async function loadDeps() {
    const specifier = 'xlsx';
    const [tmx, x] = await Promise.all([
        import('./tmx.ts'),
        import(/* @vite-ignore */ specifier),
    ]);
    // CJS interop: the namespace may carry the module object on `default`.
    return { TMXHandler: tmx.default, XLSX: (x as any).default ?? x };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const sampleTmx = `<?xml version="1.0" encoding="UTF-8"?>
<tmx version="1.4">
  <header srclang="en-US" adminlang="en-US" datatype="plaintext"/>
  <body>
    <tu tuid="1">
      <tuv xml:lang="en-US"><seg>Hello &amp; Welcome</seg></tuv>
      <tuv xml:lang="fr-FR"><seg>Bonjour &lt;Bienvenue&gt;</seg></tuv>
    </tu>
    <tu tuid="2">
      <tuv xml:lang="en-US"><seg>Goodbye</seg></tuv>
      <tuv xml:lang="fr-FR"><seg>Au revoir</seg></tuv>
    </tu>
  </body>
</tmx>`;

const tmxFormatIn = CommonFormats.TMX.supported('tmx-to-xlsx', true, false);
const xlsxFormatOut = CommonFormats.XLSX.supported('tmx-to-xlsx', false, true);

const xlsxFormatIn = CommonFormats.XLSX.supported('xlsx-to-tmx', true, false);
const tmxFormatOut = CommonFormats.TMX.supported('xlsx-to-tmx', false, true);

test.skipIf(!hasXlsx)(`TMX handler converts .tmx to .xlsx and back to .tmx (Round-trip) [${MISSING_DEPS_REASON}]`, async () => {
    const { TMXHandler, XLSX } = await loadDeps();
    const handler = new TMXHandler();
    await handler.init();

    // Pass 1: TMX -> XLSX
    const [xlsxOutput] = await handler.doConvert(
        [{ name: 'translations.tmx', bytes: encoder.encode(sampleTmx) }],
        tmxFormatIn,
        xlsxFormatOut
    );

    expect(xlsxOutput.name).toBe('translations.xlsx');
    expect(xlsxOutput.bytes).toBeInstanceOf(Uint8Array);

    // Validate XLSX content structures cleanly mapping escaped fields correctly
    const workbook = XLSX.read(xlsxOutput.bytes, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as string[][];
    expect(rows[0]).toEqual(['en-US', 'fr-FR']);
    expect(rows[1]).toEqual(['Hello & Welcome', 'Bonjour <Bienvenue>']);
    expect(rows[2]).toEqual(['Goodbye', 'Au revoir']);

    // Pass 2: XLSX -> TMX
    const [tmxOutput] = await handler.doConvert(
        [{ name: 'translations.xlsx', bytes: xlsxOutput.bytes }],
        xlsxFormatIn,
        tmxFormatOut
    );

    expect(tmxOutput.name).toBe('translations.tmx');

    // Assert the output accurately re-escapes and binds structural tags correctly!
    const outputXmlString = decoder.decode(tmxOutput.bytes);
    expect(outputXmlString).toContain('<tuv xml:lang="en-US"><seg>Hello &amp; Welcome</seg></tuv>');
    expect(outputXmlString).toContain('<tuv xml:lang="fr-FR"><seg>Bonjour &lt;Bienvenue&gt;</seg></tuv>');
    expect(outputXmlString).toContain('<tuv xml:lang="en-US"><seg>Goodbye</seg></tuv>');
    expect(outputXmlString).toContain('<tuv xml:lang="fr-FR"><seg>Au revoir</seg></tuv>');
});

test.skipIf(!hasXlsx)('TMX handler is registered as a background handler with 4 routing edges', async () => {
    const { TMXHandler } = await loadDeps();
    const handler = new TMXHandler();
    expect(handler.requiresMainThread).toBe(false);
    expect(handler.supportedFormats.length).toBe(4);
});
