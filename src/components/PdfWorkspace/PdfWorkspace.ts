import './PdfWorkspace.css';
import Sortable from 'sortablejs';
import { PDFDocument } from 'pdf-lib';
import type { PageEntry, SourceFile } from '../../tools/types.ts';
import { getNextFileId } from '../../tools/types.ts';
import { merge } from '../../tools/pdfMerge.ts';
import { split } from '../../tools/pdfSplit.ts';
import { organize } from '../../tools/pdfOrganize.ts';
import { renderPageThumbnail, clearThumbnailCache, isSafari } from '../../tools/pdfThumbnails.ts';
import { downloadFile, downloadAsZip } from '../ConversionModal/ConversionActions.ts';
import { showPopup, hidePopup } from '../Popup/Popup.ts';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type Tool = 'merge' | 'split' | 'organize';

let mergeFiles: SourceFile[] = [];
let splitFile: SourceFile | null = null;
let splitPages: PageEntry[] = [];
let splitSelected = new Set<number>();
let splitCountEl: HTMLElement | null = null;
let splitExtractBtn: HTMLElement | null = null;
let orgFiles: SourceFile[] = [];
let orgPages: PageEntry[] = [];

let activeTool: Tool = 'merge';
let pendingTool: Tool | null = null; // set before init, applied on init
let lastClickedIdx = -1; // for shift-select
let sortableInstance: Sortable | null = null;
let thumbnailObserver: IntersectionObserver | null = null;
let initialized = false;

let toolContent: HTMLElement;
let fileInput: HTMLInputElement;
let errorEl: HTMLElement;

const renderQueue: Array<{ bytes: Uint8Array; page: number; cb: (url: string) => void }> = [];
let rendering = false;
const EAGER_LIMIT = 50;

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

/** Programmatically switch the active PDF tool tab. Safe to call before init. */
export function selectPdfTool(tool: string) {
  const t = tool as Tool;
  if (!['merge', 'split', 'organize'].includes(t)) return;

  if (!initialized) {
    // Store for when initPdfWorkspace runs
    pendingTool = t;
    activeTool = t;
    return;
  }

  if (activeTool === t) return;
  activeTool = t;

  const tabs = document.getElementById('pdf-editor-tabs')!;
  for (const b of tabs.querySelectorAll('.cat-tab')) b.classList.remove('active');
  const target = tabs.querySelector(`.cat-tab[data-tool="${t}"]`);
  target?.classList.add('active');

  renderActiveTool();
}

export function initPdfWorkspace() {
  if (initialized) return;
  initialized = true;

  toolContent = document.getElementById('pdf-tool-content')!;
  fileInput = document.getElementById('workspace-file-input') as HTMLInputElement;
  errorEl = document.getElementById('workspace-error')!;

  if (isSafari()) {
    document.getElementById('workspace-safari-warning')!.style.display = '';
    toolContent.style.display = 'none';
    return;
  }

  // Apply pending tool set before init
  if (pendingTool) {
    activeTool = pendingTool;
    const tabs = document.getElementById('pdf-editor-tabs')!;
    for (const b of tabs.querySelectorAll('.cat-tab')) b.classList.remove('active');
    tabs.querySelector(`.cat-tab[data-tool="${pendingTool}"]`)?.classList.add('active');
    pendingTool = null;
  }

  const tabs = document.getElementById('pdf-editor-tabs')!;
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

  renderActiveTool();
}

function renderActiveTool() {
  cleanup();
  hideError();
  toolContent.className = ''; // reset layout classes
  if (activeTool === 'merge') renderMergeView();
  else if (activeTool === 'split') renderSplitView();
  else renderOrganizeView();
}

function cleanup() {
  sortableInstance?.destroy();
  sortableInstance = null;
  thumbnailObserver?.disconnect();
  thumbnailObserver = null;
  renderQueue.length = 0;
  splitCountEl = null;
  splitExtractBtn = null;
}

// ---------------------------------------------------------------------------
// Dropzone
// ---------------------------------------------------------------------------

function createDropzone(text: string, multi: boolean): HTMLElement {
  const zone = el('div', { className: 'ws-dropzone' });
  const hint = window.matchMedia("(pointer: coarse)").matches ? "or tap to browse" : "or click to browse";
  zone.innerHTML = `<p class="upload-text">${text}</p><p class="upload-hint">${hint}</p>`;

  zone.addEventListener('click', () => { fileInput.multiple = multi; fileInput.click(); });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer?.files ?? []).filter(
      f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    );
    if (!files.length) { showError('Only PDF files are supported'); return; }
    handleFiles(multi ? files : [files[0]]);
  });

  return zone;
}

/** Wrap a dropzone in a centered card-base with a label */
function createDropzoneCard(text: string, multi: boolean, label?: string): HTMLElement {
  const card = el('div', { className: 'card-base ws-dropzone-card ws-card-enter' });
  if (label) {
    card.appendChild(el('span', { className: 'ws-field-label', textContent: label }));
  }
  card.appendChild(createDropzone(text, multi));
  return card;
}

// ---------------------------------------------------------------------------
// File handling
// ---------------------------------------------------------------------------

async function handleFiles(files: File[]) {
  const parsed: SourceFile[] = [];
  for (const file of files) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
      parsed.push({
        id: getNextFileId(), name: file.name, size: file.size, bytes,
        pageCount: pdf.getPageCount(), firstPageThumb: null,
      });
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      showError(msg.includes('encrypted') || msg.includes('password')
        ? `"${file.name}" is password-protected.`
        : `"${file.name}" doesn't appear to be a valid PDF.`);
    }
  }
  if (!parsed.length) return;

  if (activeTool === 'merge') {
    mergeFiles.push(...parsed);
    renderMergeView();
    kickMergeThumbs();
  } else if (activeTool === 'split') {
    splitFile = parsed[0];
    splitPages = [];
    splitSelected.clear();
    for (let p = 1; p <= splitFile.pageCount; p++)
      splitPages.push({ type: 'source', sourceFileId: splitFile.id, sourcePageNum: p, thumbnail: null, deleted: false, rotation: 0 });
    renderSplitView();
    kickPageThumbs(splitPages);
  } else {
    orgFiles.push(...parsed);
    for (const sf of parsed)
      for (let p = 1; p <= sf.pageCount; p++)
        orgPages.push({ type: 'source', sourceFileId: sf.id, sourcePageNum: p, thumbnail: null, deleted: false, rotation: 0 });
    renderOrganizeView();
    kickPageThumbs(orgPages);
  }
}

// ---------------------------------------------------------------------------
// Shared: empty dropzone (single centered card)
// ---------------------------------------------------------------------------

function renderEmptyState(text: string, multi: boolean) {
  toolContent.className = 'ws-empty-layout';
  toolContent.appendChild(createDropzoneCard(text, multi, 'Your file'));
}

// ---------------------------------------------------------------------------
// MERGE VIEW — two cards: file grid (left) + sidebar (right)
// ---------------------------------------------------------------------------

function renderMergeView() {
  cleanup();
  toolContent.innerHTML = '';

  if (mergeFiles.length === 0) {
    renderEmptyState('Drop PDFs to merge', true);
    return;
  }

  toolContent.className = 'ws-split-layout';

  // Left card: file cards grid
  const leftCard = el('div', { className: 'card-base ws-grid-card ws-card-enter' });
  const container = el('div', { className: 'ws-file-cards' });
  for (const sf of mergeFiles) container.appendChild(createFileCard(sf));
  leftCard.appendChild(container);

  sortableInstance = new Sortable(container, {
    animation: 200, delay: 150, delayOnTouchOnly: true, ghostClass: 'ws-ghost',
    onEnd: (evt) => {
      if (evt.oldIndex != null && evt.newIndex != null && evt.oldIndex !== evt.newIndex) {
        const [moved] = mergeFiles.splice(evt.oldIndex, 1);
        mergeFiles.splice(evt.newIndex, 0, moved);
      }
    },
  });

  const addZone = el('div', { className: 'ws-add-zone' });
  addZone.textContent = '+ Add more files';
  addZone.addEventListener('click', () => { fileInput.multiple = true; fileInput.click(); });
  leftCard.appendChild(addZone);

  // Right card: sidebar
  const rightCard = el('div', { className: 'card-base ws-sidebar-card ws-card-enter' });
  rightCard.id = 'merge-sidebar';
  updateMergeSidebarContent(rightCard);

  toolContent.appendChild(leftCard);
  toolContent.appendChild(rightCard);

  // Mobile controls
  appendMobileControls(rightCard, async () => {
    if (mergeFiles.length < 2) return;
    showPopup('<div class="ws-processing"><div class="ws-spinner"></div><p>Merging...</p></div>', true);
    try { const r = await merge(mergeFiles); hidePopup(); downloadFile(r.bytes, r.name); }
    catch (e: any) { hidePopup(); showError(e?.message || 'Merge failed'); }
  }, 'Merge PDF', mergeFiles.length < 2);
}

function updateMergeSidebarContent(sidebar: HTMLElement) {
  sidebar.innerHTML = '';

  const top = el('div', { className: 'ws-sidebar-top' });

  for (const sf of mergeFiles) {
    const fileItem = el('div', { className: 'ws-sidebar-file' });
    fileItem.appendChild(el('span', { className: 'ws-sidebar-filename', textContent: sf.name, title: sf.name }));
    if (mergeFiles.length > 1) {
      fileItem.appendChild(el('span', { className: 'ws-sidebar-meta', textContent: `${sf.pageCount} pages · ${formatSize(sf.size)}` }));
    }

    const delFileBtn = el('button', { className: 'close-btn close-btn-sm ws-hover-reveal ws-file-list-remove', innerHTML: '&times;', ariaLabel: `Remove ${sf.name}` });
    delFileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      mergeFiles = mergeFiles.filter(f => f.id !== sf.id);
      renderMergeView();
      if (mergeFiles.length) kickMergeThumbs();
    });
    fileItem.appendChild(delFileBtn);
    top.appendChild(fileItem);
  }

  const addBtn = el('button', { className: 'ws-btn ws-btn-small', textContent: '+ Add files' });
  addBtn.addEventListener('click', () => { fileInput.multiple = true; fileInput.click(); });
  top.appendChild(addBtn);

  const total = mergeFiles.reduce((s, f) => s + f.pageCount, 0);
  top.appendChild(el('p', { className: 'ws-sidebar-count', textContent: `${mergeFiles.length} files · ${total} pages` }));

  sidebar.appendChild(top);

  const bottom = el('div', { className: 'ws-sidebar-bottom' });
  const resetBtn = el('button', { className: 'ws-btn-text', textContent: 'Reset' });
  resetBtn.addEventListener('click', () => { mergeFiles = []; clearThumbnailCache(); renderMergeView(); });

  const mergeBtn = el('button', { className: 'btn-primary ws-action-btn ws-action-full', textContent: 'Merge PDF' });
  if (mergeFiles.length < 2) { mergeBtn.classList.add('disabled'); mergeBtn.setAttribute('aria-disabled', 'true'); }
  mergeBtn.addEventListener('click', async () => {
    if (mergeFiles.length < 2) return;
    showPopup('<div class="ws-processing"><div class="ws-spinner"></div><p>Merging...</p></div>', true);
    try { const r = await merge(mergeFiles); hidePopup(); downloadFile(r.bytes, r.name); }
    catch (e: any) { hidePopup(); showError(e?.message || 'Merge failed'); }
  });

  bottom.appendChild(resetBtn);
  bottom.appendChild(mergeBtn);
  sidebar.appendChild(bottom);
}

function createFileCard(sf: SourceFile): HTMLElement {
  const card = el('div', { className: 'ws-file-card' });

  const thumb = el('div', { className: `ws-file-thumb${sf.firstPageThumb ? '' : ' ws-skeleton'}` });
  if (sf.firstPageThumb) {
    const img = el('img', { src: sf.firstPageThumb, alt: '', draggable: 'false' }) as HTMLImageElement;
    thumb.appendChild(img);
  }
  card.appendChild(thumb);

  const info = el('div', { className: 'ws-file-info' });
  info.appendChild(el('span', { className: 'ws-file-name', textContent: sf.name, title: sf.name }));
  info.appendChild(el('span', { className: 'ws-file-meta', textContent: `${sf.pageCount} pages · ${formatSize(sf.size)}` }));
  card.appendChild(info);

  const removeBtn = el('button', { className: 'close-btn close-btn-md ws-hover-reveal ws-file-remove', innerHTML: '&times;', ariaLabel: 'Remove' });
  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    mergeFiles = mergeFiles.filter(f => f.id !== sf.id);
    renderMergeView();
    if (mergeFiles.length) kickMergeThumbs();
  });
  card.appendChild(removeBtn);

  return card;
}

function kickMergeThumbs() {
  for (const sf of mergeFiles) {
    if (sf.firstPageThumb) continue;
    queueRender(sf.bytes, 1, (url) => {
      sf.firstPageThumb = url;
      const cards = toolContent.querySelectorAll('.ws-file-card');
      const idx = mergeFiles.indexOf(sf);
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

// ---------------------------------------------------------------------------
// SPLIT VIEW — two cards: page grid (left) + sidebar (right)
// ---------------------------------------------------------------------------

function renderSplitView() {
  cleanup();
  toolContent.innerHTML = '';

  if (!splitFile) {
    renderEmptyState('Drop a PDF to split', false);
    return;
  }

  toolContent.className = 'ws-split-layout';

  // Left card: page grid
  const leftCard = el('div', { className: 'card-base ws-grid-card ws-card-enter' });
  const grid = el('div', { className: 'ws-page-cards' });
  splitPages.forEach((page, idx) => {
    const card = createPageCard(page, idx, false);
    card.addEventListener('click', (e) => {
      if (e.shiftKey && lastClickedIdx >= 0) {
        // Shift-select range
        const start = Math.min(lastClickedIdx, idx);
        const end = Math.max(lastClickedIdx, idx);
        for (let i = start; i <= end; i++) splitSelected.add(i);
      } else {
        if (splitSelected.has(idx)) splitSelected.delete(idx);
        else splitSelected.add(idx);
      }
      lastClickedIdx = idx;
      updateSplitVisuals();
      updateSplitSidebar();
    });
    grid.appendChild(card);
  });
  leftCard.appendChild(grid);
  setupThumbnailObserver(leftCard, splitPages);

  // Right card: sidebar
  const rightCard = el('div', { className: 'card-base ws-sidebar-card ws-card-enter' });
  rightCard.id = 'split-sidebar';
  updateSplitSidebarContent(rightCard);

  toolContent.appendChild(leftCard);
  toolContent.appendChild(rightCard);

  // Mobile: FAB + sidebar toggle
  appendMobileControls(rightCard, () => {
    if (splitSelected.size === 0) return;
    handleSplit();
  }, `Extract ${splitSelected.size} page${splitSelected.size !== 1 ? 's' : ''}`, splitSelected.size === 0);
}

function updateSplitSidebar() {
  if (splitCountEl) splitCountEl.textContent = `${splitSelected.size} of ${splitPages.length} selected`;
  if (splitExtractBtn) {
    splitExtractBtn.textContent = `Extract ${splitSelected.size} page${splitSelected.size !== 1 ? 's' : ''}`;
    splitExtractBtn.classList.toggle('disabled', splitSelected.size === 0);
    if (splitSelected.size === 0) splitExtractBtn.setAttribute('aria-disabled', 'true');
    else splitExtractBtn.removeAttribute('aria-disabled');
  }
}

function updateSplitSidebarContent(sidebar: HTMLElement) {
  sidebar.innerHTML = '';

  // Top section: file info + controls
  const top = el('div', { className: 'ws-sidebar-top' });

  const fileInfo = el('div', { className: 'ws-sidebar-file' });
  fileInfo.appendChild(el('span', { className: 'ws-sidebar-filename', textContent: splitFile!.name, title: splitFile!.name }));
  fileInfo.appendChild(el('span', { className: 'ws-sidebar-meta', textContent: `${splitFile!.pageCount} pages · ${formatSize(splitFile!.size)}` }));
  top.appendChild(fileInfo);

  // Select controls
  const rangeInput = el('input', {
    type: 'text', className: 'ws-range-input', placeholder: 'e.g. 1-5, 8, 12-20',
  }) as HTMLInputElement;
  rangeInput.addEventListener('input', () => {
    const text = rangeInput.value.trim();
    if (!text) { rangeInput.classList.remove('ws-input-error'); return; }
    const parsed = parsePageRange(text, splitPages.length);
    if (!parsed) { rangeInput.classList.add('ws-input-error'); return; }
    rangeInput.classList.remove('ws-input-error');
    splitSelected.clear();
    for (const n of parsed) splitSelected.add(n - 1);
    updateSplitVisuals();
    updateSplitSidebar();
  });
  top.appendChild(rangeInput);

  const btnRow = el('div', { className: 'ws-sidebar-btn-row' });
  const selectAllBtn = el('button', { className: 'ws-btn ws-btn-small', textContent: 'Select all' });
  selectAllBtn.addEventListener('click', () => { splitPages.forEach((_, i) => splitSelected.add(i)); updateSplitVisuals(); updateSplitSidebar(); });
  const deselectBtn = el('button', { className: 'ws-btn ws-btn-small', textContent: 'Deselect all' });
  deselectBtn.addEventListener('click', () => { splitSelected.clear(); updateSplitVisuals(); updateSplitSidebar(); });
  btnRow.appendChild(selectAllBtn);
  btnRow.appendChild(deselectBtn);
  top.appendChild(btnRow);

  splitCountEl = el('p', { className: 'ws-sidebar-count', textContent: `${splitSelected.size} of ${splitPages.length} selected` });
  top.appendChild(splitCountEl);

  sidebar.appendChild(top);

  // Bottom section: action buttons
  const bottom = el('div', { className: 'ws-sidebar-bottom' });
  const resetBtn = el('button', { className: 'ws-btn-text', textContent: 'Reset' });
  resetBtn.addEventListener('click', () => { splitFile = null; splitPages = []; splitSelected.clear(); clearThumbnailCache(); renderSplitView(); });

  splitExtractBtn = el('button', {
    className: 'btn-primary ws-action-btn ws-action-full',
    textContent: `Extract ${splitSelected.size} page${splitSelected.size !== 1 ? 's' : ''}`
  });
  if (splitSelected.size === 0) { splitExtractBtn.classList.add('disabled'); splitExtractBtn.setAttribute('aria-disabled', 'true'); }
  splitExtractBtn.addEventListener('click', handleSplit);

  bottom.appendChild(resetBtn);
  bottom.appendChild(splitExtractBtn);
  sidebar.appendChild(bottom);
}

function updateSplitVisuals() {
  toolContent.querySelectorAll('.ws-page-card').forEach((card, i) => {
    card.classList.toggle('ws-page-selected', splitSelected.has(i));
  });
}

async function handleSplit() {
  if (!splitFile || splitSelected.size === 0) return;
  showPopup('<div class="ws-processing"><div class="ws-spinner"></div><p>Splitting...</p></div>', true);
  try {
    const pageNums = [...splitSelected].sort((a, b) => a - b).map(i => splitPages[i].sourcePageNum);
    const baseName = splitFile.name.replace(/\.pdf$/i, '');
    const results = await split(splitFile.bytes, pageNums, baseName);
    hidePopup();
    if (results.length === 1) downloadFile(results[0].bytes, results[0].name);
    else await downloadAsZip(results, `${baseName}_pages.zip`);
  } catch (e: any) { hidePopup(); showError(e?.message || 'Split failed'); }
}

// ---------------------------------------------------------------------------
// ORGANIZE VIEW — two cards: page grid (left) + sidebar (right)
// ---------------------------------------------------------------------------

/** Get page dimensions from the nearest source page for blank page sizing. */
async function getAdjacentPageSize(insertIdx: number): Promise<{ width: number; height: number }> {
  // Look at the page before or after the insertion point
  const nearby = orgPages[insertIdx] ?? orgPages[insertIdx - 1];
  if (nearby && nearby.type === 'source') {
    const sf = orgFiles.find(f => f.id === nearby.sourceFileId);
    if (sf) {
      try {
        const pdf = await PDFDocument.load(sf.bytes, { ignoreEncryption: true });
        const page = pdf.getPage(nearby.sourcePageNum - 1);
        const { width, height } = page.getSize();
        return { width, height };
      } catch { /* fall through to default */ }
    }
  }
  return { width: 595.28, height: 841.89 }; // A4 default
}

function insertBlankPage(atIdx: number) {
  getAdjacentPageSize(atIdx).then(size => {
    const blank: PageEntry = {
      type: 'blank', sourceFileId: -1, sourcePageNum: 0,
      thumbnail: null, deleted: false, rotation: 0,
      blankPageSize: size,
    };
    orgPages.splice(atIdx, 0, blank);
    renderOrganizeView();
    kickPageThumbs(orgPages);
  });
}

function createInsertBtn(atIdx: number): HTMLElement {
  const btn = el('button', { className: 'ws-page-insert', innerHTML: '+', ariaLabel: 'Insert blank page' });
  btn.addEventListener('click', (e) => { e.stopPropagation(); insertBlankPage(atIdx); });
  return btn;
}

function renderOrganizeView() {
  cleanup();
  toolContent.innerHTML = '';

  if (orgPages.length === 0) {
    renderEmptyState('Drop PDFs to organize', true);
    return;
  }

  toolContent.className = 'ws-split-layout';

  // Left card: page grid
  const leftCard = el('div', { className: 'card-base ws-grid-card ws-card-enter' });
  const grid = el('div', { className: 'ws-page-cards' });
  orgPages.forEach((page, idx) => {
    const slot = el('div', { className: `ws-page-slot${page.deleted ? ' ws-page-deleted' : ''}` });
    slot.appendChild(createInsertBtn(idx));
    slot.appendChild(createPageCard(page, idx, true));
    grid.appendChild(slot);
  });
  // Trailing insert — card-shaped add button
  const trailing = el('button', { className: 'ws-page-insert-trailing', innerHTML: '+', ariaLabel: 'Insert blank page at end' });
  trailing.addEventListener('click', (e) => { e.stopPropagation(); insertBlankPage(orgPages.length); });
  grid.appendChild(trailing);
  leftCard.appendChild(grid);

  sortableInstance = new Sortable(grid, {
    animation: 200, delay: 150, delayOnTouchOnly: true,
    ghostClass: 'ws-ghost',
    draggable: '.ws-page-slot:not(.ws-page-deleted)',
    onStart: () => {
      grid.querySelectorAll('.ws-page-insert').forEach(b => b.remove());
    },
    onEnd: (evt) => {
      if (evt.oldIndex != null && evt.newIndex != null && evt.oldIndex !== evt.newIndex) {
        const cards = grid.querySelectorAll<HTMLElement>('.ws-page-card');
        const reordered: PageEntry[] = [];
        cards.forEach((card) => {
          const i = Number(card.dataset.pageIdx);
          if (!isNaN(i) && orgPages[i]) reordered.push(orgPages[i]);
        });
        if (reordered.length === orgPages.length) {
          orgPages.length = 0;
          orgPages.push(...reordered);
        }
      }
      renderOrganizeView();
      kickPageThumbs(orgPages);
    },
  });

  setupThumbnailObserver(leftCard, orgPages);

  // Right card: sidebar
  const rightCard = el('div', { className: 'card-base ws-sidebar-card ws-card-enter' });
  rightCard.id = 'org-sidebar';
  updateOrgSidebarContent(rightCard);

  toolContent.appendChild(leftCard);
  toolContent.appendChild(rightCard);

  // Mobile: FAB + sidebar toggle
  const active = orgPages.filter(p => !p.deleted).length;
  appendMobileControls(rightCard, async () => {
    const activePages = orgPages.filter(p => !p.deleted);
    if (!activePages.length) return;
    showPopup('<div class="ws-processing"><div class="ws-spinner"></div><p>Saving...</p></div>', true);
    try { const r = await organize(orgFiles, activePages); hidePopup(); downloadFile(r.bytes, r.name); }
    catch (e: any) { hidePopup(); showError(e?.message || 'Save failed'); }
  }, 'Save PDF', active === 0);
}

function updateOrgSidebar() {
  const sidebar = document.getElementById('org-sidebar');
  if (sidebar) updateOrgSidebarContent(sidebar);
}

function updateOrgSidebarContent(sidebar: HTMLElement) {
  sidebar.innerHTML = '';

  const top = el('div', { className: 'ws-sidebar-top' });

  // File list
  const uniqueFiles = [...new Set(orgPages.map(p => p.sourceFileId))];
  for (const fid of uniqueFiles) {
    const sf = orgFiles.find(f => f.id === fid);
    if (!sf) continue;
    const fileItem = el('div', { className: 'ws-sidebar-file' });
    const letter = uniqueFiles.length > 1 ? String.fromCharCode(65 + (uniqueFiles.indexOf(fid) % 26)) + ': ' : '';
    fileItem.appendChild(el('span', { className: 'ws-sidebar-filename', textContent: letter + sf.name, title: sf.name }));
    if (uniqueFiles.length > 1) {
      fileItem.appendChild(el('span', { className: 'ws-sidebar-meta', textContent: `${sf.pageCount} pages` }));
    }

    // Per-file delete button
    const delFileBtn = el('button', { className: 'close-btn close-btn-sm ws-hover-reveal ws-file-list-remove', innerHTML: '&times;', ariaLabel: `Remove ${sf.name}` });
    delFileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      orgPages = orgPages.filter(p => p.sourceFileId !== fid);
      orgFiles = orgFiles.filter(f => f.id !== fid);
      if (orgPages.length === 0) clearThumbnailCache();
      renderOrganizeView();
      if (orgPages.length > 0) kickPageThumbs(orgPages);
    });
    fileItem.appendChild(delFileBtn);

    top.appendChild(fileItem);
  }

  const addBtn = el('button', { className: 'ws-btn ws-btn-small', textContent: '+ Add files' });
  addBtn.addEventListener('click', () => { fileInput.multiple = true; fileInput.click(); });
  top.appendChild(addBtn);

  const active = orgPages.filter(p => !p.deleted).length;
  const deleted = orgPages.filter(p => p.deleted).length;
  let countText = `${active} pages`;
  if (deleted > 0) countText += ` · ${deleted} deleted`;
  top.appendChild(el('p', { className: 'ws-sidebar-count', textContent: countText }));

  sidebar.appendChild(top);

  // Bottom: actions
  const bottom = el('div', { className: 'ws-sidebar-bottom' });
  const resetBtn = el('button', { className: 'ws-btn-text', textContent: 'Reset' });
  resetBtn.addEventListener('click', () => { orgFiles = []; orgPages = []; clearThumbnailCache(); renderOrganizeView(); });

  const saveBtn = el('button', { className: 'btn-primary ws-action-btn ws-action-full', textContent: 'Save PDF' });
  if (active === 0) { saveBtn.classList.add('disabled'); saveBtn.setAttribute('aria-disabled', 'true'); }
  saveBtn.addEventListener('click', async () => {
    const activePages = orgPages.filter(p => !p.deleted);
    if (!activePages.length) return;
    showPopup('<div class="ws-processing"><div class="ws-spinner"></div><p>Saving...</p></div>', true);
    try { const r = await organize(orgFiles, activePages); hidePopup(); downloadFile(r.bytes, r.name); }
    catch (e: any) { hidePopup(); showError(e?.message || 'Save failed'); }
  });

  bottom.appendChild(resetBtn);
  bottom.appendChild(saveBtn);
  sidebar.appendChild(bottom);
}

// ---------------------------------------------------------------------------
// Shared: mobile controls (FAB + sidebar toggle)

function appendMobileControls(sidebarCard: HTMLElement, onAction: () => void, actionText: string, disabled: boolean) {
  // FAB
  const fab = el('div', { className: 'ws-fab' });
  const fabBtn = el('button', { className: 'btn-primary', textContent: actionText });
  if (disabled) { fabBtn.classList.add('disabled'); fabBtn.setAttribute('aria-disabled', 'true'); }
  fabBtn.addEventListener('click', onAction);
  fab.appendChild(fabBtn);
  toolContent.appendChild(fab);

  // Sidebar toggle button
  const toggle = el('button', { className: 'ws-sidebar-toggle', ariaLabel: 'Show details' });
  toggle.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
  toolContent.appendChild(toggle);

  // Overlay
  const overlay = el('div', { className: 'ws-sidebar-overlay' });
  toolContent.appendChild(overlay);

  // Close button inside sidebar
  const closeBtn = el('button', { className: 'close-btn close-btn-lg ws-sidebar-close', innerHTML: '&times;', ariaLabel: 'Close' });
  sidebarCard.prepend(closeBtn);

  // Toggle logic
  const openSidebar = () => {
    sidebarCard.classList.add('ws-sidebar-open');
    overlay.classList.add('ws-sidebar-open');
  };
  const closeSidebar = () => {
    sidebarCard.classList.remove('ws-sidebar-open');
    overlay.classList.remove('ws-sidebar-open');
  };

  toggle.addEventListener('click', openSidebar);
  overlay.addEventListener('click', closeSidebar);
  closeBtn.addEventListener('click', closeSidebar);
}

// Shared: page card
// ---------------------------------------------------------------------------

function getPageBadgeText(page: PageEntry): string {
  if (page.type === 'blank') return 'Blank';
  const files = activeTool === 'organize' ? orgFiles : (splitFile ? [splitFile] : []);
  if (files.length <= 1) return String(page.sourcePageNum);
  const fileIdx = files.findIndex(f => f.id === page.sourceFileId);
  const letter = String.fromCharCode(65 + (fileIdx % 26));
  return `${letter}${page.sourcePageNum}`;
}

function addDeleteButton(card: HTMLElement, idx: number) {
  const delBtn = el('button', { className: 'close-btn close-btn-sm ws-overlay-btn ws-hover-reveal ws-page-delete', innerHTML: '&times;', ariaLabel: 'Delete' });
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    orgPages[idx].deleted = true;
    card.classList.add('ws-page-deleted');
    card.closest('.ws-page-slot')?.classList.add('ws-page-deleted');
    delBtn.remove();
    card.querySelector('.ws-page-rotate')?.remove();
    addUndoButton(card, idx);
    updateOrgSidebar();
  });
  card.appendChild(delBtn);
}

function addRotateButton(card: HTMLElement, page: PageEntry, badge: HTMLElement) {
  let visualAngle = page.rotation || 0;
  const rotBtn = el('button', { className: 'close-btn close-btn-sm ws-overlay-btn ws-hover-reveal ws-page-rotate', innerHTML: '&#x21bb;', ariaLabel: 'Rotate' });
  rotBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    page.rotation = ((page.rotation + 90) % 360) as 0 | 90 | 180 | 270;
    visualAngle += 90;
    const img = card.querySelector('.ws-page-thumb img') as HTMLImageElement | null;
    if (img) img.style.transform = `rotate(${visualAngle}deg)`;
    badge.textContent = page.rotation ? `${getPageBadgeText(page)} \u21bb` : getPageBadgeText(page);
  });
  card.appendChild(rotBtn);
}

function addUndoButton(card: HTMLElement, idx: number) {
  const undoBtn = el('button', { className: 'ws-page-undo', textContent: '\u21a9', ariaLabel: 'Undo' });
  undoBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    orgPages[idx].deleted = false;
    card.classList.remove('ws-page-deleted');
    card.closest('.ws-page-slot')?.classList.remove('ws-page-deleted');
    undoBtn.remove();
    addDeleteButton(card, idx);
    const badge = card.querySelector('.ws-page-badge') as HTMLElement;
    if (badge) addRotateButton(card, orgPages[idx], badge);
    updateOrgSidebar();
  });
  card.appendChild(undoBtn);
}

const BLANK_PAGE_THUMB = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="150" height="212" viewBox="0 0 150 212"><rect width="150" height="212" fill="#f8f8f8" stroke="#ddd"/><text x="75" y="106" text-anchor="middle" fill="#999" font-family="system-ui,sans-serif" font-size="14">Blank</text></svg>')}`;

function createPageCard(page: PageEntry, idx: number, deletable: boolean): HTMLElement {
  const card = el('div', {
    className: `ws-page-card${page.deleted ? ' ws-page-deleted' : ''}`,
    dataset: { pageIdx: String(idx) },
  });

  const isBlank = page.type === 'blank';
  const thumb = el('div', { className: `ws-page-thumb${page.thumbnail || isBlank ? '' : ' ws-skeleton'}` });
  const imgSrc = isBlank ? BLANK_PAGE_THUMB : page.thumbnail;
  if (imgSrc) {
    const img = el('img', { src: imgSrc, alt: isBlank ? 'Blank page' : `Page ${page.sourcePageNum}`, draggable: 'false' }) as HTMLImageElement;
    if (page.rotation) img.style.transform = `rotate(${page.rotation}deg)`;
    thumb.appendChild(img);
  }
  card.appendChild(thumb);

  const badgeText = getPageBadgeText(page);
  const badge = el('span', { className: 'ws-page-badge', textContent: page.rotation ? `${badgeText} \u21bb` : badgeText });
  card.appendChild(badge);

  if (deletable && !page.deleted) {
    addDeleteButton(card, idx);
    addRotateButton(card, page, badge);
  } else if (deletable && page.deleted) {
    addUndoButton(card, idx);
  }

  return card;
}

// ---------------------------------------------------------------------------
// Thumbnail rendering
// ---------------------------------------------------------------------------

function kickPageThumbs(pages: PageEntry[]) {
  for (let i = 0; i < Math.min(EAGER_LIMIT, pages.length); i++) queuePageThumb(pages, i);
}

function queuePageThumb(pages: PageEntry[], idx: number) {
  if (pages[idx].thumbnail || pages[idx].type === 'blank') return;
  const allFiles = activeTool === 'split' ? (splitFile ? [splitFile] : []) : orgFiles;
  const sf = allFiles.find(f => f.id === pages[idx].sourceFileId);
  if (!sf) return;
  queueRender(sf.bytes, pages[idx].sourcePageNum, (url) => {
    pages[idx].thumbnail = url;
    const card = toolContent.querySelector(`[data-page-idx="${idx}"] .ws-page-thumb`);
    if (card) {
      card.classList.remove('ws-skeleton');
      card.innerHTML = '';
      const img = document.createElement('img');
      img.src = url; img.alt = `Page ${pages[idx].sourcePageNum}`; img.draggable = false;
      if (pages[idx].rotation) img.style.transform = `rotate(${pages[idx].rotation}deg)`;
      card.appendChild(img);
    }
  });
}

function setupThumbnailObserver(container: HTMLElement, pages: PageEntry[]) {
  thumbnailObserver?.disconnect();
  thumbnailObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const idx = Number((entry.target as HTMLElement).dataset.pageIdx);
        if (!isNaN(idx) && !pages[idx]?.thumbnail) queuePageThumb(pages, idx);
        thumbnailObserver!.unobserve(entry.target);
      }
    }
  }, { root: container }); // observe within the scrollable card
  container.querySelectorAll<HTMLElement>('.ws-page-card').forEach((card, i) => {
    if (i >= EAGER_LIMIT && !pages[i]?.thumbnail) thumbnailObserver!.observe(card);
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
    try { const url = await renderPageThumbnail(bytes, page); cb(url); }
    catch { /* skip */ }
    if (++count % 3 === 0) await new Promise(r => requestAnimationFrame(r));
  }
  rendering = false;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parsePageRange(text: string, max: number): Set<number> | null {
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

let errorTimeout: ReturnType<typeof setTimeout> | null = null;

function showError(msg: string) {
  errorEl.textContent = msg;
  errorEl.style.display = '';
  if (errorTimeout) clearTimeout(errorTimeout);
  errorTimeout = setTimeout(() => hideError(), 5000);
}

function hideError() { errorEl.style.display = 'none'; errorEl.textContent = ''; }

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
