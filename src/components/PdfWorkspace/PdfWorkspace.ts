import './PdfWorkspace.css';
import Sortable from 'sortablejs';
import { PDFDocument } from 'pdf-lib';
import type { PageEntry, SourceFile } from '../../tools/types.ts';
import { getNextFileId } from '../../tools/types.ts';
import { merge } from '../../tools/pdfMerge.ts';
import { extract } from '../../tools/pdfExtract.ts';
import { organize } from '../../tools/pdfOrganize.ts';
import { renderPageThumbnail, clearThumbnailCache, mockPageThumb } from '../../tools/pdfThumbnails.ts';
import { downloadFile, downloadAsZip } from '../../conversion/download.ts';
import { isTouchUi } from '../../core/utils/touchUi.ts';
import { showToast } from '../Toast/Toast.ts';
import { showPopup, hidePopup, replacePopup, createPopupButton, showUploadSummaryPopup, type UploadResult } from '../Popup/Popup.ts';
import { formatBytes, escapeHTML, shortenFileName, ensureMinDuration } from '../utils/index.ts';
import { createDancingFrog } from '../Frogsworth/DancingFrog.ts';
import { triggerConfetti } from '../../effects/Confetti/Confetti.ts';
import { ui, updateScrollLock } from '../store/store.ts';

// ---------------------------------------------------------------------------
// State — shared file pool, per-tab working state
// ---------------------------------------------------------------------------

type Tool = 'merge' | 'organize';

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
}

// File order changed but ids unchanged — preserve `selectedFiles`; only the
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

const renderQueue: Array<{ bytes: Uint8Array; page: number; cb: (url: string) => void }> = [];
let rendering = false;
const EAGER_LIMIT = 50;

const MAX_TOTAL_FILE_SIZE = 500 * 1024 * 1024; // 500 MB total
const MAX_FILES = 300;
const MAX_TOTAL_PAGES = 300;

// ---------------------------------------------------------------------------
// Init + Tab switching
// ---------------------------------------------------------------------------

export function selectPdfTool(tool: string) {
  const t = tool as Tool;
  if (!['merge', 'organize'].includes(t)) return;
  if (!initialized) { activeTool = t; return; }
  if (activeTool === t) return;
  activeTool = t;

  const tabs = document.getElementById('pdf-editor-tabs')!;
  for (const b of tabs.querySelectorAll('.cat-tab')) b.classList.remove('active');
  tabs.querySelector(`.cat-tab[data-tool="${t}"]`)?.classList.add('active');

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
      const src = getBlankPageThumb();
      gridEl.querySelectorAll<HTMLImageElement>('.ws-page-card img[alt="Blank page"]').forEach(img => {
        img.src = src;
      });
    });
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

  // Apply pending tool
  const tabs = document.getElementById('pdf-editor-tabs')!;
  for (const b of tabs.querySelectorAll('.cat-tab')) b.classList.remove('active');
  tabs.querySelector(`.cat-tab[data-tool="${activeTool}"]`)?.classList.add('active');

  tabs.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.cat-tab') as HTMLButtonElement | null;
    if (!btn || btn.classList.contains('active')) return;
    for (const b of tabs.querySelectorAll('.cat-tab')) b.classList.remove('active');
    btn.classList.add('active');
    activeTool = btn.dataset.tool as Tool;
    renderActiveTool();
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files?.length) handleFiles(Array.from(fileInput.files));
    fileInput.value = '';
  });

  document.addEventListener('keydown', handleGlobalKeydown);

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
  else renderOrganizeView();
}

// ---------------------------------------------------------------------------
// MERGE VIEW — file-level cards
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
      // Sortable already moved the DOM — keep the cards in place, just refresh
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
    const fileItem = el('div', { className: 'ws-sidebar-file' });
    const letter = files.length > 1 ? String.fromCharCode(65 + (files.indexOf(sf) % 26)) + ': ' : '';
    fileItem.appendChild(el('span', { className: 'ws-sidebar-filename', textContent: letter + sf.name, title: sf.name }));
    if (files.length > 1) {
      fileItem.appendChild(el('span', { className: 'ws-sidebar-meta', textContent: `${sf.pageCount} pages · ${formatBytes(sf.size)}` }));
    }

    const delFileBtn = el('button', { className: 'icon-btn ws-hover-reveal ws-file-list-remove', innerHTML: '&times;', ariaLabel: `Remove ${sf.name}` });
    delFileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      files = files.filter(f => f.id !== sf.id);
      onFilesMutated();
      updateMergeContent();
      if (files.length) kickMergeThumbs();
    });
    fileItem.appendChild(delFileBtn);
    fileList.appendChild(fileItem);
  }
  sidebar.appendChild(fileList);

  sidebar.appendChild(el('hr', { className: 'ws-divider' }));

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
  card.setAttribute('role', 'checkbox');
  card.setAttribute('aria-checked', String(selectedFiles.has(sf.id)));
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
  if (sf.firstPageThumb) {
    const img = el('img', { src: sf.firstPageThumb, alt: '', draggable: 'false' }) as HTMLImageElement;
    thumb.appendChild(img);
  }
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

function kickMergeThumbs() {
  for (const sf of files) {
    if (sf.firstPageThumb) continue;
    queueRender(sf.bytes, 1, (url) => {
      sf.firstPageThumb = url;
      const cards = toolContent.querySelectorAll('.ws-file-card');
      const idx = files.indexOf(sf);
      if (idx >= 0 && cards[idx]) {
        const thumb = cards[idx].querySelector('.ws-file-thumb');
        if (thumb) {
          thumb.classList.remove('ws-skeleton');
          thumb.innerHTML = '';
          const img = document.createElement('img');
          img.src = url; img.alt = ''; img.draggable = false;
          thumb.appendChild(img);
        }
      }
    });
  }
}

function appendMobileToolbar_merge(gridCard: HTMLElement) {
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
// ORGANIZE VIEW — page-level (select, reorder, rotate, delete, extract)
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
        // Full re-render — DOM has Sortable's single-element move, need to rebuild for multi
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
  renderQueue.length = 0;
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
  renderActiveTool();
}

function createAddFileButton(): HTMLButtonElement {
  const btn = el('button', { className: 'ws-btn ws-btn-small', textContent: '+ Add' }) as HTMLButtonElement;
  btn.addEventListener('click', () => { fileInput.multiple = true; fileInput.click(); });
  return btn;
}

/** Rebuild pages from original files — resets all reorder, rotation, deletion, blank inserts. */
function resetPages() {
  if (!files.length) return;
  organizeInitialized = false;
  renderActiveTool();
}

// ---------------------------------------------------------------------------
// Dropzone
// ---------------------------------------------------------------------------

function createDropzone(text: string, multi: boolean): HTMLElement {
  const zone = el('div', { className: 'ws-dropzone' });
  const hint = isTouchUi() ? "or tap to browse" : "or click to browse";
  zone.innerHTML = `<p class="upload-text">${text}</p><p class="upload-hint">${hint}</p>`;

  let dragRejecting: boolean | null = null;
  zone.addEventListener('click', () => { fileInput.multiple = multi; fileInput.click(); });
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
    } catch {
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

  // Range input
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

  // Select / Deselect buttons
  const btnRow = el('div', { className: 'ws-sidebar-btn-row' });
  const selectAllBtn = el('button', { className: 'ws-btn ws-btn-small', textContent: 'Select all' });
  selectAllBtn.addEventListener('click', () => { pages.forEach((_, i) => selected.add(i)); updateSelectionVisuals(); updateSidebar(); syncRangeInput(); });
  const deselectBtn = el('button', { className: 'ws-btn ws-btn-small', textContent: 'Deselect all' });
  deselectBtn.addEventListener('click', () => { selected.clear(); updateSelectionVisuals(); updateSidebar(); syncRangeInput(); });
  btnRow.appendChild(selectAllBtn);
  btnRow.appendChild(deselectBtn);
  sidebar.appendChild(btnRow);

  sidebar.appendChild(el('hr', { className: 'ws-divider' }));

  // Count + Restore original
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

  // File list
  const fileList = el('div', { className: 'ws-sidebar-files' });
  const uniqueFileIds = [...new Set(pages.filter(p => p.type !== 'blank').map(p => p.sourceFileId))];
  for (const fid of uniqueFileIds) {
    const sf = files.find(f => f.id === fid);
    if (!sf) continue;
    const fileItem = el('div', { className: 'ws-sidebar-file' });
    const letter = uniqueFileIds.length > 1 ? String.fromCharCode(65 + (uniqueFileIds.indexOf(fid) % 26)) + ': ' : '';
    fileItem.appendChild(el('span', { className: 'ws-sidebar-filename', textContent: letter + sf.name, title: sf.name }));
    if (uniqueFileIds.length > 1) {
      fileItem.appendChild(el('span', { className: 'ws-sidebar-meta', textContent: `${sf.pageCount} pages · ${formatBytes(sf.size)}` }));
    }

    const delFileBtn = el('button', { className: 'icon-btn ws-hover-reveal ws-file-list-remove', innerHTML: '&times;', ariaLabel: `Remove ${sf.name}` });
    delFileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFile(fid);
    });
    fileItem.appendChild(delFileBtn);
    fileList.appendChild(fileItem);
  }
  sidebar.appendChild(fileList);

  sidebar.appendChild(el('hr', { className: 'ws-divider' }));

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
    card.setAttribute('aria-checked', String(sel));
  });
}

function updateMergeSelectionVisuals() {
  if (!mergeGridContainer) return;
  mergeGridContainer.querySelectorAll<HTMLElement>('.ws-file-card').forEach((card) => {
    const fid = Number(card.dataset.fileId);
    const sel = !isNaN(fid) && selectedFiles.has(fid);
    card.classList.toggle('ws-file-selected', sel);
    card.setAttribute('aria-checked', String(sel));
  });
}

// ---------------------------------------------------------------------------
// Actions: Save + Extract
// ---------------------------------------------------------------------------

async function handleSave() {
  if (!pages.length) return;
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
  await runWithPopup('Extracting', 'Pulling the selected pages into a new file. Almost there.', 'Extract failed. The PDF might be damaged or unsupported.',
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
const CLOSE_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

function wireTrayToggle(tray: HTMLElement, overlay: HTMLElement, iconBtn: HTMLElement) {
  const setOpen = (open: boolean) => {
    tray.classList.toggle('ws-tray-open', open);
    overlay.classList.toggle('ws-tray-open', open);
    iconBtn.innerHTML = open ? CLOSE_SVG : MORE_SVG;
    iconBtn.setAttribute('aria-label', open ? 'Close options' : 'More options');
    updateScrollLock();
  };
  iconBtn.addEventListener('click', () => setOpen(!tray.classList.contains('ws-tray-open')));
  overlay.addEventListener('click', () => setOpen(false));
}

function appendMobileToolbar(gridCard: HTMLElement) {
  const toolbar = el('div', { className: 'ws-toolbar ws-toolbar--organize' });

  // Top row: Extract n pages + triple-dot
  const topRow = el('div', { className: 'ws-toolbar-top' });

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

  // Range input
  const multiFile = files.length > 1;
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

  // Select / Deselect
  const btnRow = el('div', { className: 'ws-sidebar-btn-row' });
  const selAll = el('button', { className: 'ws-btn ws-btn-small', textContent: 'Select all' });
  selAll.addEventListener('click', () => { pages.forEach((_, i) => selected.add(i)); updateSelectionVisuals(); updateSidebar(); syncRangeInput(); });
  const desel = el('button', { className: 'ws-btn ws-btn-small', textContent: 'Deselect all' });
  desel.addEventListener('click', () => { selected.clear(); updateSelectionVisuals(); updateSidebar(); syncRangeInput(); });
  btnRow.appendChild(selAll);
  btnRow.appendChild(desel);
  tray.appendChild(btnRow);

  tray.appendChild(el('hr', { className: 'ws-divider' }));

  // Count row + Add (matches merge tray pattern)
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

  // File list
  const fileList = el('div', { className: 'ws-sidebar-files' });
  const uniqueFileIds = [...new Set(pages.filter(p => p.type !== 'blank').map(p => p.sourceFileId))];
  for (const fid of uniqueFileIds) {
    const sf = files.find(f => f.id === fid);
    if (!sf) continue;
    const fileItem = el('div', { className: 'ws-sidebar-file' });
    const letter = uniqueFileIds.length > 1 ? String.fromCharCode(65 + (uniqueFileIds.indexOf(fid) % 26)) + ': ' : '';
    fileItem.appendChild(el('span', { className: 'ws-sidebar-filename', textContent: letter + sf.name, title: sf.name }));
    if (uniqueFileIds.length > 1) {
      fileItem.appendChild(el('span', { className: 'ws-sidebar-meta', textContent: `${sf.pageCount} pages · ${formatBytes(sf.size)}` }));
    }
    const delFileBtn = el('button', { className: 'icon-btn ws-hover-reveal ws-file-list-remove', innerHTML: '&times;', ariaLabel: `Remove ${sf.name}` });
    delFileBtn.addEventListener('click', (e) => { e.stopPropagation(); removeFile(fid); });
    fileItem.appendChild(delFileBtn);
    fileList.appendChild(fileItem);
  }
  tray.appendChild(fileList);
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

function getBlankPageThumb(): string {
  const dark = document.documentElement.classList.contains('dark');
  const bg = dark ? '#1e1e1e' : '#f8f8f8';
  const border = dark ? '#444' : '#ddd';
  const text = dark ? '#666' : '#999';
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="150" height="212" viewBox="0 0 150 212"><rect width="150" height="212" fill="${bg}" stroke="${border}"/><text x="75" y="106" text-anchor="middle" fill="${text}" font-family="system-ui,sans-serif" font-size="14">Blank</text></svg>`)}`;
}

function createPageCard(page: PageEntry, idx: number): HTMLElement {
  const card = el('div', {
    className: 'ws-page-card',
    dataset: { pageIdx: String(idx) },
  });
  card.addEventListener('contextmenu', (e) => e.preventDefault());

  const isBlank = page.type === 'blank';
  const thumb = el('div', { className: `ws-page-thumb${page.thumbnail || isBlank ? '' : ' ws-skeleton'}` });
  const imgSrc = isBlank ? getBlankPageThumb() : page.thumbnail;
  if (imgSrc) {
    const img = el('img', { src: imgSrc, alt: isBlank ? 'Blank page' : `Page ${page.sourcePageNum}`, draggable: 'false' }) as HTMLImageElement;
    if (page.rotation) img.style.transform = `rotate(${page.rotation}deg)`;
    thumb.appendChild(img);
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
    if (card) {
      card.classList.remove('ws-skeleton');
      card.innerHTML = '';
      const img = document.createElement('img');
      img.src = url; img.alt = `Page ${p[idx].sourcePageNum}`; img.draggable = false;
      if (p[idx].rotation) img.style.transform = `rotate(${p[idx].rotation}deg)`;
      card.appendChild(img);
    }
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

function queueRender(bytes: Uint8Array, page: number, cb: (url: string) => void) {
  renderQueue.push({ bytes, page, cb });
  if (!rendering) processQueue();
}

async function processQueue() {
  rendering = true;
  let count = 0;
  while (renderQueue.length > 0) {
    const { bytes, page, cb } = renderQueue.shift()!;
    try {
      const url = await renderPageThumbnail(bytes, page);
      cb(url || mockPageThumb());
    } catch (e) {
      console.warn('[pdfThumbnails] page', page, e);
      cb(mockPageThumb());
    }
    if (++count % 3 === 0) await new Promise(r => requestAnimationFrame(r));
  }
  rendering = false;
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
    hidePopup();
    showError(e?.message || fallback);
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

// Exposed for unit tests — do not use in production code.
export const __testing = {
  reset() {
    files = [];
    pages = [];
    selected = new Set();
    lastClickedIdx = -1;
    history.length = 0;
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
  setActiveTool(t: 'merge' | 'organize') { activeTool = t; },
  setInitialized(v: boolean) { initialized = v; },
};

function el(tag: string, props: Record<string, any> = {}): HTMLElement {
  const elem = document.createElement(tag);
  for (const [key, val] of Object.entries(props)) {
    if (key === 'dataset') Object.assign(elem.dataset, val);
    else if (key === 'className') elem.className = val;
    else if (key === 'textContent') elem.textContent = val;
    else if (key === 'innerHTML') elem.innerHTML = val;
    else (elem as any)[key] = val;
  }
  return elem;
}
