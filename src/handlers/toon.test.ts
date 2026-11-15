import { describe, expect, it } from 'vitest';
import ToonHandler from './toon.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

it('preserves prototype-like JSON keys through an untrusted TOON round trip', async () => {
  const handler = new ToonHandler();
  await handler.init();
  const json = handler.supportedFormats!.find(f => f.mime === 'application/json')!;
  const toon = handler.supportedFormats!.find(f => f.mime === 'text/toon')!;
  const input = '{"__proto__":{"polluted":"no"},"constructor":{"prototype":{"isAdmin":true}},"safe":1}';

  const [encoded] = await handler.doConvert(
    [{ name: 'untrusted.json', bytes: encoder.encode(input) }], json, toon,
  );
  const [decoded] = await handler.doConvert([encoded], toon, json);

  expect(JSON.parse(decoder.decode(decoded.bytes))).toEqual(JSON.parse(input));
  expect(Object.prototype).not.toHaveProperty('polluted');
  expect(Object.prototype).not.toHaveProperty('isAdmin');
});
