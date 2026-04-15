import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../tools/pdfThumbnails.ts', () => ({
  renderPageThumbnail: vi.fn(async () => ''),
  clearThumbnailCache: vi.fn(),
  mockPageThumb: vi.fn(() => ''),
}));

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
