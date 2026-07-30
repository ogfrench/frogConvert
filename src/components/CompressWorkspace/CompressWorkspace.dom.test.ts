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
vi.mock('../store/store.ts', () => {
  // Stateful stub: the surface reads and writes its own persisted level.
  const compressLevel = { value: 'medium' as 'high' | 'medium' | 'low' };
  // Progress runs in the shared conversion modal, which reaches for these two
  // elements. Resolved per access rather than cached, because mountDom()
  // rebuilds the document before every test. Deliberately the real elements
  // and the real cancellation module: the point of these tests is that the
  // modal genuinely says the right things, not that a spy was called.
  const POPUP_SELECTORS: Record<string, string> = {
    popupBox: '#popup',
    popupBackground: '#popup-bg',
  };
  return {
    ui: new Proxy({} as Record<string, HTMLElement | null>, {
      get: (_, prop: string) =>
        POPUP_SELECTORS[prop] ? document.querySelector(POPUP_SELECTORS[prop]) : undefined,
    }),
    // Pulled in by ModalManager when the progress modal opens.
    updateScrollLock: () => { /* no layout to lock in jsdom */ },
    allOptionsRef: { value: [{ format: { mime: 'image/png', format: 'png' }, handler: { name: 'ImageMagick' } }] },
    compressLevel,
    setCompressLevel: (q: 'high' | 'medium' | 'low') => { compressLevel.value = q; },
    COMPRESS_LEVEL_CHOICES: [
      { value: 'auto', label: 'Automatic', blurb: 'Reads each file.' },
      { value: 'high', label: 'High quality', blurb: 'Modest savings.' },
      { value: 'medium', label: 'Balanced', blurb: 'Recommended.' },
      { value: 'low', label: 'Smallest file', blurb: 'Visible quality loss.' },
    ],
  };
});

const ws = await import('./CompressWorkspace.ts');
import { showToast } from '../Toast/Toast.ts';
import { compressBatch } from '../../core/compression/compressBatch.ts';
import { downloadFile, downloadAsZip } from '../../conversion/download.ts';

const showToastMock = vi.mocked(showToast);
const compressBatchMock = vi.mocked(compressBatch);
const downloadFileMock = vi.mocked(downloadFile);
const downloadAsZipMock = vi.mocked(downloadAsZip);

function mountDom() {
  // Mirrors index.html, including the page description that sits *outside* the
  // card — the copy tests below only mean something if both are present.
  document.body.innerHTML = `
    <main id="compress-workspace">
      <nav id="compress-category-tabs" class="tab-bar">
        <button class="cat-tab active" data-accept="" aria-pressed="true">Any</button>
        <button class="cat-tab" data-accept="image/*" aria-pressed="false">Image</button>
        <button class="cat-tab" data-accept="audio/*" aria-pressed="false">Audio</button>
        <button class="cat-tab" data-accept="video/*" aria-pressed="false">Video</button>
        <button class="cat-tab" data-accept="application/pdf,.pdf" aria-pressed="false">PDF</button>
      </nav>
      <div id="compress-card" class="card-base">
        <div id="compress-content"></div>
      </div>
      <input id="compress-file-input" type="file" multiple>
    </main>
    <p id="compress-description">Make files smaller without sending them anywhere.
      Images, audio, video and PDFs, right here in your browser.</p>
    <div id="popup-bg" class="modal-overlay" aria-hidden="true"></div>
    <div id="popup" class="card-base modal-container popup-size"
      role="status" aria-live="polite" aria-atomic="true"></div>
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
    expect(document.querySelector('.upload-zone')).not.toBeNull();
    expect(document.querySelector('.upload-file-info.visible')).toBeNull();
  });

  it('states the privacy promise exactly once', () => {
    // The card used to repeat it directly above the page description —
    // "Nothing leaves your device" stacked on "without sending them anywhere".
    // Said twice in a row it reads as padding, not reassurance.
    const page = document.body.textContent ?? '';
    const promises = page.match(/leaves? your device|without sending them anywhere/gi) ?? [];
    expect(promises).toHaveLength(1);
    expect(page).toMatch(/without sending them anywhere/i);
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

  it('shows the file-info row and its actions once files land', () => {
    ws.handleFiles([fakeFile('a.png', 'image/png')]);
    // Same drop target as the convert card, switched to its has-file state.
    expect(document.querySelector('.upload-zone.has-file')).not.toBeNull();
    expect(document.querySelector('.upload-file-info.visible')).not.toBeNull();
    expect(document.querySelector('.cw-manage')).not.toBeNull();
    expect(document.querySelector('.cw-replace')).not.toBeNull();
    expect(document.querySelector('.cw-clear')).not.toBeNull();
  });

  it('toggles the file list from the manage button', () => {
    ws.handleFiles([fakeFile('a.png', 'image/png')]);
    expect(document.querySelector<HTMLElement>('.cw-list')!.hidden).toBe(true);
    document.querySelector<HTMLElement>('.cw-manage')!.click();
    expect(document.querySelector<HTMLElement>('.cw-list')!.hidden).toBe(false);
  });

  it('clears the batch from the remove-all button', () => {
    ws.handleFiles([fakeFile('a.png', 'image/png'), fakeFile('b.png', 'image/png')]);
    document.querySelector<HTMLElement>('.cw-clear')!.click();
    expect(ws.getFiles()).toHaveLength(0);
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

  it('accepts PDFs', () => {
    expect(ws.isLikelyCompressible(fakeFile('doc.pdf', 'application/pdf'))).toBe(true);
  });

  it('accepts a PDF whose mime the browser left blank', () => {
    // File pickers on some platforms hand over an empty type; refusing those
    // would tell the user we cannot compress a PDF we can.
    expect(ws.isLikelyCompressible(fakeFile('doc.pdf', ''))).toBe(true);
    expect(ws.isLikelyCompressible(fakeFile('doc.PDF', ''))).toBe(true);
  });

  it('still refuses an unknown type with no mime', () => {
    expect(ws.isLikelyCompressible(fakeFile('mystery.bin', ''))).toBe(false);
  });

  it('removes a file when its remove button is clicked', () => {
    ws.handleFiles([fakeFile('a.png', 'image/png'), fakeFile('b.png', 'image/png')]);
    document.querySelector<HTMLElement>('.cw-manage')!.click();
    document.querySelector<HTMLElement>('[data-remove]')!.click();
    expect(ws.getFiles()).toHaveLength(1);
    expect(document.querySelectorAll('.cw-row')).toHaveLength(1);
  });

  it('accepts a single large video, which is the case people actually arrive with', () => {
    // The old flat 500 MB batch cap refused this to guard against a batch of
    // them. Inputs are read one at a time now, so one big file is fine.
    ws.handleFiles([fakeFile('holiday.mp4', 'video/mp4', 900 * 1024 * 1024)]);
    expect(ws.getFiles()).toHaveLength(1);
  });

  it('warns about a big file rather than silently starting a long job', () => {
    ws.handleFiles([fakeFile('holiday.mp4', 'video/mp4', 900 * 1024 * 1024)]);
    const said = showToastMock.mock.calls.map(c => String(c[0])).join(' ');
    expect(said).toMatch(/big one|stop any time/i);
  });

  it('refuses a file larger than an engine can hold at once', () => {
    // A real limit, not a policy one: the engines are 32-bit WASM builds.
    ws.handleFiles([fakeFile('raw.mov', 'video/mp4', 3 * 1024 * 1024 * 1024)]);
    expect(ws.getFiles()).toHaveLength(0);
    const said = showToastMock.mock.calls.map(c => String(c[0])).join(' ');
    expect(said).toMatch(/engines can hold/i);
  });

  it('takes the files that fit and says the batch is full, rather than dropping the lot', () => {
    // 5 GB of 800 MB files exceeds any device budget; partial intake beats
    // refusing everything.
    ws.handleFiles(Array.from({ length: 7 },
      (_, i) => fakeFile(`v${i}.mp4`, 'video/mp4', 800 * 1024 * 1024)));
    expect(ws.getFiles().length).toBeGreaterThan(0);
    expect(ws.getFiles().length).toBeLessThan(7);
    const said = showToastMock.mock.calls.map(c => String(c[0])).join(' ');
    expect(said).toMatch(/as big as this device can take/i);
  });
});

describe('CompressWorkspace — level picker', () => {
  beforeEach(() => ws.handleFiles([fakeFile('a.png', 'image/png')]));

  it('defaults to Automatic, the same default a fresh install gets', () => {
    // resetAll() used to drop the user on Balanced while a first-time visitor
    // started on Automatic, so "reset" moved you somewhere new.
    expect(ws.DEFAULT_LEVEL).toBe('auto');
    expect(ws.getLevel()).toBe('auto');
    expect(document.querySelector('.cw-level-selector .selector-text')?.textContent).toContain('Automatic');
  });

  it('maps user-facing labels to the inverted engine presets', () => {
    // Guards the trap: engine `low` = lowest quality = MOST compression.
    const byLabel = Object.fromEntries(ws.COMPRESS_LEVELS.map(l => [l.label, l.value]));
    expect(byLabel['High quality']).toBe('high');
    expect(byLabel['Balanced']).toBe('medium');
    expect(byLabel['Smallest file']).toBe('low');
  });

  it('does not offer a lossless level', () => {
    // Lossless targets quality 100 with no resize, so a re-encode of an
    // already-compressed file comes back larger and the keep-threshold
    // discards it - the level would reliably do nothing.
    expect(ws.COMPRESS_LEVELS.map(l => l.value)).not.toContain('lossless');
    expect(document.querySelector('[data-level="lossless"]')).toBeNull();
  });

  it('switches level on click and reflects it in the UI', () => {
    document.querySelector<HTMLElement>('.cw-level-selector')!.click();
    document.querySelector<HTMLElement>('[data-level="low"]')!.click();
    expect(ws.getLevel()).toBe('low');
    expect(document.querySelector('.cw-level-selector .selector-text')?.textContent).toContain('Smallest file');
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
    document.querySelector<HTMLElement>('.cw-level-selector')!.click();
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
    expect(document.querySelector('.cw-res-note')?.textContent).toContain('already compressed');
    expect(document.querySelector('.cw-results-headline')?.textContent).toMatch(/No smaller at this level/);
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
    // reported as "can't compress this".
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
    document.querySelector<HTMLElement>('.cw-level-selector')!.click();
    document.querySelector<HTMLElement>('[data-level="low"]')!.click();
    ws.resetAll();
    expect(ws.getFiles()).toHaveLength(0);
    expect(ws.getLevel()).toBe(ws.DEFAULT_LEVEL);
    expect(ws.getLevel()).toBe('auto');
    expect(document.querySelector('.upload-zone')).not.toBeNull();
  });
});

describe('CompressWorkspace — assistive technology', () => {
  /** Start a run that never settles, so the surface stays in the running phase. */
  async function startStalledRun(files = ['a.png', 'b.png', 'c.png']) {
    let emit: ((done: number, total: number, current: string) => void) | undefined;
    compressBatchMock.mockImplementation((async (_files: any, opts: any) => {
      emit = opts.onProgress;
      return new Promise(() => { /* never settles */ });
    }) as any);
    ws.handleFiles(files.map(n => fakeFile(n, 'image/png')));
    void ws.runCompression();
    // runCompression reads each file's bytes before it reaches compressBatch,
    // so wait for the real task queue rather than a single microtask.
    for (let i = 0; i < 20 && !emit; i++) await new Promise(r => setTimeout(r, 0));
    return { emit: (done: number, total: number, current: string) => emit!(done, total, current) };
  }

  it('runs its progress in the shared conversion modal, not inside the card', async () => {
    await startStalledRun();
    const popup = document.getElementById('popup')!;
    expect(popup.classList.contains('open')).toBe(true);
    // The modal is itself the polite live region (see #popup in index.html),
    // which is how the Converter announces progress too. Without it a
    // screen-reader user gets silence for the whole run.
    expect(popup.getAttribute('aria-live')).toBe('polite');
    expect(popup.getAttribute('aria-atomic')).toBe('true');
    expect(popup.querySelector('.loader-spinner, .loader-gooey')).not.toBeNull();
    // The card behind it keeps the file list, so Stop reveals the batch
    // exactly where it was rather than an empty panel.
    expect(document.querySelector('.upload-zone')).not.toBeNull();
  });

  it('offers Stop from the modal, with copy that does not promise a mid-file abort', async () => {
    await startStalledRun();
    const cancel = document.getElementById('cancel-conversion-btn');
    expect(cancel).not.toBeNull();
    expect(cancel!.textContent).toBe('Cancel compression');
  });

  it('announces which file is being compressed as the batch advances', async () => {
    const { emit } = await startStalledRun();
    const popup = document.getElementById('popup')!;
    expect(popup.querySelector('h2')!.textContent).toBe('Compressing your files');

    emit(1, 3, 'b.png');
    const message = popup.querySelector('p')!;
    // `done` counts finished files, so file 2 is the one being worked on.
    expect(message.textContent).toContain('file 2 of 3');
    expect(message.textContent).toContain('b.png');
  });

  it('takes the modal down when the batch settles', async () => {
    compressBatchMock.mockResolvedValue([
      { name: 'a.png', bytes: new Uint8Array(400), originalSize: 1000, shrunk: true },
    ] as any);
    ws.handleFiles([fakeFile('a.png', 'image/png')]);
    await ws.runCompression();
    expect(document.getElementById('popup')!.classList.contains('open')).toBe(false);
  });

  it('takes the modal down even when the batch throws', async () => {
    compressBatchMock.mockRejectedValue(new Error('engine exploded'));
    ws.handleFiles([fakeFile('a.png', 'image/png')]);
    await ws.runCompression();
    // Stranding the user behind a spinner is the worst outcome here: the
    // files are fine and re-running is the obvious next move.
    expect(document.getElementById('popup')!.classList.contains('open')).toBe(false);
    expect(document.querySelector('.upload-zone')).not.toBeNull();
  });

  it('announces the outcome when the batch finishes', async () => {
    compressBatchMock.mockResolvedValue([
      { name: 'a.png', bytes: new Uint8Array(400), originalSize: 1000, shrunk: true },
    ] as any);
    ws.handleFiles([fakeFile('a.png', 'image/png')]);
    await ws.runCompression();

    const head = document.querySelector('.cw-results-head')!;
    expect(head.getAttribute('role')).toBe('status');
    expect(head.getAttribute('aria-live')).toBe('polite');
    expect(head.textContent).toMatch(/\d/);
  });
});

describe('CompressWorkspace — honest PDF messaging', () => {
  it('explains why a text-heavy PDF did not shrink', async () => {
    // Ghostscript's presets only resample images, so a text PDF genuinely
    // cannot shrink. Left unexplained, a correct result reads as a bug.
    compressBatchMock.mockResolvedValue([
      { name: 'spec.pdf', bytes: new Uint8Array(1000), originalSize: 1000, shrunk: false, reason: 'no-gain' },
    ] as any);
    ws.handleFiles([fakeFile('spec.pdf', 'application/pdf')]);
    await ws.runCompression();

    const note = document.querySelector('.cw-results-note');
    expect(note).not.toBeNull();
    expect(note!.textContent).toMatch(/text/i);
  });

  it('stays quiet when the PDF did shrink', async () => {
    compressBatchMock.mockResolvedValue([
      { name: 'scan.pdf', bytes: new Uint8Array(300), originalSize: 1000, shrunk: true },
    ] as any);
    ws.handleFiles([fakeFile('scan.pdf', 'application/pdf')]);
    await ws.runCompression();
    expect(document.querySelector('.cw-results-note')).toBeNull();
  });

  it('does not blame PDFs for a non-PDF that made no gain', async () => {
    compressBatchMock.mockResolvedValue([
      { name: 'tiny.png', bytes: new Uint8Array(1000), originalSize: 1000, shrunk: false, reason: 'no-gain' },
    ] as any);
    ws.handleFiles([fakeFile('tiny.png', 'image/png')]);
    await ws.runCompression();
    expect(document.querySelector('.cw-results-note')).toBeNull();
  });
});

describe('CompressWorkspace — degraded-route warning', () => {
  it('states what the fallback cost instead of only celebrating the saving', async () => {
    compressBatchMock.mockResolvedValue([
      {
        name: 'scan.pdf', bytes: new Uint8Array(300), originalSize: 1000, shrunk: true,
        warning: 'Pages were turned into images. Text is no longer selectable.',
      },
    ] as any);
    ws.handleFiles([fakeFile('scan.pdf', 'application/pdf')]);
    await ws.runCompression();

    const warn = document.querySelector('.cw-results-warning');
    expect(warn).not.toBeNull();
    expect(warn!.textContent).toMatch(/no longer selectable/i);
  });

  it('shows one warning per cause, not one per file', async () => {
    const w = 'Pages were turned into images.';
    compressBatchMock.mockResolvedValue([
      { name: 'a.pdf', bytes: new Uint8Array(300), originalSize: 1000, shrunk: true, warning: w },
      { name: 'b.pdf', bytes: new Uint8Array(300), originalSize: 1000, shrunk: true, warning: w },
    ] as any);
    ws.handleFiles([fakeFile('a.pdf', 'application/pdf'), fakeFile('b.pdf', 'application/pdf')]);
    await ws.runCompression();

    expect(document.querySelectorAll('.cw-results-warning')).toHaveLength(1);
  });

  it('stays silent on a normal run', async () => {
    compressBatchMock.mockResolvedValue([
      { name: 'a.pdf', bytes: new Uint8Array(300), originalSize: 1000, shrunk: true },
    ] as any);
    ws.handleFiles([fakeFile('a.pdf', 'application/pdf')]);
    await ws.runCompression();
    expect(document.querySelector('.cw-results-warning')).toBeNull();
  });
});

describe('CompressWorkspace — batch edge cases', () => {
  const unsupported = (name: string) => ({
    name, bytes: new Uint8Array(1000), originalSize: 1000, shrunk: false, reason: 'unsupported',
  });

  it('does not claim unsupported files were already small', async () => {
    // "Already as small as they usefully get" would be a lie: we never tried.
    // HEIC and AVIF pass the intake filter (they really are images) and only
    // turn out to be uncompressible once the handler list has been consulted.
    compressBatchMock.mockResolvedValue([unsupported('a.heic'), unsupported('b.avif')] as any);
    ws.handleFiles([fakeFile('a.heic', 'image/heic'), fakeFile('b.avif', 'image/avif')]);
    await ws.runCompression();

    const head = document.querySelector('.cw-results-head')!.textContent!;
    expect(head).not.toMatch(/already as small/i);
    expect(head).toMatch(/aren't ones i can compress/i);
  });

  it('reports a genuine no-gain without overclaiming, and in the singular', async () => {
    // The headline used to read "Nothing left to shave off", which asserts a
    // property of the file — while the note directly below it suggested trying
    // another level. It was contradicting its own advice. And the sub-copy was
    // plural ("These were... they") over a single row.
    compressBatchMock.mockResolvedValue([
      { name: 'a.png', bytes: new Uint8Array(1000), originalSize: 1000, shrunk: false, reason: 'no-gain' },
    ] as any);
    ws.handleFiles([fakeFile('a.png', 'image/png')]);
    await ws.runCompression();
    const head = document.querySelector('.cw-results-head')!.textContent!;
    expect(head).toMatch(/No smaller at this level/);
    expect(head).toMatch(/Your original is untouched/);
    expect(head).not.toMatch(/These were|they usefully/i);
  });

  it('reports a partial win honestly when only some files were supported', async () => {
    compressBatchMock.mockResolvedValue([
      { name: 'a.png', bytes: new Uint8Array(400), originalSize: 1000, shrunk: true },
      unsupported('b.heic'),
    ] as any);
    ws.handleFiles([fakeFile('a.png', 'image/png'), fakeFile('b.heic', 'image/heic')]);
    await ws.runCompression();
    expect(document.querySelector('.cw-results-head')!.textContent).toMatch(/1 of 2 files got smaller/i);
  });

  it('turns SVG away at the door rather than after a batch', () => {
    // The one image type we know up front we can never compress. Letting it in
    // only to report "can't compress this" later wastes the user's time.
    ws.handleFiles([fakeFile('a.png', 'image/png'), fakeFile('logo.svg', 'image/svg+xml')]);
    expect(ws.getFiles().map(f => f.file.name)).toEqual(['a.png']);
    expect(showToastMock).toHaveBeenCalled();
  });

  it('accepts a PDF from the file picker, not just from a drop', () => {
    // The picker's accept list is what makes this reachable at all; a PDF-only
    // batch is the headline case for this surface.
    ws.handleFiles([fakeFile('scan.pdf', 'application/pdf')]);
    expect(ws.getFiles().map(f => f.file.name)).toEqual(['scan.pdf']);
  });

  it('survives a zero-byte file without crashing or celebrating', async () => {
    compressBatchMock.mockResolvedValue([
      { name: 'empty.png', bytes: new Uint8Array(0), originalSize: 0, shrunk: false, reason: 'already-minimal' },
    ] as any);
    ws.handleFiles([fakeFile('empty.png', 'image/png', 0)]);
    await ws.runCompression();
    expect(ws.getPhase()).toBe('done');
    // 0/0 must not render NaN%.
    expect(document.querySelector('.cw-results-head')!.textContent).not.toMatch(/NaN/);
  });

  it('takes a wide mixed drop and keeps only what it can work with', () => {
    ws.handleFiles([
      fakeFile('a.png', 'image/png'), fakeFile('b.mp3', 'audio/mpeg'),
      fakeFile('c.mp4', 'video/mp4'), fakeFile('d.pdf', 'application/pdf'),
      fakeFile('e.txt', 'text/plain'), fakeFile('f.zip', 'application/zip'),
      fakeFile('g.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ]);
    expect(ws.getFiles().map(f => f.file.name)).toEqual(['a.png', 'b.mp3', 'c.mp4', 'd.pdf']);
    expect(showToastMock).toHaveBeenCalled();
  });
});

describe('CompressWorkspace — nothing strands the surface', () => {
  it('recovers to the file list when the batch throws', async () => {
    // The failure mode this guards is not a wrong message, it is a dead end:
    // leaving phase at "running" pins the UI on "Squishing…" until a reload.
    compressBatchMock.mockRejectedValue(new Error('engine exploded'));
    ws.handleFiles([fakeFile('a.png', 'image/png')]);
    await ws.runCompression();

    expect(ws.getPhase()).toBe('idle');
    expect(ws.getFiles()).toHaveLength(1);
    expect(document.querySelector('.cw-compress')).not.toBeNull();
    expect(showToastMock).toHaveBeenCalledWith(
      expect.stringMatching(/went wrong/i), 'error', expect.any(Number));
  });

  it('hands unreadable files to the engine layer rather than pre-reading them', async () => {
    // Reading a picked file that has since been moved or deleted is ordinary
    // behaviour, and it is now handled inside `compressBatch` — which is where
    // the read happens, one file at a time. The workspace no longer loads the
    // batch up front, so it has nothing to catch here. Covered by
    // "reports a file that vanished between picking and compressing as failed"
    // in compressBatch.test.ts.
    compressBatchMock.mockResolvedValue([
      { name: 'gone.png', bytes: new Uint8Array(0), originalSize: 1000, shrunk: false, reason: 'failed' },
      { name: 'ok.png', bytes: new Uint8Array(400), originalSize: 1000, shrunk: true },
    ] as any);

    ws.handleFiles([fakeFile('gone.png', 'image/png'), fakeFile('ok.png', 'image/png')]);
    await ws.runCompression();

    expect(ws.getPhase()).toBe('done');
    // Both files are still reported; only one is downloadable.
    expect(ws.getResults().map(r => r.name)).toEqual(['gone.png', 'ok.png']);
    expect(ws.getResults()[0].reason).toBe('failed');
  });
});

describe('CompressWorkspace — stopping early', () => {
  it('says stopped, not failed, for files it never reached', async () => {
    compressBatchMock.mockResolvedValue([
      { name: 'a.png', bytes: new Uint8Array(400), originalSize: 1000, shrunk: true },
      { name: 'b.png', bytes: new Uint8Array(1000), originalSize: 1000, shrunk: false, reason: 'cancelled' },
    ] as any);
    ws.handleFiles([fakeFile('a.png', 'image/png'), fakeFile('b.png', 'image/png')]);
    await ws.runCompression();

    const card = document.querySelector('.cw-results-card')!.textContent!;
    expect(card).toMatch(/stopped/i);
    expect(card).not.toMatch(/failed/i);
  });

  it('does not claim nothing was left to shave off when it was cut short', async () => {
    compressBatchMock.mockResolvedValue([
      { name: 'a.png', bytes: new Uint8Array(1000), originalSize: 1000, shrunk: false, reason: 'cancelled' },
    ] as any);
    ws.handleFiles([fakeFile('a.png', 'image/png')]);
    await ws.runCompression();

    const head = document.querySelector('.cw-results-head')!.textContent!;
    expect(head).not.toMatch(/already as small|nothing left/i);
    expect(head).toMatch(/untouched/i);
  });
});

describe('CompressWorkspace — savings copy', () => {
  it('does not report a real saving as 0% smaller', async () => {
    // The percentage is of the whole batch, so a genuine win on one small file
    // next to a large untouched one rounds to zero. "Saved 600 B (0% smaller)"
    // reads as a bug rather than as the true statement it is.
    compressBatchMock.mockResolvedValue([
      { name: 'small.png', bytes: new Uint8Array(400), originalSize: 1000, shrunk: true },
      { name: 'big.mp4', bytes: new Uint8Array(1), originalSize: 10_000_000, shrunk: false, reason: 'no-gain' },
    ] as any);
    ws.handleFiles([fakeFile('small.png', 'image/png'), fakeFile('big.mp4', 'video/mp4')]);
    await ws.runCompression();

    const head = document.querySelector('.cw-results-head')!.textContent!;
    expect(head).not.toMatch(/0% smaller/);
    expect(head).toMatch(/under 1% smaller/i);
  });
});

describe('CompressWorkspace — download', () => {
  it('leaves an unreadable file out of the archive instead of shipping 0 bytes', async () => {
    // A 0-byte file under the original name reads as "the compressor ate it".
    // The engine layer reports a file it could not read with no bytes; the
    // surface must still list it, and must still leave it out of the archive.
    compressBatchMock.mockResolvedValue([
      { name: 'gone.png', bytes: new Uint8Array(0), originalSize: 1000, shrunk: false, reason: 'failed' },
      { name: 'ok.png', bytes: new Uint8Array(400), originalSize: 1000, shrunk: true },
    ] as any);

    ws.handleFiles([fakeFile('gone.png', 'image/png'), fakeFile('ok.png', 'image/png')]);
    await ws.runCompression();
    await ws.downloadResults();

    // Two results, but only the readable one is worth downloading — so it goes
    // out as a single file rather than a zip containing an empty entry.
    expect(ws.getResults()).toHaveLength(2);
    expect(downloadAsZipMock).not.toHaveBeenCalled();
    expect(downloadFileMock).toHaveBeenCalledWith(expect.anything(), 'ok-compressed.png');
  });
});

describe('CompressWorkspace — category pills', () => {
  const tabs = () => [...document.querySelectorAll<HTMLElement>('#compress-category-tabs .cat-tab')];

  it('names every family this surface accepts', () => {
    // The pills exist to answer "what can I drop here?" without a trial run.
    expect(tabs().map(t => t.textContent!.trim()))
      .toEqual(['Any', 'Image', 'Audio', 'Video', 'PDF']);
  });

  it('narrows the picker to the family you tapped', () => {
    // A pill that looks like a control and does nothing is worse than no pill.
    const input = document.querySelector<HTMLInputElement>('#compress-file-input')!;
    input.click = vi.fn();

    tabs().find(t => t.textContent!.trim() === 'PDF')!.click();
    expect(input.accept).toBe('application/pdf,.pdf');
    expect(input.click).toHaveBeenCalled();
  });

  it('falls back to everything for "Any" rather than an empty filter', () => {
    // accept="" would mean "no restriction" to the browser, which is right,
    // but being explicit keeps the picker's own type list meaningful.
    const input = document.querySelector<HTMLInputElement>('#compress-file-input')!;
    input.click = vi.fn();

    tabs().find(t => t.textContent!.trim() === 'Any')!.click();
    expect(input.accept).toMatch(/image\/\*/);
    expect(input.accept).toMatch(/application\/pdf/);
  });

  it('moves the active state to the tapped pill', () => {
    tabs().find(t => t.textContent!.trim() === 'Video')!.click();
    const active = tabs().filter(t => t.classList.contains('active'));
    expect(active.map(t => t.textContent!.trim())).toEqual(['Video']);
    expect(active[0].getAttribute('aria-pressed')).toBe('true');
  });
});

describe('CompressWorkspace — download naming', () => {
  it('suffixes shrunk files so the download is distinguishable from its source', async () => {
    // "photo.png" saved next to the original becomes "photo (1).png", and
    // nothing says which of the two is the small one.
    compressBatchMock.mockResolvedValue([
      { name: 'photo.png', bytes: new Uint8Array(400), originalSize: 1000, shrunk: true },
    ] as any);
    ws.handleFiles([fakeFile('photo.png', 'image/png')]);
    await ws.runCompression();
    await ws.downloadResults();
    expect(downloadFileMock).toHaveBeenCalledWith(expect.anything(), 'photo-compressed.png');
  });

  it('keeps the original name for files handed back untouched', async () => {
    // A no-gain file is the original; calling original bytes "-compressed"
    // would be a lie.
    compressBatchMock.mockResolvedValue([
      { name: 'a.png', bytes: new Uint8Array(400), originalSize: 1000, shrunk: true },
      { name: 'tiny.png', bytes: new Uint8Array(90), originalSize: 90, shrunk: false, reason: 'no-gain' },
    ] as any);
    ws.handleFiles([fakeFile('a.png', 'image/png'), fakeFile('tiny.png', 'image/png')]);
    await ws.runCompression();
    await ws.downloadResults();
    const [files] = downloadAsZipMock.mock.calls[0];
    expect(files.map((f: { name: string }) => f.name)).toEqual(['a-compressed.png', 'tiny.png']);
  });

  it('never stacks suffixes on a re-compressed download', () => {
    expect(ws.compressedName('photo-compressed.png')).toBe('photo-compressed.png');
    expect(ws.compressedName('archive.tar.gz')).toBe('archive.tar-compressed.gz');
    expect(ws.compressedName('noext')).toBe('noext-compressed');
    expect(ws.compressedName('.hidden')).toBe('.hidden-compressed');
  });
});

describe('CompressWorkspace — level dropdown dismissal', () => {
  function openMenu() {
    ws.handleFiles([fakeFile('a.png', 'image/png')]);
    document.querySelector<HTMLElement>('.cw-level-selector')!.click();
    return document.querySelector<HTMLElement>('.cw-level-menu')!;
  }

  it('closes on Escape even though focus is still on the trigger', () => {
    // Opening the dropdown leaves focus on the button, so a keydown listener
    // bound to the *menu* never fired. On a narrow screen the open menu covers
    // the Compress button and swallows the click aimed at it, so "Escape does
    // nothing" left the surface effectively stuck.
    const menu = openMenu();
    expect(menu.hidden).toBe(false);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector<HTMLElement>('.cw-level-menu')!.hidden).toBe(true);
    expect(document.querySelector('.cw-level-selector')!.getAttribute('aria-expanded')).toBe('false');
  });

  it('puts focus back on the trigger rather than dropping it', () => {
    openMenu();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.activeElement).toBe(document.querySelector('.cw-level-selector'));
  });

  it('ignores Escape when the menu is already closed', () => {
    ws.handleFiles([fakeFile('a.png', 'image/png')]);
    const before = document.activeElement;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    // No focus grab, so Escape elsewhere on the page still belongs to whoever
    // else wants it (the progress modal, for one).
    expect(document.activeElement).toBe(before);
  });

  it('still closes on a click outside the field', () => {
    const menu = openMenu();
    expect(menu.hidden).toBe(false);
    document.body.click();
    expect(document.querySelector<HTMLElement>('.cw-level-menu')!.hidden).toBe(true);
  });
});

describe('CompressWorkspace — singular and plural', () => {
  it('speaks in the plural for a batch', async () => {
    compressBatchMock.mockResolvedValue([
      { name: 'a.png', bytes: new Uint8Array(1000), originalSize: 1000, shrunk: false, reason: 'no-gain' },
      { name: 'b.png', bytes: new Uint8Array(1000), originalSize: 1000, shrunk: false, reason: 'no-gain' },
    ] as any);
    ws.handleFiles([fakeFile('a.png', 'image/png'), fakeFile('b.png', 'image/png')]);
    await ws.runCompression();
    const head = document.querySelector('.cw-results-head')!.textContent!;
    expect(head).toMatch(/Your originals are untouched/);
  });

  it('speaks in the singular when only one format was unsupported', async () => {
    compressBatchMock.mockResolvedValue([
      { name: 'a.heic', bytes: new Uint8Array(0), originalSize: 1000, shrunk: false, reason: 'unsupported' },
    ] as any);
    ws.handleFiles([fakeFile('a.heic', 'image/heic')]);
    await ws.runCompression();
    const head = document.querySelector('.cw-results-head')!.textContent!;
    expect(head).toMatch(/That format isn't one i can compress/);
  });
});

describe('CompressWorkspace — the download control', () => {
  it('names the number of files it will actually produce', async () => {
    // Not the number of rows: a file that was never opened is listed with its
    // reason but is not in the archive.
    compressBatchMock.mockResolvedValue([
      { name: 'a.png', bytes: new Uint8Array(400), originalSize: 1000, shrunk: true },
      { name: 'b.png', bytes: new Uint8Array(400), originalSize: 1000, shrunk: true },
      { name: 'c.heic', bytes: new Uint8Array(0), originalSize: 1000, shrunk: false, reason: 'unsupported' },
    ] as any);
    ws.handleFiles([
      fakeFile('a.png', 'image/png'), fakeFile('b.png', 'image/png'), fakeFile('c.heic', 'image/heic'),
    ]);
    await ws.runCompression();
    expect(document.querySelectorAll('.cw-res-row')).toHaveLength(3);
    expect(document.querySelector('.cw-download')!.textContent!.trim()).toBe('Download 2 files (.zip)');
  });

  it('says just "Download" for a single file', async () => {
    compressBatchMock.mockResolvedValue([
      { name: 'a.png', bytes: new Uint8Array(400), originalSize: 1000, shrunk: true },
    ] as any);
    ws.handleFiles([fakeFile('a.png', 'image/png')]);
    await ws.runCompression();
    expect(document.querySelector('.cw-download')!.textContent!.trim()).toBe('Download');
  });

  it('offers no download at all when nothing is downloadable', async () => {
    // Reached by stopping a batch before the first file finishes — ordinary,
    // not rare. "Download 0 files (.zip)" is a button whose only outcome is a
    // toast explaining why it did nothing.
    compressBatchMock.mockResolvedValue([
      { name: 'big.mp4', bytes: new Uint8Array(0), originalSize: 17_000_000, shrunk: false, reason: 'cancelled' },
    ] as any);
    ws.handleFiles([fakeFile('big.mp4', 'video/mp4')]);
    await ws.runCompression();

    expect(document.querySelector('.cw-download')).toBeNull();
    // The way back is still there.
    expect(document.querySelector('.cw-back')).not.toBeNull();
    expect(document.querySelector('.cw-results-headline')!.textContent).toMatch(/Stopped/);
  });
});
