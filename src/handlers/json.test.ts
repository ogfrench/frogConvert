import { describe, it, expect } from 'vitest';
import { toJsonHandler, fromJsonHandler } from './json.ts';

const fmt = (h: { supportedFormats: { internal: string }[] }, internal: string) =>
  h.supportedFormats.find(f => f.internal === internal) as never;

async function run(handler: toJsonHandler | fromJsonHandler, from: string, to: string, text: string): Promise<string> {
  const [out] = await handler.doConvert(
    [{ name: `in.${from}`, bytes: new TextEncoder().encode(text) }], fmt(handler, from), fmt(handler, to));
  return new TextDecoder().decode(out.bytes);
}

describe('csv -> json', () => {
  it('keeps the last row when the file does not end in a newline', async () => {
    const out = JSON.parse(await run(new toJsonHandler(), 'csv', 'json', 'Region,Q2\nNorth,10\nSouth,8'));
    expect(out).toEqual([{ Region: 'North', Q2: '10' }, { Region: 'South', Q2: '8' }]);
  });

  it('ignores trailing blank lines', async () => {
    const out = JSON.parse(await run(new toJsonHandler(), 'csv', 'json', 'a,b\n1,2\r\n\r\n'));
    expect(out).toEqual([{ a: '1', b: '2' }]);
  });
});

describe('json -> csv', () => {
  it('keeps the columns in their original order', async () => {
    const out = await run(new fromJsonHandler(), 'json', 'csv', JSON.stringify([{ Region: 'North', Q2: 10, Q3: 12 }]));
    expect(out.split('\n')[0]).toBe('Region,Q2,Q3');
  });
});
