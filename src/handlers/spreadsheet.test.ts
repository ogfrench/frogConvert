// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import SpreadsheetHandler from './spreadsheet.ts';

// Written by openpyxl: absolute relationship targets and inline strings.
const SHEET = new Uint8Array(readFileSync(resolve(__dirname, '../../test/resources/sheet.xlsx')));
const handler = new SpreadsheetHandler();
const fmt = (internal: string) => handler.supportedFormats.find(f => f.internal === internal)!;

async function convert(to: string): Promise<string> {
  const [out] = await handler.doConvert([{ name: 'sheet.xlsx', bytes: SHEET }], fmt('xlsx'), fmt(to));
  expect(out.name).toBe(`sheet.${to}`);
  return new TextDecoder().decode(out.bytes);
}

describe('spreadsheet', () => {
  it('xlsx -> csv gives the cell values in sheet order', async () => {
    expect(await convert('csv')).toBe('Region,Q2,Q3\nNorth,10,12\nSouth,8,9');
  });

  it('xlsx -> json gives one object per row, keyed by the header', async () => {
    expect(JSON.parse(await convert('json'))).toEqual([
      { Region: 'North', Q2: 10, Q3: 12 },
      { Region: 'South', Q2: 8, Q3: 9 },
    ]);
  });
});
