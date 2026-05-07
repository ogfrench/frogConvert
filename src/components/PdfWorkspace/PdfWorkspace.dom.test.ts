import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../tools/pdfThumbnails.ts', () => ({
  renderPageThumbnail: vi.fn(async () => ''),
  clearThumbnailCache: vi.fn(),
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
import type { PageEntry, SourceFile } from '../../tools/types.ts';

function srcPage(fileId: number, pageNum: number, rotation: 0 | 90 | 180 | 270 = 0): PageEntry {
  return { type: 'source', sourceFileId: fileId, sourcePageNum: pageNum, thumbnail: null, rotation, originalPos: pageNum };
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

  it('wmDownloadLabel always returns "Export PDF" (no per-file zip wording)', () => {
    __testing.setFiles([sf(1, 2)]);
    expect(__testing.wmDownloadLabel()).toBe('Export PDF');
    __testing.setFiles([sf(1, 2), sf(2, 3), sf(3, 4)]);
    expect(__testing.wmDownloadLabel()).toBe('Export PDF');
  });

  it('wmDownloadDisabled is disabled when nothing is selected', () => {
    __testing.setFiles([sf(1, 5)]);
    __testing.triggerWmFilesMutated();
    __testing.setWmSelected([]);
    __testing.setWmSettings({ text: 'X' });
    const r = __testing.wmDownloadDisabled();
    expect(r.disabled).toBe(true);
    expect(r.reason).toBe('Pick at least one page');
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
    const dropzone = root.querySelector('.ws-page-card.ws-page-add');
    expect(dropzone).not.toBeNull();
    expect(dropzone?.textContent).toContain('Drop more PDFs');
  });
});
