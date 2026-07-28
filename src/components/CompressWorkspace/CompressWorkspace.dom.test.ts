import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../Toast/Toast.ts', () => ({ showToast: vi.fn() }));
vi.mock('../../effects/Confetti/Confetti.ts', () => ({ triggerConfetti: vi.fn() }));
vi.mock('../../conversion/workerClient.ts', () => ({ runInWorker: vi.fn() }));
vi.mock('../../conversion/download.ts', () => ({
  downloadFile: vi.fn(),
  downloadAsZip: vi.fn(async () => {}),
  timestampForFilename: () => '20260728-120000',
}));
vi.mock('../../core/FormatHandler/detectFormat.ts', () => ({ findMatchingFormat: vi.fn(() => 0) }));
vi.mock('../../core/compression/compressBatch.ts', async (orig) => ({
  ...(await orig<typeof import('../../core/compression/compressBatch.ts')>()),
  compressBatch: vi.fn(),
}));
vi.mock('../store/store.ts', () => ({
  allOptionsRef: { value: [{ format: { mime: 'image/png', format: 'png' }, handler: { name: 'ImageMagick' } }] },
}));

const ws = await import('./CompressWorkspace.ts');
import { showToast } from '../Toast/Toast.ts';
import { compressBatch } from '../../core/compression/compressBatch.ts';
import { downloadFile, downloadAsZip } from '../../conversion/download.ts';

const showToastMock = vi.mocked(showToast);
const compressBatchMock = vi.mocked(compressBatch);
const downloadFileMock = vi.mocked(downloadFile);
const downloadAsZipMock = vi.mocked(downloadAsZip);

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
  vi.clearAllMocks();
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

describe('CompressWorkspace — running a batch', () => {
  const outcome = (over: Partial<any> = {}) => ({
    name: 'a.png', bytes: new Uint8Array(400), originalSize: 1000, shrunk: true, ...over,
  });

  it('shows a compress action once files are loaded', () => {
    ws.handleFiles([fakeFile('a.png', 'image/png')]);
    expect(document.querySelector('.cw-compress')?.textContent).toContain('Compress 1 file');
  });

  it('renders per-file and total savings after a run', async () => {
    compressBatchMock.mockResolvedValue([outcome()]);
    ws.handleFiles([fakeFile('a.png', 'image/png')]);
    await ws.runCompression();

    expect(ws.getPhase()).toBe('done');
    expect(document.querySelector('.cw-results-headline')?.textContent).toMatch(/Saved/);
    expect(document.querySelector('.cw-results-headline')?.textContent).toMatch(/60% smaller/);
    expect(document.querySelector('.cw-res-pct')?.textContent).toBe('−60%');
  });

  it('passes the chosen level through to the engine', async () => {
    compressBatchMock.mockResolvedValue([outcome()]);
    ws.handleFiles([fakeFile('a.png', 'image/png')]);
    document.querySelector<HTMLElement>('[data-level="low"]')!.click();
    await ws.runCompression();
    expect(compressBatchMock.mock.calls[0][1].level).toBe('low');
  });

  it('explains files that could not be shrunk instead of hiding them', async () => {
    compressBatchMock.mockResolvedValue([
      outcome({ shrunk: false, reason: 'already-minimal', bytes: new Uint8Array(1000) }),
    ]);
    ws.handleFiles([fakeFile('a.png', 'image/png')]);
    await ws.runCompression();
    expect(document.querySelector('.cw-res-note')?.textContent).toContain('already squished');
    expect(document.querySelector('.cw-results-headline')?.textContent).toMatch(/Nothing left to shave/);
  });

  it('downloads a single result directly and a batch as a zip', async () => {
    compressBatchMock.mockResolvedValue([outcome()]);
    ws.handleFiles([fakeFile('a.png', 'image/png')]);
    await ws.runCompression();
    await ws.downloadResults();
    expect(downloadFileMock).toHaveBeenCalled();
    expect(downloadAsZipMock).not.toHaveBeenCalled();

    ws.resetAll();
    compressBatchMock.mockResolvedValue([outcome(), outcome({ name: 'b.png' })]);
    ws.handleFiles([fakeFile('a.png', 'image/png'), fakeFile('b.png', 'image/png')]);
    await ws.runCompression();
    await ws.downloadResults();
    expect(downloadAsZipMock).toHaveBeenCalled();
    expect(downloadAsZipMock.mock.calls[0][1]).toMatch(/^compressed-\d{8}-\d{6}\.zip$/);
  });

  it('starts a new batch when files are added to a finished one', async () => {
    // Regression: render() is phase-driven, so adding files while the results
    // view was up left them invisible.
    compressBatchMock.mockResolvedValue([outcome()]);
    ws.handleFiles([fakeFile('a.png', 'image/png')]);
    await ws.runCompression();
    expect(ws.getPhase()).toBe('done');

    ws.handleFiles([fakeFile('b.png', 'image/png')]);

    expect(ws.getPhase()).toBe('idle');
    expect(document.querySelector('.cw-results-card')).toBeNull();
    expect(document.querySelectorAll('.cw-row')).toHaveLength(2);
  });

  it('refuses to run before the handler registry has loaded', async () => {
    // Regression: an empty option list made every file fail detection and get
    // reported as "can't squish this".
    const store = await import('../store/store.ts');
    const saved = store.allOptionsRef.value;
    store.allOptionsRef.value = [];
    ws.handleFiles([fakeFile('a.png', 'image/png')]);

    await ws.runCompression();

    expect(compressBatchMock).not.toHaveBeenCalled();
    expect(ws.getPhase()).toBe('idle');
    expect(showToastMock).toHaveBeenCalled();
    store.allOptionsRef.value = saved;
  });

  it('can go back to the batch to try another level', async () => {
    compressBatchMock.mockResolvedValue([outcome()]);
    ws.handleFiles([fakeFile('a.png', 'image/png')]);
    await ws.runCompression();
    document.querySelector<HTMLElement>('.cw-back')!.click();
    expect(ws.getPhase()).toBe('idle');
    expect(ws.getFiles()).toHaveLength(1);
    expect(document.querySelector('.cw-compress')).not.toBeNull();
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
