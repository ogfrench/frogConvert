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
// The shared files modal has its own suite and its own DOM; here the point is
// only that this surface hands off to it instead of rendering its own list.
vi.mock('../FilesModal/FilesModal.ts', () => ({ openFilesModal: vi.fn() }));
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
import { triggerConfetti } from '../../effects/Confetti/Confetti.ts';
import { openFilesModal } from '../FilesModal/FilesModal.ts';

const showToastMock = vi.mocked(showToast);
const compressBatchMock = vi.mocked(compressBatch);
const downloadFileMock = vi.mocked(downloadFile);
const downloadAsZipMock = vi.mocked(downloadAsZip);
const triggerConfettiMock = vi.mocked(triggerConfetti);
const openFilesModalMock = vi.mocked(openFilesModal);

function mountDom() {
  // Mirrors index.html, including the page description that sits *outside* the
  // card - the copy tests below only mean something if both are present.
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
      Compress images, audio, video and PDFs, right here in your browser.</p>
    <div id="files-modal-bg" class="modal-overlay" aria-hidden="true"></div>
    <div id="files-modal" class="card-base modal-container">
      <h2 id="files-modal-title"></h2>
      <button id="files-modal-close"></button>
      <div id="files-modal-error"><span id="files-modal-error-text"></span><button id="files-modal-error-close"></button></div>
      <div id="files-list"></div>
      <div id="files-pagination"></div>
      <div id="files-drop-more"></div>
      <button id="files-replace-all"></button>
      <button id="files-remove-all"></button>
    </div>
    <div id="popup-bg" class="modal-overlay" aria-hidden="true"></div>
    <div id="popup" class="card-base modal-container popup-size"
      role="status" aria-live="polite" aria-atomic="true"></div>
  `;
}

/** jsdom File with a controllable size, so budget logic can be exercised. */
const popupButtons = () =>
  [...document.querySelectorAll<HTMLButtonElement>('#popup .popup-actions-footer button')];
const popupButton = (i: number) => popupButtons()[i];

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

describe('CompressWorkspace - empty state', () => {
  it('renders a dropzone when no files are loaded', () => {
    expect(document.querySelector('.upload-zone')).not.toBeNull();
    expect(document.querySelector('.upload-file-info.visible')).toBeNull();
  });

  it('states the privacy promise exactly once', () => {
    // The card used to repeat it directly above the page description -
    // "Nothing leaves your device" stacked on "without sending them anywhere".
    // Said twice in a row it reads as padding, not reassurance.
    const page = document.body.textContent ?? '';
    const promises = page.match(/leaves? your device|without sending them anywhere/gi) ?? [];
    expect(promises).toHaveLength(1);
    expect(page).toMatch(/without sending them anywhere/i);
  });
});

describe('CompressWorkspace - intake', () => {
  it('accepts image, audio and video files', () => {
    ws.handleFiles([
      fakeFile('a.png', 'image/png'),
      fakeFile('b.mp3', 'audio/mpeg'),
      fakeFile('c.mp4', 'video/mp4'),
    ]);
    expect(ws.getFiles()).toHaveLength(3);
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

  it('opens the shared files modal from the manage button', () => {
    // This surface used to render its own list here - same rows, same remove
    // buttons, none of the modal's paging, per-row replace or drop-more.
    ws.handleFiles([fakeFile('a.png', 'image/png')]);
    expect(document.querySelector('.cw-list')).toBeNull();
    document.querySelector<HTMLElement>('.cw-manage')!.click();
    expect(openFilesModalMock).toHaveBeenCalledTimes(1);
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

  it('gives the modal a source that can read and write the batch', () => {
    // The adapter is the whole interface between the two, so it is worth
    // pinning: the modal removes by handing back a shorter list.
    ws.handleFiles([fakeFile('a.png', 'image/png'), fakeFile('b.png', 'image/png')]);
    document.querySelector<HTMLElement>('.cw-manage')!.click();
    const source = openFilesModalMock.mock.calls[0][0]!;
    expect(source.get().map(f => f.name)).toEqual(['a.png', 'b.png']);
    expect(source.sameTypeOnly).toBe(false); // a mixed batch is the point here
    source.set([source.get()[1]]);
    source.changed();
    expect(ws.getFiles()).toHaveLength(1);
    expect(ws.getFiles()[0].file.name).toBe('b.png');
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

describe('CompressWorkspace - level picker', () => {
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

describe('CompressWorkspace - running a batch', () => {
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
    expect(document.querySelector('#popup .cw-results-headline')?.textContent).toMatch(/Saved/);
    expect(document.querySelector('#popup .cw-results-headline')?.textContent).toMatch(/60% smaller/);
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
    expect(document.querySelector('#popup .cw-results-headline')?.textContent).toMatch(/didn't get any smaller/);
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
    // The results modal described the batch that just got replaced.
    expect(document.getElementById('popup')!.classList.contains('open')).toBe(false);
    expect(ws.getFiles()).toHaveLength(2);
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
    popupButtons().find(b => b.textContent === 'Done')!.click();
    expect(ws.getPhase()).toBe('idle');
    expect(ws.getFiles()).toHaveLength(1);
    expect(document.getElementById('popup')!.classList.contains('open')).toBe(false);
    expect(document.querySelector('.cw-compress')).not.toBeNull();
  });
});

describe('CompressWorkspace - lifecycle', () => {
  it('keeps the batch across a cleanup/init cycle (mode switch)', () => {
    ws.handleFiles([fakeFile('a.png', 'image/png')]);
    ws.cleanup();
    ws.initCompressWorkspace();
    expect(ws.getFiles()).toHaveLength(1);
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

describe('CompressWorkspace - assistive technology', () => {
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

  it('replaces the progress modal with the results, in place', async () => {
    // The Converter and the PDF Editor both swap their progress popup for a
    // success one rather than closing and reopening; closing first flashes the
    // card between the two.
    compressBatchMock.mockResolvedValue([
      { name: 'a.png', bytes: new Uint8Array(400), originalSize: 1000, shrunk: true },
    ] as any);
    ws.handleFiles([fakeFile('a.png', 'image/png')]);
    await ws.runCompression();
    const popup = document.getElementById('popup')!;
    expect(popup.classList.contains('open')).toBe(true);
    expect(popup.querySelector('h2')!.textContent).toMatch(/compressed/i);
    expect(popup.querySelector('.cw-results-card')).not.toBeNull();
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

describe('CompressWorkspace - honest PDF messaging', () => {
  it('explains why a text-heavy PDF did not shrink', async () => {
    // Ghostscript's presets only resample images, so a text PDF genuinely
    // cannot shrink. Left unexplained, a correct result reads as a bug.
    compressBatchMock.mockResolvedValue([
      { name: 'spec.pdf', bytes: new Uint8Array(1000), originalSize: 1000, shrunk: false, reason: 'no-gain' },
    ] as any);
    ws.handleFiles([fakeFile('spec.pdf', 'application/pdf')]);
    await ws.runCompression();

    const note = document.querySelector('#popup .cw-results-note');
    expect(note).not.toBeNull();
    expect(note!.textContent).toMatch(/text/i);
  });

  it('stays quiet when the PDF did shrink', async () => {
    compressBatchMock.mockResolvedValue([
      { name: 'scan.pdf', bytes: new Uint8Array(300), originalSize: 1000, shrunk: true },
    ] as any);
    ws.handleFiles([fakeFile('scan.pdf', 'application/pdf')]);
    await ws.runCompression();
    expect(document.querySelector('#popup .cw-results-note')).toBeNull();
  });

  it('does not blame PDFs for a non-PDF that made no gain', async () => {
    compressBatchMock.mockResolvedValue([
      { name: 'tiny.png', bytes: new Uint8Array(1000), originalSize: 1000, shrunk: false, reason: 'no-gain' },
    ] as any);
    ws.handleFiles([fakeFile('tiny.png', 'image/png')]);
    await ws.runCompression();
    expect(document.querySelector('#popup .cw-results-note')).toBeNull();
  });
});

describe('CompressWorkspace - degraded-route warning', () => {
  it('states what the fallback cost instead of only celebrating the saving', async () => {
    compressBatchMock.mockResolvedValue([
      {
        name: 'scan.pdf', bytes: new Uint8Array(300), originalSize: 1000, shrunk: true,
        warning: 'Pages were turned into images. Text is no longer selectable.',
      },
    ] as any);
    ws.handleFiles([fakeFile('scan.pdf', 'application/pdf')]);
    await ws.runCompression();

    const warn = document.querySelector('#popup .cw-results-warning');
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

    expect(document.querySelectorAll('#popup .cw-results-warning')).toHaveLength(1);
  });

  it('stays silent on a normal run', async () => {
    compressBatchMock.mockResolvedValue([
      { name: 'a.pdf', bytes: new Uint8Array(300), originalSize: 1000, shrunk: true },
    ] as any);
    ws.handleFiles([fakeFile('a.pdf', 'application/pdf')]);
    await ws.runCompression();
    expect(document.querySelector('#popup .cw-results-warning')).toBeNull();
  });
});

describe('CompressWorkspace - batch edge cases', () => {
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
    // property of the file - while the note directly below it suggested trying
    // another level. It was contradicting its own advice. And the sub-copy was
    // plural ("These were... they") over a single row.
    compressBatchMock.mockResolvedValue([
      { name: 'a.png', bytes: new Uint8Array(1000), originalSize: 1000, shrunk: false, reason: 'no-gain' },
    ] as any);
    ws.handleFiles([fakeFile('a.png', 'image/png')]);
    await ws.runCompression();
    const head = document.querySelector('.cw-results-head')!.textContent!;
    expect(head).toMatch(/didn't get any smaller/);
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

describe('CompressWorkspace - nothing strands the surface', () => {
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
    // behaviour, and it is now handled inside `compressBatch` - which is where
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

describe('CompressWorkspace - stopping early', () => {
  it('says stopped, not failed, for files it never reached', async () => {
    compressBatchMock.mockResolvedValue([
      { name: 'a.png', bytes: new Uint8Array(400), originalSize: 1000, shrunk: true },
      { name: 'b.png', bytes: new Uint8Array(1000), originalSize: 1000, shrunk: false, reason: 'cancelled' },
    ] as any);
    ws.handleFiles([fakeFile('a.png', 'image/png'), fakeFile('b.png', 'image/png')]);
    await ws.runCompression();

    const card = document.querySelector('#popup .cw-results-card')!.textContent!;
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

describe('CompressWorkspace - savings copy', () => {
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

describe('CompressWorkspace - download', () => {
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

    // Two results, but only the readable one is worth downloading - so it goes
    // out as a single file rather than a zip containing an empty entry.
    expect(ws.getResults()).toHaveLength(2);
    expect(downloadAsZipMock).not.toHaveBeenCalled();
    expect(downloadFileMock).toHaveBeenCalledWith(expect.anything(), 'ok-compressed.png');
  });
});

describe('CompressWorkspace - category pills', () => {
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

describe('CompressWorkspace - download naming', () => {
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

  it('hands back only the files that changed', async () => {
    // An untouched file is already on disk exactly as it is here, and shipping
    // it made the button's count disagree with the headline's.
    compressBatchMock.mockResolvedValue([
      { name: 'a.png', bytes: new Uint8Array(400), originalSize: 1000, shrunk: true },
      { name: 'tiny.png', bytes: new Uint8Array(90), originalSize: 90, shrunk: false, reason: 'no-gain' },
    ] as any);
    ws.handleFiles([fakeFile('a.png', 'image/png'), fakeFile('tiny.png', 'image/png')]);
    await ws.runCompression();
    expect(popupButton(0)!.textContent!.trim()).toBe('Download');
    await ws.downloadResults();
    expect(downloadAsZipMock).not.toHaveBeenCalled();
    expect(downloadFileMock).toHaveBeenCalledWith(expect.anything(), 'a-compressed.png');
  });

  it('never stacks suffixes on a re-compressed download', () => {
    expect(ws.compressedName('photo-compressed.png')).toBe('photo-compressed.png');
    expect(ws.compressedName('archive.tar.gz')).toBe('archive.tar-compressed.gz');
    expect(ws.compressedName('noext')).toBe('noext-compressed');
    expect(ws.compressedName('.hidden')).toBe('.hidden-compressed');
  });
});

describe('CompressWorkspace - level chooser', () => {
  function open() {
    ws.handleFiles([fakeFile('a.png', 'image/png')]);
    document.querySelector<HTMLElement>('.cw-level-selector')!.click();
    return document.querySelector<HTMLElement>('.cw-level-dialog');
  }

  it('opens as a modal rather than a dropdown over the card', () => {
    // As an absolutely positioned menu this opened directly on top of the
    // Compress button, so on a narrow screen a tap aimed at Compress landed on
    // the menu instead - and with five options it ran off a short screen
    // entirely. A modal can do neither.
    expect(open()).not.toBeNull();
    expect(document.querySelector('.cw-level-menu')).toBeNull();
  });

  it('marks the current level for assistive tech, not by styling alone', () => {
    open();
    const checked = [...document.querySelectorAll('.cw-level-option')]
      .filter(o => o.getAttribute('aria-checked') === 'true');
    expect(checked).toHaveLength(1);
    expect(checked[0].textContent).toContain('Automatic');
  });

  it('exposes the choices as a radiogroup', () => {
    open();
    const group = document.querySelector('.cw-level-list');
    expect(group?.getAttribute('role')).toBe('radiogroup');
    expect(document.querySelectorAll('.cw-level-option[role="radio"]').length)
      .toBe(ws.COMPRESS_LEVELS.length);
  });

  it('closes on Escape, wherever focus happens to be', () => {
    // Dismissal is ModalManager's now, but the outcome is the user-visible
    // contract and still worth pinning: opening the chooser and being unable
    // to leave it is the failure this replaced.
    open();
    expect(document.getElementById('popup')!.classList.contains('open')).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.getElementById('popup')!.classList.contains('open')).toBe(false);
  });

  it('applies a pick and closes', () => {
    open();
    const smallest = [...document.querySelectorAll<HTMLElement>('.cw-level-option')]
      .find(o => o.textContent?.includes('Smallest file'))!;
    smallest.click();
    expect(ws.getLevel()).toBe('low');
    expect(document.getElementById('popup')!.classList.contains('open')).toBe(false);
    expect(document.querySelector('.cw-level-selector .selector-text')?.textContent)
      .toContain('Smallest file');
  });
});

describe('CompressWorkspace - singular and plural', () => {
  it('speaks in the plural for a batch', async () => {
    compressBatchMock.mockResolvedValue([
      { name: 'a.png', bytes: new Uint8Array(1000), originalSize: 1000, shrunk: false, reason: 'no-gain' },
      { name: 'b.png', bytes: new Uint8Array(1000), originalSize: 1000, shrunk: false, reason: 'no-gain' },
    ] as any);
    ws.handleFiles([fakeFile('a.png', 'image/png'), fakeFile('b.png', 'image/png')]);
    await ws.runCompression();
    const head = document.querySelector('.cw-results-head')!.textContent!;
    // Names the count, because the row list is capped and can no longer be
    // counted by eye.
    expect(head).toMatch(/All 2 are untouched/);
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

describe('CompressWorkspace - the results list stays a summary', () => {
  const batch = (n: number, shrunkCount = 0) =>
    [...Array(n)].map((_, i) => ({
      name: `f${String(i).padStart(3, '0')}.png`,
      bytes: new Uint8Array(i < shrunkCount ? 400 : 900),
      originalSize: 1000,
      shrunk: i < shrunkCount,
      reason: i < shrunkCount ? undefined : 'no-gain',
    })) as any;

  it('caps the rows and counts the rest', async () => {
    // 300 files is a legal batch. Every one of them used to become a row.
    compressBatchMock.mockResolvedValue(batch(40));
    ws.handleFiles([...Array(40)].map((_, i) => fakeFile(`f${String(i).padStart(3, '0')}.png`, 'image/png')));
    await ws.runCompression();

    expect(document.querySelectorAll('#popup .cw-res-row')).toHaveLength(8);
    expect(document.querySelector('#popup .cw-res-more')!.textContent!.trim()).toBe('and 32 more files');
  });

  it('lists every file when the batch is small enough to fit', async () => {
    compressBatchMock.mockResolvedValue(batch(3));
    ws.handleFiles([...Array(3)].map((_, i) => fakeFile(`f${String(i).padStart(3, '0')}.png`, 'image/png')));
    await ws.runCompression();

    expect(document.querySelectorAll('#popup .cw-res-row')).toHaveLength(3);
    expect(document.querySelector('#popup .cw-res-more')).toBeNull();
  });

  it('shows the files that did something, not the first eight alphabetically', async () => {
    // The two that shrank are last by name. A plain slice would drop exactly
    // the rows carrying information and keep eight identical "no gain" lines.
    const rows = batch(20);
    rows[18].shrunk = true; rows[18].bytes = new Uint8Array(400); rows[18].reason = undefined;
    rows[19].shrunk = true; rows[19].bytes = new Uint8Array(400); rows[19].reason = undefined;
    compressBatchMock.mockResolvedValue(rows);
    ws.handleFiles([...Array(20)].map((_, i) => fakeFile(`f${String(i).padStart(3, '0')}.png`, 'image/png')));
    await ws.runCompression();

    const shown = [...document.querySelectorAll('#popup .cw-res-row')];
    expect(shown).toHaveLength(8);
    expect(shown.filter(r => r.classList.contains('shrunk'))).toHaveLength(2);
    expect(shown[0].textContent).toContain('f018.png');
    expect(shown[1].textContent).toContain('f019.png');
  });

  it('states the total, since the rows can no longer be counted by eye', async () => {
    compressBatchMock.mockResolvedValue(batch(40));
    ws.handleFiles([...Array(40)].map((_, i) => fakeFile(`f${String(i).padStart(3, '0')}.png`, 'image/png')));
    await ws.runCompression();
    expect(document.querySelector('#popup .cw-results-sub')!.textContent).toMatch(/All 40 are untouched/);
  });
});

describe('CompressWorkspace - confetti', () => {
  it('celebrates any real saving, however small', async () => {
    // A threshold was tried and reverted: the user who saved a kilobyte still
    // got what they came for. The only silent result is the one below.
    compressBatchMock.mockResolvedValue([
      { name: 'a.png', bytes: new Uint8Array(9900), originalSize: 10000, shrunk: true },
    ] as any);
    ws.handleFiles([fakeFile('a.png', 'image/png')]);
    await ws.runCompression();
    await vi.waitFor(() => expect(triggerConfettiMock).toHaveBeenCalled());
  });

  it('stays quiet when nothing could be compressed', async () => {
    compressBatchMock.mockResolvedValue([
      { name: 'a.png', bytes: new Uint8Array(10000), originalSize: 10000, shrunk: false, reason: 'no-gain' },
    ] as any);
    ws.handleFiles([fakeFile('a.png', 'image/png')]);
    await ws.runCompression();
    expect(triggerConfettiMock).not.toHaveBeenCalled();
  });
});

describe('CompressWorkspace - the download control', () => {
  it('counts what it will produce, not the rows on screen', async () => {
    // Rows report every file; the archive holds only the ones that changed.
    compressBatchMock.mockResolvedValue([
      { name: 'a.png', bytes: new Uint8Array(400), originalSize: 1000, shrunk: true },
      { name: 'b.png', bytes: new Uint8Array(400), originalSize: 1000, shrunk: true },
      { name: 'c.heic', bytes: new Uint8Array(0), originalSize: 1000, shrunk: false, reason: 'unsupported' },
    ] as any);
    ws.handleFiles([
      fakeFile('a.png', 'image/png'), fakeFile('b.png', 'image/png'), fakeFile('c.heic', 'image/heic'),
    ]);
    await ws.runCompression();
    expect(document.querySelectorAll('#popup .cw-res-row')).toHaveLength(3);
    expect(popupButton(0)!.textContent!.trim()).toBe('Download 2 files (.zip)');
  });

  it('offers nothing when nothing changed', async () => {
    // Every file is already on disk exactly as it is here. A button reading
    // "Download 3 files" over a headline saying none of them got smaller was
    // the two disagreeing about the same run.
    compressBatchMock.mockResolvedValue([
      { name: 'a.png', bytes: new Uint8Array(900), originalSize: 1000, shrunk: false, reason: 'no-gain' },
    ] as any);
    ws.handleFiles([fakeFile('a.png', 'image/png')]);
    await ws.runCompression();
    expect(popupButtons().map(b => b.textContent)).toEqual(['Done']);
  });

  it('names what it will produce, even when files shrank', async () => {
    compressBatchMock.mockResolvedValue([
      { name: 'a.png', bytes: new Uint8Array(400), originalSize: 1000, shrunk: true },
      { name: 'b.png', bytes: new Uint8Array(400), originalSize: 1000, shrunk: true },
    ] as any);
    ws.handleFiles([fakeFile('a.png', 'image/png'), fakeFile('b.png', 'image/png')]);
    await ws.runCompression();
    expect(popupButton(0)!.textContent!.trim()).toBe('Download 2 files (.zip)');
  });

  it('never downloads on its own, however good the result', async () => {
    // No surface hands a file over unasked. The button is the transaction.
    vi.useFakeTimers();
    try {
      compressBatchMock.mockResolvedValue([
        { name: 'a.png', bytes: new Uint8Array(100), originalSize: 10000, shrunk: true },
      ] as any);
      ws.handleFiles([fakeFile('a.png', 'image/png')]);
      await ws.runCompression();
      await vi.advanceTimersByTimeAsync(2000);
      expect(downloadFileMock).not.toHaveBeenCalled();
      expect(downloadAsZipMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not hand anything over when the level changed nothing', async () => {
    // No new file exists, and "Try another level" is the likely next move.
    // Dropping an unchanged copy into Downloads for each level tried is noise.
    vi.useFakeTimers();
    try {
      compressBatchMock.mockResolvedValue([
        { name: 'a.png', bytes: new Uint8Array(900), originalSize: 1000, shrunk: false, reason: 'no-gain' },
      ] as any);
      ws.handleFiles([fakeFile('a.png', 'image/png')]);
      await ws.runCompression();
      await vi.advanceTimersByTimeAsync(500);
      expect(downloadFileMock).not.toHaveBeenCalled();
      expect(downloadAsZipMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('offers a stopped batch through the button like any other result', async () => {
    vi.useFakeTimers();
    try {
      compressBatchMock.mockResolvedValue([
        { name: 'a.png', bytes: new Uint8Array(400), originalSize: 1000, shrunk: true },
        { name: 'b.png', bytes: new Uint8Array(0), originalSize: 1000, shrunk: false, reason: 'cancelled' },
      ] as any);
      ws.handleFiles([fakeFile('a.png', 'image/png'), fakeFile('b.png', 'image/png')]);
      await ws.runCompression();
      await vi.advanceTimersByTimeAsync(500);
      expect(downloadFileMock).not.toHaveBeenCalled();
      expect(downloadAsZipMock).not.toHaveBeenCalled();
      expect(popupButton(0)!.textContent!.trim()).toBe('Download');
    } finally {
      vi.useRealTimers();
    }
  });

  it('offers no download at all when nothing is downloadable', async () => {
    // Reached by stopping a batch before the first file finishes - ordinary,
    // not rare. "Download 0 files (.zip)" is a button whose only outcome is a
    // toast explaining why it did nothing.
    compressBatchMock.mockResolvedValue([
      { name: 'big.mp4', bytes: new Uint8Array(0), originalSize: 17_000_000, shrunk: false, reason: 'cancelled' },
    ] as any);
    ws.handleFiles([fakeFile('big.mp4', 'video/mp4')]);
    await ws.runCompression();

    // Only the way out. "Download 0 files" is a button whose sole outcome is
    // a toast explaining why it did nothing.
    expect(popupButtons().map(b => b.textContent)).toEqual(['Done']);
    expect(document.querySelector('#popup .cw-results-headline')!.textContent).toMatch(/Stopped/);
  });
});
