import { expect, test } from 'vitest';
import JSZip from 'jszip';
import { FormatDefinition } from '../core/FormatHandler/FormatHandler.ts';
import CommonFormats from '../core/CommonFormats/CommonFormats.ts';
import harHandler from './har.ts';

const encoder = new TextEncoder();
const harFormat = new FormatDefinition(
  'HTTP Archive',
  'har',
  'har',
  'application/har+json',
  'archive'
).supported('har', true, false, true);
const zipFormat = CommonFormats.ZIP.supported('zip', false, true, true);

test('har handler sanitizes zip entry paths against traversal segments', async () => {
  const handler = new harHandler();
  await handler.init();

  const b64 = btoa('pwned');
  const har = {
    log: {
      entries: [
        {
          request: { url: 'http://example.com/../../../etc/passwd' },
          response: { content: { mimeType: 'text/plain', encoding: 'base64', text: b64 } },
        },
        {
          request: { url: 'http://example.com/%2E%2E/%2E%2E/secret' },
          response: { content: { mimeType: 'text/plain', encoding: 'base64', text: b64 } },
        },
        {
          request: { url: 'http://example.com/safe.txt' },
          response: { content: { mimeType: 'text/plain', encoding: 'base64', text: b64 } },
        },
      ],
    },
  };

  const [out] = await handler.doConvert(
    [{ name: 'capture.har', bytes: encoder.encode(JSON.stringify(har)) }],
    harFormat,
    zipFormat,
  );

  const zip = await JSZip.loadAsync(out.bytes);
  const names = Object.keys(zip.files);
  for (const name of names) {
    expect(name).not.toMatch(/(^|\/)\.\.($|\/)/);
    expect(name.startsWith('/')).toBe(false);
    expect(name.startsWith('\\')).toBe(false);
  }
  expect(names.some(n => n.endsWith('safe.txt'))).toBe(true);
});
