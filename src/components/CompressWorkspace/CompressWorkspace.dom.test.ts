import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../Toast/Toast.ts', () => ({ showToast: vi.fn() }));

const ws = await import('./CompressWorkspace.ts');
import { showToast } from '../Toast/Toast.ts';

const showToastMock = vi.mocked(showToast);

function mountDom() {
  document.body.innerHTML = `
    <main id="compress-workspace">
      <div id="compress-content"></div>
      <input id="compress-file-input" type="file" multiple>
    </main>
  `;
}

/** jsdom File with a controllable size, so budget logic can be exercised. */
function fakeFile(name: string, type: string, size = 1024): File {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

beforeEach(() => {
  mountDom();
  ws.resetAll();
  showToastMock.mockClear();
  ws.initCompressWorkspace();
});

describe('CompressWorkspace — empty state', () => {
  it('renders a dropzone when no files are loaded', () => {
    expect(document.querySelector('.cw-dropzone')).not.toBeNull();
    expect(document.querySelector('.cw-list')).toBeNull();
  });

  it('states the privacy promise up front', () => {
    expect(document.querySelector('.cw-privacy')?.textContent)
      .toMatch(/never leaves|nothing leaves/i);
  });
});

describe('CompressWorkspace — intake', () => {
  it('accepts image, audio and video files', () => {
    ws.handleFiles([
      fakeFile('a.png', 'image/png'),
      fakeFile('b.mp3', 'audio/mpeg'),
      fakeFile('c.mp4', 'video/mp4'),
    ]);
    expect(ws.getFiles()).toHaveLength(3);
    expect(document.querySelectorAll('.cw-row')).toHaveLength(3);
  });

  it('swaps the dropzone for the file list once files land', () => {
    ws.handleFiles([fakeFile('a.png', 'image/png')]);
    expect(document.querySelector('.cw-dropzone')).toBeNull();
    expect(document.querySelector('.cw-list')).not.toBeNull();
  });

  it('rejects file types it cannot compress and says so', () => {
    ws.handleFiles([fakeFile('notes.txt', 'text/plain')]);
    expect(ws.getFiles()).toHaveLength(0);
    expect(showToastMock).toHaveBeenCalled();
  });

  it('keeps the compressible files out of a mixed drop and warns about the rest', () => {
    ws.handleFiles([fakeFile('a.png', 'image/png'), fakeFile('notes.txt', 'text/plain')]);
    expect(ws.getFiles()).toHaveLength(1);
    expect(showToastMock).toHaveBeenCalled();
  });

  it('does not yet accept PDFs (Phase 2)', () => {
    expect(ws.isLikelyCompressible(fakeFile('doc.pdf', 'application/pdf'))).toBe(false);
  });

  it('removes a file when its remove button is clicked', () => {
    ws.handleFiles([fakeFile('a.png', 'image/png'), fakeFile('b.png', 'image/png')]);
    document.querySelector<HTMLElement>('[data-remove]')!.click();
    expect(ws.getFiles()).toHaveLength(1);
    expect(document.querySelectorAll('.cw-row')).toHaveLength(1);
  });

  it('refuses a batch over the total size budget', () => {
    ws.handleFiles([fakeFile('huge.mp4', 'video/mp4', 600 * 1024 * 1024)]);
    expect(ws.getFiles()).toHaveLength(0);
    expect(showToastMock).toHaveBeenCalled();
  });
});

describe('CompressWorkspace — level picker', () => {
  beforeEach(() => ws.handleFiles([fakeFile('a.png', 'image/png')]));

  it('defaults to the Recommended level', () => {
    expect(ws.getLevel()).toBe('medium');
    expect(document.querySelector('.cw-level.active')?.textContent).toContain('Recommended');
  });

  it('maps user-facing labels to the inverted engine presets', () => {
    // Guards the trap: engine `low` = lowest quality = MOST compression.
    const byLabel = Object.fromEntries(ws.COMPRESS_LEVELS.map(l => [l.label, l.preset]));
    expect(byLabel.Less).toBe('high');
    expect(byLabel.Recommended).toBe('medium');
    expect(byLabel.Extreme).toBe('low');
    expect(byLabel.Lossless).toBe('lossless');
  });

  it('switches level on click and reflects it in the UI', () => {
    document.querySelector<HTMLElement>('[data-level="low"]')!.click();
    expect(ws.getLevel()).toBe('low');
    expect(document.querySelector('.cw-level.active')?.textContent).toContain('Extreme');
  });
});

describe('CompressWorkspace — lifecycle', () => {
  it('keeps the batch across a cleanup/init cycle (mode switch)', () => {
    ws.handleFiles([fakeFile('a.png', 'image/png')]);
    ws.cleanup();
    ws.initCompressWorkspace();
    expect(ws.getFiles()).toHaveLength(1);
    expect(document.querySelectorAll('.cw-row')).toHaveLength(1);
  });

  it('resetAll clears the batch and restores the default level', () => {
    ws.handleFiles([fakeFile('a.png', 'image/png')]);
    document.querySelector<HTMLElement>('[data-level="low"]')!.click();
    ws.resetAll();
    expect(ws.getFiles()).toHaveLength(0);
    expect(ws.getLevel()).toBe('medium');
    expect(document.querySelector('.cw-dropzone')).not.toBeNull();
  });
});
