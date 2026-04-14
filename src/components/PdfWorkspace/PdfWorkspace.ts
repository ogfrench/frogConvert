import './PdfWorkspace.css';
import Sortable from 'sortablejs';
import { PDFDocument } from 'pdf-lib';
import type { PageEntry, SourceFile } from '../../tools/types.ts';
import { getNextFileId } from '../../tools/types.ts';
import { merge } from '../../tools/pdfMerge.ts';
import { extract } from '../../tools/pdfExtract.ts';
import { organize } from '../../tools/pdfOrganize.ts';
import { renderPageThumbnail, clearThumbnailCache, mockPageThumb } from '../../tools/pdfThumbnails.ts';
import { downloadFile, downloadAsZip } from '../ConversionModal/ConversionActions.ts';
import { showPopup, hidePopup } from '../Popup/Popup.ts';
import { formatBytes } from '../utils.ts';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type Tool = 'merge' | 'extract' | 'organize';

let mergeFiles: SourceFile[] = [];
let extractFiles: SourceFile[] = [];
let extractPages: PageEntry[] = [];
let extractSelected = new Set<number>();
let extractBtn: HTMLElement | null = null;
let mobileActionBtn: HTMLElement | null = null;
let extractRangeInput: HTMLInputElement | null = null;
let extractGroupAsOne = false;
let orgFiles: SourceFile[] = [];
let orgPages: PageEntry[] = [];

let activeTool: Tool = 'merge';
let pendingTool: Tool | null = null; // set before init, applied on init
let lastClickedIdx = -1; // for shift-select
let mergeGridContainer: HTMLElement | null = null;
let mergeSidebarCard: HTMLElement | null = null;
let mergeMobileTray: HTMLElement | null = null;
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
  if (!['merge', 'extract', 'organize'].includes(t)) return;

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
  toolContent.classList.remove('ws-empty-layout', 'ws-extract-layout');
  if (activeTool === 'merge') renderMergeView();
  else if (activeTool === 'extract') renderExtractView();
  else renderOrganizeView();
}

function cleanup() {
  sortableInstance?.destroy();
  sortableInstance = null;
  thumbnailObserver?.disconnect();
  thumbnailObserver = null;
  renderQueue.length = 0;
  extractBtn = null;
  extractRangeInput = null;
  mobileActionBtn = null;
  mergeGridContainer = null;
  mergeSidebarCard = null;
  mergeMobileTray = null;
}

function resetAll() {
  mergeFiles = [];
  extractFiles = [];
  extractPages = [];
  extractSelected.clear();
  extractGroupAsOne = false;
  orgFiles = [];
  orgPages = [];
  lastClickedIdx = -1;
  clearThumbnailCache();
  renderActiveTool();
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
  const card = el('div', { className: 'card-base ws-dropzone-card' });
  if (label) {
    card.appendChild(el('span', { className: 'ws-field-label', textContent: label }));
  }
  card.appendChild(createDropzone(text, multi));
  return card;
}

// ---------------------------------------------------------------------------
// File handling
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200 MB

async function handleFiles(files: File[]) {
  const parsed: SourceFile[] = [];
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      showError(`"${file.name}" is too large (max 200 MB).`);
      continue;
    }
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
    updateMergeContent();
    kickMergeThumbs();
  } else if (activeTool === 'extract') {
    extractFiles.push(...parsed);
    for (const sf of parsed)
      for (let p = 1; p <= sf.pageCount; p++)
        extractPages.push({ type: 'source', sourceFileId: sf.id, sourcePageNum: p, thumbnail: null, deleted: false, rotation: 0 });
    renderExtractView();
    kickPageThumbs(extractPages);
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
  toolContent.classList.add('ws-empty-layout');
  toolContent.appendChild(createDropzoneCard(text, multi));
}

// ---------------------------------------------------------------------------
// MERGE VIEW — two cards: file grid (left) + sidebar (right)
// ---------------------------------------------------------------------------

function renderMergeView() {
  cleanup();
  toolContent.innerHTML = '';
  toolContent.classList.remove('ws-empty-layout', 'ws-extract-layout');

  if (mergeFiles.length === 0) {
    renderEmptyState('Drop PDFs to merge', true);
    return;
  }

  toolContent.classList.add('ws-extract-layout');

  // Left card: file cards grid
  const leftCard = el('div', { className: 'card-base ws-grid-card' });
  mergeGridContainer = el('div', { className: 'ws-file-cards' });
  leftCard.appendChild(mergeGridContainer);

  // Right card: sidebar
  mergeSidebarCard = el('div', { className: 'card-base ws-sidebar-card' });
  mergeSidebarCard.id = 'merge-sidebar';

  toolContent.appendChild(leftCard);
  toolContent.appendChild(mergeSidebarCard);

  // Mobile toolbar + tray
  appendMobileToolbar({
    gridCard: leftCard,
    actionText: 'Merge PDF',
    actionDisabled: mergeFiles.length < 2,
    onAction: handleMerge,
    buildTrayContent: (tray) => { mergeMobileTray = tray; updateMergeSidebarContent(tray); },
  });

  updateMergeContent();
}

/** Incrementally update the merge grid + sidebar without rebuilding outer cards. */
function updateMergeContent() {
  if (!mergeGridContainer) { renderMergeView(); return; }

  // If all files removed, full re-render to show empty state
  if (mergeFiles.length === 0) { renderMergeView(); return; }

  // Rebuild grid contents
  sortableInstance?.destroy();
  sortableInstance = null;
  mergeGridContainer.innerHTML = '';
  for (const sf of mergeFiles) mergeGridContainer.appendChild(createFileCard(sf));

  const addCard = createDropzone('Drop more PDFs', true);
  addCard.className = 'ws-file-card ws-file-add';
  mergeGridContainer.appendChild(addCard);

  sortableInstance = new Sortable(mergeGridContainer, {
    animation: 200, delay: 150, delayOnTouchOnly: true, ghostClass: 'ws-ghost',
    draggable: '.ws-file-card:not(.ws-file-add)',
    onEnd: (evt) => {
      if (evt.oldIndex != null && evt.newIndex != null && evt.oldIndex !== evt.newIndex) {
        const [moved] = mergeFiles.splice(evt.oldIndex, 1);
        mergeFiles.splice(evt.newIndex, 0, moved);
      }
    },
  });

  // Update sidebar + mobile tray
  if (mergeSidebarCard) updateMergeSidebarContent(mergeSidebarCard);
  if (mergeMobileTray) updateMergeSidebarContent(mergeMobileTray);

  // Update mobile action button state
  if (mobileActionBtn) {
    mobileActionBtn.textContent = 'Merge PDF';
    mobileActionBtn.classList.toggle('disabled', mergeFiles.length < 2);
    if (mergeFiles.length < 2) mobileActionBtn.setAttribute('aria-disabled', 'true');
    else mobileActionBtn.removeAttribute('aria-disabled');
  }
}

function updateMergeSidebarContent(sidebar: HTMLElement) {
  sidebar.innerHTML = '';

  const addZone = createDropzone('Drop more PDFs', true);
  addZone.classList.add('ws-sidebar-dropzone');
  sidebar.appendChild(addZone);

  const total = mergeFiles.reduce((s, f) => s + f.pageCount, 0);
  const mergeCountText = mergeFiles.length === 1
    ? `${total} pages`
    : `${mergeFiles.length} files · ${total} pages`;
  sidebar.appendChild(el('p', { className: 'ws-sidebar-count', textContent: mergeCountText }));

  const fileList = el('div', { className: 'ws-sidebar-files' });
  for (const sf of mergeFiles) {
    const fileItem = el('div', { className: 'ws-sidebar-file' });
    const letter = mergeFiles.length > 1 ? String.fromCharCode(65 + (mergeFiles.indexOf(sf) % 26)) + ': ' : '';
    fileItem.appendChild(el('span', { className: 'ws-sidebar-filename', textContent: letter + sf.name, title: sf.name }));
    if (mergeFiles.length > 1) {
      fileItem.appendChild(el('span', { className: 'ws-sidebar-meta', textContent: `${sf.pageCount} pages · ${formatBytes(sf.size)}` }));
    }

    const delFileBtn = el('button', { className: 'icon-btn ws-hover-reveal ws-file-list-remove', innerHTML: '&times;', ariaLabel: `Remove ${sf.name}` });
    delFileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      mergeFiles = mergeFiles.filter(f => f.id !== sf.id);
      updateMergeContent();
      if (mergeFiles.length) kickMergeThumbs();
    });
    fileItem.appendChild(delFileBtn);
    fileList.appendChild(fileItem);
  }
  sidebar.appendChild(fileList);

  const bottom = el('div', { className: 'ws-sidebar-bottom' });

  const mergeBtn = el('button', { className: 'btn-primary ws-action-btn ws-action-full', textContent: 'Merge PDF' });
  if (mergeFiles.length < 2) { mergeBtn.classList.add('disabled'); mergeBtn.setAttribute('aria-disabled', 'true'); }
  mergeBtn.addEventListener('click', handleMerge);

  bottom.appendChild(mergeBtn);
  sidebar.appendChild(bottom);
}

async function handleMerge() {
  if (mergeFiles.length < 2) return;
  await runWithPopup('Merging', 'Merge failed. Try removing a file and re-adding it.', async () => {
    const r = await merge(mergeFiles);
    downloadFile(r.bytes, r.name);
  });
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
  info.appendChild(el('span', { className: 'ws-file-meta', textContent: `${sf.pageCount} pages · ${formatBytes(sf.size)}` }));
  card.appendChild(info);

  const removeBtn = el('button', { className: 'icon-btn ws-hover-reveal ws-file-remove', innerHTML: '&times;', ariaLabel: 'Remove' });
  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    mergeFiles = mergeFiles.filter(f => f.id !== sf.id);
    updateMergeContent();
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
// EXTRACT VIEW — two cards: page grid (left) + sidebar (right)
// ---------------------------------------------------------------------------

function renderExtractView() {
  cleanup();
  toolContent.innerHTML = '';
  toolContent.classList.remove('ws-empty-layout', 'ws-extract-layout');

  if (extractFiles.length === 0) {
    renderEmptyState('Drop PDFs to extract pages', true);
    return;
  }

  toolContent.classList.add('ws-extract-layout');

  // Left card: page grid
  const leftCard = el('div', { className: 'card-base ws-grid-card' });
  const grid = el('div', { className: 'ws-page-cards' });
  extractPages.forEach((page, idx) => {
    const card = createPageCard(page, idx, false);
    card.setAttribute('role', 'checkbox');
    card.setAttribute('aria-checked', String(extractSelected.has(idx)));
    card.setAttribute('aria-label', `Page ${page.sourcePageNum}`);
    card.tabIndex = 0;
    const togglePage = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key !== ' ' && e.key !== 'Enter') return;
      if (e instanceof KeyboardEvent) e.preventDefault();
      if (e instanceof MouseEvent && e.shiftKey && lastClickedIdx >= 0) {
        const start = Math.min(lastClickedIdx, idx);
        const end = Math.max(lastClickedIdx, idx);
        for (let i = start; i <= end; i++) extractSelected.add(i);
      } else {
        if (extractSelected.has(idx)) extractSelected.delete(idx);
        else extractSelected.add(idx);
      }
      lastClickedIdx = idx;
      updateExtractVisuals();
      updateExtractSidebar();
      syncRangeInput();
    };
    card.addEventListener('click', togglePage);
    card.addEventListener('keydown', togglePage);
    grid.appendChild(card);
  });
  const addCard = createDropzone('Drop more PDFs', true);
  addCard.className = 'ws-page-add';
  grid.appendChild(addCard);
  leftCard.appendChild(grid);
  setupThumbnailObserver(leftCard, extractPages);

  // Right card: sidebar
  const rightCard = el('div', { className: 'card-base ws-sidebar-card' });
  rightCard.id = 'extract-sidebar';
  updateExtractSidebarContent(rightCard);

  // Save desktop refs before mobile tray overwrites them
  const desktopBtn = extractBtn;
  const desktopRangeInput = extractRangeInput;

  toolContent.appendChild(leftCard);
  toolContent.appendChild(rightCard);

  // Mobile toolbar + tray
  appendMobileToolbar({
    gridCard: leftCard,
    actionText: extractSelected.size === 0 ? 'Select pages to extract' : `Extract ${extractSelected.size} page${extractSelected.size !== 1 ? 's' : ''}`,
    actionDisabled: extractSelected.size === 0,
    onAction: handleExtract,
    buildTrayContent: (tray) => { updateExtractSidebarContent(tray); },
  });

  // Restore desktop refs (tray build overwrote them)
  extractBtn = desktopBtn;
  extractRangeInput = desktopRangeInput;
}

function updateExtractSidebar() {
  const text = extractSelected.size === 0 ? 'Select pages to extract' : `Extract ${extractSelected.size} page${extractSelected.size !== 1 ? 's' : ''}`;
  if (extractBtn) {
    extractBtn.textContent = text;
    extractBtn.classList.toggle('disabled', extractSelected.size === 0);
    if (extractSelected.size === 0) extractBtn.setAttribute('aria-disabled', 'true');
    else extractBtn.removeAttribute('aria-disabled');
  }
  // Update mobile toolbar action button
  if (mobileActionBtn) {
    mobileActionBtn.textContent = text;
    mobileActionBtn.classList.toggle('disabled', extractSelected.size === 0);
    if (extractSelected.size === 0) mobileActionBtn.setAttribute('aria-disabled', 'true');
    else mobileActionBtn.removeAttribute('aria-disabled');
  }
}

function updateExtractSidebarContent(sidebar: HTMLElement) {
  sidebar.innerHTML = '';

  // Select controls (pinned above scroll)
  const multiFile = extractFiles.length > 1;
  const rangeInput = el('input', {
    type: 'text', className: 'ws-range-input',
    placeholder: multiFile ? 'e.g. A1-A5, B3, B8-B10' : 'e.g. 1-5, 8, 12-20',
    ariaLabel: 'Page range',
  }) as HTMLInputElement;
  rangeInput.value = extractRangeToString();
  rangeInput.addEventListener('input', () => {
    const text = rangeInput.value.trim();
    if (!text) { rangeInput.classList.remove('ws-input-error'); extractSelected.clear(); updateExtractVisuals(); updateExtractSidebar(); return; }
    const parsed = parseExtractRange(text);
    if (!parsed) { rangeInput.classList.add('ws-input-error'); return; }
    rangeInput.classList.remove('ws-input-error');
    extractSelected = parsed;
    updateExtractVisuals();
    updateExtractSidebar();
  });
  extractRangeInput = rangeInput;
  sidebar.appendChild(rangeInput);

  const btnRow = el('div', { className: 'ws-sidebar-btn-row' });
  const selectAllBtn = el('button', { className: 'ws-btn ws-btn-small', textContent: 'Select all' });
  selectAllBtn.addEventListener('click', () => { extractPages.forEach((_, i) => extractSelected.add(i)); updateExtractVisuals(); updateExtractSidebar(); syncRangeInput(); });
  const deselectBtn = el('button', { className: 'ws-btn ws-btn-small', textContent: 'Deselect all' });
  deselectBtn.addEventListener('click', () => { extractSelected.clear(); updateExtractVisuals(); updateExtractSidebar(); syncRangeInput(); });
  btnRow.appendChild(selectAllBtn);
  btnRow.appendChild(deselectBtn);
  sidebar.appendChild(btnRow);

  const countText = extractFiles.length === 1
    ? `${extractPages.length} pages`
    : `${extractFiles.length} files · ${extractPages.length} pages`;
  sidebar.appendChild(el('p', { className: 'ws-sidebar-count', textContent: countText }));

  const addZone = createDropzone('Drop more PDFs', true);
  addZone.classList.add('ws-sidebar-dropzone');
  sidebar.appendChild(addZone);

  // File list (scrollable)
  const fileList = el('div', { className: 'ws-sidebar-files' });
  const uniqueFiles = [...new Set(extractPages.map(p => p.sourceFileId))];
  for (const fid of uniqueFiles) {
    const sf = extractFiles.find(f => f.id === fid);
    if (!sf) continue;
    const fileItem = el('div', { className: 'ws-sidebar-file' });
    const letter = uniqueFiles.length > 1 ? String.fromCharCode(65 + (uniqueFiles.indexOf(fid) % 26)) + ': ' : '';
    fileItem.appendChild(el('span', { className: 'ws-sidebar-filename', textContent: letter + sf.name, title: sf.name }));
    if (uniqueFiles.length > 1) {
      fileItem.appendChild(el('span', { className: 'ws-sidebar-meta', textContent: `${sf.pageCount} pages · ${formatBytes(sf.size)}` }));
    }

    const delFileBtn = el('button', { className: 'icon-btn ws-hover-reveal ws-file-list-remove', innerHTML: '&times;', ariaLabel: `Remove ${sf.name}` });
    delFileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Remap selected indices after removing this file's pages
      const newSelected = new Set<number>();
      let newIdx = 0;
      extractPages.forEach((p, oldIdx) => {
        if (p.sourceFileId === fid) return;
        if (extractSelected.has(oldIdx)) newSelected.add(newIdx);
        newIdx++;
      });
      const survivingPages = extractPages.filter(p => p.sourceFileId !== fid);
      extractPages = survivingPages;
      extractSelected = newSelected;
      extractFiles = extractFiles.filter(f => f.id !== fid);
      if (extractFiles.length === 0) clearThumbnailCache();
      renderExtractView();
      if (extractPages.length > 0) kickPageThumbs(extractPages);
    });
    fileItem.appendChild(delFileBtn);
    fileList.appendChild(fileItem);
  }
  sidebar.appendChild(fileList);

  // Bottom section: action buttons
  const bottom = el('div', { className: 'ws-sidebar-bottom' });
  extractBtn = el('button', {
    className: 'btn-primary ws-action-btn ws-action-full',
    textContent: extractSelected.size === 0 ? 'Select pages to extract' : `Extract ${extractSelected.size} page${extractSelected.size !== 1 ? 's' : ''}`
  });
  if (extractSelected.size === 0) { extractBtn.classList.add('disabled'); extractBtn.setAttribute('aria-disabled', 'true'); }
  extractBtn.addEventListener('click', handleExtract);

  const checkRow = el('label', { className: 'ws-checkbox-row' });
  const checkbox = el('input', { type: 'checkbox' }) as HTMLInputElement;
  checkbox.checked = extractGroupAsOne;
  checkbox.addEventListener('change', () => { extractGroupAsOne = checkbox.checked; });
  checkRow.appendChild(checkbox);
  checkRow.appendChild(document.createTextNode(' Combine into one PDF'));
  bottom.appendChild(checkRow);
  bottom.appendChild(extractBtn);
  sidebar.appendChild(bottom);
}

function updateExtractVisuals() {
  toolContent.querySelectorAll('.ws-page-card').forEach((card, i) => {
    const selected = extractSelected.has(i);
    card.classList.toggle('ws-page-selected', selected);
    card.setAttribute('aria-checked', String(selected));
  });
}

async function handleExtract() {
  if (extractFiles.length === 0 || extractSelected.size === 0) return;
  await runWithPopup('Extracting', 'Extract failed. The PDF might be damaged or unsupported.', async () => {
    // Group selected pages by source file
    const byFile = new Map<number, number[]>();
    for (const idx of [...extractSelected].sort((a, b) => a - b)) {
      const page = extractPages[idx];
      const arr = byFile.get(page.sourceFileId) ?? [];
      arr.push(page.sourcePageNum);
      byFile.set(page.sourceFileId, arr);
    }

    const firstName = extractFiles[0].name.replace(/\.pdf$/i, '');

    if (extractGroupAsOne) {
      // Combine selected pages across all files into one PDF
      const output = await PDFDocument.create();
      const loadedSources = new Map<number, Awaited<ReturnType<typeof PDFDocument.load>>>();
      for (const idx of [...extractSelected].sort((a, b) => a - b)) {
        const page = extractPages[idx];
        if (!loadedSources.has(page.sourceFileId)) {
          const sf = extractFiles.find(f => f.id === page.sourceFileId)!;
          loadedSources.set(page.sourceFileId, await PDFDocument.load(sf.bytes, { ignoreEncryption: true }));
        }
        const source = loadedSources.get(page.sourceFileId)!;
        const [copied] = await output.copyPages(source, [page.sourcePageNum - 1]);
        output.addPage(copied);
      }
      const outputBytes = new Uint8Array(await output.save());
      const suffix = extractSelected.size === extractPages.length ? '' : '_extracted';
      downloadFile(outputBytes, `${firstName}${suffix}.pdf`);
    } else {
      // Extract per-file, collect all results
      const allResults: { name: string; bytes: Uint8Array }[] = [];
      for (const [fid, pageNums] of byFile) {
        const sf = extractFiles.find(f => f.id === fid)!;
        const baseName = sf.name.replace(/\.pdf$/i, '');
        const results = await extract(sf.bytes, pageNums, baseName, false);
        allResults.push(...results);
      }
      if (allResults.length === 1) downloadFile(allResults[0].bytes, allResults[0].name);
      else await downloadAsZip(allResults, `${firstName}_pages.zip`);
    }
  });
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

    const grid = toolContent.querySelector('.ws-page-cards');
    if (!grid) { renderOrganizeView(); kickPageThumbs(orgPages); return; }

    // Insert new slot into existing grid
    const newSlot = el('div', { className: 'ws-page-slot' });
    newSlot.appendChild(createInsertBtn(atIdx));
    newSlot.appendChild(createPageCard(blank, atIdx, true));
    const trailing = grid.querySelector('.ws-page-insert-trailing');
    const slots = grid.querySelectorAll('.ws-page-slot');
    if (atIdx < slots.length) {
      grid.insertBefore(newSlot, slots[atIdx]);
    } else {
      grid.insertBefore(newSlot, trailing);
    }

    // Re-index data attributes on all slots
    reindexSlots(grid);

    updateOrgSidebar();
    kickPageThumbs(orgPages);
  });
}

function createInsertBtn(atIdx: number): HTMLElement {
  const btn = el('button', { className: 'ws-page-insert', innerHTML: '+', ariaLabel: 'Insert blank page' });
  btn.dataset.insertAt = String(atIdx);
  return btn;
}

/** Re-index page card and insert button data attributes after reorder/insert. */
function reindexSlots(grid: Element) {
  grid.querySelectorAll<HTMLElement>('.ws-page-slot').forEach((slot, idx) => {
    const card = slot.querySelector<HTMLElement>('.ws-page-card');
    if (card) card.dataset.pageIdx = String(idx);
    // Ensure insert button exists and has correct index
    let btn = slot.querySelector<HTMLElement>('.ws-page-insert');
    if (!btn) {
      btn = createInsertBtn(idx + 1);
      slot.insertBefore(btn, slot.firstChild);
    } else {
      btn.dataset.insertAt = String(idx + 1);
    }
  });
}

function renderOrganizeView() {
  cleanup();
  toolContent.innerHTML = '';
  toolContent.classList.remove('ws-empty-layout', 'ws-extract-layout');

  if (orgPages.length === 0) {
    renderEmptyState('Drop PDFs to rearrange, rotate, or remove pages', true);
    return;
  }

  toolContent.classList.add('ws-extract-layout');

  // Left card: page grid
  const leftCard = el('div', { className: 'card-base ws-grid-card' });
  const grid = el('div', { className: 'ws-page-cards' });
  orgPages.forEach((page, idx) => {
    const slot = el('div', { className: `ws-page-slot${page.deleted ? ' ws-page-deleted' : ''}` });
    slot.appendChild(createInsertBtn(idx + 1));
    slot.appendChild(createPageCard(page, idx, true));
    grid.appendChild(slot);
  });
  // Trailing insert — card-shaped add button
  const trailing = el('button', { className: 'ws-page-insert-trailing', innerHTML: '+', ariaLabel: 'Insert blank page at end' });
  trailing.dataset.insertAt = 'end';
  grid.appendChild(trailing);
  const addBlankCard = el('button', { className: 'ws-page-add', ariaLabel: 'Add blank page' });
  addBlankCard.innerHTML = '<p class="upload-text">+ Blank page</p>';
  addBlankCard.addEventListener('click', () => insertBlankPage(orgPages.length));
  grid.appendChild(addBlankCard);
  const addCard = createDropzone('Drop more PDFs', true);
  addCard.className = 'ws-page-add';
  grid.appendChild(addCard);
  leftCard.appendChild(grid);

  // Event delegation for all insert buttons (between-page + trailing)
  grid.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-insert-at]');
    if (!btn) return;
    e.stopPropagation();
    const at = btn.dataset.insertAt === 'end' ? orgPages.length : Number(btn.dataset.insertAt);
    insertBlankPage(at);
  });

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
      reindexSlots(grid);
      updateOrgSidebar();
    },
  });

  setupThumbnailObserver(leftCard, orgPages);

  // Right card: sidebar
  const rightCard = el('div', { className: 'card-base ws-sidebar-card' });
  rightCard.id = 'org-sidebar';
  updateOrgSidebarContent(rightCard);

  toolContent.appendChild(leftCard);
  toolContent.appendChild(rightCard);

  // Mobile toolbar + tray
  const active = orgPages.filter(p => !p.deleted).length;
  appendMobileToolbar({
    gridCard: leftCard,
    actionText: 'Save PDF',
    actionDisabled: active === 0,
    onAction: handleOrganize,
    buildTrayContent: (tray) => { updateOrgSidebarContent(tray); },
  });
}

function updateOrgSidebar() {
  const sidebar = document.getElementById('org-sidebar');
  if (sidebar) updateOrgSidebarContent(sidebar);
}

function updateOrgSidebarContent(sidebar: HTMLElement) {
  sidebar.innerHTML = '';

  const addZone = createDropzone('Drop more PDFs', true);
  addZone.classList.add('ws-sidebar-dropzone');
  sidebar.appendChild(addZone);

  const active = orgPages.filter(p => !p.deleted).length;
  const deleted = orgPages.filter(p => p.deleted).length;
  let countText = `${active} pages`;
  if (deleted > 0) countText += ` · ${deleted} removed`;
  sidebar.appendChild(el('p', { className: 'ws-sidebar-count', textContent: countText }));

  // File list (scrollable)
  const fileList = el('div', { className: 'ws-sidebar-files' });
  const uniqueFiles = [...new Set(orgPages.filter(p => p.type !== 'blank').map(p => p.sourceFileId))];
  for (const fid of uniqueFiles) {
    const sf = orgFiles.find(f => f.id === fid);
    if (!sf) continue;
    const fileItem = el('div', { className: 'ws-sidebar-file' });
    const letter = uniqueFiles.length > 1 ? String.fromCharCode(65 + (uniqueFiles.indexOf(fid) % 26)) + ': ' : '';
    fileItem.appendChild(el('span', { className: 'ws-sidebar-filename', textContent: letter + sf.name, title: sf.name }));
    if (uniqueFiles.length > 1) {
      fileItem.appendChild(el('span', { className: 'ws-sidebar-meta', textContent: `${sf.pageCount} pages · ${formatBytes(sf.size)}` }));
    }

    const delFileBtn = el('button', { className: 'icon-btn ws-hover-reveal ws-file-list-remove', innerHTML: '&times;', ariaLabel: `Remove ${sf.name}` });
    delFileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      orgPages = orgPages.filter(p => p.sourceFileId !== fid);
      orgFiles = orgFiles.filter(f => f.id !== fid);
      if (orgPages.length === 0) clearThumbnailCache();
      renderOrganizeView();
      if (orgPages.length > 0) kickPageThumbs(orgPages);
    });
    fileItem.appendChild(delFileBtn);
    fileList.appendChild(fileItem);
  }
  sidebar.appendChild(fileList);

  // Bottom: actions
  const bottom = el('div', { className: 'ws-sidebar-bottom' });

  const saveBtn = el('button', { className: 'btn-primary ws-action-btn ws-action-full', textContent: 'Save PDF' });
  if (active === 0) { saveBtn.classList.add('disabled'); saveBtn.setAttribute('aria-disabled', 'true'); }
  saveBtn.addEventListener('click', handleOrganize);

  bottom.appendChild(saveBtn);
  sidebar.appendChild(bottom);
}

async function handleOrganize() {
  const activePages = orgPages.filter(p => !p.deleted);
  if (!activePages.length) return;
  await runWithPopup('Saving', 'Save failed. Try with fewer pages or a smaller file.', async () => {
    const r = await organize(orgFiles, activePages);
    downloadFile(r.bytes, r.name);
  });
}

// ---------------------------------------------------------------------------
// Shared: mobile toolbar + tray

const MORE_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';

function appendMobileToolbar(opts: {
  gridCard: HTMLElement;
  actionText: string;
  actionDisabled: boolean;
  onAction: () => void;
  buildTrayContent: (container: HTMLElement) => void;
}): HTMLElement {
  // Toolbar — lives inside the grid card for sticky positioning
  const toolbar = el('div', { className: 'ws-toolbar' });
  const iconBtn = el('button', { className: 'icon-btn ws-toolbar-icon', ariaLabel: 'More options' });
  iconBtn.innerHTML = MORE_SVG;
  const actionBtn = el('button', { className: 'btn-primary ws-toolbar-action', textContent: opts.actionText });
  if (opts.actionDisabled) { actionBtn.classList.add('disabled'); actionBtn.setAttribute('aria-disabled', 'true'); }
  actionBtn.addEventListener('click', opts.onAction);
  toolbar.appendChild(actionBtn);
  toolbar.appendChild(iconBtn);
  opts.gridCard.appendChild(toolbar);

  // Tray + overlay stay in toolContent (fixed-positioned)
  const tray = el('div', { className: 'ws-tray' });
  opts.buildTrayContent(tray);

  const overlay = el('div', { className: 'ws-tray-overlay' });

  const openTray = () => { tray.classList.add('ws-tray-open'); overlay.classList.add('ws-tray-open'); };
  const closeTray = () => { tray.classList.remove('ws-tray-open'); overlay.classList.remove('ws-tray-open'); };
  iconBtn.addEventListener('click', () => tray.classList.contains('ws-tray-open') ? closeTray() : openTray());
  overlay.addEventListener('click', closeTray);

  toolContent.appendChild(overlay);
  toolContent.appendChild(tray);

  mobileActionBtn = actionBtn;
  return actionBtn;
}

// Shared: page card
// ---------------------------------------------------------------------------

function getPageBadgeText(page: PageEntry): string {
  if (page.type === 'blank') return 'Blank';
  const files = activeTool === 'organize' ? orgFiles : extractFiles;
  if (files.length <= 1) return String(page.sourcePageNum);
  const fileIdx = files.findIndex(f => f.id === page.sourceFileId);
  const letter = String.fromCharCode(65 + (fileIdx % 26));
  return `${letter}${page.sourcePageNum}`;
}

function addDeleteButton(card: HTMLElement, idx: number) {
  const delBtn = el('button', { className: 'icon-btn ws-hover-reveal ws-page-delete', innerHTML: '&times;', ariaLabel: 'Delete' });
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (orgPages[idx].type === 'blank') {
      orgPages.splice(idx, 1);
      renderOrganizeView();
      kickPageThumbs(orgPages);
      return;
    }
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
  const rotBtn = el('button', { className: 'icon-btn ws-hover-reveal ws-page-rotate', innerHTML: '&#x21bb;', ariaLabel: 'Rotate' });
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
  const undoBtn = el('button', { className: 'icon-btn ws-page-undo', textContent: '\u21a9', ariaLabel: 'Undo' });
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
  const allFiles = activeTool === 'extract' ? extractFiles : orgFiles;
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
// Helpers
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

export function setToRangeString(selected: Set<number>, total: number): string {
  if (selected.size === 0) return '';
  if (selected.size === total) return `1-${total}`;
  const sorted = [...selected].sort((a, b) => a - b);
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
  if (!extractRangeInput) return;
  extractRangeInput.value = extractRangeToString();
  extractRangeInput.classList.remove('ws-input-error');
}

/** Convert extractSelected → range string. Uses letter prefixes when multi-file. */
function extractRangeToString(): string {
  if (extractSelected.size === 0) return '';
  if (extractFiles.length <= 1) return setToRangeString(extractSelected, extractPages.length);

  // Group selected indices by file
  const byFile = new Map<number, number[]>();
  for (const idx of [...extractSelected].sort((a, b) => a - b)) {
    const page = extractPages[idx];
    const arr = byFile.get(page.sourceFileId) ?? [];
    arr.push(page.sourcePageNum);
    byFile.set(page.sourceFileId, arr);
  }

  const uniqueFileIds = [...new Set(extractPages.map(p => p.sourceFileId))];
  const parts: string[] = [];
  for (const [fid, pageNums] of byFile) {
    const letterIdx = uniqueFileIds.indexOf(fid);
    const letter = String.fromCharCode(65 + (letterIdx % 26));
    const sf = extractFiles.find(f => f.id === fid);
    const total = sf?.pageCount ?? 0;
    if (pageNums.length === total && total > 0) {
      parts.push(`${letter}1-${letter}${total}`);
      continue;
    }
    let start = pageNums[0], end = pageNums[0];
    for (let i = 1; i < pageNums.length; i++) {
      if (pageNums[i] === end + 1) { end = pageNums[i]; }
      else { parts.push(start === end ? `${letter}${start}` : `${letter}${start}-${letter}${end}`); start = pageNums[i]; end = pageNums[i]; }
    }
    parts.push(start === end ? `${letter}${start}` : `${letter}${start}-${letter}${end}`);
  }
  return parts.join(', ');
}

/** Parse range string → 0-indexed extractSelected indices. Supports letter prefixes when multi-file. */
function parseExtractRange(text: string): Set<number> | null {
  if (extractFiles.length <= 1) {
    const oneIndexed = parsePageRange(text, extractPages.length);
    if (!oneIndexed) return null;
    const zeroIndexed = new Set<number>();
    for (const n of oneIndexed) zeroIndexed.add(n - 1);
    return zeroIndexed;
  }

  const uniqueFileIds = [...new Set(extractPages.map(p => p.sourceFileId))];
  const result = new Set<number>();

  for (const part of text.split(',').map(s => s.trim()).filter(Boolean)) {
    // Match prefixed range: A1-A5 or A1-5
    const rangeMatch = part.match(/^([A-Z])(\d+)\s*-\s*(?:([A-Z])(\d+)|(\d+))$/i);
    if (rangeMatch) {
      const letter = rangeMatch[1].toUpperCase();
      const start = parseInt(rangeMatch[2], 10);
      const endLetter = rangeMatch[3]?.toUpperCase() ?? letter;
      const end = parseInt(rangeMatch[4] ?? rangeMatch[5], 10);
      if (endLetter !== letter) return null; // cross-file ranges not supported
      const fileIdx = letter.charCodeAt(0) - 65;
      if (fileIdx < 0 || fileIdx >= uniqueFileIds.length) return null;
      const fid = uniqueFileIds[fileIdx];
      const sf = extractFiles.find(f => f.id === fid);
      if (!sf || start < 1 || end > sf.pageCount || start > end) return null;
      for (let p = start; p <= end; p++) {
        const idx = extractPages.findIndex(pg => pg.sourceFileId === fid && pg.sourcePageNum === p);
        if (idx >= 0) result.add(idx);
      }
      continue;
    }
    // Match single prefixed page: A5
    const singleMatch = part.match(/^([A-Z])(\d+)$/i);
    if (singleMatch) {
      const letter = singleMatch[1].toUpperCase();
      const pageNum = parseInt(singleMatch[2], 10);
      const fileIdx = letter.charCodeAt(0) - 65;
      if (fileIdx < 0 || fileIdx >= uniqueFileIds.length) return null;
      const fid = uniqueFileIds[fileIdx];
      const sf = extractFiles.find(f => f.id === fid);
      if (!sf || pageNum < 1 || pageNum > sf.pageCount) return null;
      const idx = extractPages.findIndex(pg => pg.sourceFileId === fid && pg.sourcePageNum === pageNum);
      if (idx >= 0) result.add(idx);
      continue;
    }
    return null; // unrecognized format
  }
  return result.size > 0 ? result : null;
}

async function runWithPopup(verb: string, fallback: string, fn: () => Promise<void>) {
  const wrap = el('div', { className: 'ws-processing' });
  wrap.appendChild(el('div', { className: 'ws-spinner' }));
  wrap.appendChild(el('p', { textContent: `${verb}...` }));
  showPopup(wrap, true);
  try { await fn(); hidePopup(); }
  catch (e: any) { hidePopup(); showError(e?.message || fallback); }
}

let errorTimeout: ReturnType<typeof setTimeout> | null = null;

function showError(msg: string) {
  errorEl.textContent = msg;
  errorEl.style.display = '';
  if (errorTimeout) clearTimeout(errorTimeout);
  errorTimeout = setTimeout(() => hideError(), 5000);
}

function hideError() { errorEl.style.display = 'none'; errorEl.textContent = ''; }

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
