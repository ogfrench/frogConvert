import './PdfWorkspace.css';
import Sortable from 'sortablejs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import type { PageEntry, SourceFile } from '../../tools/types.ts';
import { getNextFileId } from '../../tools/types.ts';
import { merge } from '../../tools/pdfMerge.ts';
import { extract } from '../../tools/pdfExtract.ts';
import { organize } from '../../tools/pdfOrganize.ts';
import {
  watermark,
  hexToRgb,
  placementCoords,
  tilePositions,
  rotatedOrigin,
  WatermarkValidationError,
  WATERMARK_DEFAULTS,
  type PdfWatermarkOptions,
} from '../../tools/pdfWatermark.ts';
import { renderPageThumbnail, renderPageBitmap, clearThumbnailCache, mockPageThumb } from '../../tools/pdfThumbnails.ts';
import { downloadFile, downloadAsZip } from '../../conversion/download.ts';
import { isTouchUi } from '../../core/utils/touchUi.ts';
import { showToast } from '../Toast/Toast.ts';
import { showPopup, hidePopup, replacePopup, createPopupButton, showUploadSummaryPopup, type UploadResult } from '../Popup/Popup.ts';
import { formatBytes, escapeHTML, shortenFileName, ensureMinDuration, toUserErrorInfo, appendSupportContact, FEEDBACK_CONTACT_TEXT } from '../utils/index.ts';
import { createDancingFrog } from '../Frogsworth/DancingFrog.ts';
import { triggerConfetti } from '../../effects/Confetti/Confetti.ts';
import { ui, updateScrollLock } from '../store/store.ts';

// ---------------------------------------------------------------------------
// State: shared file pool, per-tab working state
// ---------------------------------------------------------------------------

const TOOLS = ['merge', 'organize', 'watermark'] as const;
type Tool = typeof TOOLS[number];

let files: SourceFile[] = [];
// Organize state (persists across tab switches)
let pages: PageEntry[] = [];
let selected = new Set<number>();
let selectedFiles = new Set<number>();
let lastClickedIdx = -1;
let organizeInitialized = false; // true once pages derived from files

function onFilesMutated(): void {
  organizeInitialized = false;
  selected.clear();
  const fileIds = new Set(files.map(f => f.id));
  for (const id of selectedFiles) {
    if (!fileIds.has(id)) selectedFiles.delete(id);
  }
  // Watermark grid tracks a flat page list, rebuild it when files change.
  wmRebuildFlatPages();
}

// File order changed but ids unchanged, preserve `selectedFiles`; only the
// derived page indices are invalid.
function onFilesReordered(): void {
  organizeInitialized = false;
  selected.clear();
}


let _autoScrollFrame: number | null = null;
let _autoScrollY = 0;
const _onAutoScrollPointerMove = (e: PointerEvent) => { _autoScrollY = e.clientY; };

function startAutoScroll(leftCard: HTMLElement): void {
  _autoScrollY = 0;
  document.addEventListener('pointermove', _onAutoScrollPointerMove, { passive: true });
  document.addEventListener('pointerup', stopAutoScroll, { once: true, capture: true });
  const SENSITIVITY = 200;
  const SPEED = 16;
  const tick = () => {
    const rect = leftCard.getBoundingClientRect();
    const topBound = Math.max(rect.top, 0);
    const botBound = Math.min(rect.bottom, window.innerHeight);
    const distTop = _autoScrollY - topBound;
    const distBot = botBound - _autoScrollY;
    if (distTop < SENSITIVITY && distTop >= 0)
      window.scrollBy(0, -SPEED * (1 - distTop / SENSITIVITY));
    if (distBot < SENSITIVITY && distBot >= 0)
      window.scrollBy(0,  SPEED * (1 - distBot / SENSITIVITY));
    _autoScrollFrame = requestAnimationFrame(tick);
  };
  _autoScrollFrame = requestAnimationFrame(tick);
}

function stopAutoScroll(): void {
  if (_autoScrollFrame) { cancelAnimationFrame(_autoScrollFrame); _autoScrollFrame = null; }
  document.removeEventListener('pointermove', _onAutoScrollPointerMove);
}

// ---------------------------------------------------------------------------
// Multi-drag visuals (shared between merge + organize Sortable instances)
// ---------------------------------------------------------------------------

function applyMultiDragVisuals(
  container: HTMLElement,
  itemSelector: string,
  getId: (el: HTMLElement) => number,
  draggedId: number,
  selectionSet: Set<number>,
): void {
  requestAnimationFrame(() => {
    const ghost = document.querySelector('.sortable-fallback') as HTMLElement;
    if (ghost) {
      const badge = document.createElement('span');
      badge.className = 'ws-ghost-count';
      badge.textContent = String(selectionSet.size);
      ghost.appendChild(badge);
    }
  });
  container.querySelectorAll<HTMLElement>(itemSelector).forEach(el => {
    const id = getId(el);
    if (!isNaN(id) && id !== draggedId && selectionSet.has(id)) {
      el.classList.add('ws-multi-drag-hidden');
    }
  });
}

function clearMultiDragVisuals(container: HTMLElement): void {
  container.querySelectorAll('.ws-multi-drag-hidden').forEach(el =>
    el.classList.remove('ws-multi-drag-hidden'));
}

function setKeyboardMode(on: boolean): void {
  document.body.classList.toggle('ws-keyboard-mode', on);
}

function extractBtnText(cnt: number): string {
  return cnt === 0 ? 'Select pages to extract' : `Extract ${cnt} page${cnt !== 1 ? 's' : ''}`;
}

// Dragging an unselected item resets the selection to just that item. Shared
// invariant across the Organize and Merge Sortable `onStart` handlers, then
// the `onEnd` branches decide between single- and multi-drag off a correct
// selection state.
function stompDragSelection<T>(set: Set<T>, id: T, onChanged: () => void): void {
  if (set.has(id)) return;
  set.clear();
  set.add(id);
  onChanged();
}

function refreshMergeUi(): void {
  updateMergeSelectionVisuals();
  if (mergeSidebarCard) updateMergeSidebarContent(mergeSidebarCard);
  if (mergeMobileTray) updateMergeSidebarContent(mergeMobileTray);
}

function moveSelection(dir: 'up' | 'down'): boolean {
  if (!selected.size) return false;
  const sorted = [...selected].sort((a, b) => a - b);
  if (dir === 'up' && sorted[0] === 0) return false;
  if (dir === 'down' && sorted[sorted.length - 1] === pages.length - 1) return false;

  pushHistory();
  const movingSet = new Set(sorted);
  const moving = sorted.map(i => pages[i]);
  const kept = pages.filter((_, i) => !movingSet.has(i));
  const dropAt = dir === 'up' ? sorted[0] - 1 : sorted[sorted.length - 1] + 2;
  const removedBefore = sorted.filter(i => i < dropAt).length;
  const insertAt = dropAt - removedBefore;
  kept.splice(insertAt, 0, ...moving);
  pages.length = 0;
  pages.push(...kept);
  selected.clear();
  moving.forEach(p => { const ni = pages.indexOf(p); if (ni >= 0) selected.add(ni); });
  return true;
}


type HistorySnapshot = {
  pages: PageEntry[];
  selected: Set<number>;
  files: SourceFile[];
  lastClickedIdx: number;
};
const history: HistorySnapshot[] = [];
const HISTORY_MAX = 30;

function pushHistory() {
  history.push({
    pages: pages.map(p => ({ ...p })),
    selected: new Set(selected),
    files: files.slice(),
    lastClickedIdx,
  });
  if (history.length > HISTORY_MAX) history.shift();
}

function undo() {
  const snap = history.pop();
  if (!snap) return;
  pages = snap.pages;
  selected = snap.selected;
  files = snap.files;
  lastClickedIdx = snap.lastClickedIdx;
  renderOrganizeView();
  kickPageThumbs(pages);
}

let activeTool: Tool = 'merge';
let saveBtn: HTMLElement | null = null;
let extractBtn: HTMLElement | null = null;
let mobileActionBtn: HTMLElement | null = null;
let mobileExtractBtn: HTMLElement | null = null;
let rangeInput: HTMLInputElement | null = null;
let gridEl: HTMLElement | null = null;
let mergeGridContainer: HTMLElement | null = null;
let mergeSidebarCard: HTMLElement | null = null;
let mergeMobileTray: HTMLElement | null = null;
let organizeMobileTray: HTMLElement | null = null;
let sortableInstance: Sortable | null = null;
let pendingMultiDrag: { pages: PageEntry[]; dragIdx: number } | null = null;
let thumbnailObserver: IntersectionObserver | null = null;
let initialized = false;

let lastPdfResult: { bytes: Uint8Array; name: string }[] = [];
let lastPdfZipName: string | null = null;

let toolContent: HTMLElement;
let fileInput: HTMLInputElement;
let errorEl: HTMLElement;

const EAGER_LIMIT = 50;

const MAX_TOTAL_FILE_SIZE = 500 * 1024 * 1024; // 500 MB total
const MAX_FILES = 300;
const MAX_TOTAL_PAGES = 300;

// ---------------------------------------------------------------------------
// Init + Tab switching
// ---------------------------------------------------------------------------

export function getActiveTool(): Tool { return activeTool; }

// Sync tab DOM with the active tool. Updates the .active class, aria-selected,
// and tabindex (roving — only the selected tab is keyboard-tabbable). The
// tabpanel's aria-labelledby tracks the active tab so SR announces the panel
// header correctly after a switch.
function syncTabsUI(t: Tool) {
  const tabs = document.getElementById('pdf-editor-tabs');
  if (!tabs) return;
  for (const b of tabs.querySelectorAll<HTMLButtonElement>('.cat-tab')) {
    const isActive = b.dataset.tool === t;
    b.classList.toggle('active', isActive);
    b.setAttribute('aria-selected', String(isActive));
    b.tabIndex = isActive ? 0 : -1;
  }
  document.getElementById('pdf-tool-content')?.setAttribute('aria-labelledby', `pdf-tab-${t}`);
}

export function selectPdfTool(tool: string) {
  const t = tool as Tool;
  if (!(TOOLS as readonly string[]).includes(t)) return;
  if (!initialized) { activeTool = t; return; }
  if (activeTool === t) return;
  activeTool = t;

  syncTabsUI(t);

  renderActiveTool();
}

export function initPdfWorkspace() {
  if (initialized) return;
  initialized = true;

  toolContent = document.getElementById('pdf-tool-content')!;
  fileInput = document.getElementById('workspace-file-input') as HTMLInputElement;
  errorEl = document.getElementById('workspace-error')!;

  // Blank-page thumbs bake theme colors into an SVG data URL, so re-render on theme toggle.
  let wasDark = document.documentElement.classList.contains('dark');
  new MutationObserver(() => {
    const isDark = document.documentElement.classList.contains('dark');
    if (isDark === wasDark) return;
    wasDark = isDark;
    requestAnimationFrame(() => {
      if (!gridEl) return;
      const src = mockPageThumb('Blank');
      gridEl.querySelectorAll<HTMLImageElement>('.ws-page-card img[alt="Blank page"]').forEach(img => {
        img.src = src;
      });
    });
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

  // Apply pending tool
  const tabs = document.getElementById('pdf-editor-tabs')!;
  syncTabsUI(activeTool);

  tabs.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.cat-tab') as HTMLButtonElement | null;
    if (!btn || btn.classList.contains('active')) return;
    activeTool = btn.dataset.tool as Tool;
    syncTabsUI(activeTool);
    renderActiveTool();
  });

  // Arrow-key roving navigation across the tablist
  tabs.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    const buttons = Array.from(tabs.querySelectorAll<HTMLButtonElement>('.cat-tab'));
    const current = buttons.findIndex(b => b.dataset.tool === activeTool);
    if (current < 0) return;
    let next = current;
    if (e.key === 'ArrowLeft') next = (current - 1 + buttons.length) % buttons.length;
    else if (e.key === 'ArrowRight') next = (current + 1) % buttons.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = buttons.length - 1;
    e.preventDefault();
    activeTool = buttons[next].dataset.tool as Tool;
    syncTabsUI(activeTool);
    buttons[next].focus();
    renderActiveTool();
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files?.length) handleFiles(Array.from(fileInput.files));
    fileInput.value = '';
  });

  document.addEventListener('keydown', handleGlobalKeydown);

  // Track the virtual keyboard so the fixed mobile toolbar can slide above it.
  // Without this, focusing the watermark text input or page-range input on iOS
  // hides the Export/Download button behind the keyboard.
  if (typeof window !== 'undefined' && window.visualViewport) {
    const vv = window.visualViewport;
    let lastKb = '';
    const updateKbOffset = () => {
      const kb = window.innerHeight - vv.height - vv.offsetTop;
      const next = kb > 50 ? `${kb}px` : '0px';
      if (next === lastKb) return;
      lastKb = next;
      document.documentElement.style.setProperty('--kb-offset', next);
    };
    vv.addEventListener('resize', updateKbOffset);
    vv.addEventListener('scroll', updateKbOffset);
    updateKbOffset();
  }

  renderActiveTool();
}

function handleGlobalKeydown(e: KeyboardEvent) {
  if (!initialized || activeTool !== 'organize' || !pages.length) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
    if (!history.length) return;
    e.preventDefault();
    undo();
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (!selected.size) return;
    e.preventDefault();
    deleteSelected();
  } else if (e.key === 'Escape') {
    if (!selected.size) return;
    e.preventDefault();
    selected.clear();
    updateSelectionVisuals();
    updateSidebar();
    syncRangeInput();
  }
}

function renderActiveTool() {
  cleanup();
  hideError();
  toolContent.innerHTML = '';
  toolContent.classList.remove('ws-empty-layout', 'ws-extract-layout');
  if (activeTool === 'merge') renderMergeView();
  else if (activeTool === 'watermark') renderWatermarkView();
  else renderOrganizeView();
}

// ---------------------------------------------------------------------------
// Shared sidebar primitives, used by all three tabs
// ---------------------------------------------------------------------------

interface SidebarFileRowOpts {
  /** Optional letter prefix (e.g. "A") shown before the filename. */
  letter?: string;
  /** Optional meta line below the filename (e.g. "12 pages · 1.2 MB"). */
  meta?: string;
  /** When set, render a × button that calls this on click. */
  onRemove?: () => void;
}

function makeSidebarFileRow(sf: SourceFile, opts: SidebarFileRowOpts = {}): HTMLElement {
  const row = el('div', { className: 'ws-sidebar-file' });
  const prefix = opts.letter ? `${opts.letter}: ` : '';
  row.appendChild(el('span', { className: 'ws-sidebar-filename', textContent: prefix + sf.name, title: sf.name }));
  if (opts.meta !== undefined) {
    row.appendChild(el('span', { className: 'ws-sidebar-meta', textContent: opts.meta }));
  }
  if (opts.onRemove) {
    const delBtn = el('button', { className: 'icon-btn ws-hover-reveal ws-file-list-remove', innerHTML: '&times;', ariaLabel: `Remove ${sf.name}` });
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); opts.onRemove!(); });
    row.appendChild(delBtn);
  }
  return row;
}

function makeSectionLabel(text: string): HTMLElement {
  return el('p', { className: 'ws-sidebar-section-label', textContent: text });
}

function makeSidebarDivider(): HTMLElement {
  return el('hr', { className: 'ws-divider' });
}

// ---------------------------------------------------------------------------
// MERGE VIEW: file-level cards
// ---------------------------------------------------------------------------

function renderMergeView() {
  cleanup();
  toolContent.innerHTML = '';
  toolContent.classList.remove('ws-empty-layout', 'ws-extract-layout');

  if (files.length === 0) {
    renderEmptyState('Drop PDFs to merge', true);
    return;
  }

  toolContent.classList.add('ws-extract-layout');

  // Left card: file grid
  const leftCard = el('div', { className: 'card-base ws-grid-card' });
  mergeGridContainer = el('div', { className: 'ws-file-cards' });
  leftCard.appendChild(mergeGridContainer);

  // Right card: sidebar
  mergeSidebarCard = el('div', { className: 'card-base ws-sidebar-card' });
  mergeSidebarCard.id = 'merge-sidebar';

  toolContent.appendChild(leftCard);
  toolContent.appendChild(mergeSidebarCard);

  // Mobile toolbar + tray
  appendMobileToolbar_merge(leftCard);
  updateMergeContent();
}

function updateMergeContent() {
  if (!mergeGridContainer) { renderMergeView(); return; }
  if (files.length === 0) { renderMergeView(); return; }

  sortableInstance?.destroy();
  sortableInstance = null;
  mergeGridContainer.innerHTML = '';
  for (const sf of files) mergeGridContainer.appendChild(createFileCard(sf));

  const addCard = createDropzone('Drop more PDFs', true);
  addCard.className = 'ws-file-card ws-file-add';
  mergeGridContainer.appendChild(addCard);

  sortableInstance = new Sortable(mergeGridContainer, {
    animation: 200, delay: 150, delayOnTouchOnly: true,
    forceFallback: true,
    fallbackOnBody: true,
    scroll: false,
    ghostClass: 'ws-ghost',
    draggable: '.ws-file-card:not(.ws-file-add)',
    filter: '.ws-file-remove, .ws-file-list-remove',
    preventOnFilter: true,
    onStart: (evt) => {
      startAutoScroll(mergeGridContainer!.parentElement as HTMLElement);
      const draggedCard = evt.item as HTMLElement;
      const draggedFid = Number(draggedCard.dataset.fileId);
      if (isNaN(draggedFid)) return;
      stompDragSelection(selectedFiles, draggedFid, refreshMergeUi);

      if (selectedFiles.size > 1) {
        applyMultiDragVisuals(mergeGridContainer!, '.ws-file-card', c => Number(c.dataset.fileId), draggedFid, selectedFiles);
      }
    },
    onEnd: (evt) => {
      stopAutoScroll();
      clearMultiDragVisuals(mergeGridContainer!);
      if (evt.oldIndex == null || evt.newIndex == null || evt.oldIndex === evt.newIndex) return;
      const draggedCard = evt.item as HTMLElement;
      const draggedFid = Number(draggedCard.dataset.fileId);

      if (selectedFiles.size > 1) {
        const movingSet = new Set(selectedFiles);
        const moving = files.filter(f => movingSet.has(f.id));
        const domOrder = [...mergeGridContainer!.querySelectorAll<HTMLElement>('.ws-file-card:not(.ws-file-add)')]
          .map(c => Number(c.dataset.fileId));
        const dropDomIdx = domOrder.indexOf(draggedFid);
        const kept = files.filter(f => !movingSet.has(f.id));
        const prevInDom = dropDomIdx > 0 ? domOrder[dropDomIdx - 1] : null;
        let insertAt = 0;
        if (prevInDom != null && !movingSet.has(prevInDom)) {
          insertAt = kept.findIndex(f => f.id === prevInDom) + 1;
        } else {
          for (let i = dropDomIdx - 1; i >= 0; i--) {
            if (!movingSet.has(domOrder[i])) {
              insertAt = kept.findIndex(f => f.id === domOrder[i]) + 1;
              break;
            }
          }
        }
        kept.splice(insertAt, 0, ...moving);
        files = kept;
        onFilesReordered();
        updateMergeContent();
        return;
      }

      const [moved] = files.splice(evt.oldIndex, 1);
      files.splice(evt.newIndex, 0, moved);
      onFilesReordered();
      // Sortable already moved the DOM, keep the cards in place, just refresh
      // the sidebar (file-letter labels depend on order) and retune the delay
      // so momentum applies to the next drag.
      refreshMergeUi();
    },
  });

  if (mergeSidebarCard) updateMergeSidebarContent(mergeSidebarCard);
  if (mergeMobileTray) updateMergeSidebarContent(mergeMobileTray);

  if (mobileActionBtn) {
    mobileActionBtn.textContent = 'Merge PDF';
    mobileActionBtn.classList.toggle('disabled', files.length < 2);
    if (files.length < 2) mobileActionBtn.setAttribute('aria-disabled', 'true');
    else mobileActionBtn.removeAttribute('aria-disabled');
  }

  kickMergeThumbs();
}

function updateMergeSidebarContent(sidebar: HTMLElement) {
  sidebar.innerHTML = '';

  const total = files.reduce((s, f) => s + f.pageCount, 0);
  const countText = `${files.length} file${files.length !== 1 ? 's' : ''} · ${total} pages`;
  const countRow = el('div', { className: 'ws-sidebar-count-row' });
  countRow.appendChild(el('p', { className: 'ws-sidebar-count', textContent: countText }));
  const mergeBtnGroup = el('div', { className: 'ws-count-btn-group' });
  mergeBtnGroup.appendChild(createAddFileButton());
  countRow.appendChild(mergeBtnGroup);
  sidebar.appendChild(countRow);

  const fileList = el('div', { className: 'ws-sidebar-files' });
  for (const sf of files) {
    const isMulti = files.length > 1;
    fileList.appendChild(makeSidebarFileRow(sf, {
      letter: isMulti ? String.fromCharCode(65 + (files.indexOf(sf) % 26)) : undefined,
      meta: isMulti ? `${sf.pageCount} pages · ${formatBytes(sf.size)}` : undefined,
      onRemove: () => {
        files = files.filter(f => f.id !== sf.id);
        onFilesMutated();
        updateMergeContent();
        if (files.length) kickMergeThumbs();
      },
    }));
  }
  sidebar.appendChild(fileList);

  const bottom = el('div', { className: 'ws-sidebar-bottom' });

  if (selectedFiles.size > 0) {
    const removeBtn = el('button', {
      className: 'ws-btn ws-action-btn ws-action-full',
      textContent: `Remove ${selectedFiles.size} file${selectedFiles.size !== 1 ? 's' : ''}`,
    });
    removeBtn.addEventListener('click', handleRemoveSelectedFiles);
    bottom.appendChild(removeBtn);
  }

  const mergeBtn = el('button', { className: 'btn-primary ws-action-btn ws-action-full', textContent: 'Merge PDF' });
  if (files.length < 2) { mergeBtn.classList.add('disabled'); mergeBtn.setAttribute('aria-disabled', 'true'); }
  mergeBtn.addEventListener('click', handleMerge);
  bottom.appendChild(mergeBtn);
  sidebar.appendChild(bottom);
}

function handleRemoveSelectedFiles(): void {
  if (!selectedFiles.size) return;
  files = files.filter(f => !selectedFiles.has(f.id));
  onFilesMutated();
  updateMergeContent();
  if (files.length) kickMergeThumbs();
}

async function handleMerge() {
  if (files.length < 2) return;
  await runWithPopup('Merging', 'Stitching your pages into one PDF. This only takes a moment.', 'Merge failed. Try removing a file and re-adding it.', async () => {
    const r = await merge(files);
    lastPdfResult = [{ bytes: r.bytes, name: r.name }];
    lastPdfZipName = null;
    return r;
  }, (r) => {
    showPdfSuccessModal(
      'PDF merged! \u{1F389}',
      `<b>${escapeHTML(shortenFileName(r.name, 32))}</b> is downloading now.`,
    );
  });
}

function createFileCard(sf: SourceFile): HTMLElement {
  const card = el('div', { className: 'ws-file-card' });
  card.dataset.fileId = String(sf.id);
  if (selectedFiles.has(sf.id)) card.classList.add('ws-file-selected');
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-pressed', String(selectedFiles.has(sf.id)));
  card.setAttribute('aria-label', sf.name);
  card.addEventListener('contextmenu', (e) => e.preventDefault());
  card.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.ws-file-remove, .ws-file-list-remove')) return;
    if (selectedFiles.has(sf.id)) selectedFiles.delete(sf.id);
    else selectedFiles.add(sf.id);
    updateMergeContent();
  });

  const checkBadge = el('span', { className: 'ws-file-check', innerHTML: '&#x2713;', ariaHidden: 'true' });
  card.appendChild(checkBadge);

  const thumbWrap = el('div', { className: 'ws-file-thumb-wrap' });
  const thumb = el('div', { className: `ws-file-thumb${sf.firstPageThumb ? '' : ' ws-skeleton'}` });
  if (sf.firstPageThumb) setThumb(thumb, sf.firstPageThumb);
  thumbWrap.appendChild(thumb);

  card.appendChild(thumbWrap);

  if (files.length > 1) {
    const idx = files.indexOf(sf);
    const letter = String.fromCharCode(65 + (idx % 26));
    card.appendChild(el('span', { className: 'ws-file-badge', textContent: letter }));
  }

  const info = el('div', { className: 'ws-file-info' });
  info.appendChild(el('span', { className: 'ws-file-name', textContent: sf.name, title: sf.name }));
  info.appendChild(el('span', { className: 'ws-file-meta', textContent: `${sf.pageCount} pages · ${formatBytes(sf.size)}` }));
  card.appendChild(info);

  const removeBtn = el('button', { className: 'icon-btn ws-hover-reveal ws-file-remove', innerHTML: '&times;', ariaLabel: 'Remove' });
  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    files = files.filter(f => f.id !== sf.id);
    onFilesMutated();
    updateMergeContent();
    if (files.length) kickMergeThumbs();
  });
  card.appendChild(removeBtn);

  return card;
}

const PAGE_THUMB_WIDTH = 320;

function kickMergeThumbs() {
  for (const sf of files) {
    if (sf.firstPageThumb) continue;
    queueRender(sf.bytes, 1, (url) => {
      sf.firstPageThumb = url;
      const cards = toolContent.querySelectorAll('.ws-file-card');
      const idx = files.indexOf(sf);
      if (idx >= 0 && cards[idx]) {
        const thumb = cards[idx].querySelector('.ws-file-thumb');
        if (thumb) setThumb(thumb, url);
      }
    }, PAGE_THUMB_WIDTH);
  }
}

function appendMobileToolbar_merge(_gridCard: HTMLElement) {
  const toolbar = el('div', { className: 'ws-toolbar' });
  const iconBtn = el('button', { className: 'icon-btn ws-toolbar-icon', ariaLabel: 'More options' });
  iconBtn.innerHTML = MORE_SVG;
  const actionBtn = el('button', { className: 'btn-primary ws-toolbar-action', textContent: 'Merge PDF' });
  if (files.length < 2) { actionBtn.classList.add('disabled'); actionBtn.setAttribute('aria-disabled', 'true'); }
  actionBtn.addEventListener('click', handleMerge);
  toolbar.appendChild(actionBtn);
  toolbar.appendChild(iconBtn);
  document.body.appendChild(toolbar);
  mobileActionBtn = actionBtn;

  const tray = el('div', { className: 'ws-tray' });
  mergeMobileTray = tray;
  updateMergeSidebarContent(tray);
  const overlay = el('div', { className: 'ws-tray-overlay' });
  wireTrayToggle(tray, overlay, iconBtn);

  document.body.appendChild(overlay);
  document.body.appendChild(tray);
}

// ---------------------------------------------------------------------------
// WATERMARK VIEW: apply a text watermark to selected pages
// ---------------------------------------------------------------------------

interface WmSettings {
  text: string;
  fontSize: number;
  colorHex: string;
  opacity: number;        // 0-1
  rotation: number;       // degrees
  repeat: boolean;
}

const WM_DEFAULTS: WmSettings = {
  text: 'CONFIDENTIAL',
  fontSize: WATERMARK_DEFAULTS.fontSize,
  colorHex: WATERMARK_DEFAULTS.colorHex,
  opacity: WATERMARK_DEFAULTS.opacity,
  rotation: WATERMARK_DEFAULTS.rotationDegrees,
  repeat: WATERMARK_DEFAULTS.repeat,
};

interface WmPageEntry { fileId: number; pageNum: number; }

let wmSettings: WmSettings = { ...WM_DEFAULTS };
let wmFlatPages: WmPageEntry[] = [];
let wmSelected: Set<number> = new Set();   // flat-index source of truth
let wmLastClicked = -1;                     // for shift-click range
let wmTextEncodeFont: { font: any; doc: PDFDocument } | null = null;
let wmGridEl: HTMLElement | null = null;
let wmObserver: IntersectionObserver | null = null;
// Per-page base bitmap. Rendered ONCE by pdfjs (lazy, on IO entry) and
// reused across every settings change. Key: `${fileId}:${pageNum}`. The
// preview composites this bitmap + a Canvas 2D watermark overlay synchronously
// on every kick — no PDF round-trip per slider tick.
const wmBaseBitmaps = new Map<string, { bitmap: ImageBitmap; pdfWidth: number; pdfHeight: number }>();
// fileId is monotonic (never reused), so on file removal stale entries are
// unreachable and would leak. Bound the map and evict oldest on insert.
// 200 × ~225 KB ≈ 45 MB ceiling for the bitmap cache.
const WM_BITMAP_CACHE_MAX = 200;
// rAF-coalesced redraw: multiple input events within one frame collapse to
// a single repaint at the next frame.
let wmRafId: number | null = null;
let watermarkMobileTray: HTMLElement | null = null;
// Per-panel id seq so desktop + mobile tray panels have unique ids for
// aria-describedby wiring (both can live in the DOM at the same time on
// mobile when the tray hasn't been opened yet).
let wmPanelSeq = 0;

/** Page numbers (1-indexed) of `sf` that the user has selected. */
function wmEffectivePagesFor(sf: SourceFile): number[] {
  const set = new Set<number>();
  for (const idx of wmSelected) {
    const entry = wmFlatPages[idx];
    if (entry && entry.fileId === sf.id) set.add(entry.pageNum);
  }
  return [...set].sort((a, b) => a - b);
}

/** Range string view of `wmSelected` (1-indexed flat positions). */
function wmSelectedToRangeString(): string {
  return setToRangeString(wmSelected, wmFlatPages.length);
}

/**
 * Parse a flat-index range string like "1-5, 8" into a Set of zero-indexed
 * flat positions. Returns null if the syntax is invalid.
 */
function wmParseRangeToSelection(text: string): Set<number> | null {
  const oneIndexed = parsePageRange(text, wmFlatPages.length);
  if (!oneIndexed) return null;
  const zeroIndexed = new Set<number>();
  for (const n of oneIndexed) zeroIndexed.add(n - 1);
  return zeroIndexed;
}

function wmRebuildFlatPages() {
  // Idempotent: only rebuild when files actually changed shape, so re-entering
  // the watermark tab doesn't blow away the rendered-thumbnail cache.
  const expectedLen = files.reduce((s, f) => s + f.pageCount, 0);
  let unchanged = wmFlatPages.length === expectedLen;
  if (unchanged) {
    let i = 0;
    outer: for (const f of files) {
      for (let p = 1; p <= f.pageCount; p++) {
        const cur = wmFlatPages[i];
        if (!cur || cur.fileId !== f.id || cur.pageNum !== p) { unchanged = false; break outer; }
        i++;
      }
    }
  }
  if (unchanged) return;

  wmFlatPages = [];
  for (const f of files) {
    for (let p = 1; p <= f.pageCount; p++) {
      wmFlatPages.push({ fileId: f.id, pageNum: p });
    }
  }
  // Flat order changed. Bitmaps are keyed by (fileId, pageNum) and fileId is
  // monotonic, so on file removal the entries are unreachable and would leak
  // (each holds a GPU ImageBitmap). Drop them.
  wmDisposeBitmaps();
}

/** Close every cached `ImageBitmap` and empty the map. */
function wmDisposeBitmaps() {
  for (const v of wmBaseBitmaps.values()) v.bitmap.close?.();
  wmBaseBitmaps.clear();
}

/** Badge: `1` (single file) or `A1` (multi-file, letter = upload order). */
function wmBadgeText(idx: number): string {
  const entry = wmFlatPages[idx];
  if (!entry) return '';
  if (files.length <= 1) return String(entry.pageNum);
  const fileIdx = files.findIndex(f => f.id === entry.fileId);
  const letter = String.fromCharCode(65 + (fileIdx % 26));
  return `${letter}${entry.pageNum}`;
}

function wmResetForFiles() {
  wmRebuildFlatPages();
  // Default selection on tab entry: every page across every file. Users who
  // want a subset click pages off (or type a narrower range).
  if (wmFlatPages.length > 0 && wmSelected.size === 0) {
    wmSelected = new Set(wmFlatPages.map((_, i) => i));
  } else {
    // Drop indices that no longer exist (file removed shrinks wmFlatPages).
    const valid = new Set<number>();
    for (const idx of wmSelected) if (idx < wmFlatPages.length) valid.add(idx);
    wmSelected = valid;
  }
  wmLastClicked = -1;
}

async function wmEnsureEncodeFont(): Promise<any | null> {
  if (wmTextEncodeFont) return wmTextEncodeFont.font;
  try {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    wmTextEncodeFont = { font, doc };
    return font;
  } catch {
    return null;
  }
}

// Encoding probe is cheap but called once per visible card on every kick;
// memoize so a 300-page grid runs encodeText() once per text change, not 300x.
let _wmTextEncodeProbe: { text: string; bad: boolean } | null = null;
function wmTextHasInvalidChars(): boolean {
  if (!wmTextEncodeFont) return false;
  if (_wmTextEncodeProbe?.text === wmSettings.text) return _wmTextEncodeProbe.bad;
  let bad = false;
  try { wmTextEncodeFont.font.encodeText(wmSettings.text); } catch { bad = true; }
  _wmTextEncodeProbe = { text: wmSettings.text, bad };
  return bad;
}

/** True iff Export will actually stamp pages (text set AND at least one page picked). */
function wmWillStamp(): boolean {
  return wmSettings.text.trim().length > 0 && wmSelected.size > 0;
}

function wmDownloadDisabled(): { disabled: boolean; reason?: string } {
  if (files.length === 0) return { disabled: true, reason: 'Add a PDF first' };
  // Invalid chars only block when we'd actually render text — empty text or
  // empty selection both fall through to source-PDF passthrough.
  if (wmWillStamp() && wmTextHasInvalidChars()) {
    return { disabled: true, reason: "Some characters can't be rendered. Try basic Latin text." };
  }
  return { disabled: false };
}

function handleWmTextInput(ti: HTMLInputElement) {
  wmSettings.text = ti.value;
  const trimmed = wmSettings.text.trim();
  const charsInvalid = trimmed ? wmTextHasInvalidChars() : false;
  const empty = !trimmed;
  // chars-invalid is the only state that should paint the destructive ring;
  // empty is informational, not an error.
  document.querySelectorAll<HTMLInputElement>('.ws-wm-text-input').forEach(el => {
    if (el !== ti && el.value !== wmSettings.text) el.value = wmSettings.text;
    el.classList.toggle('ws-input-error', charsInvalid);
    if (charsInvalid) el.setAttribute('aria-invalid', 'true');
    else el.removeAttribute('aria-invalid');
  });
  let next = '';
  if (charsInvalid) next = "Some characters can't be rendered. Try basic Latin text.";
  else if (empty) next = 'Empty text — Export saves the source PDF unchanged.';
  document.querySelectorAll<HTMLElement>('.ws-wm-text-error').forEach(e => {
    if (e.textContent !== next) e.textContent = next;
    e.classList.toggle('ws-wm-text-info', empty && !charsInvalid);
  });
  rebuildWatermarkPanelDownloadState();
  wmKickVisible();
}

/**
 * Schedule a redraw of every mounted card on the next animation frame.
 * Multiple input events within one frame collapse into a single repaint.
 * Pass `immediate` to redraw synchronously this turn.
 */
function wmKickVisible(immediate = false) {
  if (immediate) {
    if (wmRafId !== null) { cancelAnimationFrame(wmRafId); wmRafId = null; }
    wmFlushRedraw();
    return;
  }
  if (wmRafId !== null) return;
  wmRafId = requestAnimationFrame(() => {
    wmRafId = null;
    wmFlushRedraw();
  });
}

const wmKickVisibleImmediate = () => wmKickVisible(true);

/**
 * Frame-constant values for one repaint pass. All cards in a single
 * `wmFlushRedraw` share these, so they're computed once per frame instead of
 * once per card. `null` means "no overlay this frame" (text empty, contains
 * unrenderable chars, or font not ready yet).
 */
type WmFrame = {
  text: string;
  fontSize: number;
  opacity: number;
  rotation: number;
  repeat: boolean;
  wmW: number;
  wmH: number;
  fillStyle: string;
  radCanvas: number;
  // Per-(pageW, pageH) anchor list. Different pages may have different dims
  // (mixed PDF sizes), so anchors aren't fully frame-constant — but they're
  // identical across cards that share dims, which is the common case.
  tileCache: Map<string, ReadonlyArray<{ x: number; y: number }>>;
};

function wmBuildFrame(): WmFrame | null {
  const font = wmTextEncodeFont?.font;
  if (!font) return null;
  if (!wmSettings.text.trim() || wmTextHasInvalidChars()) return null;
  let color: { r: number; g: number; b: number };
  try { color = hexToRgb(wmSettings.colorHex); } catch { color = { r: 0.5, g: 0.5, b: 0.5 }; }
  return {
    text: wmSettings.text,
    fontSize: wmSettings.fontSize,
    opacity: wmSettings.opacity,
    rotation: wmSettings.rotation,
    repeat: wmSettings.repeat,
    wmW: font.widthOfTextAtSize(wmSettings.text, wmSettings.fontSize),
    wmH: font.heightAtSize(wmSettings.fontSize),
    fillStyle: `rgb(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)})`,
    radCanvas: -(wmSettings.rotation * Math.PI) / 180,
    tileCache: new Map(),
  };
}

function wmFlushRedraw() {
  if (!wmGridEl) return;
  const noText = !wmSettings.text.trim() || wmTextHasInvalidChars();
  wmGridEl.classList.toggle('ws-wm-no-overlay', noText);
  // Font not loaded yet: kick the load and redraw once it's ready. Base
  // bitmaps still paint this frame because they don't need the font.
  if (!wmTextEncodeFont) {
    void wmEnsureEncodeFont().then(() => { if (wmGridEl) wmKickVisible(true); });
  }
  const frame = wmBuildFrame();
  wmGridEl.querySelectorAll<HTMLElement>('[data-wm-flat-idx]').forEach(card => {
    const idx = Number(card.dataset.wmFlatIdx);
    if (!Number.isNaN(idx)) void wmRenderCard(idx, frame);
  });
}

async function wmRenderCard(idx: number, frame: WmFrame | null) {
  const entry = wmFlatPages[idx];
  if (!entry || !wmGridEl) return;
  const sf = files.find(f => f.id === entry.fileId);
  const card = wmGridEl.querySelector<HTMLElement>(`[data-wm-flat-idx="${idx}"]`);
  const thumb = card?.querySelector<HTMLElement>('.ws-page-thumb');
  if (!sf || !card || !thumb) return;

  const key = `${entry.fileId}:${entry.pageNum}`;
  let base = wmBaseBitmaps.get(key);
  if (!base) {
    try {
      const result = await renderPageBitmap(sf.bytes, entry.pageNum, PAGE_THUMB_WIDTH);
      if (!result) return;
      // File mutation may have invalidated the entry mid-render. Drop the
      // bitmap rather than caching against a stale (fileId, pageNum) pair.
      const stillThere = wmFlatPages[idx];
      if (!stillThere || stillThere.fileId !== entry.fileId || stillThere.pageNum !== entry.pageNum) {
        result.bitmap.close?.();
        return;
      }
      base = result;
      wmBaseBitmaps.set(key, result);
      if (wmBaseBitmaps.size > WM_BITMAP_CACHE_MAX) {
        const oldest = wmBaseBitmaps.keys().next().value as string | undefined;
        if (oldest && oldest !== key) {
          wmBaseBitmaps.get(oldest)?.bitmap.close?.();
          wmBaseBitmaps.delete(oldest);
        }
      }
    } catch (e) {
      console.warn('[pdfWorkspace] watermark base render failed:', e);
      return;
    }
  }

  wmCompositeCard(card, thumb, idx, base, frame);
}

/**
 * Sync paint: blit base bitmap, then draw the watermark overlay if `frame` is
 * non-null and this card is selected. Reuses the engine's placement helpers
 * (`tilePositions`, `placementCoords`, `rotatedOrigin`) and the cached pdf-lib
 * Helvetica metrics so tile geometry matches the export pixel-for-pixel.
 */
function wmCompositeCard(
  card: HTMLElement,
  thumb: HTMLElement,
  idx: number,
  base: { bitmap: ImageBitmap; pdfWidth: number; pdfHeight: number },
  frame: WmFrame | null
) {
  const { bitmap, pdfWidth, pdfHeight } = base;
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const cssW = PAGE_THUMB_WIDTH;
  const cssH = Math.round(cssW * (pdfHeight / pdfWidth));
  const pxW = Math.round(cssW * dpr);
  const pxH = Math.round(cssH * dpr);

  let canvas = thumb.querySelector<HTMLCanvasElement>('canvas');
  if (!canvas) {
    thumb.classList.remove('ws-skeleton');
    canvas = document.createElement('canvas');
    thumb.replaceChildren(canvas);
  }
  if (canvas.width !== pxW) canvas.width = pxW;
  if (canvas.height !== pxH) canvas.height = pxH;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, pxW, pxH);
  ctx.drawImage(bitmap, 0, 0, pxW, pxH);

  const wmApplicable = !!frame && wmSelected.has(idx);
  card.classList.toggle('ws-wm-overlay-on', wmApplicable);
  if (!wmApplicable) return;

  const { text, fontSize, opacity, rotation, repeat, wmW, wmH, fillStyle, radCanvas, tileCache } = frame!;
  // Y-flip is applied at point conversion (not as a global transform) so
  // canvas glyph rasterization stays upright.
  const scale = pxW / pdfWidth;
  const dimKey = `${pdfWidth}x${pdfHeight}`;
  let anchors = tileCache.get(dimKey);
  if (!anchors) {
    anchors = repeat
      ? tilePositions({ pageW: pdfWidth, pageH: pdfHeight, wmW, wmH, rotationDegrees: rotation })
      : [placementCoords({ pageW: pdfWidth, pageH: pdfHeight, wmW, wmH, placement: 'center' })];
    tileCache.set(dimKey, anchors);
  }

  ctx.font = `${fontSize * scale}px Helvetica, Arial, sans-serif`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = fillStyle;
  ctx.globalAlpha = opacity;

  for (const a of anchors) {
    const origin = rotatedOrigin(a.x, a.y, wmW, wmH, rotation);
    const cx = origin.x * scale;
    const cy = pxH - origin.y * scale;
    ctx.save();
    ctx.translate(cx, cy);
    // PDF degrees positive = CCW visual; canvas radians positive = CW visual
    // (Y-down). `radCanvas` carries the sign flip.
    ctx.rotate(radCanvas);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function renderWatermarkView() {
  cleanup();
  toolContent.innerHTML = '';
  toolContent.classList.remove('ws-empty-layout', 'ws-extract-layout');

  wmResetForFiles();

  if (files.length === 0) {
    renderEmptyState('Drop PDFs to watermark', true);
    return;
  }

  toolContent.classList.add('ws-extract-layout');

  const leftCard = el('div', { className: 'card-base ws-grid-card ws-wm-preview-card' });
  const rightCard = el('div', { className: 'card-base ws-sidebar-card ws-wm-panel-card' });

  // ---- Left: 2-col page grid (Organize-style, capped at 2 cols) ----
  const grid = el('div', { className: 'ws-wm-page-grid' });
  wmFlatPages.forEach((_entry, idx) => {
    const card = el('div', {
      className: 'ws-page-card ws-wm-page-card',
      dataset: { wmFlatIdx: String(idx) },
      role: 'button',
      ariaPressed: String(wmSelected.has(idx)),
      ariaLabel: `Page ${wmBadgeText(idx)}`,
    });
    card.tabIndex = 0;
    if (wmSelected.has(idx)) card.classList.add('ws-page-selected');
    card.addEventListener('contextmenu', (e) => e.preventDefault());
    card.addEventListener('click', (e) => {
      wmToggleSelection(idx, (e as MouseEvent).shiftKey);
    });
    card.addEventListener('keydown', (e) => {
      if (e.key !== ' ' && e.key !== 'Enter') return;
      e.preventDefault();
      wmToggleSelection(idx, e.shiftKey);
    });
    const watermarkedTag = el('span', { className: 'ws-wm-watermarked-tag', textContent: 'Watermarked', ariaHidden: 'true' });
    card.appendChild(watermarkedTag);
    const thumbWrap = el('div', { className: 'ws-page-thumb-wrap' });
    const thumb = el('div', { className: 'ws-page-thumb ws-skeleton' });
    thumbWrap.appendChild(thumb);
    card.appendChild(thumbWrap);
    card.appendChild(el('span', { className: 'ws-page-badge', textContent: wmBadgeText(idx), ariaHidden: 'true' }));
    grid.appendChild(card);
  });

  // Trailing "Drop more PDFs" dropzone card, same affordance as Merge / Organize.
  const addCard = createDropzone('Drop more PDFs', true);
  addCard.classList.add('ws-page-card', 'ws-page-add', 'ws-wm-page-card');
  grid.appendChild(addCard);

  leftCard.appendChild(grid);
  wmGridEl = grid;

  // ---- Right: settings panel ----
  buildWatermarkPanel(rightCard);

  toolContent.appendChild(leftCard);
  toolContent.appendChild(rightCard);

  // Mobile toolbar (sticky bottom) + tray with the same settings panel.
  appendMobileToolbar_watermark(leftCard);

  // Observe cards: render lazily as they enter the viewport. Unobserve once
  // we kick a render so scroll-back doesn't re-trigger work; subsequent
  // re-renders (settings/selection change) go via wmKickVisible which
  // iterates every `[data-wm-flat-idx]` directly.
  wmObserver?.disconnect();
  wmObserver = new IntersectionObserver((entries, observer) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const idx = Number((entry.target as HTMLElement).dataset.wmFlatIdx);
      if (!Number.isNaN(idx)) {
        void wmRenderCard(idx, wmBuildFrame());
        observer.unobserve(entry.target);
      }
    }
  }, { rootMargin: '200px' });
  grid.querySelectorAll<HTMLElement>('[data-wm-flat-idx]').forEach(c => wmObserver!.observe(c));

  // Lazy-embed Helvetica for input validation, then kick the visible cards
  // through their first paint.
  void (async () => {
    await wmEnsureEncodeFont();
    rebuildWatermarkPanelDownloadState();
    wmKickVisibleImmediate();
  })();
}

function appendMobileToolbar_watermark(_gridCard: HTMLElement) {
  const toolbar = el('div', { className: 'ws-toolbar ws-toolbar--watermark' });

  const inputWrap = el('div', { className: 'ws-prefix-input' });
  const inputLabel = el('span', { className: 'ws-prefix-input__label', textContent: 'Watermark', ariaHidden: 'true' });
  const quickInput = el('input', {
    type: 'text',
    className: 'ws-wm-text-input ws-prefix-input__field',
    value: wmSettings.text,
    maxLength: 200,
    placeholder: 'Watermark text',
    ariaLabel: 'Watermark text',
  }) as HTMLInputElement;
  quickInput.addEventListener('input', () => handleWmTextInput(quickInput));
  inputWrap.appendChild(inputLabel);
  inputWrap.appendChild(quickInput);
  toolbar.appendChild(inputWrap);

  const actionRow = el('div', { className: 'ws-toolbar-row' });
  const iconBtn = el('button', { className: 'icon-btn ws-toolbar-icon', ariaLabel: 'More options' });
  iconBtn.innerHTML = MORE_SVG;
  const actionBtn = el('button', { className: 'btn-primary ws-toolbar-action ws-wm-download-btn', textContent: wmDownloadLabel() });
  actionBtn.addEventListener('click', handleWatermarkExport);
  actionRow.appendChild(actionBtn);
  actionRow.appendChild(iconBtn);
  toolbar.appendChild(actionRow);
  document.body.appendChild(toolbar);

  const tray = el('div', { className: 'ws-tray' });
  watermarkMobileTray = tray;
  buildWatermarkPanel(tray, { tray: true });
  const overlay = el('div', { className: 'ws-tray-overlay' });
  wireTrayToggle(tray, overlay, iconBtn);

  document.body.appendChild(overlay);
  document.body.appendChild(tray);
}

/** Refresh every range input on the page to mirror `wmSelected`. */
function wmSyncRangeInputs(errorState = false) {
  const text = wmSelectedToRangeString();
  document.querySelectorAll<HTMLInputElement>('.ws-wm-range-input').forEach(ri => {
    if (!errorState && ri.value !== text) ri.value = text;
    ri.classList.toggle('ws-input-error', errorState);
    if (errorState) ri.setAttribute('aria-invalid', 'true');
    else ri.removeAttribute('aria-invalid');
  });
}

/** Refresh `.ws-page-selected` class on every visible card to match `wmSelected`. */
function wmUpdateSelectionVisuals() {
  if (!wmGridEl) return;
  wmGridEl.querySelectorAll<HTMLElement>('[data-wm-flat-idx]').forEach(card => {
    const idx = Number(card.dataset.wmFlatIdx);
    const sel = wmSelected.has(idx);
    card.classList.toggle('ws-page-selected', sel);
    card.setAttribute('aria-pressed', String(sel));
  });
}

/** Toggle / shift-range select and propagate to inputs + render. */
function wmToggleSelection(idx: number, shift: boolean) {
  if (shift && wmLastClicked >= 0) {
    const lo = Math.min(idx, wmLastClicked);
    const hi = Math.max(idx, wmLastClicked);
    for (let i = lo; i <= hi; i++) wmSelected.add(i);
  } else {
    if (wmSelected.has(idx)) wmSelected.delete(idx);
    else wmSelected.add(idx);
  }
  wmLastClicked = idx;
  wmUpdateSelectionVisuals();
  wmSyncRangeInputs();
  rebuildWatermarkPanelDownloadState();
  wmKickVisible();
}

function buildWatermarkPanel(panel: HTMLElement, opts: { tray?: boolean } = {}) {
  panel.innerHTML = '';
  if (files.length === 0) return;
  const seq = ++wmPanelSeq;
  const textErrId = `wm-text-err-${seq}`;
  const statusId = `wm-status-${seq}`;
  const textLblId = `wm-lbl-text-${seq}`;
  const colorLblId = `wm-lbl-color-${seq}`;

  // ---- BLOCK 1: count-row + file list (matches Merge / Organize sidebars) ----
  const isMulti = files.length > 1;
  const totalAcrossFiles = files.reduce((s, f) => s + f.pageCount, 0);
  const countText = isMulti
    ? `${files.length} files · ${totalAcrossFiles} pages`
    : `${totalAcrossFiles} page${totalAcrossFiles !== 1 ? 's' : ''}`;
  const countRow = el('div', { className: 'ws-sidebar-count-row' });
  countRow.appendChild(el('p', { className: 'ws-sidebar-count', textContent: countText }));
  const btnGroup = el('div', { className: 'ws-count-btn-group' });
  btnGroup.appendChild(createAddFileButton());
  countRow.appendChild(btnGroup);
  panel.appendChild(countRow);

  const fileList = el('div', { className: 'ws-sidebar-files' });
  files.forEach((f, idx) => {
    fileList.appendChild(makeSidebarFileRow(f, {
      letter: isMulti ? String.fromCharCode(65 + (idx % 26)) : undefined,
      meta: isMulti ? `${f.pageCount} pages · ${formatBytes(f.size)}` : undefined,
      onRemove: () => {
        files = files.filter(x => x.id !== f.id);
        onFilesMutated();
        renderActiveTool();
      },
    }));
  });
  panel.appendChild(fileList);
  panel.appendChild(makeSidebarDivider());

  // ---- BLOCK 2: Watermark (config), what to stamp ----
  panel.appendChild(makeSectionLabel('Watermark'));

  // Text row: shown on desktop sidebar only. On mobile the fixed toolbar
  // already provides a quick-input, so we skip it in the tray to avoid
  // duplicate entry points.
  if (!opts.tray) {
    const textRow = el('div', { className: 'ws-wm-text-row' });
    const ti = el('input', {
      type: 'text',
      className: 'ws-range-input ws-wm-text-input',
      value: wmSettings.text,
      maxLength: 200,
      placeholder: 'Watermark text',
      'aria-label': 'Watermark text',
      'aria-describedby': textErrId,
    }) as HTMLInputElement;
    textRow.appendChild(ti);
    const textErrEl = el('p', { className: 'ws-wm-text-error ws-wm-error-msg', textContent: '', id: textErrId });
    ti.addEventListener('input', () => handleWmTextInput(ti));
    panel.appendChild(textRow);
    panel.appendChild(textErrEl);
  }

  // Customize controls: desktop uses a collapsible <details> to keep the
  // panel compact. Mobile tray always shows them expanded — the tray is
  // already a focused, scrollable surface so the disclosure adds no value.
  const styleBody = el('div', { className: 'ws-wm-style-body' });

  if (!opts.tray) {
    // Desktop: wrap in <details> with animated Customize disclosure.
    const styleDetails = el('details', { className: 'ws-wm-style-details' }) as HTMLDetailsElement;
    const styleSummary = el('summary', { className: 'ws-wm-style-summary', textContent: 'Customize' });
    styleDetails.appendChild(styleSummary);

    // <details> unmounts its body instantly on close, so a CSS-only collapse
    // keyframe never runs. Intercept close, play the fade-out, flip `open` after.
    styleSummary.addEventListener('click', e => {
      if (!styleDetails.open) return;
      if (styleDetails.classList.contains('ws-wm-closing')) return;
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      e.preventDefault();
      styleDetails.classList.add('ws-wm-closing');
      styleBody.style.animation = 'ws-wm-style-collapse 0.18s ease-in forwards';
      styleBody.addEventListener('animationend', () => {
        styleBody.style.animation = '';
        styleDetails.classList.remove('ws-wm-closing');
        styleDetails.open = false;
      }, { once: true });
    });

    styleDetails.appendChild(styleBody);
    panel.appendChild(styleDetails);
  } else {
    // Mobile tray: plain div, controls always visible.
    panel.appendChild(styleBody);
  }

  styleBody.appendChild(makeWmSlider({
    label: 'Size',
    min: 8, max: 256, step: 1, value: wmSettings.fontSize,
    unit: 'pt',
    onChange: v => { wmSettings.fontSize = v; wmKickVisible(); },
  }));

  styleBody.appendChild(makeWmColorRow(wmSettings.colorHex, hex => {
    wmSettings.colorHex = hex;
    wmKickVisible();
  }, colorLblId));

  styleBody.appendChild(makeWmSlider({
    label: 'Opacity',
    min: 0, max: 100, step: 1, value: Math.round(wmSettings.opacity * 100),
    unit: '%',
    onChange: v => { wmSettings.opacity = Math.max(0, Math.min(1, v / 100)); wmKickVisible(); },
  }));

  styleBody.appendChild(makeWmSlider({
    label: 'Rotation',
    min: -90, max: 90, step: 1, value: wmSettings.rotation,
    unit: '°',
    onChange: v => { wmSettings.rotation = v; wmKickVisible(); },
  }));

  // Repeat toggle, single zero-config switch.
  // The wrapping <label> implicitly labels the checkbox via the sibling span,
  // so an explicit aria-label here would shadow that visible text. Keep them
  // in sync via a single source: the visible <span>.
  const repeatRow = el('label', { className: 'ws-wm-repeat-row' });
  const repeatChk = el('input', { type: 'checkbox', className: 'ws-wm-repeat-checkbox' }) as HTMLInputElement;
  repeatChk.checked = wmSettings.repeat;
  repeatChk.addEventListener('change', () => {
    wmSettings.repeat = repeatChk.checked;
    document.querySelectorAll<HTMLInputElement>('.ws-wm-repeat-checkbox').forEach(c => {
      if (c !== repeatChk) c.checked = wmSettings.repeat;
    });
    wmKickVisible();
  });
  repeatRow.appendChild(repeatChk);
  repeatRow.appendChild(el('span', { textContent: 'Repeat across page' }));
  styleBody.appendChild(repeatRow);

  panel.appendChild(makeSidebarDivider());

  // ---- BLOCK 3: Pages, scope: which pages get the watermark ----
  panel.appendChild(makeSectionLabel('Pages'));
  const ri = el('input', {
    type: 'text',
    className: 'ws-range-input ws-wm-range-input',
    placeholder: 'e.g. 1-5, 8, 12-20',
    value: wmSelectedToRangeString(),
    autocomplete: 'off',
    ariaLabel: 'Page range',
  }) as HTMLInputElement;
  ri.addEventListener('input', () => {
    const text = ri.value.trim();
    if (!text) {
      wmSelected.clear();
      ri.classList.remove('ws-input-error');
      ri.removeAttribute('aria-invalid');
      wmUpdateSelectionVisuals();
      wmSyncRangeInputs();
      rebuildWatermarkPanelDownloadState();
      wmKickVisible();
      return;
    }
    const parsed = wmParseRangeToSelection(text);
    if (!parsed) {
      ri.classList.add('ws-input-error');
      ri.setAttribute('aria-invalid', 'true');
      return;
    }
    ri.classList.remove('ws-input-error');
    ri.removeAttribute('aria-invalid');
    wmSelected = parsed;
    wmUpdateSelectionVisuals();
    rebuildWatermarkPanelDownloadState();
    wmKickVisible();
  });
  panel.appendChild(ri);

  const btnRow = el('div', { className: 'ws-sidebar-btn-row' });
  const selectAllBtn = el('button', { className: 'ws-btn ws-btn-small', textContent: 'Select all' });
  selectAllBtn.addEventListener('click', () => {
    wmSelected = new Set(wmFlatPages.map((_, i) => i));
    wmUpdateSelectionVisuals();
    wmSyncRangeInputs();
    rebuildWatermarkPanelDownloadState();
    wmKickVisible();
  });
  const deselectBtn = el('button', { className: 'ws-btn ws-btn-small', textContent: 'Deselect all' });
  deselectBtn.addEventListener('click', () => {
    wmSelected.clear();
    wmUpdateSelectionVisuals();
    wmSyncRangeInputs();
    rebuildWatermarkPanelDownloadState();
    wmKickVisible();
  });
  btnRow.appendChild(selectAllBtn);
  btnRow.appendChild(deselectBtn);
  panel.appendChild(btnRow);

  // ---- Action ----
  const actions = el('div', { className: 'ws-sidebar-bottom ws-wm-actions' });
  const dl = el('button', {
    className: 'btn-primary ws-action-btn ws-action-full ws-wm-download-btn',
    textContent: wmDownloadLabel(),
    'aria-describedby': statusId,
  });
  dl.addEventListener('click', handleWatermarkExport);
  actions.appendChild(dl);

  const status = el('p', { className: 'ws-wm-status ws-wm-error-msg', textContent: '', id: statusId });
  status.setAttribute('aria-live', 'polite');
  actions.appendChild(status);
  panel.appendChild(actions);
}

function wmDownloadLabel(): string {
  return wmWillStamp() ? 'Export PDF' : 'Export source PDF';
}

function rebuildWatermarkPanelDownloadState() {
  const state = wmDownloadDisabled();
  const label = wmDownloadLabel();
  // Empty-text hint already lives by the text input; only surface a hint here
  // for the zero-pages-but-text-set case so the user understands the relabeled
  // button will save the source unchanged.
  let statusText = '';
  if (state.disabled) statusText = state.reason ?? '';
  else if (wmSettings.text.trim() && !wmWillStamp()) {
    statusText = 'No pages picked — Export saves the source PDF unchanged.';
  }
  document.querySelectorAll<HTMLButtonElement>('.ws-wm-download-btn').forEach(dl => {
    if (dl.classList.contains('disabled') !== state.disabled) {
      dl.classList.toggle('disabled', state.disabled);
    }
    const ariaNow = dl.getAttribute('aria-disabled');
    if (state.disabled && ariaNow !== 'true') dl.setAttribute('aria-disabled', 'true');
    else if (!state.disabled && ariaNow !== null) dl.removeAttribute('aria-disabled');
    if (dl.textContent !== label) dl.textContent = label;
  });
  document.querySelectorAll<HTMLElement>('.ws-wm-status').forEach(status => {
    if (status.textContent !== statusText) status.textContent = statusText;
  });
}

interface SliderArgs {
  label: string;
  min: number; max: number; step: number; value: number;
  unit: string;
  onChange: (v: number) => void;
}

/** Slider + editable numeric input + unit label. Two-way bound. */
function makeWmSlider(args: SliderArgs): HTMLElement {
  const row = el('div', { className: 'ws-wm-slider-row' });
  const labelId = `wm-slider-lbl-${++wmPanelSeq}`;
  row.appendChild(el('span', { className: 'ws-wm-row-label', textContent: args.label, id: labelId }));

  const slider = el('input', {
    type: 'range',
    min: String(args.min), max: String(args.max), step: String(args.step),
    value: String(args.value),
    className: 'ws-wm-slider',
    'aria-labelledby': labelId,
  }) as HTMLInputElement;

  const num = el('input', {
    type: 'number',
    min: String(args.min), max: String(args.max), step: String(args.step),
    value: String(args.value),
    className: 'ws-range-input ws-wm-num-input',
    // Keep aria-label here — `${label} value` distinguishes the numeric
    // companion from the sibling slider; aria-labelledby would overwrite it.
    ariaLabel: `${args.label} value`,
  }) as HTMLInputElement;

  const unit = el('span', { className: 'ws-wm-slider-unit', textContent: args.unit });

  const clamp = (v: number) => Math.max(args.min, Math.min(args.max, v));

  slider.addEventListener('input', () => {
    const v = Number(slider.value);
    num.value = String(v);
    args.onChange(v);
  });

  num.addEventListener('input', () => {
    const raw = Number(num.value);
    if (!Number.isFinite(raw)) return;
    const v = clamp(raw);
    slider.value = String(v);
    args.onChange(v);
  });
  num.addEventListener('blur', () => {
    const raw = Number(num.value);
    if (!Number.isFinite(raw)) {
      num.value = String(args.value);
      return;
    }
    const v = clamp(raw);
    num.value = String(v);
    slider.value = String(v);
    args.onChange(v);
  });

  row.appendChild(slider);
  row.appendChild(num);
  row.appendChild(unit);
  return row;
}

/** Hex text input + native color swatch. Two-way bound. */
function makeWmColorRow(initial: string, onChange: (hex: string) => void, labelId: string): HTMLElement {
  // role=group + aria-labelledby ties the two related controls (hex + swatch)
  // to the visible "Color" label — AT announces "Color, group" on entry.
  const row = el('div', { className: 'ws-wm-color-row', role: 'group', 'aria-labelledby': labelId });
  row.appendChild(el('span', { className: 'ws-wm-row-label', textContent: 'Color', id: labelId }));

  const hex = el('input', {
    type: 'text',
    className: 'ws-range-input ws-wm-color-hex',
    value: initial,
    maxLength: 7,
    autocomplete: 'off',
    spellcheck: false,
    ariaLabel: 'Color hex',
  }) as HTMLInputElement;

  const swatch = el('input', {
    type: 'color',
    className: 'ws-wm-color-swatch',
    value: initial,
    ariaLabel: 'Color picker',
  }) as HTMLInputElement;

  // Validate via the engine's hexToRgb so the UI accepts #fff shorthand and
  // bare hex (no leading #) the engine accepts. The swatch only renders
  // #rrggbb, so normalize the input to its 7-char form for the swatch sync.
  const normalizeHex = (raw: string): string | null => {
    let s = raw.trim();
    if (s && !s.startsWith('#')) s = '#' + s;
    try { hexToRgb(s); } catch { return null; }
    if (s.length === 4) s = '#' + s.slice(1).split('').map(c => c + c).join('');
    return s.toLowerCase();
  };

  hex.addEventListener('input', () => {
    const normalized = normalizeHex(hex.value);
    if (normalized) {
      hex.classList.remove('ws-input-error');
      hex.removeAttribute('aria-invalid');
      swatch.value = normalized;
      onChange(normalized);
    } else {
      hex.classList.add('ws-input-error');
      hex.setAttribute('aria-invalid', 'true');
    }
  });
  hex.addEventListener('blur', () => {
    if (!normalizeHex(hex.value)) hex.value = swatch.value;
    hex.classList.remove('ws-input-error');
    hex.removeAttribute('aria-invalid');
  });

  swatch.addEventListener('input', () => {
    hex.value = swatch.value;
    hex.classList.remove('ws-input-error');
    hex.removeAttribute('aria-invalid');
    onChange(swatch.value);
  });

  row.appendChild(hex);
  row.appendChild(swatch);
  return row;
}

async function handleWatermarkExport() {
  if (files.length === 0) return;
  const state = wmDownloadDisabled();
  if (state.disabled) {
    showError(state.reason ?? 'Cannot export');
    return;
  }

  if (files.length === 1) {
    void doWatermarkExportPerSource();
    return;
  }

  showExportSplitModal({
    title: `Export ${files.reduce((s, f) => s + f.pageCount, 0)} pages as`,
    combinedLabel: 'Combined PDF',
    splitLabel: 'One PDF per source file',
    primary: 'split',
    onCombined: () => void doWatermarkExportCombined(),
    onSplit: () => void doWatermarkExportPerSource(),
  });
}

async function doWatermarkExportPerSource() {
  if (!wmWillStamp()) return doWatermarkPassthroughPerSource();

  let color;
  try {
    color = hexToRgb(wmSettings.colorHex);
  } catch (e: any) {
    showError(e?.message || 'Invalid color');
    return;
  }

  // Per-file: stamp the selected pages of each file. Files with no selected
  // pages are skipped (they'd just be passthroughs).
  const tasks: Array<{ file: SourceFile; opts: PdfWatermarkOptions }> = [];
  for (const f of files) {
    const pageNums = wmEffectivePagesFor(f);
    if (pageNums.length === 0) continue;
    tasks.push({
      file: f,
      opts: {
        source: { type: 'text', text: wmSettings.text, fontSize: wmSettings.fontSize, color },
        opacity: wmSettings.opacity,
        rotationDegrees: wmSettings.rotation,
        repeat: wmSettings.repeat,
        pageNums,
      },
    });
  }

  const isBatch = tasks.length > 1;
  const verb = isBatch ? `Watermarking ${tasks.length} PDFs` : 'Watermarking';

  await runWithPopup(
    verb,
    'Stamping your pages. This only takes a moment.',
    'Watermark failed. Try simpler text or fewer pages.',
    async () => {
      const results: { bytes: Uint8Array; name: string }[] = [];
      for (const t of tasks) {
        const r = await watermark(t.file.bytes, t.file.name, t.opts);
        results.push({ bytes: r.bytes, name: r.name });
      }
      lastPdfResult = results;
      lastPdfZipName = isBatch ? `watermarked_${Date.now()}.zip` : null;
      return results;
    },
    (results) => {
      if (isBatch) {
        showPdfSuccessModal(
          `${results.length} PDFs watermarked! \u{1F389}`,
          `Your <b>${results.length}</b> watermarked PDFs are downloading as a zip.`,
        );
      } else {
        showPdfSuccessModal(
          'PDF watermarked! \u{1F389}',
          `<b>${escapeHTML(shortenFileName(results[0].name, 32))}</b> is downloading now.`,
        );
      }
    },
  );
}

/** Empty-text per-source path: emit each source file unchanged. */
async function doWatermarkPassthroughPerSource() {
  if (files.length === 0) return;
  const isBatch = files.length > 1;
  const verb = isBatch ? `Saving ${files.length} PDFs` : 'Saving';
  await runWithPopup(
    verb,
    'Empty watermark — saving the source PDFs unchanged.',
    'Save failed.',
    async () => {
      const results = files.map(f => ({ bytes: f.bytes, name: f.name }));
      lastPdfResult = results;
      lastPdfZipName = isBatch ? `pdfs_${Date.now()}.zip` : null;
      return results;
    },
    (results) => {
      if (isBatch) {
        showPdfSuccessModal(
          `${results.length} PDFs saved! \u{1F389}`,
          `Your <b>${results.length}</b> source PDFs are downloading as a zip.`,
        );
      } else {
        showPdfSuccessModal(
          'PDF saved! \u{1F389}',
          `<b>${escapeHTML(shortenFileName(results[0].name, 32))}</b> is downloading now.`,
        );
      }
    },
  );
}

/** Empty-text combined path: merge all source files into one PDF, no stamp. */
async function doWatermarkPassthroughCombined() {
  if (files.length === 0) return;
  await runWithPopup(
    'Saving',
    'Empty watermark — merging your files unchanged.',
    'Save failed.',
    async () => {
      const merged = await merge(files);
      lastPdfResult = [{ bytes: merged.bytes, name: merged.name }];
      lastPdfZipName = null;
      return lastPdfResult;
    },
    (results) => {
      showPdfSuccessModal(
        'PDF saved! \u{1F389}',
        `<b>${escapeHTML(shortenFileName(results[0].name, 32))}</b> is downloading now.`,
      );
    },
  );
}

/** Combined-mode Watermark export: merge all source files, stamp selected indices, save as one PDF. */
async function doWatermarkExportCombined() {
  if (!wmWillStamp()) return doWatermarkPassthroughCombined();

  let color;
  try {
    color = hexToRgb(wmSettings.colorHex);
  } catch (e: any) {
    showError(e?.message || 'Invalid color');
    return;
  }

  await runWithPopup(
    'Watermarking',
    'Merging your files and stamping the selected pages.',
    'Watermark failed. Try simpler text or fewer pages.',
    async () => {
      const merged = await merge(files);

      // wmSelected stores flat indices (zero-based). watermark() wants 1-indexed.
      const pageNums = [...wmSelected].sort((a, b) => a - b).map(i => i + 1);

      const r = await watermark(merged.bytes, files[0].name, {
        source: { type: 'text', text: wmSettings.text, fontSize: wmSettings.fontSize, color },
        opacity: wmSettings.opacity,
        rotationDegrees: wmSettings.rotation,
        repeat: wmSettings.repeat,
        pageNums,
      });
      lastPdfResult = [{ bytes: r.bytes, name: r.name }];
      lastPdfZipName = null;
      return lastPdfResult;
    },
    (results) => {
      showPdfSuccessModal(
        'PDF watermarked! \u{1F389}',
        `<b>${escapeHTML(shortenFileName(results[0].name, 32))}</b> is downloading now.`,
      );
    },
  );
}

// ---------------------------------------------------------------------------
// ORGANIZE VIEW: page-level (select, reorder, rotate, delete, extract)
// ---------------------------------------------------------------------------

function renderOrganizeView() {
  if (!initialized || !toolContent) return;
  const prevScroll = window.scrollY;
  cleanup();
  toolContent.innerHTML = '';
  toolContent.classList.remove('ws-empty-layout', 'ws-extract-layout');

  // Derive pages from files on first visit or when files changed
  if (!organizeInitialized || pages.length === 0) {
    pages = [];
    let pos = 0;
    for (const sf of files)
      for (let p = 1; p <= sf.pageCount; p++)
        pages.push({ type: 'source', sourceFileId: sf.id, sourcePageNum: p, thumbnail: null, rotation: 0, originalPos: ++pos });
    selected.clear();
    lastClickedIdx = -1;
    organizeInitialized = true;
  }

  if (pages.length === 0) {
    renderEmptyState('Drop PDFs to organize', true);
    return;
  }

  toolContent.classList.add('ws-extract-layout');

  // Left card: page grid
  const leftCard = el('div', { className: 'card-base ws-grid-card' });
  const grid = el('div', { className: 'ws-page-cards' });
  gridEl = grid;

  pages.forEach((page, idx) => {
    const slot = el('div', { className: 'ws-page-slot' });
    slot.appendChild(createInsertBtn(idx));
    const card = createPageCard(page, idx);
    card.setAttribute('role', 'checkbox');

    card.setAttribute('aria-label', page.type === 'blank' ? 'Blank page' : `Page ${page.sourcePageNum}`);
    card.tabIndex = 0;
    slot.appendChild(card);
    grid.appendChild(slot);
  });
  updateSelectionVisuals();

  // Trailing insert button
  const trailing = el('button', { className: 'ws-page-insert-trailing', innerHTML: '+', ariaLabel: 'Insert blank page at end' });
  trailing.dataset.insertAt = 'end';
  grid.appendChild(trailing);

  // Add blank page card
  const addBlankCard = el('button', { className: 'ws-page-card ws-page-add', ariaLabel: 'Add blank page' });
  addBlankCard.innerHTML = '<p class="upload-text">+ Blank page</p>';
  addBlankCard.addEventListener('click', () => insertBlankPage(pages.length));
  grid.appendChild(addBlankCard);

  // Add more PDFs card
  const addCard = createDropzone('Drop more PDFs', true);
  addCard.className = 'ws-page-card ws-page-add';
  grid.appendChild(addCard);

  leftCard.appendChild(grid);

  grid.addEventListener('pointerdown', () => setKeyboardMode(false));
  grid.addEventListener('keydown', (e) => {
    if (e.key.startsWith('Arrow') || e.key === ' ' || e.key === 'Enter' || e.key === 'Tab') {
      setKeyboardMode(true);
    }
  });

  grid.addEventListener('keydown', (e) => {
    if ((e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || !selected.size) return;
    const card = (e.target as HTMLElement).closest('.ws-page-card') as HTMLElement | null;
    if (!card) return;
    e.preventDefault();
    const moved = moveSelection(e.key === 'ArrowUp' ? 'up' : 'down');
    if (moved) {
      renderOrganizeView();
      const firstIdx = [...selected].sort((a, b) => a - b)[0];
      const next = gridEl?.querySelector<HTMLElement>(`.ws-page-card[data-page-idx="${firstIdx}"]`);
      next?.focus();
    }
  });

  grid.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-insert-at]');
    if (!btn) return;
    e.stopPropagation();
    const at = btn.dataset.insertAt === 'end' ? pages.length : Number(btn.dataset.insertAt);
    insertBlankPage(at);
  });

  // Event delegation: page selection
  grid.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('.ws-page-delete, .ws-page-rotate, .ws-page-insert, .ws-page-insert-trailing, .ws-page-add, [data-insert-at]')) return;
    const card = target.closest('.ws-page-card') as HTMLElement | null;
    if (!card) return;
    const idx = Number(card.dataset.pageIdx);
    if (isNaN(idx)) return;

    toggleSelection(idx, e.shiftKey);
  });

  grid.addEventListener('keydown', (e) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    const card = (e.target as HTMLElement).closest('.ws-page-card') as HTMLElement | null;
    if (!card) return;
    e.preventDefault();
    const idx = Number(card.dataset.pageIdx);
    if (isNaN(idx)) return;
    toggleSelection(idx, e.shiftKey);
  });

  sortableInstance = new Sortable(grid, {
    animation: 200, delay: 150, delayOnTouchOnly: true,
    forceFallback: true,
    fallbackOnBody: true,
    ghostClass: 'ws-ghost',
    draggable: '.ws-page-slot',
    scroll: false,
    filter: '.ws-page-delete, .ws-page-rotate, .ws-page-insert, .ws-page-plus',
    preventOnFilter: true,
    onStart: (evt) => {
      startAutoScroll(leftCard);
      const dragCard = evt.item.querySelector<HTMLElement>('.ws-page-card');
      const dragIdx = Number(dragCard?.dataset.pageIdx);
      pendingMultiDrag = null;

      if (!isNaN(dragIdx)) {
        stompDragSelection(selected, dragIdx, () => {
          updateSelectionVisuals();
          updateSidebar();
          syncRangeInput();
        });
      }

      // Multi-drag: capture state NOW (immune to mid-drag selection clearing)
      if (selected.size > 1) {
        const multiPages = [...selected].sort((a, b) => a - b).map(i => pages[i]);
        pendingMultiDrag = { pages: multiPages, dragIdx };

        applyMultiDragVisuals(grid, '.ws-page-slot', el => Number(el.querySelector<HTMLElement>('.ws-page-card')?.dataset.pageIdx), dragIdx, selected);
      }

      grid.querySelectorAll('.ws-page-insert').forEach(b => b.remove());
    },
    onEnd: (evt) => {
      stopAutoScroll();
      clearMultiDragVisuals(grid);

      const multi = pendingMultiDrag;
      pendingMultiDrag = null;
      if (multi) {
        // Multi-drag: read DOM to find where dragged slot landed,
        // replace it with ALL selected pages in their original relative order
        const multiSet = new Set(multi.pages);
        const newOrder: PageEntry[] = [];
        grid.querySelectorAll<HTMLElement>('.ws-page-card').forEach(card => {
          const i = Number(card.dataset.pageIdx);
          if (isNaN(i)) return;
          if (i === multi.dragIdx) {
            newOrder.push(...multi.pages);
          } else if (!multiSet.has(pages[i])) {
            newOrder.push(pages[i]);
          }
        });

        pushHistory();
        pages.length = 0;
        pages.push(...newOrder);
        selected.clear();
        multi.pages.forEach(p => { const ni = pages.indexOf(p); if (ni >= 0) selected.add(ni); });
        // Full re-render, DOM has Sortable's single-element move, need to rebuild for multi
        renderOrganizeView();
        return;
      } else if (evt.oldIndex != null && evt.newIndex != null && evt.oldIndex !== evt.newIndex) {
        // Single drag: rebuild from DOM order
        const cards = grid.querySelectorAll<HTMLElement>('.ws-page-card');
        const reordered: PageEntry[] = [];
        cards.forEach((card) => {
          const i = Number(card.dataset.pageIdx);
          if (!isNaN(i) && pages[i]) reordered.push(pages[i]);
        });
        if (reordered.length === pages.length) {
          const newSelected = new Set<number>();
          for (const s of selected) {
            const page = pages[s];
            const ni = reordered.indexOf(page);
            if (ni >= 0) newSelected.add(ni);
          }
          pushHistory();
          pages.length = 0;
          pages.push(...reordered);
          selected = newSelected;
        }
      }
      // Full re-render to update badges with new positions
      renderOrganizeView();
    },
  });

  setupThumbnailObserver(leftCard, pages);

  // Right card: sidebar
  const rightCard = el('div', { className: 'card-base ws-sidebar-card' });
  rightCard.id = 'pdf-sidebar';
  updateSidebarContent(rightCard);

  toolContent.appendChild(leftCard);
  toolContent.appendChild(rightCard);

  // Mobile toolbar
  appendMobileToolbar(leftCard);

  if (prevScroll) window.scrollTo(0, prevScroll);
  kickPageThumbs(pages);
}

function cleanup() {
  sortableInstance?.destroy();
  sortableInstance = null;
  thumbnailObserver?.disconnect();
  thumbnailObserver = null;
  setKeyboardMode(false);
  saveBtn = null;
  extractBtn = null;
  rangeInput = null;
  mobileActionBtn = null;
  mobileExtractBtn = null;
  gridEl = null;
  mergeGridContainer = null;
  mergeSidebarCard = null;
  mergeMobileTray = null;
  organizeMobileTray = null;
  // Watermark DOM refs. DOM is wiped by toolContent.innerHTML = ''. Bitmap
  // cache and encode font are intentionally NOT cleared so re-entering the tab
  // keeps thumbnails warm. The bitmap map is bounded by WM_BITMAP_CACHE_MAX
  // and invalidated on file mutation (wmRebuildFlatPages) or full reset.
  wmGridEl = null;
  wmObserver?.disconnect();
  wmObserver = null;
  watermarkMobileTray = null;
  if (wmRafId !== null) { cancelAnimationFrame(wmRafId); wmRafId = null; }
  // Remove body-appended mobile elements (toolbar, tray, overlay)
  document.querySelectorAll('.ws-toolbar, .ws-tray, .ws-tray-overlay').forEach(e => e.remove());
}

export function resetAll() {
  files = [];
  pages = [];
  selected.clear();
  selectedFiles.clear();
  lastClickedIdx = -1;
  organizeInitialized = false;
  history.length = 0;
  setKeyboardMode(false);
  clearThumbnailCache();
  // Reset watermark state
  wmSettings = { ...WM_DEFAULTS };
  wmFlatPages = [];
  wmDisposeBitmaps();
  wmTextEncodeFont = null;
  if (wmRafId !== null) { cancelAnimationFrame(wmRafId); wmRafId = null; }
  renderActiveTool();
}

function createAddFileButton(): HTMLButtonElement {
  const btn = el('button', { className: 'ws-btn ws-btn-small', textContent: '+ Add' }) as HTMLButtonElement;
  btn.addEventListener('click', () => { fileInput.multiple = true; fileInput.click(); });
  return btn;
}

/** Rebuild pages from original files, resets all reorder, rotation, deletion, blank inserts. */
function resetPages() {
  if (!files.length) return;
  organizeInitialized = false;
  renderActiveTool();
}

// ---------------------------------------------------------------------------
// Dropzone
// ---------------------------------------------------------------------------

function createDropzone(text: string, multi: boolean): HTMLElement {
  const zone = el('div', { className: 'ws-dropzone', role: 'button', ariaLabel: text });
  zone.tabIndex = 0;
  const hint = isTouchUi() ? "or tap to browse" : "or click to browse";
  zone.innerHTML = `<p class="upload-text">${text}</p><p class="upload-hint">${hint}</p>`;

  let dragRejecting: boolean | null = null;
  zone.addEventListener('click', () => { fileInput.multiple = multi; fileInput.click(); });
  zone.addEventListener('keydown', (e) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    fileInput.multiple = multi;
    fileInput.click();
  });
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    const items = Array.from(e.dataTransfer?.items ?? []);
    const rejecting = items.length > 0 && items.every(item => item.type && item.type !== 'application/pdf');
    if (rejecting === dragRejecting) return;
    dragRejecting = rejecting;
    zone.classList.toggle('drag-reject', rejecting);
    zone.classList.toggle('drag-over', !rejecting);
  });
  zone.addEventListener('dragleave', () => {
    dragRejecting = null;
    zone.classList.remove('drag-over');
    zone.classList.remove('drag-reject');
  });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    dragRejecting = null;
    zone.classList.remove('drag-over');
    zone.classList.remove('drag-reject');
    const dropped = Array.from(e.dataTransfer?.files ?? []).filter(
      f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    );
    if (!dropped.length) { showToast('Only PDF files are supported', 'warn', 8000); return; }
    handleFiles(multi ? dropped : [dropped[0]]);
  });

  return zone;
}

function createDropzoneCard(text: string, multi: boolean): HTMLElement {
  const card = el('div', { className: 'card-base ws-dropzone-card' });
  card.appendChild(createDropzone(text, multi));
  return card;
}

/** Check if pages differ from the original file-derived state. */
function isPagesModified(): boolean {
  let idx = 0;
  for (const sf of files) {
    for (let p = 1; p <= sf.pageCount; p++) {
      if (idx >= pages.length) return true;
      const pg = pages[idx];
      if (pg.type !== 'source' || pg.sourceFileId !== sf.id || pg.sourcePageNum !== p || pg.rotation !== 0) return true;
      idx++;
    }
  }
  return idx !== pages.length; // extra pages (blanks) = modified
}

function renderEmptyState(text = 'Drop your PDFs here', multi = true) {
  toolContent.classList.add('ws-empty-layout');
  toolContent.appendChild(createDropzoneCard(text, multi));
}

// ---------------------------------------------------------------------------
// File handling
// ---------------------------------------------------------------------------

async function handleFiles(rawFiles: File[]) {
  const results: UploadResult[] = [];
  const parsed: SourceFile[] = [];

  for (const file of rawFiles) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
      parsed.push({
        id: getNextFileId(), name: file.name, size: file.size, bytes,
        pageCount: pdf.getPageCount(), firstPageThumb: null,
      });
    } catch (e) {
      console.warn('[pdfWorkspace] failed to read PDF:', file.name, e);
      results.push({ name: file.name, status: 'skipped', reason: 'load-error' });
    }
  }

  let fileBudget = MAX_FILES - files.length;
  let sizeBudget = MAX_TOTAL_FILE_SIZE;
  let pageBudget = MAX_TOTAL_PAGES;
  for (const f of files) { sizeBudget -= f.size; pageBudget -= f.pageCount; }

  const accepted: SourceFile[] = [];
  for (const sf of parsed) {
    if (fileBudget <= 0)       { results.push({ name: sf.name, status: 'skipped', reason: 'file-limit' }); continue; }
    if (sizeBudget < sf.size)  { results.push({ name: sf.name, status: 'skipped', reason: 'too-large'  }); continue; }
    if (pageBudget <= 0)       { results.push({ name: sf.name, status: 'skipped', reason: 'page-limit' }); continue; }
    const pages = Math.min(sf.pageCount, pageBudget);
    accepted.push(pages === sf.pageCount ? sf : { ...sf, pageCount: pages });
    fileBudget -= 1;
    sizeBudget -= sf.size;
    pageBudget -= pages;
    results.push({ name: sf.name, status: 'added' });
  }

  if (results.some(r => r.status === 'skipped')) {
    showUploadSummaryPopup(results, {
      files: MAX_FILES,
      pages: MAX_TOTAL_PAGES,
      sizeBytes: MAX_TOTAL_FILE_SIZE,
    });
  }
  if (accepted.length === 0) return;

  files.push(...accepted);

  if (activeTool === 'organize') {
    // New pages append at the end, so existing selection indices stay valid.
    let nextPos = pages.length + 1;
    for (const sf of accepted)
      for (let p = 1; p <= sf.pageCount; p++)
        pages.push({ type: 'source', sourceFileId: sf.id, sourcePageNum: p, thumbnail: null, rotation: 0, originalPos: nextPos++ });
    renderOrganizeView();
    kickPageThumbs(pages);
  } else if (activeTool === 'watermark') {
    onFilesMutated();
    renderWatermarkView();
  } else {
    onFilesMutated();
    updateMergeContent();
    kickMergeThumbs();
  }
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function updateSidebar() {
  const sidebar = document.getElementById('pdf-sidebar');
  if (sidebar) updateSidebarContent(sidebar);
  // Update mobile tray content
  if (organizeMobileTray) buildMobileTrayContent(organizeMobileTray);
  // Update mobile action button
  if (mobileActionBtn) {
    const active = pages.length;
    mobileActionBtn.textContent = 'Export PDF';
    mobileActionBtn.classList.toggle('disabled', active === 0);
    if (active === 0) mobileActionBtn.setAttribute('aria-disabled', 'true');
    else mobileActionBtn.removeAttribute('aria-disabled');
  }
  if (mobileExtractBtn) {
    mobileExtractBtn.textContent = extractBtnText(selected.size);
  }
}

function updateSidebarContent(sidebar: HTMLElement) {
  sidebar.innerHTML = '';

  // ---- BLOCK 1: file context (count + Restore + Add, then file list) ----
  const modified = isPagesModified();
  const originalCount = files.reduce((s, f) => s + f.pageCount, 0);
  const diff = pages.length - originalCount;
  const countBase = `${files.length} file${files.length !== 1 ? 's' : ''} · ${pages.length} pages`;
  let countHtml = countBase;
  if (modified) {
    countHtml += '<sup>*</sup>';
    if (diff !== 0) countHtml += ` (${diff > 0 ? '+' : ''}${diff})`;
  }
  const countRow = el('div', { className: 'ws-sidebar-count-row' });
  countRow.appendChild(el('p', { className: 'ws-sidebar-count', innerHTML: countHtml }));
  const btnGroup = el('div', { className: 'ws-count-btn-group' });
  if (modified) {
    const restoreBtn = el('button', { className: 'ws-btn ws-btn-small', textContent: 'Restore' });
    restoreBtn.addEventListener('click', resetPages);
    btnGroup.appendChild(restoreBtn);
  }
  btnGroup.appendChild(createAddFileButton());
  countRow.appendChild(btnGroup);
  sidebar.appendChild(countRow);

  const fileList = el('div', { className: 'ws-sidebar-files' });
  const uniqueFileIds = [...new Set(pages.filter(p => p.type !== 'blank').map(p => p.sourceFileId))];
  for (const fid of uniqueFileIds) {
    const sf = files.find(f => f.id === fid);
    if (!sf) continue;
    const isMulti = uniqueFileIds.length > 1;
    fileList.appendChild(makeSidebarFileRow(sf, {
      letter: isMulti ? String.fromCharCode(65 + (uniqueFileIds.indexOf(fid) % 26)) : undefined,
      meta: isMulti ? `${sf.pageCount} pages · ${formatBytes(sf.size)}` : undefined,
      onRemove: () => removeFile(fid),
    }));
  }
  sidebar.appendChild(fileList);

  sidebar.appendChild(makeSidebarDivider());

  // ---- BLOCK 2: Pages, what pages are in scope ----
  sidebar.appendChild(makeSectionLabel('Pages'));
  const ri = el('input', {
    type: 'text', className: 'ws-range-input',
    name: 'page-range', id: 'ws-range-input-sidebar',
    autocomplete: 'off',
    placeholder: 'e.g. 1-5, 8, 12-20',
    ariaLabel: 'Page range',
  }) as HTMLInputElement;
  ri.value = selectedToRangeString();
  ri.addEventListener('input', () => {
    const text = ri.value.trim();
    if (!text) { ri.classList.remove('ws-input-error'); selected.clear(); updateSelectionVisuals(); updateSidebar(); return; }
    const parsed = parseSelectionRange(text);
    if (!parsed) { ri.classList.add('ws-input-error'); return; }
    ri.classList.remove('ws-input-error');
    selected = parsed;
    updateSelectionVisuals();
    updateSidebar();
  });
  rangeInput = ri;
  sidebar.appendChild(ri);

  const btnRow = el('div', { className: 'ws-sidebar-btn-row' });
  const selectAllBtn = el('button', { className: 'ws-btn ws-btn-small', textContent: 'Select all' });
  selectAllBtn.addEventListener('click', () => { pages.forEach((_, i) => selected.add(i)); updateSelectionVisuals(); updateSidebar(); syncRangeInput(); });
  const deselectBtn = el('button', { className: 'ws-btn ws-btn-small', textContent: 'Deselect all' });
  deselectBtn.addEventListener('click', () => { selected.clear(); updateSelectionVisuals(); updateSidebar(); syncRangeInput(); });
  btnRow.appendChild(selectAllBtn);
  btnRow.appendChild(deselectBtn);
  sidebar.appendChild(btnRow);

  const bottom = el('div', { className: 'ws-sidebar-bottom' });

  if (selected.size > 0) {
    const moveRow = el('div', { className: 'ws-sidebar-move-row' });
    const sorted = [...selected].sort((a, b) => a - b);
    const atTop = sorted[0] === 0;
    const atBottom = sorted[sorted.length - 1] === pages.length - 1;
    const upBtn = el('button', { className: 'ws-btn ws-btn-small ws-move-btn', innerHTML: '&uarr; Move up' });
    upBtn.dataset.dir = 'up';
    if (atTop) { upBtn.classList.add('disabled'); upBtn.setAttribute('aria-disabled', 'true'); }
    upBtn.addEventListener('click', () => {
      if (!moveSelection('up')) return;
      renderOrganizeView();
      document.querySelector<HTMLElement>('#pdf-sidebar .ws-move-btn[data-dir="up"]')?.focus();
    });
    const downBtn = el('button', { className: 'ws-btn ws-btn-small ws-move-btn', innerHTML: 'Move down &darr;' });
    downBtn.dataset.dir = 'down';
    if (atBottom) { downBtn.classList.add('disabled'); downBtn.setAttribute('aria-disabled', 'true'); }
    downBtn.addEventListener('click', () => {
      if (!moveSelection('down')) return;
      renderOrganizeView();
      document.querySelector<HTMLElement>('#pdf-sidebar .ws-move-btn[data-dir="down"]')?.focus();
    });
    moveRow.appendChild(upBtn);
    moveRow.appendChild(downBtn);
    bottom.appendChild(moveRow);
  }

  const extractText = extractBtnText(selected.size);
  extractBtn = el('button', { className: 'ws-btn ws-action-btn ws-action-full', textContent: extractText });
  if (selected.size === 0) { extractBtn.classList.add('disabled'); extractBtn.setAttribute('aria-disabled', 'true'); }
  extractBtn.addEventListener('click', handleExtractClick);
  bottom.appendChild(extractBtn);

  const exportRow = el('div', { className: 'ws-sidebar-export-row' });
  saveBtn = el('button', { className: 'btn-primary ws-action-btn ws-action-full', textContent: 'Export PDF' });
  saveBtn.addEventListener('click', handleSave);
  exportRow.appendChild(saveBtn);

  bottom.appendChild(exportRow);
  sidebar.appendChild(bottom);
}

function removeFile(fid: number) {
  // Re-map selected indices for organize state
  const newSelected = new Set<number>();
  let newIdx = 0;
  pages.forEach((p, oldIdx) => {
    if (p.sourceFileId === fid) return;
    if (selected.has(oldIdx)) newSelected.add(newIdx);
    newIdx++;
  });
  pages = pages.filter(p => p.sourceFileId !== fid);
  selected = newSelected;
  files = files.filter(f => f.id !== fid);
  lastClickedIdx = -1;

  if (files.length === 0) clearThumbnailCache();
  if (pages.length === 0) organizeInitialized = false;

  renderActiveTool();
  if (activeTool === 'organize' && pages.length > 0) kickPageThumbs(pages);
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

function toggleSelection(idx: number, shift: boolean) {
  if (shift && selected.size > 0) {
    let lo = idx, hi = idx;
    for (const s of selected) { if (s < lo) lo = s; if (s > hi) hi = s; }
    for (let i = lo; i <= hi; i++) selected.add(i);
  } else {
    selected.has(idx) ? selected.delete(idx) : selected.add(idx);
  }
  lastClickedIdx = idx;
  updateSelectionVisuals();
  updateSidebar();
  syncRangeInput();
}

function updateSelectionVisuals() {
  if (!gridEl) return;
  let firstSelIdx = -1;
  let lastSelIdx = -1;
  if (selected.size > 0) {
    const sorted = [...selected].sort((a, b) => a - b);
    firstSelIdx = sorted[0];
    lastSelIdx = sorted[sorted.length - 1];
  }
  gridEl.querySelectorAll<HTMLElement>('.ws-page-card').forEach((card) => {
    const i = Number(card.dataset.pageIdx);
    const sel = selected.has(i);
    card.classList.toggle('ws-page-selected', sel);
    card.classList.toggle('ws-first-selected', i === firstSelIdx);
    card.classList.toggle('ws-last-selected', i === lastSelIdx);
    card.setAttribute('aria-pressed', String(sel));
  });
}

function updateMergeSelectionVisuals() {
  if (!mergeGridContainer) return;
  mergeGridContainer.querySelectorAll<HTMLElement>('.ws-file-card').forEach((card) => {
    const fid = Number(card.dataset.fileId);
    const sel = !isNaN(fid) && selectedFiles.has(fid);
    card.classList.toggle('ws-file-selected', sel);
    card.setAttribute('aria-pressed', String(sel));
  });
}

// ---------------------------------------------------------------------------
// Actions: Save + Extract
// ---------------------------------------------------------------------------

async function handleSave() {
  if (!pages.length) return;

  if (files.length === 1) {
    void doOrganizeSaveCombined();
    return;
  }

  const splitState = organizeAllowsPerSourceSplit();
  const realPageCount = pages.filter(p => p.type !== 'blank').length;
  showExportSplitModal({
    title: `Export ${realPageCount} pages as`,
    combinedLabel: 'Combined PDF',
    splitLabel: 'One PDF per source file',
    primary: 'combined',
    splitDisabled: splitState.allowed ? undefined : { reason: splitState.reason },
    onCombined: () => void doOrganizeSaveCombined(),
    onSplit: () => void doOrganizeSavePerSource(),
  });
}

async function doOrganizeSaveCombined() {
  await runWithPopup('Saving', 'Packing up your PDF with the latest page order. Hold tight.', 'Save failed. Try with fewer pages or a smaller file.', async () => {
    const r = await organize(files, pages);
    lastPdfResult = [{ bytes: r.bytes, name: r.name }];
    lastPdfZipName = null;
    return r;
  }, (r) => {
    showPdfSuccessModal(
      'PDF saved! \u{1F389}',
      `<b>${escapeHTML(shortenFileName(r.name, 32))}</b> is downloading now.`,
    );
  });
}

async function doOrganizeSavePerSource() {
  const firstName = files[0].name.replace(/\.pdf$/i, '');
  await runWithPopup('Saving', 'Packing each source file separately. Hold tight.', 'Save failed. Try with fewer pages or a smaller file.', async () => {
    const out: { bytes: Uint8Array; name: string }[] = [];
    for (const sf of files) {
      const filtered = pages.filter(p => p.type === 'source' && p.sourceFileId === sf.id);
      if (filtered.length === 0) continue;
      const r = await organize([sf], filtered);
      out.push({ bytes: r.bytes, name: r.name });
    }
    lastPdfResult = out;
    lastPdfZipName = out.length > 1 ? `${firstName}_organized.zip` : null;
    return out;
  }, (results) => {
    if (results.length > 1) {
      showPdfSuccessModal(
        `${results.length} PDFs saved! \u{1F389}`,
        `Your <b>${results.length}</b> PDFs are downloading as a zip.`,
      );
    } else if (results.length === 1) {
      showPdfSuccessModal(
        'PDF saved! \u{1F389}',
        `<b>${escapeHTML(shortenFileName(results[0].name, 32))}</b> is downloading now.`,
      );
    }
  });
}

/**
 * Per-source split is faithful only when each source's pages form a single
 * contiguous block in `pages[]` and there are no blanks. Cross-file mixing or
 * blanks would silently lose content in the per-source output.
 */
function organizeAllowsPerSourceSplit(): { allowed: true } | { allowed: false; reason: string } {
  if (pages.some(p => p.type === 'blank')) {
    return { allowed: false, reason: 'Remove blank pages to split per file, or use combined.' };
  }
  const closed = new Set<number>();
  let open: number | null = null;
  for (const p of pages) {
    if (p.type === 'blank') continue;
    if (p.sourceFileId !== open) {
      if (open !== null) closed.add(open);
      open = p.sourceFileId;
      if (closed.has(open)) {
        return { allowed: false, reason: 'Group each file\'s pages together to split per file, or use combined.' };
      }
    }
  }
  return { allowed: true };
}

interface ExportSplitOpts {
  title: string;
  combinedLabel: string;
  splitLabel: string;
  primary: 'combined' | 'split';
  splitDisabled?: { reason: string };
  onCombined: () => void;
  onSplit: () => void;
}

function showExportSplitModal(opts: ExportSplitOpts): void {
  const wrap = el('div', { className: 'popup-choices' });

  const closeBtn = el('button', { className: 'close-btn close-btn-lg modal-close-btn', innerHTML: '&times;', ariaLabel: 'Close' });
  closeBtn.addEventListener('click', () => hidePopup());
  wrap.appendChild(closeBtn);

  wrap.appendChild(el('p', { className: 'ws-sidebar-count', textContent: opts.title }));

  const combClass = opts.primary === 'combined' ? 'btn-primary' : 'ws-btn';
  const combBtn = el('button', { className: `${combClass} ws-action-btn ws-action-full`, textContent: opts.combinedLabel });
  combBtn.addEventListener('click', () => { hidePopup(); opts.onCombined(); });
  wrap.appendChild(combBtn);

  const splitClass = opts.primary === 'split' ? 'btn-primary' : 'ws-btn';
  const splitBtn = el('button', { className: `${splitClass} ws-action-btn ws-action-full`, textContent: opts.splitLabel });
  if (opts.splitDisabled) {
    splitBtn.classList.add('disabled');
    splitBtn.setAttribute('aria-disabled', 'true');
  } else {
    splitBtn.addEventListener('click', () => { hidePopup(); opts.onSplit(); });
  }
  wrap.appendChild(splitBtn);

  if (opts.splitDisabled) {
    wrap.appendChild(el('p', { className: 'ws-sidebar-hint', textContent: opts.splitDisabled.reason }));
  }

  showPopup(wrap, false, () => hidePopup());
}

async function handleExtractClick() {
  if (selected.size === 0) return;
  const indices = [...selected].sort((a, b) => a - b);
  if (indices.length === 1) { doExtract(indices, false); return; }
  showExtractModal(indices);
}


function showExtractModal(indices: number[]) {
  const count = indices.length;
  const wrap = el('div', { className: 'popup-choices' });

  const closeBtn = el('button', { className: 'close-btn close-btn-lg modal-close-btn', innerHTML: '&times;', ariaLabel: 'Close' });
  closeBtn.addEventListener('click', () => hidePopup());
  wrap.appendChild(closeBtn);

  wrap.appendChild(el('p', { className: 'ws-sidebar-count', textContent: `Extract ${count} pages as` }));

  const combBtn = el('button', { className: 'btn-primary ws-action-btn ws-action-full', textContent: 'Combined PDF' });
  combBtn.addEventListener('click', () => { hidePopup(); doExtract(indices, true); });
  wrap.appendChild(combBtn);

  const sepBtn = el('button', { className: 'ws-btn ws-action-btn ws-action-full', textContent: 'One file per page' });
  sepBtn.addEventListener('click', () => { hidePopup(); doExtract(indices, false); });
  wrap.appendChild(sepBtn);

  showPopup(wrap, false, () => hidePopup());
}

async function doExtract(indices: number[], groupAsOne: boolean) {
  if (files.length === 0 || indices.length === 0) return;
  const extractCount = indices.length;
  const sorted = [...indices].sort((a, b) => a - b);
  await runWithPopup('Extracting', 'Pulling the selected pages into a new file. Almost there.', 'Extract failed. The PDF might be damaged. Try re-exporting it from the source app.',
    async () => {
      const byFile = new Map<number, number[]>();
      for (const idx of sorted) {
        const page = pages[idx];
        const arr = byFile.get(page.sourceFileId) ?? [];
        arr.push(page.sourcePageNum);
        byFile.set(page.sourceFileId, arr);
      }

      const firstName = files[0].name.replace(/\.pdf$/i, '');

      if (groupAsOne) {
        const output = await PDFDocument.create();
        const loadedSources = new Map<number, Awaited<ReturnType<typeof PDFDocument.load>>>();
        for (const idx of sorted) {
          const page = pages[idx];
          if (!loadedSources.has(page.sourceFileId)) {
            const sf = files.find(f => f.id === page.sourceFileId)!;
            loadedSources.set(page.sourceFileId, await PDFDocument.load(sf.bytes, { ignoreEncryption: true }));
          }
          const source = loadedSources.get(page.sourceFileId)!;
          const [copied] = await output.copyPages(source, [page.sourcePageNum - 1]);
          output.addPage(copied);
        }
        const outputBytes = new Uint8Array(await output.save());
        const suffix = extractCount === pages.length ? '' : '_extracted';
        const name = `${firstName}${suffix}.pdf`;
        lastPdfResult = [{ bytes: outputBytes, name }];
        lastPdfZipName = null;
        return lastPdfResult;
      } else {
        const allResults: { name: string; bytes: Uint8Array }[] = [];
        for (const [fid, pageNums] of byFile) {
          const sf = files.find(f => f.id === fid)!;
          const baseName = sf.name.replace(/\.pdf$/i, '');
          const results = await extract(sf.bytes, pageNums, baseName, false);
          allResults.push(...results);
        }
        lastPdfResult = allResults;
        lastPdfZipName = allResults.length > 1 ? `${firstName}_pages.zip` : null;
        return allResults;
      }
    },
    () => {
      const pageWord = extractCount === 1 ? 'page' : 'pages';
      showPdfSuccessModal(
        'Pages extracted! \u{1F389}',
        `${extractCount} ${pageWord} extracted and downloading now.`,
      );
    },
    1000,
  );
}

// ---------------------------------------------------------------------------
// Delete + Blank page insert
// ---------------------------------------------------------------------------

function deletePage(idx: number) {
  pushHistory();
  const page = pages[idx];
  const fid = page.sourceFileId;

  pages.splice(idx, 1);

  // Re-map selected + lastClickedIdx
  const newSelected = new Set<number>();
  for (const s of selected) {
    if (s === idx) continue;
    newSelected.add(s > idx ? s - 1 : s);
  }
  selected = newSelected;
  if (lastClickedIdx === idx) lastClickedIdx = -1;
  else if (lastClickedIdx > idx) lastClickedIdx--;

  // If file has no more pages, remove it
  if (page.type === 'source' && !pages.some(p => p.sourceFileId === fid)) {
    files = files.filter(f => f.id !== fid);
  }

  if (pages.length === 0) {
    files = [];
    selected.clear();
    clearThumbnailCache();
  }

  // Full re-render to update all badges with new positions
  renderOrganizeView();
}

async function getAdjacentPageSize(insertIdx: number): Promise<{ width: number; height: number }> {
  const nearby = pages[insertIdx] ?? pages[insertIdx - 1];
  if (nearby && nearby.type === 'source') {
    const sf = files.find(f => f.id === nearby.sourceFileId);
    if (sf) {
      try {
        const pdf = await PDFDocument.load(sf.bytes, { ignoreEncryption: true });
        const page = pdf.getPage(nearby.sourcePageNum - 1);
        const { width, height } = page.getSize();
        return { width, height };
      } catch { /* fall through */ }
    }
  }
  return { width: 595.28, height: 841.89 };
}

function deleteSelected() {
  if (!selected.size) return;
  pushHistory();
  pages = pages.filter((_, i) => !selected.has(i));
  const remainingFileIds = new Set(pages.filter(p => p.type === 'source').map(p => p.sourceFileId));
  files = files.filter(f => remainingFileIds.has(f.id));
  selected.clear();
  lastClickedIdx = -1;
  if (pages.length === 0) {
    files = [];
    clearThumbnailCache();
  }
  renderOrganizeView();
}

function insertBlankPage(atIdx: number) {
  getAdjacentPageSize(atIdx).then(size => {
    pushHistory();
    const blank: PageEntry = {
      type: 'blank', sourceFileId: -1, sourcePageNum: 0,
      thumbnail: null, rotation: 0,
      blankPageSize: size,
      originalPos: atIdx + 1,
    };
    // Shift selected indices
    const newSelected = new Set<number>();
    for (const s of selected) newSelected.add(s >= atIdx ? s + 1 : s);
    selected = newSelected;
    if (lastClickedIdx >= atIdx) lastClickedIdx++;

    pages.splice(atIdx, 0, blank);
    renderOrganizeView();
    kickPageThumbs(pages);
  });
}

function createInsertBtn(atIdx: number): HTMLElement {
  const btn = el('button', { className: 'ws-page-insert', innerHTML: '+', ariaLabel: 'Insert blank page' });
  btn.dataset.insertAt = String(atIdx);
  return btn;
}

// ---------------------------------------------------------------------------
// Mobile toolbar + tray
// ---------------------------------------------------------------------------

const MORE_SVG  = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';
const COLLAPSE_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';

function wireTrayToggle(tray: HTMLElement, overlay: HTMLElement, iconBtn: HTMLElement) {
  // Tray is a non-modal dialog: gives it semantics + ESC + focus return.
  // We do NOT set aria-modal=true because we don't trap focus — claiming
  // modal without a trap mis-states behavior to AT.
  tray.setAttribute('role', 'dialog');
  tray.setAttribute('aria-label', 'Options');
  tray.tabIndex = -1;
  iconBtn.setAttribute('aria-expanded', 'false');

  let onKeyDown: ((e: KeyboardEvent) => void) | null = null;

  const setOpen = (open: boolean) => {
    tray.classList.toggle('ws-tray-open', open);
    overlay.classList.toggle('ws-tray-open', open);
    iconBtn.innerHTML = open ? COLLAPSE_SVG : MORE_SVG;
    iconBtn.setAttribute('aria-label', open ? 'Hide options' : 'More options');
    iconBtn.setAttribute('aria-expanded', String(open));
    updateScrollLock();
    if (open) {
      // Move focus into the tray. Prefer the first focusable; fall back to
      // the tray container itself.
      const first = tray.querySelector<HTMLElement>(
        'button, [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      (first ?? tray).focus();
      onKeyDown = (e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          setOpen(false);
        }
      };
      document.addEventListener('keydown', onKeyDown);
    } else {
      if (onKeyDown) { document.removeEventListener('keydown', onKeyDown); onKeyDown = null; }
      // Return focus to the trigger so keyboard users don't get stranded.
      iconBtn.focus();
    }
  };
  iconBtn.addEventListener('click', () => setOpen(!tray.classList.contains('ws-tray-open')));
  overlay.addEventListener('click', () => setOpen(false));
}

function appendMobileToolbar(_gridCard: HTMLElement) {
  const toolbar = el('div', { className: 'ws-toolbar ws-toolbar--organize' });

  // Top row: Extract n pages + triple-dot
  const topRow = el('div', { className: 'ws-toolbar-row' });

  const mobileExtract = el('button', { className: 'btn-secondary ws-toolbar-extract', textContent: extractBtnText(selected.size) });
  mobileExtract.addEventListener('click', handleExtractClick);
  mobileExtractBtn = mobileExtract;

  const iconBtn = el('button', { className: 'icon-btn ws-toolbar-icon', ariaLabel: 'More options' });
  iconBtn.innerHTML = MORE_SVG;

  topRow.appendChild(mobileExtract);
  topRow.appendChild(iconBtn);
  toolbar.appendChild(topRow);

  // Export PDF (full width, primary)
  const actionBtn = el('button', { className: 'btn-primary ws-toolbar-export', textContent: 'Export PDF' });
  actionBtn.addEventListener('click', handleSave);
  toolbar.appendChild(actionBtn);
  document.body.appendChild(toolbar);
  mobileActionBtn = actionBtn;

  // Tray
  const tray = el('div', { className: 'ws-tray' });
  organizeMobileTray = tray;
  buildMobileTrayContent(tray);
  const overlay = el('div', { className: 'ws-tray-overlay' });

  wireTrayToggle(tray, overlay, iconBtn);

  document.body.appendChild(overlay);
  document.body.appendChild(tray);
}

function buildMobileTrayContent(tray: HTMLElement) {
  tray.innerHTML = '';

  const modified = isPagesModified();
  const multiFile = files.length > 1;

  // ---- BLOCK 1: file context (count + Restore + Add, then file list) ----
  const originalCount = files.reduce((s, f) => s + f.pageCount, 0);
  const diff = pages.length - originalCount;
  const countBase = `${files.length} file${files.length !== 1 ? 's' : ''} · ${pages.length} pages`;
  let countHtml = countBase;
  if (modified) {
    countHtml += '<sup>*</sup>';
    if (diff !== 0) countHtml += ` (${diff > 0 ? '+' : ''}${diff})`;
  }
  const countRow = el('div', { className: 'ws-sidebar-count-row' });
  countRow.appendChild(el('p', { className: 'ws-sidebar-count', innerHTML: countHtml }));
  const trayBtnGroup = el('div', { className: 'ws-count-btn-group' });
  if (modified) {
    const restoreBtn = el('button', { className: 'ws-btn ws-btn-small', textContent: 'Restore' });
    restoreBtn.addEventListener('click', resetPages);
    trayBtnGroup.appendChild(restoreBtn);
  }
  trayBtnGroup.appendChild(createAddFileButton());
  countRow.appendChild(trayBtnGroup);
  tray.appendChild(countRow);

  const fileList = el('div', { className: 'ws-sidebar-files' });
  const uniqueFileIds = [...new Set(pages.filter(p => p.type !== 'blank').map(p => p.sourceFileId))];
  for (const fid of uniqueFileIds) {
    const sf = files.find(f => f.id === fid);
    if (!sf) continue;
    const isMulti = uniqueFileIds.length > 1;
    fileList.appendChild(makeSidebarFileRow(sf, {
      letter: isMulti ? String.fromCharCode(65 + (uniqueFileIds.indexOf(fid) % 26)) : undefined,
      meta: isMulti ? `${sf.pageCount} pages · ${formatBytes(sf.size)}` : undefined,
      onRemove: () => removeFile(fid),
    }));
  }
  tray.appendChild(fileList);

  tray.appendChild(makeSidebarDivider());

  // ---- BLOCK 2: Pages, what pages are in scope ----
  tray.appendChild(makeSectionLabel('Pages'));
  const ri = el('input', {
    type: 'text', className: 'ws-range-input',
    name: 'page-range', id: 'ws-range-input-tray',
    autocomplete: 'off',
    placeholder: multiFile ? 'e.g. A1-A5, B3' : 'e.g. 1-5, 8',
    ariaLabel: 'Page range',
  }) as HTMLInputElement;
  ri.value = selectedToRangeString();
  ri.addEventListener('input', () => {
    const text = ri.value.trim();
    if (!text) { ri.classList.remove('ws-input-error'); selected.clear(); updateSelectionVisuals(); updateSidebar(); return; }
    const parsed = parseSelectionRange(text);
    if (!parsed) { ri.classList.add('ws-input-error'); return; }
    ri.classList.remove('ws-input-error');
    selected = parsed;
    updateSelectionVisuals();
    updateSidebar();
  });
  tray.appendChild(ri);

  const btnRow = el('div', { className: 'ws-sidebar-btn-row' });
  const selAll = el('button', { className: 'ws-btn ws-btn-small', textContent: 'Select all' });
  selAll.addEventListener('click', () => { pages.forEach((_, i) => selected.add(i)); updateSelectionVisuals(); updateSidebar(); syncRangeInput(); });
  const desel = el('button', { className: 'ws-btn ws-btn-small', textContent: 'Deselect all' });
  desel.addEventListener('click', () => { selected.clear(); updateSelectionVisuals(); updateSidebar(); syncRangeInput(); });
  btnRow.appendChild(selAll);
  btnRow.appendChild(desel);
  tray.appendChild(btnRow);

  // Touch-only reorder fallback. Drag-to-reorder requires a long-press gesture
  // that is hard to discover and impossible for users with motor impairments;
  // these buttons reuse moveSelection() (same path the desktop sidebar uses
  // when ws-keyboard-mode is active).
  if (selected.size > 0) {
    tray.appendChild(makeSidebarDivider());
    tray.appendChild(makeSectionLabel('Reorder'));
    const moveRow = el('div', { className: 'ws-sidebar-btn-row' });
    const sorted = [...selected].sort((a, b) => a - b);
    const atTop = sorted[0] === 0;
    const atBottom = sorted[sorted.length - 1] === pages.length - 1;
    const upBtn = el('button', {
      className: 'ws-btn ws-move-btn',
      innerHTML: '&uarr; Move up',
      ariaLabel: 'Move selected pages up',
    });
    if (atTop) { upBtn.classList.add('disabled'); upBtn.setAttribute('aria-disabled', 'true'); }
    upBtn.addEventListener('click', () => {
      if (!moveSelection('up')) return;
      renderOrganizeView();
    });
    const downBtn = el('button', {
      className: 'ws-btn ws-move-btn',
      innerHTML: 'Move down &darr;',
      ariaLabel: 'Move selected pages down',
    });
    if (atBottom) { downBtn.classList.add('disabled'); downBtn.setAttribute('aria-disabled', 'true'); }
    downBtn.addEventListener('click', () => {
      if (!moveSelection('down')) return;
      renderOrganizeView();
    });
    moveRow.appendChild(upBtn);
    moveRow.appendChild(downBtn);
    tray.appendChild(moveRow);
  }
}

// ---------------------------------------------------------------------------
// Page card
// ---------------------------------------------------------------------------

function getPageBadgeText(page: PageEntry): string {
  if (page.type === 'blank') return 'Blank';
  if (files.length <= 1) return String(page.sourcePageNum);
  const fileIdx = files.findIndex(f => f.id === page.sourceFileId);
  const letter = String.fromCharCode(65 + (fileIdx % 26));
  return `${letter}${page.sourcePageNum}`;
}

function createPageCard(page: PageEntry, idx: number): HTMLElement {
  const card = el('div', {
    className: 'ws-page-card',
    dataset: { pageIdx: String(idx) },
  });
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-pressed', selected.has(idx) ? 'true' : 'false');
  card.setAttribute('aria-label', page.type === 'blank' ? `Blank page ${idx + 1}` : `Page ${idx + 1} of ${pages.length}`);
  card.addEventListener('contextmenu', (e) => e.preventDefault());

  const isBlank = page.type === 'blank';
  const thumb = el('div', { className: `ws-page-thumb${page.thumbnail || isBlank ? '' : ' ws-skeleton'}` });
  const imgSrc = isBlank ? mockPageThumb('Blank') : page.thumbnail;
  if (imgSrc) {
    setThumb(thumb, imgSrc, {
      alt: isBlank ? 'Blank page' : `Page ${page.sourcePageNum}`,
      rotation: page.rotation,
    });
  }
  card.appendChild(thumb);

  const checkBadge = el('span', { className: 'ws-page-check', innerHTML: '&#x2713;', ariaHidden: 'true' });
  card.appendChild(checkBadge);

  const badgeText = getPageBadgeText(page);
  const badge = el('span', { className: 'ws-page-badge', textContent: page.rotation ? `${badgeText} \u21bb` : badgeText });
  card.appendChild(badge);

  const plusBefore = el('button', { className: 'ws-page-plus ws-page-plus-before', innerHTML: '+', ariaLabel: 'Insert blank page before selection' });
  plusBefore.addEventListener('click', (e) => {
    e.stopPropagation();
    const sorted = [...selected].sort((a, b) => a - b);
    if (sorted.length) insertBlankPage(sorted[0]);
  });
  card.appendChild(plusBefore);

  const plusAfter = el('button', { className: 'ws-page-plus ws-page-plus-after', innerHTML: '+', ariaLabel: 'Insert blank page after selection' });
  plusAfter.addEventListener('click', (e) => {
    e.stopPropagation();
    const sorted = [...selected].sort((a, b) => a - b);
    if (sorted.length) insertBlankPage(sorted[sorted.length - 1] + 1);
  });
  card.appendChild(plusAfter);

  const delBtn = el('button', { className: 'icon-btn ws-hover-reveal ws-page-delete', innerHTML: '&times;', ariaLabel: 'Delete' });
  delBtn.addEventListener('click', (e) => { e.stopPropagation(); deletePage(idx); });
  card.appendChild(delBtn);

  let visualAngle = page.rotation || 0;
  const rotBtn = el('button', { className: 'icon-btn ws-hover-reveal ws-page-rotate', innerHTML: '&#x21bb;', ariaLabel: 'Rotate' });
  rotBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    pushHistory();
    page.rotation = ((page.rotation + 90) % 360) as 0 | 90 | 180 | 270;
    visualAngle += 90;
    const img = card.querySelector('.ws-page-thumb img') as HTMLImageElement | null;
    if (img) img.style.transform = `rotate(${visualAngle}deg)`;
    badge.textContent = page.rotation ? `${getPageBadgeText(page)} \u21bb` : getPageBadgeText(page);
    updateSidebar();
  });
  card.appendChild(rotBtn);

  return card;
}

// ---------------------------------------------------------------------------
// Thumbnail rendering
// ---------------------------------------------------------------------------

function kickPageThumbs(p: PageEntry[]) {
  if (!initialized) return;
  for (let i = 0; i < Math.min(EAGER_LIMIT, p.length); i++) queuePageThumb(p, i);
}

function queuePageThumb(p: PageEntry[], idx: number) {
  if (p[idx].thumbnail || p[idx].type === 'blank') return;
  const sf = files.find(f => f.id === p[idx].sourceFileId);
  if (!sf) return;
  queueRender(sf.bytes, p[idx].sourcePageNum, (url) => {
    p[idx].thumbnail = url;
    if (!toolContent) return;
    const card = toolContent.querySelector(`[data-page-idx="${idx}"] .ws-page-thumb`);
    if (card) setThumb(card, url, { alt: `Page ${p[idx].sourcePageNum}`, rotation: p[idx].rotation });
  });
}

function setupThumbnailObserver(container: HTMLElement, p: PageEntry[]) {
  thumbnailObserver?.disconnect();
  thumbnailObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const idx = Number((entry.target as HTMLElement).dataset.pageIdx);
        if (!isNaN(idx) && !p[idx]?.thumbnail) queuePageThumb(p, idx);
        thumbnailObserver!.unobserve(entry.target);
      }
    }
  }, { root: container });
  container.querySelectorAll<HTMLElement>('.ws-page-card').forEach((card, i) => {
    if (i >= EAGER_LIMIT && !p[i]?.thumbnail) thumbnailObserver!.observe(card);
  });
}

/**
 * Thin async wrapper around renderPageThumbnail. The internal queue inside
 * pdfThumbnails.ts already serialises calls; this just handles errors and the
 * empty-result fallback so call sites stay tidy.
 */
async function queueRender(bytes: Uint8Array, page: number, cb: (url: string) => void, maxWidth?: number) {
  try {
    const url = await renderPageThumbnail(bytes, page, maxWidth);
    cb(url || mockPageThumb());
  } catch (e) {
    console.warn('[pdfThumbnails] page', page, e);
    cb(mockPageThumb());
  }
}

// ---------------------------------------------------------------------------
// Range helpers
// ---------------------------------------------------------------------------

export function parsePageRange(text: string, max: number): Set<number> | null {
  const result = new Set<number>();
  for (const part of text.split(',').map(s => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      const start = parseInt(m[1], 10), end = parseInt(m[2], 10);
      if (start < 1 || end > max || start > end) return null;
      for (let i = start; i <= end; i++) result.add(i);
    } else {
      const n = parseInt(part, 10);
      if (isNaN(n) || n < 1 || n > max) return null;
      result.add(n);
    }
  }
  return result.size > 0 ? result : null;
}

export function setToRangeString(sel: Set<number>, total: number): string {
  if (sel.size === 0) return '';
  if (sel.size === total) return `1-${total}`;
  const sorted = [...sel].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0], end = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === end + 1) { end = sorted[i]; }
    else { ranges.push(start === end ? String(start + 1) : `${start + 1}-${end + 1}`); start = sorted[i]; end = sorted[i]; }
  }
  ranges.push(start === end ? String(start + 1) : `${start + 1}-${end + 1}`);
  return ranges.join(', ');
}

function syncRangeInput() {
  if (!rangeInput) return;
  rangeInput.value = selectedToRangeString();
  rangeInput.classList.remove('ws-input-error');
}

function selectedToRangeString(): string {
  return setToRangeString(selected, pages.length);
}

function parseSelectionRange(text: string): Set<number> | null {
  const oneIndexed = parsePageRange(text, pages.length);
  if (!oneIndexed) return null;
  const zeroIndexed = new Set<number>();
  for (const n of oneIndexed) zeroIndexed.add(n - 1);
  return zeroIndexed;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

async function runWithPopup<T>(
  verb: string,
  subtext: string,
  fallback: string,
  fn: () => Promise<T>,
  onSuccess?: (result: T) => void,
  minMs: number = 1200,
): Promise<void> {
  const wrap = el('div', { className: 'ws-processing' });
  wrap.appendChild(el('h2', { textContent: `${verb}...` }));
  wrap.appendChild(el('div', { className: 'ws-spinner' }));
  wrap.appendChild(el('p', { textContent: subtext }));
  showPopup(wrap, true);
  const startTime = performance.now();
  try {
    const result = await fn();
    await ensureMinDuration(startTime, minMs);
    if (onSuccess) onSuccess(result);
    else hidePopup();
  } catch (e: any) {
    console.error(`[pdfWorkspace] ${verb.toLowerCase()} failed:`, e);
    hidePopup();
    const info = toUserErrorInfo(e);
    const message = info.message || fallback;
    showError(appendSupportContact(message, FEEDBACK_CONTACT_TEXT));
  }
}

function redownloadLastPdfResult() {
  if (lastPdfResult.length === 0) return;
  if (lastPdfResult.length === 1) downloadFile(lastPdfResult[0].bytes, lastPdfResult[0].name);
  else downloadAsZip(lastPdfResult, lastPdfZipName!);
}

function showPdfSuccessModal(title: string, resultHTML: string) {
  const h2 = el('h2', { textContent: title });
  const frogDiv = createDancingFrog();
  const p = el('p', {});
  p.innerHTML = resultHTML;

  const actions = el('div', { className: 'popup-actions-footer' });
  actions.appendChild(createPopupButton('Download again', 'btn-primary', redownloadLastPdfResult));
  actions.appendChild(createPopupButton('Done', 'btn-secondary', hidePopup));

  replacePopup([h2, frogDiv, p, actions]);

  setTimeout(() => { if (ui.popupBox.classList.contains('open')) triggerConfetti(); }, 150);
  setTimeout(() => { if (ui.popupBox.classList.contains('open')) redownloadLastPdfResult(); }, 400);
}

let errorTimeout: ReturnType<typeof setTimeout> | null = null;

function showError(msg: string) {
  errorEl.textContent = msg;
  errorEl.style.display = '';
  if (errorTimeout) clearTimeout(errorTimeout);
  errorTimeout = setTimeout(() => hideError(), 5000);
}

function hideError() { errorEl.style.display = 'none'; errorEl.textContent = ''; }

// Exposed for unit tests, do not use in production code.
export const __testing = {
  reset() {
    files = [];
    pages = [];
    selected = new Set();
    lastClickedIdx = -1;
    history.length = 0;
    wmSettings = { ...WM_DEFAULTS };
    wmFlatPages = [];
    wmDisposeBitmaps();
    wmTextEncodeFont = null;
    if (wmRafId !== null) { cancelAnimationFrame(wmRafId); wmRafId = null; }
  },
  seed(seedPages: PageEntry[], seedFiles: SourceFile[] = [], seedSelected: number[] = []) {
    pages = seedPages;
    files = seedFiles;
    selected = new Set(seedSelected);
    lastClickedIdx = -1;
    history.length = 0;
  },
  getPages: () => pages,
  getFiles: () => files,
  getSelected: () => selected,
  getHistoryLength: () => history.length,
  deleteSelected,
  undo,
  pushHistory,
  parseSelectionRange,
  selectedToRangeString,
  handleKeydown(e: KeyboardEvent) {
    // Simulate: organize tool active, initialized already set by caller
    handleGlobalKeydown(e);
  },
  setActiveTool(t: 'merge' | 'organize' | 'watermark') { activeTool = t; },
  setInitialized(v: boolean) { initialized = v; },
  // Watermark seams
  setWmSettings(partial: Partial<WmSettings>) { wmSettings = { ...wmSettings, ...partial }; },
  getWmSettings: () => wmSettings,
  triggerWmFilesMutated() { onFilesMutated(); },
  setFiles(fs: SourceFile[]) { files = fs; },
  getWmFlatPages: () => wmFlatPages,
  wmBadgeText: (idx: number) => wmBadgeText(idx),
  getWmSelected: () => wmSelected,
  setWmSelected: (s: Iterable<number>) => { wmSelected = new Set(s); },
  wmSelectedToRangeString: () => wmSelectedToRangeString(),
  organizeAllowsPerSourceSplit: () => organizeAllowsPerSourceSplit(),
  wmEffectivePagesFor: (sourceFile: SourceFile) => wmEffectivePagesFor(sourceFile),
  wmDownloadDisabled: () => wmDownloadDisabled(),
  wmDownloadLabel: () => wmDownloadLabel(),
  hasWmBaseBitmap: (idx: number) => {
    const e = wmFlatPages[idx];
    return e ? wmBaseBitmaps.has(`${e.fileId}:${e.pageNum}`) : false;
  },
  renderWmCardForTest: (idx: number) => wmRenderCard(idx, wmBuildFrame()),
  /**
   * Scaffold the DOM and module state for a tab, then render. Returns the
   * `#pdf-tool-content` container so tests can query rendered nodes.
   */
  setupForTest(tab: 'merge' | 'organize' | 'watermark', sfs: SourceFile[]): HTMLElement {
    document.querySelectorAll('.ws-toolbar, .ws-tray, .ws-tray-overlay').forEach(e => e.remove());
    let tc = document.getElementById('pdf-tool-content');
    if (!tc) {
      tc = document.createElement('div');
      tc.id = 'pdf-tool-content';
      document.body.appendChild(tc);
    }
    let fi = document.getElementById('workspace-file-input') as HTMLInputElement | null;
    if (!fi) {
      fi = document.createElement('input');
      fi.type = 'file';
      fi.id = 'workspace-file-input';
      document.body.appendChild(fi);
    }
    let er = document.getElementById('workspace-error');
    if (!er) {
      er = document.createElement('div');
      er.id = 'workspace-error';
      document.body.appendChild(er);
    }
    toolContent = tc;
    fileInput = fi;
    errorEl = er;
    initialized = true;
    activeTool = tab;
    files = sfs;
    pages = [];
    selected = new Set();
    selectedFiles = new Set();
    lastClickedIdx = -1;
    history.length = 0;
    organizeInitialized = false;
    wmFlatPages = [];
    wmSelected = new Set();
    wmDisposeBitmaps();
    if (tab === 'organize') {
      let pos = 0;
      for (const sf of sfs) {
        for (let p = 1; p <= sf.pageCount; p++) {
          pages.push({ type: 'source', sourceFileId: sf.id, sourcePageNum: p, thumbnail: null, rotation: 0, originalPos: ++pos });
        }
      }
    }
    renderActiveTool();
    return tc;
  },
};

function el(tag: string, props: Record<string, any> = {}): HTMLElement {
  const elem = document.createElement(tag);
  for (const [key, val] of Object.entries(props)) {
    if (key === 'dataset') Object.assign(elem.dataset, val);
    else if (key === 'className') elem.className = val;
    else if (key === 'textContent') elem.textContent = val;
    else if (key === 'innerHTML') elem.innerHTML = val;
    else if (key === 'role') elem.setAttribute('role', String(val));
    else if (/^aria[A-Z]/.test(key)) {
      // ariaLabel → aria-label, ariaLabelledBy → aria-labelledby (no internal
      // hyphens — ARIA attribute names are one lowercase token after `aria-`).
      // setAttribute is the spec-compliant path; ARIAMixin IDL reflection is
      // patchy in older Firefox/Safari and jsdom. Use the attribute directly.
      elem.setAttribute('aria-' + key.slice(4).toLowerCase(), String(val));
    }
    else if (key.startsWith('aria-')) elem.setAttribute(key, String(val));
    else (elem as any)[key] = val;
  }
  return elem;
}

function setThumb(
  host: Element,
  src: string,
  opts?: { alt?: string; rotation?: number }
): void {
  host.classList.remove('ws-skeleton');
  host.replaceChildren();
  const img = document.createElement('img');
  img.src = src;
  img.alt = opts?.alt ?? '';
  img.draggable = false;
  if (opts?.rotation) img.style.transform = `rotate(${opts.rotation}deg)`;
  host.appendChild(img);
}
