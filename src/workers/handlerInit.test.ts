import { expect, test } from 'vitest';
import type { FileData, FileFormat, FormatHandler } from '../core/FormatHandler/FormatHandler.ts';
import { ensureHandlerInit } from './handlerInit.ts';

function makeHandler(opts: { initBehavior: () => Promise<void> }): FormatHandler & { initCalls: number } {
  return {
    name: 'stub',
    ready: false,
    initCalls: 0,
    async init() {
      this.initCalls++;
      await opts.initBehavior.call(this);
    },
    async doConvert(_i: FileData[], _from: FileFormat, _to: FileFormat) {
      return [];
    },
  };
}

test('ensureHandlerInit runs init exactly once under concurrent callers', async () => {
  let resolveInit!: () => void;
  const handler = makeHandler({
    initBehavior() {
      return new Promise<void>(r => { resolveInit = r; });
    },
  });

  const p1 = ensureHandlerInit(handler);
  const p2 = ensureHandlerInit(handler);
  const p3 = ensureHandlerInit(handler);
  resolveInit();
  (handler as any).ready = true;
  await Promise.all([p1, p2, p3]);

  expect(handler.initCalls).toBe(1);
});

test('ensureHandlerInit clears the cache when init fails so retry is possible', async () => {
  let shouldFail = true;
  const handler = makeHandler({
    async initBehavior() {
      if (shouldFail) throw new Error('boom');
    },
  });

  await expect(ensureHandlerInit(handler)).rejects.toThrow('boom');

  shouldFail = false;
  await ensureHandlerInit(handler);
  (handler as any).ready = true;

  expect(handler.initCalls).toBe(2);
});

test('ensureHandlerInit is a no-op once handler.ready is true', async () => {
  const handler = makeHandler({ initBehavior: async () => {} });
  (handler as any).ready = true;

  await ensureHandlerInit(handler);
  await ensureHandlerInit(handler);

  expect(handler.initCalls).toBe(0);
});
