// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { normalizeOoxmlForPandoc } from './ooxmlNormalize.ts';

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function pkg(workbookRels: string): Uint8Array {
  return zipSync({
    '_rels/.rels': strToU8(`<Relationships><Relationship Id="r1" Type="${REL}/officeDocument" Target="/xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8('<workbook/>'),
    'xl/_rels/workbook.xml.rels': strToU8(workbookRels),
    'xl/worksheets/sheet1.xml': strToU8('<worksheet/>'),
  });
}

describe('normalizeOoxmlForPandoc: relationship targets', () => {
  it('rewrites absolute targets the way openpyxl writes them', () => {
    // The form pandoc failed on: "Entry not found: xl//xl/worksheets/sheet1.xml".
    const out = unzipSync(normalizeOoxmlForPandoc(pkg(
      `<Relationships><Relationship Id="rId1" Type="${REL}/worksheet" Target="/xl/worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
    )));
    const rels = strFromU8(out['xl/_rels/workbook.xml.rels']);
    expect(rels).toContain('Target="worksheets/sheet1.xml"');
    expect(rels).toContain('Target="styles.xml"');
    expect(strFromU8(out['_rels/.rels'])).toContain('Target="xl/workbook.xml"');
    expect(strFromU8(out['xl/worksheets/sheet1.xml'])).toBe('<worksheet/>');
  });

  it('walks up for a target outside the source folder', () => {
    const out = unzipSync(normalizeOoxmlForPandoc(pkg(
      `<Relationships><Relationship Id="r" Type="${REL}/custom" Target="/customXml/item1.xml"/></Relationships>`,
    )));
    expect(strFromU8(out['xl/_rels/workbook.xml.rels'])).toContain('Target="../customXml/item1.xml"');
  });

  it('leaves external links alone', () => {
    const rels = `<Relationships><Relationship Id="h" Type="${REL}/hyperlink" Target="/docs/page" TargetMode="External"/></Relationships>`;
    const out = unzipSync(normalizeOoxmlForPandoc(pkg(rels)));
    expect(strFromU8(out['xl/_rels/workbook.xml.rels'])).toContain('Target="/docs/page"');
  });

  it('returns the same bytes when there is nothing to change or it is not a zip', () => {
    const plain = new Uint8Array([1, 2, 3]);
    expect(normalizeOoxmlForPandoc(plain)).toBe(plain);
    const already = zipSync({ 'xl/_rels/workbook.xml.rels': strToU8(`<Relationships><Relationship Id="a" Target="worksheets/sheet1.xml"/></Relationships>`) });
    expect(normalizeOoxmlForPandoc(already)).toBe(already);
  });
});

describe('normalizeOoxmlForPandoc: inline strings', () => {
  const sheet = (cells: string) => strToU8(`<worksheet><sheetData><row r="1">${cells}</row></sheetData></worksheet>`);
  const base = () => ({
    '[Content_Types].xml': strToU8('<Types><Default Extension="xml" ContentType="application/xml"/></Types>'),
    'xl/workbook.xml': strToU8('<workbook/>'),
    'xl/_rels/workbook.xml.rels': strToU8(`<Relationships><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
  });

  it('moves inline string cells into a shared-strings table, the form pandoc reads', () => {
    // openpyxl and pandas write labels as t="inlineStr"; pandoc dropped every
    // one of them and kept only the numbers.
    const out = unzipSync(normalizeOoxmlForPandoc(zipSync({
      ...base(),
      'xl/worksheets/sheet1.xml': sheet(
        '<c r="A1" t="inlineStr"><is><t>Region</t></is></c><c r="B1"><v>10</v></c><c r="C1" t="inlineStr"><is><t>North &amp; South</t></is></c>',
      ),
    })));
    const ws = strFromU8(out['xl/worksheets/sheet1.xml']);
    expect(ws).toContain('<c r="A1" t="s"><v>0</v></c>');
    expect(ws).toContain('<c r="B1"><v>10</v></c>');
    expect(ws).toContain('<c r="C1" t="s"><v>1</v></c>');
    const sst = strFromU8(out['xl/sharedStrings.xml']);
    expect(sst).toContain('<si><t>Region</t></si><si><t>North &amp; South</t></si>');
    expect(strFromU8(out['xl/_rels/workbook.xml.rels'])).toContain('Target="sharedStrings.xml"');
    expect(strFromU8(out['[Content_Types].xml'])).toContain('PartName="/xl/sharedStrings.xml"');
  });

  it('appends to an existing shared-strings table, numbering after its entries', () => {
    const out = unzipSync(normalizeOoxmlForPandoc(zipSync({
      ...base(),
      'xl/sharedStrings.xml': strToU8('<sst count="1" uniqueCount="1"><si><t>Old</t></si></sst>'),
      'xl/worksheets/sheet1.xml': sheet('<c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>New</t></is></c>'),
    })));
    expect(strFromU8(out['xl/worksheets/sheet1.xml'])).toContain('<c r="B1" t="s"><v>1</v></c>');
    expect(strFromU8(out['xl/sharedStrings.xml'])).toBe('<sst><si><t>Old</t></si><si><t>New</t></si></sst>');
  });

  it('leaves an empty self-closing inline cell alone instead of swallowing the next cell', () => {
    const out = unzipSync(normalizeOoxmlForPandoc(zipSync({
      ...base(),
      'xl/worksheets/sheet1.xml': sheet('<c r="A1" t="inlineStr"/><c r="B1" t="inlineStr"><is><t>Kept</t></is></c>'),
    })));
    const ws = strFromU8(out['xl/worksheets/sheet1.xml']);
    expect(ws).toContain('<c r="A1" t="inlineStr"/><c r="B1" t="s"><v>0</v></c>');
    expect(strFromU8(out['xl/sharedStrings.xml'])).toContain('<si><t>Kept</t></si>');
  });
});

describe('normalizeOoxmlForPandoc: memory budget', () => {
  it('passes a package whose declared sizes exceed the budget through untouched, without allocating them', () => {
    const zip = zipSync({
      '_rels/.rels': strToU8('<Relationships><Relationship Id="r1" Target="/word/document.xml"/></Relationships>'),
      'word/document.xml': strToU8('<w:document/>'),
    });
    // Declare 300 MB for document.xml in the central directory, which is what
    // fflate allocates. Without the budget this rewrote the rels and returned
    // a package carrying a 300 MB member.
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    let end = zip.length - 22;
    while (view.getUint32(end, true) !== 0x06054b50) end--;
    let pos = view.getUint32(end + 16, true);
    for (let i = 0; i < view.getUint16(end + 10, true); i++) {
      const nameLength = view.getUint16(pos + 28, true);
      if (strFromU8(zip.subarray(pos + 46, pos + 46 + nameLength)) === 'word/document.xml') {
        view.setUint32(pos + 24, 300 * 1024 * 1024, true);
      }
      pos += 46 + nameLength + view.getUint16(pos + 30, true) + view.getUint16(pos + 32, true);
    }
    expect(normalizeOoxmlForPandoc(zip)).toBe(zip);
  });
});
