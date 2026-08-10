import { describe, it, expect } from 'vitest';
import { checkpoint, PdfEditCancelled } from './cancellation.ts';

describe('checkpoint', () => {
  it('resolves without throwing when no signal is given', async () => {
    await expect(checkpoint()).resolves.toBeUndefined();
  });

  it('resolves without throwing when the signal is not aborted', async () => {
    const controller = new AbortController();
    await expect(checkpoint(controller.signal)).resolves.toBeUndefined();
  });

  it('throws PdfEditCancelled when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(checkpoint(controller.signal)).rejects.toThrow(PdfEditCancelled);
  });
});
