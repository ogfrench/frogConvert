import { describe, it, expect } from 'vitest';
import { createPopupButton } from './Popup.ts';

describe('createPopupButton', () => {
  it('runs the action once for a double-click', async () => {
    // A double-click on Download saved two copies, or zipped a batch twice.
    let runs = 0;
    let finish!: () => void;
    const btn = createPopupButton('Download', 'btn-primary', () => {
      runs++;
      return new Promise<void>(r => { finish = r; });
    });
    btn.click();
    btn.click();
    expect(runs).toBe(1);
    finish();
    await Promise.resolve();
    await Promise.resolve();
    // Straight after it finishes is still the same double-click.
    btn.click();
    expect(runs).toBe(1);
  });
});
