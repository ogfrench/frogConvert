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

  const toXlsx = async (from: string, name: string, text: string) => {
    const [out] = await handler.doConvert([{ name, bytes: new TextEncoder().encode(text) }], fmt(from), fmt('xlsx'));
    expect(out.name).toBe(name.replace(/\.\w+$/, '.xlsx'));
    return out.bytes;
  };

  it('csv -> xlsx writes a workbook that reads back to the same cells', async () => {
    const bytes = await toXlsx('csv', 'table.csv', 'Region,Q2\nNorth,10\nSouth,8');
    expect(new TextDecoder('latin1').decode(bytes.subarray(0, 2))).toBe('PK');
    const [back] = await handler.doConvert([{ name: 'table.xlsx', bytes }], fmt('xlsx'), fmt('csv'));
    expect(new TextDecoder().decode(back.bytes)).toBe('Region,Q2\nNorth,10\nSouth,8');
  });

  it('json -> xlsx takes a list of objects, keyed by header', async () => {
    const bytes = await toXlsx('json', 'rows.json', '[{"Region":"North","Q2":10},{"Region":"South","Q2":8}]');
    const [back] = await handler.doConvert([{ name: 'rows.xlsx', bytes }], fmt('xlsx'), fmt('json'));
    expect(JSON.parse(new TextDecoder().decode(back.bytes))).toEqual([{ Region: 'North', Q2: 10 }, { Region: 'South', Q2: 8 }]);
  });

  it('json -> xlsx refuses data that is not a table, with a message that says how to fix it', async () => {
    await expect(toXlsx('json', 'x.json', '{"a":1}')).rejects.toThrow(/list of objects/);
    await expect(toXlsx('json', 'x.json', 'not json')).rejects.toThrow(/could not be read/);
  });
});
