import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../tools/pdfThumbnails.ts', () => ({
  renderPageThumbnail: vi.fn(async () => ''),
  renderPageBitmap: vi.fn(async () => null),
  clearThumbnailCache: vi.fn(),
  mockBlankPageThumb: vi.fn(() => ''),
  mockPageThumb: vi.fn(() => ''),
}));

// jsdom does not provide IntersectionObserver. The lazy-render path under test
// only needs the object shape, not actual intersection callbacks.
class MockIntersectionObserver {
  observe() { /* noop */ }
  unobserve() { /* noop */ }
  disconnect() { /* noop */ }
  takeRecords() { return []; }
  root = null;
  rootMargin = '';
  thresholds = [];
}
(globalThis as any).IntersectionObserver = MockIntersectionObserver;

const { __testing } = await import('./PdfWorkspace.ts');
import { renderPageThumbnail } from '../../tools/pdfThumbnails.ts';
import type { PageEntry, SourceFile } from '../../tools/types.ts';
import { ui } from '../store/store.ts';

const renderPageThumbnailMock = vi.mocked(renderPageThumbnail);

let nextTestPageId = 1_000_000;
function srcPage(fileId: number, pageNum: number, rotation: 0 | 90 | 180 | 270 = 0): PageEntry {
  return { type: 'source', sourceFileId: fileId, sourcePageNum: pageNum, thumbnail: null, rotation, originalPos: pageNum, pageId: nextTestPageId++ };
}

function sf(id: number, pageCount: number): SourceFile {
  return { id, name: `f${id}.pdf`, size: 0, bytes: new Uint8Array(), pageCount, firstPageThumb: null };
}

function keydown(opts: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', { ...opts, cancelable: true });
}

beforeEach(() => {
  __testing.reset();
  __testing.setActiveTool('organize');
  __testing.setInitialized(true);
  renderPageThumbnailMock.mockResolvedValue('');
});

describe('PdfWorkspace keyboard + undo', () => {
  it('Delete key removes selected pages', () => {
    __testing.seed([srcPage(1, 1), srcPage(1, 2), srcPage(1, 3)], [sf(1, 3)], [0, 2]);
    __testing.handleKeydown(keydown({ key: 'Delete' }));
    const pages = __testing.getPages();
    expect(pages.length).toBe(1);
    expect(pages[0].sourcePageNum).toBe(2);
    expect(__testing.getSelected().size).toBe(0);
  });

  it('Ctrl+Z undoes a delete', () => {
    __testing.seed([srcPage(1, 1), srcPage(1, 2), srcPage(1, 3)], [sf(1, 3)], [1]);
    __testing.deleteSelected();
    expect(__testing.getPages().length).toBe(2);
    __testing.handleKeydown(keydown({ key: 'z', ctrlKey: true }));
    const pages = __testing.getPages();
    expect(pages.length).toBe(3);
    expect(pages.map(p => p.sourcePageNum)).toEqual([1, 2, 3]);
  });

  it('Undo restores rotation', () => {
    __testing.seed([srcPage(1, 1)], [sf(1, 1)]);
    __testing.pushHistory();
    __testing.getPages()[0].rotation = 90;
    expect(__testing.getPages()[0].rotation).toBe(90);
    __testing.undo();
    expect(__testing.getPages()[0].rotation).toBe(0);
  });

  it('Escape clears selection', () => {
    __testing.seed([srcPage(1, 1), srcPage(1, 2)], [sf(1, 2)], [0, 1]);
    __testing.handleKeydown(keydown({ key: 'Escape' }));
    expect(__testing.getSelected().size).toBe(0);
  });

  it('Keydown is ignored when focus is in an input', () => {
    __testing.seed([srcPage(1, 1), srcPage(1, 2)], [sf(1, 2)], [0]);
    const input = document.createElement('input');
    document.body.appendChild(input);
    const ev = new KeyboardEvent('keydown', { key: 'Delete', cancelable: true, bubbles: true });
    Object.defineProperty(ev, 'target', { value: input });
    __testing.handleKeydown(ev);
    expect(__testing.getPages().length).toBe(2);
    input.remove();
  });

  it('parseSelectionRange parses "1-5, 8, 12-20"', () => {
    __testing.seed(Array.from({ length: 20 }, (_, i) => srcPage(1, i + 1)), [sf(1, 20)]);
    const result = __testing.parseSelectionRange('1-5, 8, 12-20');
    expect(result).not.toBeNull();
    const indices = [...result!].sort((a, b) => a - b);
    expect(indices).toEqual([0, 1, 2, 3, 4, 7, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  });
});

describe('Watermark state', () => {
  beforeEach(() => {
    __testing.reset();
    __testing.setActiveTool('watermark');
    __testing.setInitialized(true);
  });

  it('default settings match spec defaults', () => {
    const s = __testing.getWmSettings();
    expect(s.text).toBe('CONFIDENTIAL');
    expect(s.fontSize).toBe(80);
    expect(s.colorHex).toBe('#808080');
    expect(s.opacity).toBeCloseTo(0.5, 5);
    expect(s.rotation).toBe(-45);
    expect(s.repeat).toBe(false);
  });

  it('repeat round-trips via setWmSettings', () => {
    __testing.setWmSettings({ repeat: true });
    expect(__testing.getWmSettings().repeat).toBe(true);
    __testing.setWmSettings({ repeat: false });
    expect(__testing.getWmSettings().repeat).toBe(false);
  });

  it('setWmSettings merges partials', () => {
    __testing.setWmSettings({ text: 'DRAFT', rotation: 0 });
    const s = __testing.getWmSettings();
    expect(s.text).toBe('DRAFT');
    expect(s.rotation).toBe(0);
    // unchanged
    expect(s.fontSize).toBe(80);
  });

  it('triggerWmFilesMutated rebuilds the flat page list', () => {
    __testing.setFiles([sf(1, 3), sf(2, 2)]);
    __testing.triggerWmFilesMutated();
    const flat = __testing.getWmFlatPages();
    expect(flat.length).toBe(5);
    expect(flat.map(p => `${p.fileId}:${p.pageNum}`)).toEqual(['1:1', '1:2', '1:3', '2:1', '2:2']);
  });

  it('triggerWmFilesMutated clears flat pages when no files remain', () => {
    __testing.setFiles([sf(1, 3)]);
    __testing.triggerWmFilesMutated();
    expect(__testing.getWmFlatPages().length).toBe(3);
    __testing.setFiles([]);
    __testing.triggerWmFilesMutated();
    expect(__testing.getWmFlatPages().length).toBe(0);
  });

  it('wmBadgeText uses plain numbers for single file, letter prefix for multi-file', () => {
    __testing.setFiles([sf(1, 3)]);
    __testing.triggerWmFilesMutated();
    expect(__testing.wmBadgeText(0)).toBe('1');
    expect(__testing.wmBadgeText(2)).toBe('3');

    __testing.setFiles([sf(1, 3), sf(2, 2)]);
    __testing.triggerWmFilesMutated();
    expect(__testing.wmBadgeText(0)).toBe('A1');
    expect(__testing.wmBadgeText(2)).toBe('A3');
    expect(__testing.wmBadgeText(3)).toBe('B1');
    expect(__testing.wmBadgeText(4)).toBe('B2');
  });

  it('reset() restores watermark defaults', () => {
    __testing.setWmSettings({ text: 'DRAFT', rotation: 30, opacity: 0.9 });
    __testing.reset();
    const s = __testing.getWmSettings();
    expect(s.text).toBe('CONFIDENTIAL');
    expect(s.rotation).toBe(-45);
    expect(s.opacity).toBeCloseTo(0.5, 5);
  });
});

describe('Watermark selection model', () => {
  beforeEach(() => {
    __testing.reset();
    __testing.setActiveTool('watermark');
    __testing.setInitialized(true);
  });

  it('wmEffectivePagesFor returns selected pages of the given file', () => {
    // 3 files: A=3pp, B=2pp, C=4pp → flat indices 0..8 (3+2+4)
    __testing.setFiles([sf(1, 3), sf(2, 2), sf(3, 4)]);
    __testing.triggerWmFilesMutated();
    // Select A1, A3, B2, C1 → flat indices [0, 2, 4, 5]
    __testing.setWmSelected([0, 2, 4, 5]);
    expect(__testing.wmEffectivePagesFor(sf(1, 3))).toEqual([1, 3]);
    expect(__testing.wmEffectivePagesFor(sf(2, 2))).toEqual([2]);
    expect(__testing.wmEffectivePagesFor(sf(3, 4))).toEqual([1]);
  });

  it('wmEffectivePagesFor returns empty when nothing selected for that file', () => {
    __testing.setFiles([sf(1, 3), sf(2, 2)]);
    __testing.triggerWmFilesMutated();
    __testing.setWmSelected([0, 1, 2]);   // only file 1
    expect(__testing.wmEffectivePagesFor(sf(2, 2))).toEqual([]);
  });

  it('wmSelectedToRangeString serializes selection as a flat range', () => {
    __testing.setFiles([sf(1, 3), sf(2, 2)]);
    __testing.triggerWmFilesMutated();
    __testing.setWmSelected([0, 1, 2, 3, 4]);
    expect(__testing.wmSelectedToRangeString()).toBe('1-5');
    __testing.setWmSelected([0, 2, 4]);
    expect(__testing.wmSelectedToRangeString()).toBe('1, 3, 5');
  });

  it('wmDownloadLabel reads "Export PDF" when text + pages will stamp, regardless of file count', () => {
    __testing.setFiles([sf(1, 2)]);
    __testing.triggerWmFilesMutated();
    __testing.setWmSelected([0]);
    __testing.setWmSettings({ text: 'X' });
    expect(__testing.wmDownloadLabel()).toBe('Export PDF');
    __testing.setFiles([sf(1, 2), sf(2, 3), sf(3, 4)]);
    __testing.triggerWmFilesMutated();
    __testing.setWmSelected([0, 3]);
    expect(__testing.wmDownloadLabel()).toBe('Export PDF');
  });

  it('wmDownloadLabel always returns "Export PDF" - passthrough cases trust the user', () => {
    __testing.setFiles([sf(1, 5)]);
    __testing.triggerWmFilesMutated();
    // Text set, but no pages picked → passthrough.
    __testing.setWmSelected([]);
    __testing.setWmSettings({ text: 'X' });
    expect(__testing.wmDownloadLabel()).toBe('Export PDF');
    // Pages picked, but text empty → passthrough.
    __testing.setWmSelected([0]);
    __testing.setWmSettings({ text: '' });
    expect(__testing.wmDownloadLabel()).toBe('Export PDF');
  });

  it('wmDownloadDisabled allows passthrough when nothing is selected', () => {
    __testing.setFiles([sf(1, 5)]);
    __testing.triggerWmFilesMutated();
    __testing.setWmSelected([]);
    __testing.setWmSettings({ text: 'X' });
    const r = __testing.wmDownloadDisabled();
    expect(r.disabled).toBe(false);
    expect(__testing.wmDownloadLabel()).toBe('Export PDF');
  });

  it('wmDownloadDisabled is enabled when at least one page is selected', () => {
    __testing.setFiles([sf(1, 5)]);
    __testing.triggerWmFilesMutated();
    __testing.setWmSelected([0]);
    __testing.setWmSettings({ text: 'X' });
    expect(__testing.wmDownloadDisabled().disabled).toBe(false);
  });
});

describe('organizeAllowsPerSourceSplit', () => {
  beforeEach(() => {
    __testing.reset();
    __testing.setActiveTool('organize');
    __testing.setInitialized(true);
  });

  it('allows split when each source forms one contiguous block, no blanks', () => {
    __testing.seed(
      [srcPage(1, 1), srcPage(1, 2), srcPage(2, 1), srcPage(2, 2)],
      [sf(1, 2), sf(2, 2)],
    );
    expect(__testing.organizeAllowsPerSourceSplit()).toEqual({ allowed: true });
  });

  it('allows split when within-file pages are reordered (still one block per file)', () => {
    __testing.seed(
      [srcPage(1, 2), srcPage(1, 1), srcPage(2, 1), srcPage(2, 2)],
      [sf(1, 2), sf(2, 2)],
    );
    expect(__testing.organizeAllowsPerSourceSplit()).toEqual({ allowed: true });
  });

  it('blocks split when pages are mixed across files', () => {
    __testing.seed(
      [srcPage(1, 1), srcPage(2, 1), srcPage(1, 2)],   // A1, B1, A2, A revisited
      [sf(1, 2), sf(2, 1)],
    );
    const r = __testing.organizeAllowsPerSourceSplit();
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toMatch(/each file/i);
  });

  it('blocks split when a blank page is present', () => {
    __testing.seed(
      [srcPage(1, 1), { type: 'blank', rotation: 0, originalPos: 0, thumbnail: null } as any, srcPage(2, 1)],
      [sf(1, 1), sf(2, 1)],
    );
    const r = __testing.organizeAllowsPerSourceSplit();
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toMatch(/blank pages/i);
  });

  it('allows split for a single file with reordered pages', () => {
    __testing.seed(
      [srcPage(1, 3), srcPage(1, 1), srcPage(1, 2)],
      [sf(1, 3)],
    );
    expect(__testing.organizeAllowsPerSourceSplit()).toEqual({ allowed: true });
  });
});

// DOM-level tests: verify that user-facing event handlers (card clicks, Select
// all / Deselect all buttons) actually mutate the underlying selection state.
// State-shape tests above prove the parsing/serializing math; these prove the
// wiring.
describe('Watermark DOM interactions', () => {
  beforeEach(() => {
    __testing.reset();
  });

  function getCards(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>('.ws-wm-page-card[data-wm-flat-idx]'));
  }

  it('clicking a page card toggles its selection', () => {
    const root = __testing.setupForTest('watermark', [sf(1, 3)]);
    // Default selection on tab entry: every page selected.
    expect(__testing.getWmSelected().size).toBe(3);
    const cards = getCards(root);
    expect(cards.length).toBe(3);
    cards[0].click();
    expect(__testing.getWmSelected().has(0)).toBe(false);
    expect(__testing.getWmSelected().size).toBe(2);
    cards[0].click();
    expect(__testing.getWmSelected().has(0)).toBe(true);
    expect(__testing.getWmSelected().size).toBe(3);
  });

  it('shift-clicking extends selection from the last anchor', () => {
    const root = __testing.setupForTest('watermark', [sf(1, 5)]);
    // Start from a clean slate so we can observe the range extension cleanly.
    __testing.setWmSelected([]);
    const cards = getCards(root);
    cards[1].click(); // anchor at idx 1
    expect(__testing.getWmSelected().has(1)).toBe(true);
    cards[4].dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true, cancelable: true }));
    const sel = [...__testing.getWmSelected()].sort((a, b) => a - b);
    expect(sel).toEqual([1, 2, 3, 4]);
  });

  it('the "Watermarked" tag is present on every card and is shown via .ws-page-selected', () => {
    const root = __testing.setupForTest('watermark', [sf(1, 2)]);
    const cards = getCards(root);
    for (const c of cards) {
      expect(c.querySelector('.ws-wm-watermarked-tag')?.textContent).toBe('Watermarked');
      expect(c.classList.contains('ws-page-selected')).toBe(true);
    }
    cards[0].click(); // deselect first card
    expect(cards[0].classList.contains('ws-page-selected')).toBe(false);
    expect(cards[1].classList.contains('ws-page-selected')).toBe(true);
  });

  it('Select all / Deselect all buttons drive selection', () => {
    const root = __testing.setupForTest('watermark', [sf(1, 4)]);
    const findBtn = (label: string) =>
      Array.from(root.querySelectorAll<HTMLButtonElement>('.ws-btn'))
        .find(b => b.textContent === label)!;
    findBtn('Deselect all').click();
    expect(__testing.getWmSelected().size).toBe(0);
    findBtn('Select all').click();
    expect(__testing.getWmSelected().size).toBe(4);
  });

  it('renders a trailing "Drop more PDFs" dropzone card alongside page cards', () => {
    const root = __testing.setupForTest('watermark', [sf(1, 2)]);
    const dropzone = root.querySelector('.ws-page-card.ws-dropzone');
    expect(dropzone).not.toBeNull();
    expect(dropzone?.textContent).toContain('Drop more PDFs');
  });

  it('renders a quick watermark text input above the mobile export action', () => {
    const root = __testing.setupForTest('watermark', [sf(1, 2)]);
    const toolbar = document.querySelector<HTMLElement>('.ws-toolbar--watermark')!;
    const quickInput = toolbar.querySelector<HTMLInputElement>('.ws-prefix-input__field')!;
    const actionRow = toolbar.querySelector<HTMLElement>('.ws-toolbar-row')!;

    const inputWrap = toolbar.querySelector<HTMLElement>('.ws-prefix-input')!;
    expect(toolbar.firstElementChild).toBe(inputWrap);
    expect(inputWrap.contains(quickInput)).toBe(true);
    expect(toolbar.children[1]).toBe(actionRow);
    expect(actionRow.querySelector('.ws-wm-download-btn')?.textContent).toBe('Export PDF');

    quickInput.value = 'On the fly';
    quickInput.dispatchEvent(new Event('input', { bubbles: true }));

    expect(__testing.getWmSettings().text).toBe('On the fly');
    expect(root.querySelector<HTMLInputElement>('.ws-wm-panel-card .ws-wm-text-input')?.value).toBe('On the fly');
  });

  it('uses a down chevron instead of an X when the mobile tray is open', () => {
    __testing.setupForTest('watermark', [sf(1, 2)]);
    const iconBtn = document.querySelector<HTMLButtonElement>('.ws-toolbar--watermark .ws-toolbar-icon')!;

    iconBtn.click();

    expect(iconBtn.getAttribute('aria-label')).toBe('Hide options');
    expect(iconBtn.innerHTML).toContain('m6 9 6 6 6-6');
    expect(iconBtn.innerHTML).not.toContain('M6 6l12 12');
  });

  it('mounts the watermark tray in the closed state (no ws-tray-open, aria-expanded=false)', () => {
    // Regression: an `app-fade-in` keyframe on body-children once forced the
    // tray opaque on mount, making the non-interactive ghost visible before
    // the kebab was tapped. Mount must produce a fully closed tray.
    __testing.setupForTest('watermark', [sf(1, 2)]);
    const tray = document.querySelector<HTMLElement>('.ws-tray')!;
    const iconBtn = document.querySelector<HTMLButtonElement>('.ws-toolbar--watermark .ws-toolbar-icon')!;

    expect(tray.classList.contains('ws-tray-open')).toBe(false);
    expect(iconBtn.getAttribute('aria-expanded')).toBe('false');
    expect(iconBtn.getAttribute('aria-label')).toBe('More options');
  });

  it('empty watermark text keeps the Export PDF button enabled with no extra chrome', () => {
    const root = __testing.setupForTest('watermark', [sf(1, 2)]);
    const toolbar = document.querySelector<HTMLElement>('.ws-toolbar--watermark')!;
    const quickInput = toolbar.querySelector<HTMLInputElement>('.ws-prefix-input__field')!;
    const exportBtn = toolbar.querySelector<HTMLButtonElement>('.ws-wm-download-btn')!;

    quickInput.value = '';
    quickInput.dispatchEvent(new Event('input', { bubbles: true }));

    // Trust the user: empty text still exports (source PDF unchanged), with
    // no relabel, no inline hint. Matches every other passthrough in the app.
    expect(__testing.wmDownloadLabel()).toBe('Export PDF');
    expect(exportBtn.textContent).toBe('Export PDF');
    expect(exportBtn.getAttribute('aria-disabled')).toBeNull();
    expect(exportBtn.classList.contains('disabled')).toBe(false);

    const statusEl = root.querySelector<HTMLElement>('.ws-wm-panel-card .ws-wm-status')!;
    expect(statusEl.textContent).toBe('');

    const errorEl = root.querySelector<HTMLElement>('.ws-wm-panel-card .ws-wm-text-error')!;
    expect(errorEl.textContent).toBe('');

    const desktopInput = root.querySelector<HTMLInputElement>('.ws-wm-panel-card .ws-wm-text-input')!;
    expect(desktopInput.classList.contains('ws-input-error')).toBe(false);
    expect(desktopInput.getAttribute('aria-invalid')).toBeNull();
  });

  it('non-empty text keeps the Export PDF label and a clean status', () => {
    const root = __testing.setupForTest('watermark', [sf(1, 2)]);
    const quickInput = document.querySelector<HTMLInputElement>('.ws-toolbar--watermark .ws-prefix-input__field')!;

    quickInput.value = '';
    quickInput.dispatchEvent(new Event('input', { bubbles: true }));
    quickInput.value = 'CONFIDENTIAL';
    quickInput.dispatchEvent(new Event('input', { bubbles: true }));

    expect(__testing.wmDownloadLabel()).toBe('Export PDF');
    const statusEl = root.querySelector<HTMLElement>('.ws-wm-panel-card .ws-wm-status')!;
    expect(statusEl.textContent).toBe('');
    const errorEl = root.querySelector<HTMLElement>('.ws-wm-panel-card .ws-wm-text-error')!;
    expect(errorEl.textContent).toBe('');
  });

  it('flags the grid with ws-wm-no-overlay when watermark text is empty', () => {
    const root = __testing.setupForTest('watermark', [sf(1, 2)]);
    const grid = root.querySelector<HTMLElement>('.ws-wm-page-grid')!;
    const quickInput = document.querySelector<HTMLInputElement>('.ws-toolbar--watermark .ws-prefix-input__field')!;

    quickInput.value = '';
    quickInput.dispatchEvent(new Event('input', { bubbles: true }));
    // Flush rAF so the kick that handleWmTextInput scheduled paints once.
    return new Promise<void>(r => requestAnimationFrame(() => {
      expect(grid.classList.contains('ws-wm-no-overlay')).toBe(true);
      r();
    }));
  });
});

// Organize selection / pages persist when files mutate from another tab.
// Pre-pageId, onFilesMutated wiped the entire pages array and selection set.
describe('Organize state across cross-tab file mutations', () => {
  beforeEach(() => {
    __testing.reset();
    __testing.setActiveTool('organize');
    __testing.setInitialized(true);
  });

  it('preserves surviving pages and their selections when a file is removed', () => {
    __testing.seed(
      [srcPage(1, 1), srcPage(1, 2), srcPage(2, 1), srcPage(2, 2), srcPage(3, 1)],
      [sf(1, 2), sf(2, 2), sf(3, 1)],
      [0, 4], // pick page A1 and page C1
    );
    // Cross-tab removal of file 2 (the middle one).
    __testing.setFiles([sf(1, 2), sf(3, 1)]);
    __testing.triggerWmFilesMutated();

    const pages = __testing.getPages();
    expect(pages.length).toBe(3);
    expect(pages.map(p => `${p.sourceFileId}:${p.sourcePageNum}`))
      .toEqual(['1:1', '1:2', '3:1']);
    // The two originally-selected pages survive in the selection set.
    expect(__testing.getSelected().size).toBe(2);
  });

  it('appends new files\' pages to the end when a file is added', () => {
    __testing.seed(
      [srcPage(1, 1), srcPage(1, 2)],
      [sf(1, 2)],
      [0],
    );
    __testing.setFiles([sf(1, 2), sf(2, 2)]);
    __testing.triggerWmFilesMutated();

    const pages = __testing.getPages();
    expect(pages.map(p => `${p.sourceFileId}:${p.sourcePageNum}`))
      .toEqual(['1:1', '1:2', '2:1', '2:2']);
    // Original selection survives; newly-appended pages are not auto-selected.
    expect(__testing.getSelected().size).toBe(1);
  });
});

// Selection-persistence invariants: regressions on these would resurrect the
// "everything gets selected" / "selection silently shifts" bugs.
describe('Watermark selection across file mutations', () => {
  beforeEach(() => { __testing.reset(); });

  it('preserves prior selection on file add and auto-selects the new file', () => {
    __testing.setupForTest('watermark', [sf(1, 2)]);
    // Start: every page selected on first entry. Deselect file 1's pages.
    __testing.setWmSelected([]);
    expect(__testing.getWmSelected().size).toBe(0);

    // User drops a second file with 3 pages.
    __testing.setFiles([sf(1, 2), sf(2, 3)]);
    __testing.triggerWmFilesMutated();

    // File 1's pages stay deselected (size 0 + size 3 = 3); only file 2's
    // pages are selected, demonstrating Default-selected on add without
    // reviving the previously deselected set.
    expect(__testing.getWmSelected().size).toBe(3);
    const keys = [...__testing.getWmSelectedKeys()].sort();
    expect(keys).toEqual(['2:1', '2:2', '2:3']);
  });

  it('preserves selection of surviving files when one is removed', () => {
    __testing.setupForTest('watermark', [sf(1, 2), sf(2, 2), sf(3, 2)]);
    // Pick file 1 + file 3 only (deselect file 2's pages 2,3 = flat indices 2,3).
    __testing.setWmSelected(['1:1', '1:2', '3:1', '3:2']);

    // Remove file 2 from the middle.
    __testing.setFiles([sf(1, 2), sf(3, 2)]);
    __testing.triggerWmFilesMutated();

    const keys = [...__testing.getWmSelectedKeys()].sort();
    expect(keys).toEqual(['1:1', '1:2', '3:1', '3:2']);
  });

  it('deselect-all then add-file selects only the new file', () => {
    __testing.setupForTest('watermark', [sf(1, 3)]);
    __testing.setWmSelected([]);

    __testing.setFiles([sf(1, 3), sf(2, 2)]);
    __testing.triggerWmFilesMutated();

    const keys = [...__testing.getWmSelectedKeys()].sort();
    expect(keys).toEqual(['2:1', '2:2']);
  });
});

// ---------------------------------------------------------------------------
// Cancelling a per-file job
// ---------------------------------------------------------------------------

describe('a cancelled per-file save offers what it finished', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="popup-bg" class="modal-overlay"></div>
      <div id="popup" class="card-base modal-container"></div>`;
    // `ui` resolved its refs when the store module loaded, against a document
    // this file has since replaced.
    (ui as any).popupBox = document.getElementById('popup');
    (ui as any).popupBackground = document.getElementById('popup-bg');
  });

  const doc = (name: string) => ({ name, bytes: new Uint8Array([1, 2, 3]) });

  it('offers the finished files instead of closing silently', () => {
    // These loops complete whole documents before they are stopped. Discarding
    // them meant Cancel could only be paid for by redoing the ones that had
    // already succeeded.
    __testing.offerPartialPdfResult([doc('a.pdf'), doc('b.pdf'), doc('c.pdf')], 'organized.zip');

    const popup = document.getElementById('popup')!;
    expect(popup.querySelector('h2')!.textContent).toBe('Stopped');
    expect(popup.querySelector('p')!.textContent).toMatch(/3.*finished before you stopped/);
    const buttons = [...popup.querySelectorAll('.popup-actions-footer button')].map(b => b.textContent);
    expect(buttons).toEqual(['Download 3 files (.zip)', 'Done']);
  });

  it('names the single file when only one finished', () => {
    __testing.offerPartialPdfResult([doc('report.pdf')], 'organized.zip');
    const popup = document.getElementById('popup')!;
    expect(popup.querySelector('p')!.textContent).toMatch(/report\.pdf.*finished before you stopped/);
    expect(popup.querySelector('.popup-actions-footer button')!.textContent).toBe('Download');
  });

  it('stays silent when nothing finished', () => {
    // The popup is already closed, and "0 files were saved" is worse than the
    // editor simply reappearing intact.
    __testing.offerPartialPdfResult([], 'organized.zip');
    expect(document.getElementById('popup')!.querySelector('h2')).toBeNull();
  });

  it('does not claim a download is under way', () => {
    __testing.offerPartialPdfResult([doc('a.pdf'), doc('b.pdf')], 'z.zip');
    expect(document.getElementById('popup')!.textContent).not.toMatch(/downloading now/i);
    expect(document.getElementById('popup')!.textContent).toMatch(/ready to download/);
  });
});

describe('sidebar file management', () => {
  const countRowButtons = (root: ParentNode) =>
    [...root.querySelectorAll('.ws-sidebar-count-row .ws-count-btn-group button')]
      .map(b => b.textContent);

  /** The visible panel: desktop card and mobile tray are both in the DOM. */
  const panels = () => [
    ...document.querySelectorAll('.ws-sidebar-card, .ws-wm-panel-card, .ws-tray-scroll'),
  ].filter(p => p.querySelector('.ws-sidebar-files'));

  for (const tab of ['merge', 'organize', 'watermark'] as const) {
    it(`offers Replace all and Clear on ${tab}, in every panel that lists files`, () => {
      __testing.setupForTest(tab, [sf(1, 2), sf(2, 3)]);
      const found = panels();
      expect(found.length).toBeGreaterThan(0);
      for (const panel of found) {
        // Exactly two, never three: a third small button wraps every label onto
        // two lines at the sidebar's real width.
        expect(countRowButtons(panel)).toEqual(['Replace all', 'Clear']);
      }
    });

    it(`moves + Add out of the count row and under the file list on ${tab}`, () => {
      __testing.setupForTest(tab, [sf(1, 2), sf(2, 3)]);
      for (const panel of panels()) {
        const list = panel.querySelector('.ws-sidebar-files')!;
        const addRow = list.nextElementSibling;
        expect(addRow?.className).toContain('ws-sidebar-btn-row');
        expect([...addRow!.querySelectorAll('button')].map(b => b.textContent)).toContain('+ Add');
      }
    });
  }

  it('asks before clearing, and keeps the files if the confirm is dismissed', () => {
    document.body.insertAdjacentHTML('beforeend',
      '<div id="popup-bg" class="modal-overlay"></div><div id="popup" class="card-base modal-container"></div>');
    (ui as any).popupBox = document.getElementById('popup');
    (ui as any).popupBackground = document.getElementById('popup-bg');
    __testing.setupForTest('merge', [sf(1, 2), sf(2, 3)]);

    const clear = [...document.querySelectorAll<HTMLButtonElement>('.ws-count-btn-group button')]
      .find(b => b.textContent === 'Clear')!;
    clear.click();

    const popup = document.getElementById('popup')!;
    expect(popup.querySelector('h2')!.textContent).toBe('Clear all files?');
    const [confirm, dismiss] = [...popup.querySelectorAll<HTMLButtonElement>('.popup-actions-footer button')];
    expect(confirm.textContent).toBe('Clear');
    expect(dismiss.textContent).toBe('Keep them');

    dismiss.click();
    expect(__testing.getFiles().length).toBe(2);
  });

  it('puts Pages above the tool settings on watermark, as on organize', () => {
    __testing.setupForTest('watermark', [sf(1, 3)]);
    const panel = panels()[0];
    const labels = [...panel.querySelectorAll('.ws-sidebar-section-label')].map(l => l.textContent);
    // Asserted as an order, not an index, so a block gaining a row cannot
    // silently break it.
    expect(labels.indexOf('Pages')).toBeGreaterThanOrEqual(0);
    expect(labels.indexOf('Watermark')).toBeGreaterThanOrEqual(0);
    expect(labels.indexOf('Pages')).toBeLessThan(labels.indexOf('Watermark'));
  });
});

describe('watermark Reset style', () => {
  const resetRows = () => [...document.querySelectorAll<HTMLElement>('.ws-wm-reset-row')];
  const resetBtns = () => [...document.querySelectorAll<HTMLButtonElement>('.ws-wm-reset-row button')];

  it('stays hidden while the style is untouched', () => {
    __testing.setupForTest('watermark', [sf(1, 2)]);
    expect(resetRows().length).toBeGreaterThan(0);
    expect(resetRows().every(r => r.hidden)).toBe(true);
  });

  it('appears once a style control moves off its default', () => {
    __testing.setupForTest('watermark', [sf(1, 2)]);
    const opacity = document.querySelector<HTMLInputElement>('[data-wm="opacity"] .ws-wm-slider')!;
    opacity.value = '20';
    opacity.dispatchEvent(new Event('input'));

    expect(resetRows().some(r => !r.hidden)).toBe(true);
  });

  it('restores every style field, in state and in the inputs', () => {
    __testing.setWmSettings({
      fontSize: 24, colorHex: '#ff0000', opacity: 0.9, rotation: 15, repeat: true,
    });
    __testing.setupForTest('watermark', [sf(1, 2)]);
    expect(resetRows().some(r => !r.hidden)).toBe(true);

    resetBtns()[0].click();

    const s = __testing.getWmSettings();
    expect(s.fontSize).toBe(80);
    expect(s.colorHex).toBe('#808080');
    expect(s.opacity).toBe(0.5);
    expect(s.rotation).toBe(-45);
    expect(s.repeat).toBe(false);

    // The controls have no reactive binding, so state alone is not enough:
    // a stale input would silently write the old value back on the next nudge.
    expect(document.querySelector<HTMLInputElement>('[data-wm="size"] .ws-wm-slider')!.value).toBe('80');
    expect(document.querySelector<HTMLInputElement>('[data-wm="opacity"] .ws-wm-slider')!.value).toBe('50');
    expect(document.querySelector<HTMLInputElement>('[data-wm="rotation"] .ws-wm-slider')!.value).toBe('-45');
    expect(document.querySelector<HTMLInputElement>('.ws-wm-color-hex')!.value).toBe('#808080');
    expect(document.querySelector<HTMLInputElement>('.ws-wm-repeat-checkbox')!.checked).toBe(false);
  });

  it('leaves the watermark text alone', () => {
    __testing.setWmSettings({ text: 'DRAFT COPY', opacity: 0.9 });
    __testing.setupForTest('watermark', [sf(1, 2)]);

    resetBtns()[0].click();

    expect(__testing.getWmSettings().text).toBe('DRAFT COPY');
  });

  it('hides itself again, and hands focus on rather than stranding it', () => {
    __testing.setWmSettings({ rotation: 15 });
    __testing.setupForTest('watermark', [sf(1, 2)]);

    resetBtns()[0].click();

    expect(resetRows().every(r => r.hidden)).toBe(true);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.classList.contains('ws-wm-repeat-checkbox')).toBe(true);
  });

  it('syncs every mounted panel, not just the one clicked', () => {
    __testing.setWmSettings({ opacity: 0.9 });
    __testing.setupForTest('watermark', [sf(1, 2)]);
    // Open the phone tray so a second copy of the style controls is mounted.
    document.querySelector<HTMLButtonElement>('.ws-toolbar-icon')!.click();
    const sliders = () => [...document.querySelectorAll<HTMLInputElement>('[data-wm="opacity"] .ws-wm-slider')];
    expect(sliders().length).toBeGreaterThan(1);

    resetBtns()[0].click();

    expect(sliders().every(s => s.value === '50')).toBe(true);
    expect(resetRows().every(r => r.hidden)).toBe(true);
  });
});

describe('removing a file from the mobile tray', () => {
  it('leaves the tray open instead of destroying it mid-interaction', () => {
    __testing.setupForTest('watermark', [sf(1, 2), sf(2, 2)]);
    const iconBtn = document.querySelector<HTMLButtonElement>('.ws-toolbar-icon')!;
    iconBtn.click();
    expect(document.querySelector('.ws-tray.ws-tray-open')).not.toBeNull();

    document.querySelector<HTMLButtonElement>('.ws-tray .ws-file-list-remove')!.click();

    expect(__testing.getFiles().length).toBe(1);
    // A different element than before - the tool re-rendered - but still open,
    // so clearing three files does not mean reopening the sheet three times.
    expect(document.querySelector('.ws-tray.ws-tray-open')).not.toBeNull();
    expect(document.querySelector('.ws-tray .ws-file-list-remove')).not.toBeNull();
  });

  it('does not strand focus on <body> after the removed row is destroyed', () => {
    __testing.setupForTest('watermark', [sf(1, 2), sf(2, 2)]);
    document.querySelector<HTMLButtonElement>('.ws-toolbar-icon')!.click();
    document.querySelector<HTMLButtonElement>('.ws-tray .ws-file-list-remove')!.click();

    const tray = document.querySelector('.ws-tray.ws-tray-open')!;
    expect(document.activeElement).not.toBe(document.body);
    expect(tray.contains(document.activeElement)).toBe(true);
  });

  it('releases the scroll lock when cleanup deletes an open tray', () => {
    // The lock is derived from an open tray existing. Deleting the tray without
    // re-deriving it left `overflow-y: hidden` on <html> with no sheet on
    // screen and no way to dismiss it.
    __testing.setupForTest('watermark', [sf(1, 2)]);
    document.querySelector<HTMLButtonElement>('.ws-toolbar-icon')!.click();
    expect(document.documentElement.classList.contains('scroll-lock')).toBe(true);

    __testing.cleanup();

    expect(document.querySelector('.ws-tray')).toBeNull();
    expect(document.documentElement.classList.contains('scroll-lock')).toBe(false);
  });
});

describe('removing a file from a panel that survives the removal', () => {
  it('hands focus to the next × on merge, which repaints in place', () => {
    __testing.setupForTest('merge', [sf(1, 2), sf(2, 2), sf(3, 2)]);
    const card = document.querySelector<HTMLElement>('.ws-sidebar-card')!;
    const first = card.querySelectorAll<HTMLButtonElement>('.ws-file-list-remove')[0];
    first.focus();

    first.click();

    expect(__testing.getFiles().length).toBe(2);
    expect(document.activeElement).not.toBe(document.body);
    expect(card.contains(document.activeElement)).toBe(true);
    expect((document.activeElement as HTMLElement).className).toContain('ws-file-list-remove');
  });

  it('falls back to the button row once the last file is removed', () => {
    __testing.setupForTest('merge', [sf(1, 2)]);
    const card = document.querySelector<HTMLElement>('.ws-sidebar-card')!;
    const only = card.querySelector<HTMLButtonElement>('.ws-file-list-remove');
    // With a single file the row may not offer a ×; nothing to assert if so.
    if (!only) return;
    only.focus();
    only.click();
    expect(document.activeElement).not.toBe(document.body);
  });

  it('leaves focus alone when the × was clicked without holding focus', () => {
    __testing.setupForTest('merge', [sf(1, 2), sf(2, 2)]);
    const card = document.querySelector<HTMLElement>('.ws-sidebar-card')!;
    (document.activeElement as HTMLElement | null)?.blur();

    card.querySelectorAll<HTMLButtonElement>('.ws-file-list-remove')[0].click();

    expect(document.activeElement).toBe(document.body);
  });
});

describe('announcing removals to a screen reader', () => {
  // A removal changes nothing that reads as text: the row disappears and the
  // count beside it is rebuilt rather than edited. Sighted users watch the
  // list get shorter; without this, screen reader users get silence.
  const announcer = () => document.getElementById('a11y-announcer');

  it('says what went and what is left', () => {
    __testing.setupForTest('merge', [sf(1, 2), sf(2, 2), sf(3, 2)]);
    const card = document.querySelector<HTMLElement>('.ws-sidebar-card')!;
    card.querySelectorAll<HTMLButtonElement>('.ws-file-list-remove')[0].click();

    expect(announcer()!.textContent).toMatch(/Removed .+\. 2 files remaining\./);
  });

  it('counts down in words that match the number', () => {
    __testing.setupForTest('merge', [sf(1, 2), sf(2, 2)]);
    const card = document.querySelector<HTMLElement>('.ws-sidebar-card')!;
    card.querySelectorAll<HTMLButtonElement>('.ws-file-list-remove')[0].click();
    // "1 files remaining" is the kind of thing only a machine says.
    expect(announcer()!.textContent).toMatch(/1 file remaining\./);
  });

  it('says so when that was the last one', () => {
    __testing.setupForTest('merge', [sf(1, 2)]);
    const btn = document.querySelector<HTMLButtonElement>('.ws-file-list-remove');
    if (!btn) return;
    btn.click();
    expect(announcer()!.textContent).toMatch(/No files left\./);
  });

  it('announces a second removal even when the sentence repeats', () => {
    // Two removals can produce identical text, and identical text is not a
    // change - so the second would pass in silence.
    __testing.setupForTest('merge', [sf(1, 2), sf(2, 2), sf(3, 2)]);
    const card = document.querySelector<HTMLElement>('.ws-sidebar-card')!;
    card.querySelectorAll<HTMLButtonElement>('.ws-file-list-remove')[0].click();
    const first = announcer()!.textContent;
    card.querySelectorAll<HTMLButtonElement>('.ws-file-list-remove')[0].click();
    expect(announcer()!.textContent).not.toBe(first);
  });

  it('keeps the region out of sight and out of the layout', () => {
    __testing.setupForTest('merge', [sf(1, 2), sf(2, 2)]);
    document.querySelector<HTMLButtonElement>('.ws-file-list-remove')!.click();
    const region = announcer()!;
    expect(region.className).toContain('sr-only');
    expect(region.getAttribute('aria-live')).toBe('polite');
    // Not hidden: display:none and visibility:hidden both take an element out
    // of the accessibility tree, which is the one thing a live region cannot be.
    expect(region.hasAttribute('hidden')).toBe(false);
    expect(region.getAttribute('aria-hidden')).toBeNull();
  });
});

describe('bulk file action accessibility', () => {
  it('names what Replace all and Clear act on, keeping the visible text as a prefix', () => {
    __testing.setupForTest('merge', [sf(1, 2), sf(2, 2)]);
    const buttons = [...document.querySelectorAll<HTMLButtonElement>(
      '.ws-sidebar-card .ws-count-btn-group button')];
    for (const btn of buttons) {
      const name = btn.getAttribute('aria-label')!;
      expect(name).toBeTruthy();
      // WCAG 2.5.3: speech control has to be able to act on what it can read.
      expect(name.startsWith(btn.textContent!)).toBe(true);
      expect(name).toMatch(/files$/);
    }
    expect(buttons.map(b => b.getAttribute('aria-label')))
      .toEqual(['Replace all files', 'Clear all files']);
  });

  it('does not leave a stale Escape handler behind for every rebuilt tray', () => {
    __testing.setupForTest('watermark', [sf(1, 2), sf(2, 2), sf(3, 2)]);
    document.querySelector<HTMLButtonElement>('.ws-toolbar-icon')!.click();
    // Two removals, each rebuilding the tray while it is open.
    document.querySelector<HTMLButtonElement>('.ws-tray .ws-file-list-remove')!.click();
    document.querySelector<HTMLButtonElement>('.ws-tray .ws-file-list-remove')!.click();

    // Escape must close the one live tray, not fire once per orphaned handler
    // against detached nodes.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(document.querySelector('.ws-tray.ws-tray-open')).toBeNull();
    const iconBtn = document.querySelector<HTMLButtonElement>('.ws-toolbar-icon')!;
    expect(iconBtn.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(iconBtn);
  });
});
