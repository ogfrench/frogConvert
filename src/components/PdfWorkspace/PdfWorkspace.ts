import './PdfWorkspace.css';
import Sortable from 'sortablejs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import type { PageEntry, SourceFile } from '../../tools/types.ts';
import { getNextFileId, bumpNextFileId, getNextPageId, bumpNextPageId } from '../../tools/types.ts';
import { createPersistor } from '../persistence/createPersistor.ts';
import { clearSession, type StoredSession, type PdfWorkspacePayload } from '../persistence/sessionStore.ts';
import { merge } from '../../tools/pdfMerge.ts';
import { extract } from '../../tools/pdfExtract.ts';
import { organize } from '../../tools/pdfOrganize.ts';
import { PdfEditCancelled, checkpoint } from '../../tools/cancellation.ts';
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
import { renderPageThumbnail, renderPageBitmap, clearThumbnailCache, mockBlankPageThumb, mockPageThumb } from '../../tools/pdfThumbnails.ts';
import { downloadFile, downloadAsZip, timestampForFilename } from '../../conversion/download.ts';
import { isTouchUi } from '../../core/utils/touchUi.ts';
import { showToast } from '../Toast/Toast.ts';
import { Icons } from '../icons.ts';
import { showPopup, hidePopup, replacePopup, createPopupButton, showConfirmPopup, showUploadSummaryPopup, type UploadResult } from '../Popup/Popup.ts';
import { formatBytes, escapeHTML, shortenFileName, ensureMinDuration, toUserErrorInfo, appendSupportContact, FEEDBACK_CONTACT_TEXT, announce } from '../utils/index.ts';
import { createDancingFrog } from '../Frogsworth/DancingFrog.ts';
import { celebrateOnPopup } from '../../effects/Confetti/Confetti.ts';
import { ui, updateScrollLock, pdfQuality } from '../store/store.ts';
import {
  compressPdfOutputs,
  cancelPdfOutputCompression,
  resetPdfOutputCompression,
  wasPdfOutputCompressionCancelled,
} from '../../conversion/compressPdfOutput.ts';
import { formatProgress, liveLine, reassuranceLine } from '../../conversion/progressStatus.ts';
import type { ProgressEvent } from '../../core/FormatHandler/FormatHandler.ts';
import { MAX_TOTAL_FILE_SIZE, ABSOLUTE_MAX_FILES } from '../../constants/ui.ts';

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

/**
 * Apply a surgical delta to all per-tab state when `files` mutates:
 * - organize `pages` array: drop removed-file pages, append new-file source
 *   pages at the end, leaving any user reorder/rotation/blank intact
 * - organize `selected`: drop pageIds whose underlying page is gone
 * - merge `selectedFiles`: drop ids no longer present
 * - watermark `wmSelected`: drop removed-file keys, auto-include new-file keys
 *   (Default-selected on add)
 * - rebuild watermark flat-page index
 *
 * Driven off `knownFileIds` so the delta is exact across mutations from any
 * tab, including ones that previously bypassed this path.
 */
function onFilesMutated(): void {
  const newFileIds = new Set(files.map(f => f.id));
  const removedFileIds = new Set([...knownFileIds].filter(id => !newFileIds.has(id)));
  const addedFiles = files.filter(f => !knownFileIds.has(f.id));

  // Organize delta. Skip the append on first-ever entry (pages.length === 0
  // and organizeInitialized === false): renderOrganizeView lazily builds the
  // initial pages array from `files` on the first visit.
  if (organizeInitialized) {
    if (removedFileIds.size > 0) {
      pages = pages.filter(p => p.type === 'blank' || !removedFileIds.has(p.sourceFileId));
    }
    for (const f of addedFiles) {
      for (let p = 1; p <= f.pageCount; p++) {
        pages.push({
          type: 'source',
          sourceFileId: f.id,
          sourcePageNum: p,
          thumbnail: null,
          rotation: 0,
          originalPos: pages.length + 1,
          pageId: getNextPageId(),
        });
      }
    }
  }

  // Drop pageIds whose page is gone.
  const validPageIds = new Set(pages.map(p => p.pageId));
  for (const pid of selected) if (!validPageIds.has(pid)) selected.delete(pid);

  for (const id of selectedFiles) {
    if (!newFileIds.has(id)) selectedFiles.delete(id);
  }

  applyWmFileDelta(addedFiles, removedFileIds);

  knownFileIds = newFileIds;
  wmRebuildFlatPages();
  markDirty('files');
}

// File order changed but ids unchanged, preserve `selectedFiles`; only the
// derived page indices are invalid.
function onFilesReordered(): void {
  organizeInitialized = false;
  selected.clear();
  // Reorder does not change file ids, so manifest-only is enough.
  markDirty('manifest');
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
  if (mergeMobileTray) updateMergeSidebarContent(trayScroll(mergeMobileTray));
}

function moveSelection(dir: 'up' | 'down'): boolean {
  if (!selected.size) return false;
  const idxs = pages
    .map((p, i) => selected.has(p.pageId) ? i : -1)
    .filter(i => i >= 0)
    .sort((a, b) => a - b);
  if (idxs.length === 0) return false;
  if (dir === 'up' && idxs[0] === 0) return false;
  if (dir === 'down' && idxs[idxs.length - 1] === pages.length - 1) return false;

  pushHistory();
  const movingSet = new Set(idxs);
  const moving = idxs.map(i => pages[i]);
  const kept = pages.filter((_, i) => !movingSet.has(i));
  const dropAt = dir === 'up' ? idxs[0] - 1 : idxs[idxs.length - 1] + 2;
  const removedBefore = idxs.filter(i => i < dropAt).length;
  const insertAt = dropAt - removedBefore;
  kept.splice(insertAt, 0, ...moving);
  pages.length = 0;
  pages.push(...kept);
  // Selection follows pageIds; no remap needed across reorder.
  return true;
}


type HistorySnapshot = {
  pages: PageEntry[];
  selected: Set<number>;
  files: SourceFile[];
  lastClickedIdx: number;
};
const history: HistorySnapshot[] = [];
const redoStack: HistorySnapshot[] = [];
const HISTORY_MAX = 30;

function snapshotCurrent(): HistorySnapshot {
  return {
    pages: pages.map(p => ({ ...p })),
    selected: new Set(selected),
    files: files.slice(),
    lastClickedIdx,
  };
}

function pushHistory() {
  history.push(snapshotCurrent());
  if (history.length > HISTORY_MAX) history.shift();
  // New mutating action invalidates any pending redo branch - same convention
  // as code editors and image tools.
  redoStack.length = 0;
  markDirty('manifest');
}

function applySnapshot(snap: HistorySnapshot) {
  pages = snap.pages;
  selected = snap.selected;
  files = snap.files;
  lastClickedIdx = snap.lastClickedIdx;
  renderOrganizeView();
  kickPageThumbs(pages);
  markDirty('manifest');
}

function undo() {
  const snap = history.pop();
  if (!snap) return;
  // Capture the post-action state so redo can restore it.
  redoStack.push(snapshotCurrent());
  if (redoStack.length > HISTORY_MAX) redoStack.shift();
  applySnapshot(snap);
}

function redo() {
  const snap = redoStack.pop();
  if (!snap) return;
  history.push(snapshotCurrent());
  if (history.length > HISTORY_MAX) history.shift();
  applySnapshot(snap);
}

// Bumped on every applyPayload. In-flight async work (thumbnail renders,
// pdfjs base bitmap renders) keys against this and bails when stale, so a
// late callback can't write into the wrong PageEntry array.
let renderGeneration = 0;

const persistor = createPersistor<PdfWorkspacePayload>({
  kind: 'pdfWorkspace',
  buildPayload: () => ({
    activeTool,
    files: files.map(f => ({ id: f.id, name: f.name, size: f.size, pageCount: f.pageCount })),
    pages: pages.map(p => ({
      type: p.type,
      sourceFileId: p.sourceFileId,
      sourcePageNum: p.sourcePageNum,
      rotation: p.rotation,
      blankPageSize: p.blankPageSize,
      originalPos: p.originalPos,
      pageId: p.pageId,
    })),
    selected: [...selected],
    selectedFiles: [...selectedFiles],
    wmSelected: [...wmSelected],
    wmSettings: { ...wmSettings },
  }),
  currentFileIds: () => files.map(f => f.id),
  getBytesForId: (id) => {
    const f = files.find(x => x.id === id);
    if (!f) throw new Error(`PdfWorkspace: no file with id ${id}`);
    return f.bytes;
  },
  isPristine: () => files.length === 0,
  applyPayload: (payload, bytesById) => {
    const missing = payload.files.filter(f => !bytesById.has(f.id));
    if (missing.length) {
      showToast('Saved session was incomplete and could not be restored.', 'warn', 6000);
      return false;
    }
    // Invalidate any in-flight thumbnail / preview callbacks before we swap
    // the pages/files arrays out from under them.
    renderGeneration++;
    files = payload.files.map(meta => ({
      id: meta.id,
      name: meta.name,
      size: meta.size,
      pageCount: meta.pageCount ?? 0,
      bytes: bytesById.get(meta.id)!,
      firstPageThumb: null,
    }));
    pages = (payload.pages as any[]).map(p => ({
      type: p.type,
      sourceFileId: p.sourceFileId,
      sourcePageNum: p.sourcePageNum,
      rotation: p.rotation,
      blankPageSize: p.blankPageSize,
      originalPos: p.originalPos,
      // Pre-pageId payloads have no pageId; mint a fresh one so identity is
      // valid going forward (selection, if positional, gets translated below).
      pageId: typeof p.pageId === 'number' ? p.pageId : getNextPageId(),
      thumbnail: null,
    })) as PageEntry[];
    let maxPageId = 0;
    const validPageIds = new Set<number>();
    for (const p of pages) {
      validPageIds.add(p.pageId);
      if (p.pageId > maxPageId) maxPageId = p.pageId;
    }
    if (pages.length > 0) bumpNextPageId(maxPageId + 1);
    // Selection: new payloads store pageIds, legacy payloads stored array
    // indices. Detect by checking whether values match any current pageId.
    const rawSelected: number[] = payload.selected ?? [];
    if (rawSelected.length > 0 && rawSelected.every(v => validPageIds.has(v))) {
      selected = new Set(rawSelected);
    } else {
      // Legacy positional: translate via index lookup against the just-rebuilt
      // pages array.
      const sel = new Set<number>();
      for (const i of rawSelected) {
        if (i >= 0 && i < pages.length) sel.add(pages[i].pageId);
      }
      selected = sel;
    }
    selectedFiles = new Set(payload.selectedFiles ?? []);
    wmSettings = { ...WM_DEFAULTS, ...payload.wmSettings };
    // Rebuild the watermark flat-page index against the restored files so
    // legacy positional payloads can be translated.
    wmRebuildFlatPages();
    const restored = new Set<string>();
    for (const v of payload.wmSelected ?? []) {
      if (typeof v === 'string') {
        restored.add(v);
      } else if (typeof v === 'number' && v >= 0 && v < wmFlatPages.length) {
        // Legacy: positional flat-index. Translate against the rebuilt array.
        restored.add(wmKey(wmFlatPages[v]));
      }
    }
    wmSelected = restored;
    knownFileIds = new Set(files.map(f => f.id));
    wmLastClicked = -1;
    activeTool = payload.activeTool;
    lastClickedIdx = -1;
    history.length = 0;
    redoStack.length = 0;
    organizeInitialized = pages.length > 0;
    if (files.length > 0) bumpNextFileId(Math.max(...files.map(f => f.id)) + 1);
    syncTabsUI(activeTool);
    renderActiveTool();
    if (pages.length > 0) kickPageThumbs(pages);
    return true;
  },
});

// Persistence is dirty-flagged at state-mutation sites only, NEVER inside
// renderers. The 1s debounce inside createPersistor coalesces bursts, so the
// cost saved by precise marking is small, but the cost paid is that every
// new state-changing handler must remember to call markDirty.
//
// If you add a new affordance that mutates `files`, `pages`, `selected`,
// `selectedFiles`, `wmSelected`, `wmSettings`, or `activeTool`, call:
//   markDirty('files')    when the file array shape (ids/order) changes
//   markDirty('manifest') for everything else
//
// Centralised mutation helpers (`onFilesMutated`, `onFilesReordered`,
// `pushHistory`) already mark dirty on behalf of their callers, prefer
// routing through those when possible.
const markDirty = (scope: 'manifest' | 'files' = 'manifest') =>
  scope === 'files' ? persistor.markFilesDirty() : persistor.markManifestDirty();

function showResumePopup(stored: StoredSession<PdfWorkspacePayload>): void {
  const fileCount = stored.payload.files.length;
  const totalPages = stored.payload.files.reduce((s, f) => s + (f.pageCount ?? 0), 0);
  const summary = `${fileCount} PDF${fileCount === 1 ? '' : 's'} · ${totalPages} page${totalPages === 1 ? '' : 's'}`;
  showConfirmPopup(
    'Resume your last session?',
    summary,
    { label: 'Resume', onClick: async () => {
      const ok = await persistor.resume(stored);
      if (ok) showToast('Session restored', 'info', 3000);
    }},
    { label: 'Start fresh', onClick: () => { void clearSession(stored.sessionId); } },
  );
}

async function tryRestoreSession(): Promise<void> {
  const result = await persistor.tryRestore();
  if (result.status === 'orphan') showResumePopup(result.stored);
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

/** Mobile trays use an outer `.ws-tray` (rounded card, clips overflow) plus an
 *  inner `.ws-tray-scroll` that holds content and owns the scrollbar. This
 *  keeps the scrollbar inside the rounded corner instead of protruding. */
function trayScroll(tray: HTMLElement): HTMLElement {
  return tray.querySelector<HTMLElement>(':scope > .ws-tray-scroll') ?? tray;
}
let sortableInstance: Sortable | null = null;
let pendingMultiDrag: { pages: PageEntry[]; dragIdx: number } | null = null;
let thumbnailObserver: IntersectionObserver | null = null;
let initialized = false;

let lastEnterSignature = '';
function shouldEnter(sig: string): boolean {
  if (lastEnterSignature === sig) return false;
  lastEnterSignature = sig;
  return true;
}

let lastPdfResult: { bytes: Uint8Array; name: string }[] = [];
let lastPdfZipName: string | null = null;

/**
 * What the optional compression pass did to the save that just finished, or
 * null when it had nothing to report.
 *
 * The setting is sticky (`pdfQuality` persists), the default is Original
 * quality, and the success modal used to read identically either way. So
 * someone who picked Smallest file once, for one scan, kept re-compressing
 * every document they edited afterwards with nothing on screen to say so.
 * Three quite different outcomes - shrank by half, came back no smaller and
 * was discarded by the keep-threshold, failed and was swallowed by the
 * never-throws rule - all produced the same sentence.
 */
let lastPdfCompression: { before: number; after: number; skipped: boolean } | null = null;

/**
 * The one place a finished job hands its output over.
 *
 * Every tool used to assign `lastPdfResult` and `lastPdfZipName` itself, which
 * meant nine copies of the same two lines and nine places to remember when
 * something has to happen to every result. The optional output compression is
 * exactly that something: routing it through here means merge, organize,
 * watermark and extract all honour the Compression setting without any of them
 * knowing it exists.
 *
 * At Original quality (the default) this is the same two assignments as before.
 */
async function setPdfResult(
  results: { bytes: Uint8Array; name: string }[],
  zipName: string | null,
): Promise<{ bytes: Uint8Array; name: string }[]> {
  const level = pdfQuality.value;
  resetPdfOutputCompression();
  let skipButton: HTMLElement | null = null;
  if (level !== 'lossless' && results.length > 0) {
    // The popup still reads "Stitching your pages..." from whichever job called
    // us. Compressing a big scan takes seconds, and a message describing work
    // that already finished reads as a hang. Best-effort: no popup, no update.
    const note = document.querySelector<HTMLElement>('.ws-processing p');
    if (note) {
      note.textContent = results.length > 1
        ? `Compressing ${results.length} PDFs. The first one takes a little longer.`
        : 'Compressing your PDF. The first one takes a little longer.';
    }
    // The heading moves with it. Left saying "Merging..." over a body about
    // compression, the two lines describe different jobs and the one that has
    // already finished is the one shouted in bold.
    const heading = document.querySelector<HTMLElement>('.ws-processing h2');
    if (heading) heading.textContent = 'Compressing...';
    // A way out. Worst case here is the first-ever use on a large scan over a
    // slow line: a 16 MB engine fetch, a WASM compile and the pass itself,
    // behind a spinner whose only other exit was the 10-minute worker timeout.
    //
    // Safe by construction: the edit finished before this step started, so
    // skipping hands back the finished document uncompressed - precisely what
    // Original quality would have produced. Nothing the user asked for is lost.
    skipButton = addSkipCompressionButton();
  }
  // Both totals are to hand right here - the documents going in, and the ones
  // coming out - so nothing has to be threaded through the engine to report
  // them. Measured across the batch, because that is what the user saved.
  const before = results.reduce((n, r) => n + r.bytes.byteLength, 0);
  // Live status in the popup's own subtext, using the same formatter and the
  // same 9s/3s rhythm as Convert and Compress. Ghostscript reports a real
  // percentage - including, on first use, the download of its own ~16 MB engine
  // - and all of it used to be discarded here.
  const startedAt = Date.now();
  const note = document.querySelector<HTMLElement>('.ws-processing p');
  let ticker: ReturnType<typeof setInterval> | null = null;
  let latest: ProgressEvent | undefined;
  let position = '';
  const paint = () => {
    if (!note) return;
    const live = liveLine(formatProgress(latest), Date.now() - startedAt);
    const line = live ? `${live} — ${reassuranceLine()}` : reassuranceLine();
    note.textContent = position ? `${position} — ${line}` : line;
  };
  if (note) ticker = setInterval(paint, 1000);
  try {
    lastPdfResult = await compressPdfOutputs(results, level, (p, index, total) => {
      latest = p;
      position = total > 1 ? `PDF ${index + 1} of ${total}` : '';
      paint();
    });
  } finally {
    if (ticker) clearInterval(ticker);
    skipButton?.remove();
  }
  const after = lastPdfResult.reduce((n, r) => n + r.bytes.byteLength, 0);
  const skipped = level !== 'lossless' && wasPdfOutputCompressionCancelled();
  // Nothing to say at Original quality, and nothing to say when the pass ran
  // and kept the original: "compressed, 0% smaller" is worse than silence.
  lastPdfCompression =
    level === 'lossless' || (after >= before && !skipped)
      ? null
      : { before, after, skipped };
  lastPdfZipName = zipName;
  return lastPdfResult;
}

/**
 * The one clause the success modal adds about compression, or "".
 *
 * Deliberately a clause on the existing sentence rather than a card or a
 * second modal: this is a footnote to a save that already succeeded, and the
 * Compress surface is where a full report belongs.
 */
function compressionNote(c = lastPdfCompression): string {
  if (!c) return '';
  const saved = c.before - c.after;
  if (c.skipped) {
    // Skipping is safe by construction - the edit finished first - so this
    // says what the user has rather than dressing it up as a failure. A batch
    // stopped part-way still saved something, and that is worth stating.
    return saved > 0
      ? ` Compression stopped early, after ${escapeHTML(formatBytes(saved))}.`
      : ' Compression skipped, your pages are untouched.';
  }
  return ` Compressed ${escapeHTML(formatBytes(c.before))} → ${escapeHTML(formatBytes(c.after))}.`;
}

/** Cancel control for the optional compression step, added to the live popup. */
function addSkipCompressionButton(): HTMLElement | null {
  const wrap = document.querySelector<HTMLElement>('.ws-processing');
  if (!wrap) return null;
  const actions = el('div', { className: 'popup-actions-footer' });
  const btn = el('button', {
    className: 'btn-secondary',
    textContent: 'Skip compression',
    type: 'button',
  }) as HTMLButtonElement;
  btn.addEventListener('click', () => {
    btn.disabled = true;
    btn.textContent = 'Finishing up...';
    cancelPdfOutputCompression();
  });
  actions.appendChild(btn);
  wrap.appendChild(actions);
  return actions;
}

let toolContent: HTMLElement;
let fileInput: HTMLInputElement;
let errorEl: HTMLElement;

/**
 * Whether the next successful pick replaces the file list instead of appending.
 *
 * One `<input type=file>` serves + Add, every dropzone and Replace all, and a
 * cancelled picker fires no event at all - so a flag set at click time would
 * survive a cancel and silently turn the next + Add into a replace. Routing
 * every caller through `openPicker` means the flag is rewritten on each open,
 * so the last button pressed is always the one that decides.
 */
let replaceOnPick = false;

function openPicker(multiple: boolean, replace = false): void {
  replaceOnPick = replace;
  fileInput.multiple = multiple;
  fileInput.click();
}

const EAGER_LIMIT = 50;

const MAX_FILES = ABSOLUTE_MAX_FILES;
const MAX_TOTAL_PAGES = 300;

// ---------------------------------------------------------------------------
// Init + Tab switching
// ---------------------------------------------------------------------------

export function getActiveTool(): Tool { return activeTool; }

/**
 * Public entry for files arriving from outside the PDF Editor UI (Web Share
 * Target, future File Handlers). Mounts the workspace if the user hasn't
 * been here yet, then delegates to the standard `handleFiles` pipeline so
 * MAX_FILES / MAX_TOTAL_FILE_SIZE / MAX_TOTAL_PAGES caps + the upload-summary
 * popup behave identically to a regular drop.
 */
export function ingestExternalFiles(files: File[]): void {
  if (!files.length) return;
  if (!initialized) initPdfWorkspace();
  void handleFiles(files);
}

// Sync tab DOM with the active tool. Updates the .active class, aria-selected,
// and tabindex (roving - only the selected tab is keyboard-tabbable). The
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
  markDirty('manifest');
}

export function initPdfWorkspace() {
  // First-call setup wires document-level listeners and resolves DOM refs.
  // Subsequent calls (after cleanup() on app-mode switch) skip wiring and
  // just remount the active tool - module state is preserved.
  if (initialized) {
    renderActiveTool();
    return;
  }
  initialized = true;
  // Async, non-blocking - empty state still paints first if no session exists.
  void tryRestoreSession();
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void persistor.flushOnHide();
    });
  }
  // pagehide for mobile / OS-killed-tab cases visibilitychange misses.
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => { void persistor.flushOnHide(); });
  }

  toolContent = document.getElementById('pdf-tool-content')!;
  fileInput = document.getElementById('workspace-file-input') as HTMLInputElement;
  errorEl = document.getElementById('workspace-error')!;

  // Apply pending tool
  const tabs = document.getElementById('pdf-editor-tabs')!;
  syncTabsUI(activeTool);

  tabs.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.cat-tab') as HTMLButtonElement | null;
    if (!btn || btn.classList.contains('active')) return;
    activeTool = btn.dataset.tool as Tool;
    syncTabsUI(activeTool);
    renderActiveTool();
    markDirty('manifest');
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
    markDirty('manifest');
  });

  fileInput.addEventListener('change', () => {
    const replacing = replaceOnPick;
    replaceOnPick = false;
    if (fileInput.files?.length) handleFiles(Array.from(fileInput.files), replacing);
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
  } else if (
    (e.ctrlKey || e.metaKey) &&
    (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))
  ) {
    if (!redoStack.length) return;
    e.preventDefault();
    redo();
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
    markDirty('manifest');
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
    const delBtn = el('button', { className: 'icon-btn ws-hover-reveal ws-file-list-remove', innerHTML: Icons.x(), ariaLabel: `Remove ${sf.name}` });
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const panel = row.closest<HTMLElement>('.ws-tray-scroll, .ws-sidebar-card, .ws-wm-panel-card');
      const idx = panel
        ? [...panel.querySelectorAll('.ws-file-list-remove')].indexOf(delBtn)
        : -1;
      const hadFocus = document.activeElement === delBtn;
      opts.onRemove!();
      // Nothing on screen says a file went: the row is gone and the count
      // beside it is rebuilt rather than edited, so there is no text change
      // for a screen reader to notice. Announced here rather than at each of
      // the four call sites, because they all remove a file the same way and
      // only differ in what they repaint afterwards.
      announce(files.length
        ? `Removed ${sf.name}. ${files.length} ${files.length === 1 ? 'file' : 'files'} remaining.`
        : `Removed ${sf.name}. No files left.`);
      // This button is gone with its row, so focus has to be placed somewhere
      // deliberate or it falls to <body> and the user is dumped at the top of
      // the document.
      if (!hadFocus) return;
      if (panel?.isConnected) {
        // Merge repaints its list in place, so the panel outlives the row:
        // step to the neighbouring ×, or to the button row if that was the
        // last file.
        const remaining = panel.querySelectorAll<HTMLElement>('.ws-file-list-remove');
        if (remaining.length) remaining[Math.min(idx, remaining.length - 1)].focus();
        else panel.querySelector<HTMLElement>('.ws-sidebar-btn-row button')?.focus();
        return;
      }
      // The panel was rebuilt. A reopened tray has already claimed focus.
      const tray = document.querySelector('.ws-tray.ws-tray-open');
      if (tray?.contains(document.activeElement)) return;
      // Otherwise that was the last file and the whole view is now the empty
      // dropzone, which is the only thing left worth focusing.
      document.querySelector<HTMLElement>('.ws-dropzone')?.focus();
    });
    row.appendChild(delBtn);
  }
  return row;
}

/**
 * Replace all / Clear, for the count row at the top of a file block.
 *
 * Files were the only collection in the app without bulk actions - the
 * Converter and Compress have had them in the shared Files modal all along
 * (`index.html:588-590`), which is where this wording comes from. "Clear"
 * rather than "Remove all" is not only shorter: at the sidebar's real width
 * two long labels wrap onto two lines each, and one long plus one short does
 * not.
 *
 * `+ Add` moves out of this row and onto its own below the list, so the three
 * actions are not competing for the ~130px left over beside the count.
 */
function makeFileBulkActions(): HTMLElement {
  const group = el('div', { className: 'ws-count-btn-group' });

  // Both labels are terse enough to be ambiguous read out of context - "Clear"
  // on its own says nothing about what - so each names its object. The visible
  // text is a prefix of the accessible name, which is what speech control
  // needs to be able to act on what it can see (WCAG 2.5.3).
  const replaceBtn = el('button', {
    className: 'ws-btn ws-btn-small',
    textContent: 'Replace all',
    ariaLabel: 'Replace all files',
  });
  // No confirm: the picker opens first and the list is only swapped once files
  // come back, so cancelling the picker costs nothing. Same contract as the
  // Files modal's own Replace all.
  replaceBtn.addEventListener('click', () => openPicker(true, true));
  group.appendChild(replaceBtn);

  const clearBtn = el('button', {
    className: 'ws-btn ws-btn-small',
    textContent: 'Clear',
    ariaLabel: 'Clear all files',
  });
  clearBtn.addEventListener('click', () => {
    showConfirmPopup(
      'Clear all files?',
      'Page order, rotations and watermark settings go with them.',
      {
        label: 'Clear',
        onClick: () => {
          // Said before the reset, while there is still a count to report.
          const n = files.length;
          resetAll();
          announce(`Cleared ${n} ${n === 1 ? 'file' : 'files'}.`);
        },
      },
      { label: 'Keep them' },
    );
  });
  group.appendChild(clearBtn);

  return group;
}

/**
 * `+ Add`, on its own row under a file list, optionally with Organize's
 * Restore beside it.
 */
function makeAddFileRow(opts: { restore?: boolean } = {}): HTMLElement {
  const row = el('div', { className: 'ws-sidebar-btn-row' });
  row.appendChild(createAddFileButton());
  if (opts.restore) {
    const restoreBtn = el('button', { className: 'ws-btn ws-btn-small', textContent: 'Restore' });
    restoreBtn.addEventListener('click', resetPages);
    row.appendChild(restoreBtn);
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

  const enter = shouldEnter('merge-full') ? ' ws-content-enter' : '';

  // Left card: file grid
  const leftCard = el('div', { className: 'card-base ws-grid-card' + enter });
  mergeGridContainer = el('div', { className: 'ws-file-cards' });
  leftCard.appendChild(mergeGridContainer);

  // Right card: sidebar
  mergeSidebarCard = el('div', { className: 'card-base ws-sidebar-card' + enter });
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
  addCard.classList.add('ws-file-card');
  mergeGridContainer.appendChild(addCard);

  sortableInstance = new Sortable(mergeGridContainer, {
    animation: 200, delay: 150, delayOnTouchOnly: true,
    forceFallback: true,
    fallbackOnBody: true,
    scroll: false,
    ghostClass: 'ws-ghost',
    draggable: '.ws-file-card:not(.ws-dropzone)',
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
        const domOrder = [...mergeGridContainer!.querySelectorAll<HTMLElement>('.ws-file-card:not(.ws-dropzone)')]
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
  if (mergeMobileTray) updateMergeSidebarContent(trayScroll(mergeMobileTray));

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
  const countText = `${files.length} file${files.length !== 1 ? 's' : ''} · ${total} page${total !== 1 ? 's' : ''}`;
  const countRow = el('div', { className: 'ws-sidebar-count-row' });
  countRow.appendChild(el('p', { className: 'ws-sidebar-count', textContent: countText }));
  countRow.appendChild(makeFileBulkActions());
  sidebar.appendChild(countRow);

  const fileList = el('div', { className: 'ws-sidebar-files' });
  for (const sf of files) {
    const isMulti = files.length > 1;
    fileList.appendChild(makeSidebarFileRow(sf, {
      letter: isMulti ? String.fromCharCode(65 + (files.indexOf(sf) % 26)) : undefined,
      meta: isMulti ? `${sf.pageCount} page${sf.pageCount !== 1 ? 's' : ''} · ${formatBytes(sf.size)}` : undefined,
      onRemove: () => {
        files = files.filter(f => f.id !== sf.id);
        onFilesMutated();
        updateMergeContent();
        if (files.length) kickMergeThumbs();
      },
    }));
  }
  sidebar.appendChild(fileList);
  sidebar.appendChild(makeAddFileRow());

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
  await runWithPopup('Merging', 'Stitching your pages into one PDF. This only takes a moment.', 'Merge failed. Try removing a file and re-adding it.', async (signal) => {
    const r = await merge(files, signal);
    await setPdfResult([{ bytes: r.bytes, name: r.name }], null);
    return r;
  }, (r) => {
    showPdfSuccessModal(
      'PDF merged! \u{1F389}',
      `<b>${escapeHTML(shortenFileName(r.name, 32))}</b> is ready to download.`,
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
    markDirty('manifest');
  });

  const checkBadge = el('span', { className: 'ws-file-check floating-card-surface', innerHTML: Icons.check('0.75rem'), ariaHidden: 'true' });
  card.appendChild(checkBadge);

  const thumbWrap = el('div', { className: 'ws-file-thumb-wrap' });
  const thumb = el('div', { className: `ws-file-thumb${sf.firstPageThumb ? '' : ' ws-skeleton'}` });
  if (sf.firstPageThumb) setThumb(thumb, sf.firstPageThumb);
  thumbWrap.appendChild(thumb);

  card.appendChild(thumbWrap);

  if (files.length > 1) {
    const idx = files.indexOf(sf);
    const letter = String.fromCharCode(65 + (idx % 26));
    card.appendChild(el('span', { className: 'ws-file-badge floating-card-surface', textContent: letter }));
  }

  const info = el('div', { className: 'ws-file-info' });
  info.appendChild(el('span', { className: 'ws-file-name', textContent: sf.name, title: sf.name }));
  info.appendChild(el('span', { className: 'ws-file-meta', textContent: `${sf.pageCount} page${sf.pageCount !== 1 ? 's' : ''} · ${formatBytes(sf.size)}` }));
  card.appendChild(info);

  const removeBtn = el('button', { className: 'icon-btn ws-hover-reveal ws-file-remove floating-card-surface', innerHTML: Icons.x(), ariaLabel: 'Remove' });
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
    const gen = renderGeneration;
    queueRender(sf.bytes, 1, (url) => {
      // Drop the result if applyPayload (or any other generational reset)
      // swapped the file array out from under this in-flight render.
      if (gen !== renderGeneration) return;
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
  const actionBtn = el('button', { className: 'btn-primary toolbar-primary ws-toolbar-action', textContent: 'Merge PDF' });
  if (files.length < 2) { actionBtn.classList.add('disabled'); actionBtn.setAttribute('aria-disabled', 'true'); }
  actionBtn.addEventListener('click', handleMerge);
  toolbar.appendChild(actionBtn);
  toolbar.appendChild(iconBtn);
  document.body.appendChild(toolbar);
  mobileActionBtn = actionBtn;

  const tray = el('div', { className: 'ws-tray' });
  const scroll = el('div', { className: 'ws-tray-scroll' });
  tray.appendChild(scroll);
  mergeMobileTray = tray;
  updateMergeSidebarContent(scroll);
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
// Selection is keyed by `${fileId}:${pageNum}` so it survives any change to
// flat-index ordering. wmFlatPages stays as the visual surrogate; helpers
// translate between idx and key.
let wmSelected: Set<string> = new Set();
// Tracks which file ids existed at the last mutation so onFilesMutated can
// auto-include new files' pages and prune removed files' keys.
let knownFileIds: Set<number> = new Set();
let wmLastClicked = -1;                     // for shift-click range
let wmTextEncodeFont: { font: any; doc: PDFDocument } | null = null;
let wmGridEl: HTMLElement | null = null;
let wmObserver: IntersectionObserver | null = null;
// Per-page base bitmap. Rendered ONCE by pdfjs (lazy, on IO entry) and
// reused across every settings change. Key: `${fileId}:${pageNum}`. The
// preview composites this bitmap + a Canvas 2D watermark overlay synchronously
// on every kick - no PDF round-trip per slider tick.
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

function wmKey(entry: WmPageEntry): string { return `${entry.fileId}:${entry.pageNum}`; }
function fileIdFromWmKey(key: string): number { return Number(key.slice(0, key.indexOf(':'))); }
function wmIsSelected(idx: number): boolean {
  const entry = wmFlatPages[idx];
  return !!entry && wmSelected.has(wmKey(entry));
}
function wmSelectIdx(idx: number): void {
  const entry = wmFlatPages[idx];
  if (entry) wmSelected.add(wmKey(entry));
}
function wmDeselectIdx(idx: number): void {
  const entry = wmFlatPages[idx];
  if (entry) wmSelected.delete(wmKey(entry));
}
function wmSelectedSize(): number {
  let n = 0;
  for (const e of wmFlatPages) if (wmSelected.has(wmKey(e))) n++;
  return n;
}
function wmAllKeys(): Set<string> {
  return new Set(wmFlatPages.map(wmKey));
}

/** Page numbers (1-indexed) of `sf` that the user has selected. */
function wmEffectivePagesFor(sf: SourceFile): number[] {
  const set = new Set<number>();
  for (let p = 1; p <= sf.pageCount; p++) {
    if (wmSelected.has(`${sf.id}:${p}`)) set.add(p);
  }
  return [...set].sort((a, b) => a - b);
}

/** Range string view of selection over flat-page positions (1-indexed). */
function wmSelectedToRangeString(): string {
  const indices = new Set<number>();
  wmFlatPages.forEach((_, i) => { if (wmIsSelected(i)) indices.add(i); });
  return setToRangeString(indices, wmFlatPages.length);
}

/**
 * Parse a flat-index range string like "1-5, 8" into a Set of `${fileId}:${pageNum}`
 * keys, looking up each 1-indexed flat position in the current `wmFlatPages`.
 * Returns null if the syntax is invalid.
 */
function wmParseRangeToSelection(text: string): Set<string> | null {
  const oneIndexed = parsePageRange(text, wmFlatPages.length);
  if (!oneIndexed) return null;
  const keys = new Set<string>();
  for (const n of oneIndexed) {
    const entry = wmFlatPages[n - 1];
    if (entry) keys.add(wmKey(entry));
  }
  return keys;
}

/**
 * Reconcile `wmSelected` against the current `files` array:
 * - drop keys for removed files
 * - auto-include all keys for newly-added files (Default-selected on add)
 * - keys for surviving files pass through untouched
 *
 * Idempotent: safe to call multiple times. Driven off `knownFileIds` so the
 * delta is exact - adding a file in any tab triggers the auto-include exactly
 * once, on the first call after that file appeared.
 */
function applyWmFileDelta(addedFiles: SourceFile[], removedFileIds: Set<number>): void {
  for (const key of wmSelected) {
    if (removedFileIds.has(fileIdFromWmKey(key))) wmSelected.delete(key);
  }
  for (const f of addedFiles) {
    for (let p = 1; p <= f.pageCount; p++) wmSelected.add(`${f.id}:${p}`);
  }
}

function wmSyncWithFiles(): void {
  const fileIds = new Set(files.map(f => f.id));
  const removedFileIds = new Set([...knownFileIds].filter(id => !fileIds.has(id)));
  const addedFiles = files.filter(f => !knownFileIds.has(f.id));
  applyWmFileDelta(addedFiles, removedFileIds);
  knownFileIds = fileIds;
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
  // Catch up on any file mutations that bypassed onFilesMutated (e.g. organize
  // tab's add path appends pages directly without routing here). Idempotent:
  // a no-op if onFilesMutated already ran.
  wmSyncWithFiles();
  wmRebuildFlatPages();
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
  return wmSettings.text.trim().length > 0 && wmSelectedSize() > 0;
}

function wmDownloadDisabled(): { disabled: boolean; reason?: string } {
  if (files.length === 0) return { disabled: true, reason: 'Add a PDF first' };
  // Invalid chars only block when we'd actually render text - empty text or
  // empty selection both fall through to source-PDF passthrough.
  if (wmWillStamp() && wmTextHasInvalidChars()) {
    return { disabled: true, reason: "Some characters can't be rendered. Try basic Latin text." };
  }
  return { disabled: false };
}

function handleWmTextInput(ti: HTMLInputElement) {
  wmSettings.text = ti.value;
  markDirty('manifest');
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

  document.querySelectorAll<HTMLElement>('.ws-wm-text-error').forEach(e => {
    if (e.textContent !== next) e.textContent = next;

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
  // Pure render kicker - markDirty is the responsibility of the call sites
  // that mutate wmSettings or wmSelected. Marking here would queue an IDB
  // write on every animation frame during slider drags.
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
  // (mixed PDF sizes), so anchors aren't fully frame-constant - but they're
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

  const wmApplicable = !!frame && wmIsSelected(idx);
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

  const enter = shouldEnter('watermark-full') ? ' ws-content-enter' : '';
  const leftCard = el('div', { className: 'card-base ws-grid-card ws-wm-preview-card' + enter });
  const rightCard = el('div', { className: 'card-base ws-sidebar-card ws-wm-panel-card' + enter });

  // ---- Left: 2-col page grid (Organize-style, capped at 2 cols) ----
  const grid = el('div', { className: 'ws-wm-page-grid' });
  wmFlatPages.forEach((_entry, idx) => {
    const card = el('div', {
      className: 'ws-page-card ws-wm-page-card',
      dataset: { wmFlatIdx: String(idx) },
      role: 'button',
      ariaPressed: String(wmIsSelected(idx)),
      ariaLabel: `Page ${wmBadgeText(idx)}`,
    });
    card.tabIndex = 0;
    if (wmIsSelected(idx)) card.classList.add('ws-page-selected');
    card.addEventListener('contextmenu', (e) => e.preventDefault());
    card.addEventListener('click', (e) => {
      wmToggleSelection(idx, (e as MouseEvent).shiftKey);
    });
    card.addEventListener('keydown', (e) => {
      if (e.key !== ' ' && e.key !== 'Enter') return;
      e.preventDefault();
      wmToggleSelection(idx, e.shiftKey);
    });
    const watermarkedTag = el('span', { className: 'ws-wm-watermarked-tag floating-card-surface', textContent: 'Watermarked', ariaHidden: 'true' });
    card.appendChild(watermarkedTag);
    const thumbWrap = el('div', { className: 'ws-page-thumb-wrap' });
    const thumb = el('div', { className: 'ws-page-thumb ws-skeleton' });
    thumbWrap.appendChild(thumb);
    card.appendChild(thumbWrap);
    card.appendChild(el('span', { className: 'ws-page-badge floating-card-surface', textContent: wmBadgeText(idx), ariaHidden: 'true' }));
    grid.appendChild(card);
  });

  // Trailing "Drop more PDFs" dropzone card, same affordance as Merge / Organize.
  const addCard = createDropzone('Drop more PDFs', true);
  addCard.classList.add('ws-page-card', 'ws-wm-page-card');
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
  const actionBtn = el('button', { className: 'btn-primary toolbar-primary ws-toolbar-action ws-wm-download-btn', textContent: wmDownloadLabel() });
  actionBtn.addEventListener('click', handleWatermarkExport);
  actionRow.appendChild(actionBtn);
  actionRow.appendChild(iconBtn);
  toolbar.appendChild(actionRow);
  document.body.appendChild(toolbar);

  const tray = el('div', { className: 'ws-tray' });
  const scroll = el('div', { className: 'ws-tray-scroll' });
  tray.appendChild(scroll);
  watermarkMobileTray = tray;
  buildWatermarkPanel(scroll, { tray: true });
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
    const sel = wmIsSelected(idx);
    card.classList.toggle('ws-page-selected', sel);
    card.setAttribute('aria-pressed', String(sel));
  });
}

/** Toggle / shift-range select and propagate to inputs + render. */
function wmToggleSelection(idx: number, shift: boolean) {
  if (shift && wmLastClicked >= 0) {
    const lo = Math.min(idx, wmLastClicked);
    const hi = Math.max(idx, wmLastClicked);
    for (let i = lo; i <= hi; i++) wmSelectIdx(i);
  } else {
    if (wmIsSelected(idx)) wmDeselectIdx(idx);
    else wmSelectIdx(idx);
  }
  wmLastClicked = idx;
  wmUpdateSelectionVisuals();
  wmSyncRangeInputs();
  rebuildWatermarkPanelDownloadState();
  wmKickVisible();
  markDirty('manifest');
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
    ? `${files.length} file${files.length !== 1 ? 's' : ''} · ${totalAcrossFiles} page${totalAcrossFiles !== 1 ? 's' : ''}`
    : `${totalAcrossFiles} page${totalAcrossFiles !== 1 ? 's' : ''}`;
  const countRow = el('div', { className: 'ws-sidebar-count-row' });
  countRow.appendChild(el('p', { className: 'ws-sidebar-count', textContent: countText }));
  countRow.appendChild(makeFileBulkActions());
  panel.appendChild(countRow);

  const fileList = el('div', { className: 'ws-sidebar-files' });
  files.forEach((f, idx) => {
    fileList.appendChild(makeSidebarFileRow(f, {
      letter: isMulti ? String.fromCharCode(65 + (idx % 26)) : undefined,
      meta: isMulti ? `${f.pageCount} page${f.pageCount !== 1 ? 's' : ''} · ${formatBytes(f.size)}` : undefined,
      onRemove: () => {
        files = files.filter(x => x.id !== f.id);
        onFilesMutated();
        withTrayPreserved(renderActiveTool);
      },
    }));
  });
  panel.appendChild(fileList);
  panel.appendChild(makeAddFileRow());
  panel.appendChild(makeSidebarDivider());

  // ---- BLOCK 2: Pages, scope: which pages get the watermark ----
  // Above the settings, so Watermark reads files -> scope -> what to stamp,
  // the same shape as Organize and Extract. It used to come last, which put
  // the range input and its Select all / Deselect all below five controls on a
  // phone - off-screen exactly when the user is choosing which pages to mark.
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
      markDirty('manifest');
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
    markDirty('manifest');
  });
  panel.appendChild(ri);

  const btnRow = el('div', { className: 'ws-sidebar-btn-row' });
  const selectAllBtn = el('button', { className: 'ws-btn ws-btn-small', textContent: 'Select all' });
  selectAllBtn.addEventListener('click', () => {
    wmSelected = wmAllKeys();
    wmUpdateSelectionVisuals();
    wmSyncRangeInputs();
    rebuildWatermarkPanelDownloadState();
    wmKickVisible();
    markDirty('manifest');
  });
  const deselectBtn = el('button', { className: 'ws-btn ws-btn-small', textContent: 'Deselect all' });
  deselectBtn.addEventListener('click', () => {
    wmSelected.clear();
    wmUpdateSelectionVisuals();
    wmSyncRangeInputs();
    rebuildWatermarkPanelDownloadState();
    wmKickVisible();
    markDirty('manifest');
  });
  btnRow.appendChild(selectAllBtn);
  btnRow.appendChild(deselectBtn);
  panel.appendChild(btnRow);

  panel.appendChild(makeSidebarDivider());

  // ---- BLOCK 3: Watermark (config), what to stamp ----
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
  // panel compact. Mobile tray always shows them expanded - the tray is
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
    onChange: v => { wmSettings.fontSize = v; markDirty('manifest'); wmKickVisible(); },
  }));

  styleBody.appendChild(makeWmColorRow(wmSettings.colorHex, hex => {
    wmSettings.colorHex = hex;
    markDirty('manifest');
    wmKickVisible();
  }, colorLblId));

  styleBody.appendChild(makeWmSlider({
    label: 'Opacity',
    min: 0, max: 100, step: 1, value: Math.round(wmSettings.opacity * 100),
    unit: '%',
    onChange: v => { wmSettings.opacity = Math.max(0, Math.min(1, v / 100)); markDirty('manifest'); wmKickVisible(); },
  }));

  styleBody.appendChild(makeWmSlider({
    label: 'Rotation',
    min: -90, max: 90, step: 1, value: wmSettings.rotation,
    unit: '°',
    onChange: v => { wmSettings.rotation = v; markDirty('manifest'); wmKickVisible(); },
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
    markDirty('manifest');
    wmKickVisible();
  });
  repeatRow.appendChild(repeatChk);
  repeatRow.appendChild(el('span', { textContent: 'Repeat across page' }));
  styleBody.appendChild(repeatRow);

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
  return 'Export PDF';
}

function rebuildWatermarkPanelDownloadState() {
  const state = wmDownloadDisabled();
  const label = wmDownloadLabel();
  const statusText = state.disabled ? (state.reason ?? '') : '';
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
    // Keep aria-label here - `${label} value` distinguishes the numeric
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
  // to the visible "Color" label - AT announces "Color, group" on entry.
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
    title: (() => { const n = files.reduce((s, f) => s + f.pageCount, 0); return `Export ${n} page${n !== 1 ? 's' : ''} as`; })(),
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
  // Outside the closure so a cancellation cannot take the finished ones with it.
  const results: { bytes: Uint8Array; name: string }[] = [];
  const zipName = `watermarked-pdfs-${timestampForFilename()}.zip`;

  await runWithPopup(
    verb,
    'Stamping your pages. This only takes a moment.',
    'Watermark failed. Try simpler text or fewer pages.',
    async (signal) => {
      for (const t of tasks) {
        const r = await watermark(t.file.bytes, t.file.name, t.opts, signal);
        results.push({ bytes: r.bytes, name: r.name });
      }
      await setPdfResult(results, isBatch ? zipName : null);
      return results;
    },
    (out) => {
      if (isBatch) {
        showPdfSuccessModal(
          `${out.length} PDFs watermarked! \u{1F389}`,
          `Your <b>${out.length}</b> watermarked PDFs are zipped up and ready to download.`,
        );
      } else {
        showPdfSuccessModal(
          'PDF watermarked! \u{1F389}',
          `<b>${escapeHTML(shortenFileName(out[0].name, 32))}</b> is ready to download.`,
        );
      }
    },
    1200,
    () => offerPartialPdfResult(results, zipName),
  );
}

/** Empty-text per-source path: emit each source file unchanged. */
async function doWatermarkPassthroughPerSource() {
  if (files.length === 0) return;
  const isBatch = files.length > 1;
  const verb = isBatch ? `Saving ${files.length} PDFs` : 'Saving';
  await runWithPopup(
    verb,
    'Empty watermark - saving the source PDFs unchanged.',
    'Save failed.',
    async () => {
      const results = files.map(f => ({ bytes: f.bytes, name: f.name }));
      await setPdfResult(results, isBatch ? `pdfs-${timestampForFilename()}.zip` : null);
      return results;
    },
    (results) => {
      if (isBatch) {
        showPdfSuccessModal(
          `${results.length} PDFs saved! \u{1F389}`,
          `Your <b>${results.length}</b> source PDFs are zipped up and ready to download.`,
        );
      } else {
        showPdfSuccessModal(
          'PDF saved! \u{1F389}',
          `<b>${escapeHTML(shortenFileName(results[0].name, 32))}</b> is ready to download.`,
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
    'Empty watermark - merging your files unchanged.',
    'Save failed.',
    async (signal) => {
      const merged = await merge(files, signal);
      return await setPdfResult([{ bytes: merged.bytes, name: merged.name }], null);
    },
    (results) => {
      showPdfSuccessModal(
        'PDF saved! \u{1F389}',
        `<b>${escapeHTML(shortenFileName(results[0].name, 32))}</b> is ready to download.`,
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
    async (signal) => {
      const merged = await merge(files, signal);

      // Derive 1-indexed page numbers in merge order: walk files, accumulate
      // per-file offsets, emit (offset + pageNum) for every selected key.
      const pageNums: number[] = [];
      let offset = 0;
      for (const f of files) {
        for (let p = 1; p <= f.pageCount; p++) {
          if (wmSelected.has(`${f.id}:${p}`)) pageNums.push(offset + p);
        }
        offset += f.pageCount;
      }

      const r = await watermark(merged.bytes, files[0].name, {
        source: { type: 'text', text: wmSettings.text, fontSize: wmSettings.fontSize, color },
        opacity: wmSettings.opacity,
        rotationDegrees: wmSettings.rotation,
        repeat: wmSettings.repeat,
        pageNums,
      }, signal);
      return await setPdfResult([{ bytes: r.bytes, name: r.name }], null);
    },
    (results) => {
      showPdfSuccessModal(
        'PDF watermarked! \u{1F389}',
        `<b>${escapeHTML(shortenFileName(results[0].name, 32))}</b> is ready to download.`,
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
        pages.push({ type: 'source', sourceFileId: sf.id, sourcePageNum: p, thumbnail: null, rotation: 0, originalPos: ++pos, pageId: getNextPageId() });
    selected.clear();
    lastClickedIdx = -1;
    organizeInitialized = true;
    // Bring knownFileIds in sync so the next onFilesMutated computes a
    // correct delta (no spurious "all files added" replay).
    knownFileIds = new Set(files.map(f => f.id));
  }

  if (pages.length === 0) {
    renderEmptyState('Drop PDFs to organize', true);
    return;
  }

  toolContent.classList.add('ws-extract-layout');

  const enter = shouldEnter('organize-full') ? ' ws-content-enter' : '';

  // Left card: page grid
  const leftCard = el('div', { className: 'card-base ws-grid-card' + enter });
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
  const trailing = el('button', { className: 'ws-page-insert-trailing', innerHTML: Icons.plus(), ariaLabel: 'Insert blank page at end' });
  trailing.dataset.insertAt = 'end';
  grid.appendChild(trailing);

  // Add more PDFs card. .ws-dropzone (from createDropzone) carries the
  // dashed-filled drop-target visual; .ws-page-card carries the grid-cell
  // shape. The two compose without an extra add-class.
  const addCard = createDropzone('Drop more PDFs', true);
  addCard.classList.add('ws-page-card');
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
    if (target.closest('.ws-page-delete, .ws-page-rotate, .ws-page-insert, .ws-page-insert-trailing, .ws-dropzone, [data-insert-at]')) return;
    const card = target.closest('.ws-page-card') as HTMLElement | null;
    if (!card) return;
    const idx = Number(card.dataset.pageIdx);
    if (isNaN(idx)) return;

    toggleSelection(idx, e.shiftKey, e.ctrlKey || e.metaKey);
  });

  grid.addEventListener('keydown', (e) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    const card = (e.target as HTMLElement).closest('.ws-page-card') as HTMLElement | null;
    if (!card) return;
    e.preventDefault();
    const idx = Number(card.dataset.pageIdx);
    if (isNaN(idx)) return;
    toggleSelection(idx, e.shiftKey, e.ctrlKey || e.metaKey);
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
        // Selection follows pageIds; no remap needed.
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
          pushHistory();
          pages.length = 0;
          pages.push(...reordered);
          // Selection follows pageIds; no remap needed.
        }
      }
      // Full re-render to update badges with new positions
      renderOrganizeView();
    },
  });

  setupThumbnailObserver(leftCard, pages);

  // Right card: sidebar
  const rightCard = el('div', { className: 'card-base ws-sidebar-card' + enter });
  rightCard.id = 'pdf-sidebar';
  updateSidebarContent(rightCard);

  toolContent.appendChild(leftCard);
  toolContent.appendChild(rightCard);

  // Mobile toolbar
  appendMobileToolbar(leftCard);

  if (prevScroll) window.scrollTo(0, prevScroll);
  kickPageThumbs(pages);
}

/**
 * Tear down DOM-side state without losing module state. Use this on app-mode
 * switch out (e.g. from /pdf to /) so re-entering preserves files, page order,
 * selections, and watermark settings. resetAll() is the destructive cousin.
 */
export function cleanup() {
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
  // The lock is derived from `.ws-tray.ws-tray-open` existing, so deleting an
  // open tray without re-deriving it leaves `html.scroll-lock` - and its
  // `overflow-y: hidden` - applied with no sheet on screen and nothing left to
  // dismiss. Re-deriving here makes "the lock follows the tray" true by
  // construction instead of by every caller remembering.
  updateScrollLock();
}

export function resetAll() {
  files = [];
  pages = [];
  selected.clear();
  selectedFiles.clear();
  lastClickedIdx = -1;
  organizeInitialized = false;
  history.length = 0;
  redoStack.length = 0;
  setKeyboardMode(false);
  clearThumbnailCache();
  // Reset watermark state
  wmSettings = { ...WM_DEFAULTS };
  wmFlatPages = [];
  wmDisposeBitmaps();
  wmTextEncodeFont = null;
  if (wmRafId !== null) { cancelAnimationFrame(wmRafId); wmRafId = null; }
  // Drop the saved session so reload doesn't ghost-restore.
  persistor.clear();
  renderActiveTool();
}

function createAddFileButton(): HTMLButtonElement {
  const btn = el('button', { className: 'ws-btn ws-btn-small', textContent: '+ Add' }) as HTMLButtonElement;
  btn.addEventListener('click', () => openPicker(true));
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
  zone.addEventListener('click', () => openPicker(multi));
  zone.addEventListener('keydown', (e) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    openPicker(multi);
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
    if (!dropped.length) { showToast("That's not a PDF. Drop a .pdf to edit it here.", 'warn', 8000); return; }
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
  const card = createDropzoneCard(text, multi);
  if (shouldEnter(`${activeTool}-empty`)) card.classList.add('ws-content-enter');
  toolContent.appendChild(card);
}

// ---------------------------------------------------------------------------
// File handling
// ---------------------------------------------------------------------------

async function handleFiles(rawFiles: File[], replaceExisting = false) {
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

  // Replace all measures its budgets against an empty workspace, since the
  // incoming set is about to become the whole list. Nothing is discarded yet -
  // the swap happens below, only once something has actually been accepted, so
  // a pick of unreadable or oversized PDFs leaves the user's files alone
  // instead of emptying the editor for nothing.
  const replacing = replaceExisting && parsed.length > 0;
  const base = replacing ? [] : files;

  let fileBudget = MAX_FILES - base.length;
  let sizeBudget = MAX_TOTAL_FILE_SIZE;
  let pageBudget = MAX_TOTAL_PAGES;
  for (const f of base) { sizeBudget -= f.size; pageBudget -= f.pageCount; }

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

  if (replacing) {
    files = [];
    lastClickedIdx = -1;
    history.length = 0;
    redoStack.length = 0;
    clearThumbnailCache();
    // `pages`, `selected`, `selectedFiles` and the watermark's flat page list
    // are deliberately left alone: onFilesMutated below diffs against
    // knownFileIds, sees every old id as removed and every new one as added,
    // and prunes them in the one place that already knows how.
  }

  files.push(...accepted);
  markDirty('files');

  // Single delta path: onFilesMutated does the surgical pages append + the
  // watermark/organize/file-selection updates against the prev knownFileIds
  // snapshot. The active-tool branches just handle render + thumb-kick.
  onFilesMutated();
  if (activeTool === 'organize') {
    renderOrganizeView();
    kickPageThumbs(pages);
  } else if (activeTool === 'watermark') {
    renderWatermarkView();
  } else {
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
  if (organizeMobileTray) buildMobileTrayContent(trayScroll(organizeMobileTray));
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
  const countBase = `${files.length} file${files.length !== 1 ? 's' : ''} · ${pages.length} page${pages.length !== 1 ? 's' : ''}`;
  let countHtml = countBase;
  if (modified) {
    countHtml += '<sup>*</sup>';
    if (diff !== 0) countHtml += ` (${diff > 0 ? '+' : ''}${diff})`;
  }
  const countRow = el('div', { className: 'ws-sidebar-count-row' });
  countRow.appendChild(el('p', { className: 'ws-sidebar-count', innerHTML: countHtml }));
  countRow.appendChild(makeFileBulkActions());
  sidebar.appendChild(countRow);

  const fileList = el('div', { className: 'ws-sidebar-files' });
  const uniqueFileIds = [...new Set(pages.filter(p => p.type !== 'blank').map(p => p.sourceFileId))];
  for (const fid of uniqueFileIds) {
    const sf = files.find(f => f.id === fid);
    if (!sf) continue;
    const isMulti = uniqueFileIds.length > 1;
    fileList.appendChild(makeSidebarFileRow(sf, {
      letter: isMulti ? String.fromCharCode(65 + (uniqueFileIds.indexOf(fid) % 26)) : undefined,
      meta: isMulti ? `${sf.pageCount} page${sf.pageCount !== 1 ? 's' : ''} · ${formatBytes(sf.size)}` : undefined,
      onRemove: () => removeFile(fid),
    }));
  }
  sidebar.appendChild(fileList);
  // Restore rides with + Add rather than staying in the count row: that row now
  // carries Replace all / Clear, and a third small button there wraps every
  // label onto two lines at the sidebar's real width.
  sidebar.appendChild(makeAddFileRow({ restore: modified }));

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
    if (!text) {
      ri.classList.remove('ws-input-error');
      selected.clear();
      updateSelectionVisuals();
      updateSidebar();
      markDirty('manifest');
      return;
    }
    const parsed = parseSelectionRange(text);
    if (!parsed) { ri.classList.add('ws-input-error'); return; }
    ri.classList.remove('ws-input-error');
    selected = parsed;
    updateSelectionVisuals();
    updateSidebar();
    markDirty('manifest');
  });
  rangeInput = ri;
  sidebar.appendChild(ri);

  const btnRow = el('div', { className: 'ws-sidebar-btn-row' });
  const selectAllBtn = el('button', { className: 'ws-btn ws-btn-small', textContent: 'Select all' });
  selectAllBtn.addEventListener('click', () => {
    selected = new Set(pages.map(p => p.pageId));
    updateSelectionVisuals();
    updateSidebar();
    syncRangeInput();
    markDirty('manifest');
  });
  const deselectBtn = el('button', { className: 'ws-btn ws-btn-small', textContent: 'Deselect all' });
  deselectBtn.addEventListener('click', () => {
    selected.clear();
    updateSelectionVisuals();
    updateSidebar();
    syncRangeInput();
    markDirty('manifest');
  });
  btnRow.appendChild(selectAllBtn);
  btnRow.appendChild(deselectBtn);
  sidebar.appendChild(btnRow);

  const bottom = el('div', { className: 'ws-sidebar-bottom' });

  if (selected.size > 0) {
    const moveRow = el('div', { className: 'ws-sidebar-move-row' });
    const sorted = [...selected].sort((a, b) => a - b);
    const atTop = sorted[0] === 0;
    const atBottom = sorted[sorted.length - 1] === pages.length - 1;
    const upBtn = el('button', { className: 'ws-btn ws-btn-small ws-move-btn', innerHTML: `${Icons.arrowUp()} Move up` });
    upBtn.dataset.dir = 'up';
    if (atTop) { upBtn.classList.add('disabled'); upBtn.setAttribute('aria-disabled', 'true'); }
    upBtn.addEventListener('click', () => {
      if (!moveSelection('up')) return;
      renderOrganizeView();
      document.querySelector<HTMLElement>('#pdf-sidebar .ws-move-btn[data-dir="up"]')?.focus();
    });
    const downBtn = el('button', { className: 'ws-btn ws-btn-small ws-move-btn', innerHTML: `Move down ${Icons.arrowDown()}` });
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
  files = files.filter(f => f.id !== fid);
  lastClickedIdx = -1;
  // onFilesMutated drops the removed file's pages from `pages`, prunes
  // pageIds from `selected`, updates merge/watermark state in lockstep.
  onFilesMutated();
  if (files.length === 0) clearThumbnailCache();
  if (pages.length === 0) organizeInitialized = false;
  withTrayPreserved(renderActiveTool);
  if (activeTool === 'organize' && pages.length > 0) kickPageThumbs(pages);
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

// `selected` stores pageIds (semantic). Helpers translate between idx and
// pageId so the rest of the code keeps thinking in flat positions.
function isOrgSelected(idx: number): boolean {
  return idx >= 0 && idx < pages.length && selected.has(pages[idx].pageId);
}
function selectOrgIdx(idx: number): void {
  if (idx >= 0 && idx < pages.length) selected.add(pages[idx].pageId);
}
function deselectOrgIdx(idx: number): void {
  if (idx >= 0 && idx < pages.length) selected.delete(pages[idx].pageId);
}
function selectedOrgIndices(): number[] {
  const idxs: number[] = [];
  pages.forEach((p, i) => { if (selected.has(p.pageId)) idxs.push(i); });
  return idxs;
}

function toggleSelection(idx: number, shift: boolean, ctrl = false) {
  // Ctrl/Cmd+Click is an explicit non-contiguous toggle and overrides Shift -
  // matches the Windows/macOS multi-select convention so power users can
  // pick or unpick a single page without disturbing the rest of a Shift range.
  if (shift && !ctrl && selected.size > 0) {
    const idxs = selectedOrgIndices();
    let lo = idx, hi = idx;
    for (const i of idxs) { if (i < lo) lo = i; if (i > hi) hi = i; }
    for (let i = lo; i <= hi; i++) selectOrgIdx(i);
  } else {
    if (isOrgSelected(idx)) deselectOrgIdx(idx);
    else selectOrgIdx(idx);
  }
  lastClickedIdx = idx;
  updateSelectionVisuals();
  updateSidebar();
  syncRangeInput();
  markDirty('manifest');
}

function updateSelectionVisuals() {
  // Pure DOM sync from `selected` - mutation sites (toggleSelection, Escape
  // clear, range-input parse, select/deselect-all) own markDirty.
  if (!gridEl) return;
  const idxs = selectedOrgIndices();
  const firstSelIdx = idxs[0] ?? -1;
  const lastSelIdx = idxs[idxs.length - 1] ?? -1;
  gridEl.querySelectorAll<HTMLElement>('.ws-page-card').forEach((card) => {
    const i = Number(card.dataset.pageIdx);
    const sel = isOrgSelected(i);
    card.classList.toggle('ws-page-selected', sel);
    card.classList.toggle('ws-first-selected', i === firstSelIdx);
    card.classList.toggle('ws-last-selected', i === lastSelIdx);
    card.setAttribute('aria-pressed', String(sel));
  });
}

function updateMergeSelectionVisuals() {
  // Pure DOM sync from `selectedFiles` - mutation sites own markDirty.
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
    title: `Export ${realPageCount} page${realPageCount !== 1 ? 's' : ''} as`,
    combinedLabel: 'Combined PDF',
    splitLabel: 'One PDF per source file',
    primary: 'combined',
    splitDisabled: splitState.allowed ? undefined : { reason: splitState.reason },
    onCombined: () => void doOrganizeSaveCombined(),
    onSplit: () => void doOrganizeSavePerSource(),
  });
}

async function doOrganizeSaveCombined() {
  await runWithPopup('Saving', 'Packing up your PDF with the latest page order. Hold tight.', 'Save failed. Try with fewer pages or a smaller file.', async (signal) => {
    const r = await organize(files, pages, signal);
    await setPdfResult([{ bytes: r.bytes, name: r.name }], null);
    return r;
  }, (r) => {
    showPdfSuccessModal(
      'PDF saved! \u{1F389}',
      `<b>${escapeHTML(shortenFileName(r.name, 32))}</b> is ready to download.`,
    );
  });
}

async function doOrganizeSavePerSource() {
  // Outside the closure: a cancellation throws straight past anything declared
  // inside it, taking the finished documents with it.
  const out: { bytes: Uint8Array; name: string }[] = [];
  const zipName = `organized-pdfs-${timestampForFilename()}.zip`;
  await runWithPopup('Saving', 'Packing each source file separately. Hold tight.', 'Save failed. Try with fewer pages or a smaller file.', async (signal) => {
    for (const sf of files) {
      const filtered = pages.filter(p => p.type === 'source' && p.sourceFileId === sf.id);
      if (filtered.length === 0) continue;
      const r = await organize([sf], filtered, signal);
      out.push({ bytes: r.bytes, name: r.name });
    }
    await setPdfResult(out, out.length > 1 ? zipName : null);
    return out;
  }, (results) => {
    if (results.length > 1) {
      showPdfSuccessModal(
        `${results.length} PDFs saved! \u{1F389}`,
        `Your <b>${results.length}</b> PDFs are zipped up and ready to download.`,
      );
    } else if (results.length === 1) {
      showPdfSuccessModal(
        'PDF saved! \u{1F389}',
        `<b>${escapeHTML(shortenFileName(results[0].name, 32))}</b> is ready to download.`,
      );
    }
  }, 1200, () => offerPartialPdfResult(out, zipName));
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

  const closeBtn = el('button', { className: 'close-btn close-btn-lg modal-close-btn', innerHTML: Icons.x(), ariaLabel: 'Close' });
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

  const closeBtn = el('button', { className: 'close-btn close-btn-lg modal-close-btn', innerHTML: Icons.x(), ariaLabel: 'Close' });
  closeBtn.addEventListener('click', () => hidePopup());
  wrap.appendChild(closeBtn);

  wrap.appendChild(el('p', { className: 'ws-sidebar-count', textContent: `Extract ${count} page${count !== 1 ? 's' : ''} as` }));

  const combBtn = el('button', { className: 'btn-primary ws-action-btn ws-action-full', textContent: 'Combined PDF' });
  combBtn.addEventListener('click', () => { hidePopup(); doExtract(indices, true); });
  wrap.appendChild(combBtn);

  const sepBtn = el('button', { className: 'ws-btn ws-action-btn ws-action-full', textContent: 'One file per page' });
  sepBtn.addEventListener('click', () => { hidePopup(); doExtract(indices, false); });
  wrap.appendChild(sepBtn);

  showPopup(wrap, false, () => hidePopup());
}

// See src/tools/cancellation.ts - the groupAsOne branch below builds its
// output PDF inline rather than delegating to extract(), so it checkpoints
// directly at the same cadence extract()'s own loop uses.
const EXTRACT_CHECKPOINT_INTERVAL = 10;

async function doExtract(indices: number[], groupAsOne: boolean) {
  if (files.length === 0 || indices.length === 0) return;
  const extractCount = indices.length;
  const sorted = [...indices].sort((a, b) => a - b);
  // Only the per-source branch below builds its output incrementally; the
  // combined branch produces one document and has no partial state to keep.
  const allResults: { name: string; bytes: Uint8Array }[] = [];
  const zipName = `extracted-pages-${timestampForFilename()}.zip`;
  await runWithPopup('Extracting', 'Pulling the selected pages into a new file. Almost there.', 'Extract failed. The PDF might be damaged. Try re-exporting it from the source app.',
    async (signal) => {
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
        for (let i = 0; i < sorted.length; i++) {
          if (i % EXTRACT_CHECKPOINT_INTERVAL === 0) await checkpoint(signal);
          const page = pages[sorted[i]];
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
        return await setPdfResult([{ bytes: outputBytes, name }], null);
      } else {
        for (const [fid, pageNums] of byFile) {
          const sf = files.find(f => f.id === fid)!;
          const baseName = sf.name.replace(/\.pdf$/i, '');
          const results = await extract(sf.bytes, pageNums, baseName, false, signal);
          allResults.push(...results);
        }
        await setPdfResult(allResults, allResults.length > 1 ? zipName : null);
        return allResults;
      }
    },
    () => {
      const pageWord = extractCount === 1 ? 'page' : 'pages';
      showPdfSuccessModal(
        'Pages extracted! \u{1F389}',
        `${extractCount} ${pageWord} extracted, ready to download.`,
      );
    },
    1000,
    () => offerPartialPdfResult(allResults, zipName),
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
  pages = pages.filter(p => !selected.has(p.pageId));
  const remainingFileIds = new Set(pages.filter(p => p.type === 'source').map(p => p.sourceFileId));
  files = files.filter(f => remainingFileIds.has(f.id));
  selected.clear();
  lastClickedIdx = -1;
  if (pages.length === 0) {
    files = [];
    clearThumbnailCache();
  }
  // onFilesMutated reconciles knownFileIds / watermark / merge state against
  // the freshly-trimmed `files` (surgical pages update is a no-op since the
  // removed pages are already gone, but it keeps wmSelected and knownFileIds
  // in lockstep).
  onFilesMutated();
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
      pageId: getNextPageId(),
    };
    // Selection follows pageIds, so an insertion at any index leaves all
    // existing selections valid. Only the shift-click anchor needs adjusting.
    if (lastClickedIdx >= atIdx) lastClickedIdx++;

    pages.splice(atIdx, 0, blank);
    renderOrganizeView();
    kickPageThumbs(pages);
  });
}

function createInsertBtn(atIdx: number): HTMLElement {
  const btn = el('button', { className: 'ws-page-insert', innerHTML: Icons.plus(), ariaLabel: 'Insert blank page' });
  btn.dataset.insertAt = String(atIdx);
  return btn;
}

// ---------------------------------------------------------------------------
// Mobile toolbar + tray
// ---------------------------------------------------------------------------

const MORE_SVG  = Icons.moreVertical(18);
const COLLAPSE_SVG = Icons.chevronDown(18);

/**
 * Set while a tool re-render is replacing a tray the user had open, so the
 * rebuilt one comes back open. See `withTrayPreserved`.
 */
let restoreTrayOpen = false;
/**
 * Set by `wireTrayToggle` when it builds a replacement for a tray that was
 * open. Deferred rather than opened on the spot because the tray is wired
 * before it is appended to the body, and focusing a detached node does
 * nothing - which is how the reopened sheet ended up open but with focus
 * still stranded on `<body>`.
 */
let pendingTrayOpen: (() => void) | null = null;

/**
 * Read and clear `pendingTrayOpen` in one step.
 *
 * Also the only way to read it without fighting the compiler: assigning `null`
 * to a module-level `let` narrows it to `null` for the rest of the block, and
 * the intervening `rerender()` - which is what actually sets it, several
 * frames deep - does not widen that back. Reading it from a function whose
 * body never assigns before the read keeps the declared union.
 */
function takePendingTrayOpen(): (() => void) | null {
  const fn = pendingTrayOpen;
  pendingTrayOpen = null;
  return fn;
}

/**
 * Run a re-render that destroys and rebuilds the mobile tray, and put the user
 * back where they were.
 *
 * `cleanup()` deletes the body-appended toolbar, tray and overlay, so anything
 * routed through `renderActiveTool()` closes the sheet. That is right when the
 * user is switching tools and wrong when they are editing the list inside it:
 * removing three files on Organize or Watermark meant reopening the tray three
 * times, and the page jumped to the top on the way. Merge never had the
 * problem because it repaints its sidebar in place.
 */
function withTrayPreserved(rerender: () => void): void {
  const openTray = document.querySelector<HTMLElement>('.ws-tray.ws-tray-open');
  const scrollTop = openTray ? trayScroll(openTray).scrollTop : 0;
  const pageScroll = window.scrollY;
  restoreTrayOpen = !!openTray;
  takePendingTrayOpen();
  try {
    rerender();
  } finally {
    restoreTrayOpen = false;
  }
  const reopen = takePendingTrayOpen();
  if (!reopen) return;

  // Open first, then restore the offsets: opening moves focus, and focusing a
  // control at the top of the sheet would otherwise scroll the tray back up.
  reopen();
  const rebuilt = document.querySelector<HTMLElement>('.ws-tray');
  if (rebuilt) trayScroll(rebuilt).scrollTop = scrollTop;
  // Removing files shortens the grid, which can clamp the page scroll to 0
  // behind the sheet. Restore it so dismissing the tray does not reveal a
  // different part of the document than the one it was opened over.
  window.scrollTo({ top: pageScroll });
}

function wireTrayToggle(tray: HTMLElement, overlay: HTMLElement, iconBtn: HTMLElement) {
  // Tray is a non-modal dialog: gives it semantics + ESC + focus return.
  // We do NOT set aria-modal=true because we don't trap focus - claiming
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
        // `cleanup()` deletes the tray without going through setOpen, so this
        // listener outlives the sheet it belongs to. Left unguarded it would
        // accumulate one stale Escape handler per rebuild - and now that a
        // removal rebuilds an *open* tray, that is once per file removed - each
        // one still calling setOpen(false) on a detached node. Unregister on
        // the first keystroke after the tray is gone.
        if (!tray.isConnected) {
          document.removeEventListener('keydown', onKeyDown!);
          onKeyDown = null;
          return;
        }
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

  // This tray replaces one the user had open, so it opens with it - handed
  // back to `withTrayPreserved` to run once the tray is in the document. Going
  // through setOpen rather than the class alone keeps the icon, aria-expanded,
  // the Escape handler, the scroll lock and focus in step; focus lands on the
  // first control in the sheet instead of on <body>, where the destroyed × row
  // used to strand it.
  if (restoreTrayOpen) pendingTrayOpen = () => setOpen(true);
}

function appendMobileToolbar(_gridCard: HTMLElement) {
  const toolbar = el('div', { className: 'ws-toolbar ws-toolbar--organize' });

  // Top row: Extract n pages + triple-dot
  const topRow = el('div', { className: 'ws-toolbar-row' });

  const mobileExtract = el('button', { className: 'btn-secondary toolbar-primary ws-toolbar-extract', textContent: extractBtnText(selected.size) });
  mobileExtract.addEventListener('click', handleExtractClick);
  mobileExtractBtn = mobileExtract;

  const iconBtn = el('button', { className: 'icon-btn ws-toolbar-icon', ariaLabel: 'More options' });
  iconBtn.innerHTML = MORE_SVG;

  topRow.appendChild(mobileExtract);
  topRow.appendChild(iconBtn);
  toolbar.appendChild(topRow);

  // Export PDF (full width, primary)
  const actionBtn = el('button', { className: 'btn-primary toolbar-primary ws-toolbar-export', textContent: 'Export PDF' });
  actionBtn.addEventListener('click', handleSave);
  toolbar.appendChild(actionBtn);
  document.body.appendChild(toolbar);
  mobileActionBtn = actionBtn;

  // Tray
  const tray = el('div', { className: 'ws-tray' });
  const scroll = el('div', { className: 'ws-tray-scroll' });
  tray.appendChild(scroll);
  organizeMobileTray = tray;
  buildMobileTrayContent(scroll);
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
  const countBase = `${files.length} file${files.length !== 1 ? 's' : ''} · ${pages.length} page${pages.length !== 1 ? 's' : ''}`;
  let countHtml = countBase;
  if (modified) {
    countHtml += '<sup>*</sup>';
    if (diff !== 0) countHtml += ` (${diff > 0 ? '+' : ''}${diff})`;
  }
  const countRow = el('div', { className: 'ws-sidebar-count-row' });
  countRow.appendChild(el('p', { className: 'ws-sidebar-count', innerHTML: countHtml }));
  countRow.appendChild(makeFileBulkActions());
  tray.appendChild(countRow);

  const fileList = el('div', { className: 'ws-sidebar-files' });
  const uniqueFileIds = [...new Set(pages.filter(p => p.type !== 'blank').map(p => p.sourceFileId))];
  for (const fid of uniqueFileIds) {
    const sf = files.find(f => f.id === fid);
    if (!sf) continue;
    const isMulti = uniqueFileIds.length > 1;
    fileList.appendChild(makeSidebarFileRow(sf, {
      letter: isMulti ? String.fromCharCode(65 + (uniqueFileIds.indexOf(fid) % 26)) : undefined,
      meta: isMulti ? `${sf.pageCount} page${sf.pageCount !== 1 ? 's' : ''} · ${formatBytes(sf.size)}` : undefined,
      onRemove: () => removeFile(fid),
    }));
  }
  tray.appendChild(fileList);
  tray.appendChild(makeAddFileRow({ restore: modified }));

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
  selAll.addEventListener('click', () => { selected = new Set(pages.map(p => p.pageId)); updateSelectionVisuals(); updateSidebar(); syncRangeInput(); });
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
      innerHTML: `${Icons.arrowUp()} Move up`,
      ariaLabel: 'Move selected pages up',
    });
    if (atTop) { upBtn.classList.add('disabled'); upBtn.setAttribute('aria-disabled', 'true'); }
    upBtn.addEventListener('click', () => {
      if (!moveSelection('up')) return;
      renderOrganizeView();
    });
    const downBtn = el('button', {
      className: 'ws-btn ws-move-btn',
      innerHTML: `Move down ${Icons.arrowDown()}`,
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
  card.setAttribute('aria-pressed', isOrgSelected(idx) ? 'true' : 'false');
  card.setAttribute('aria-label', page.type === 'blank' ? `Blank page ${idx + 1}` : `Page ${idx + 1} of ${pages.length}`);
  card.addEventListener('contextmenu', (e) => e.preventDefault());

  const isBlank = page.type === 'blank';
  const thumb = el('div', { className: `ws-page-thumb${page.thumbnail || isBlank ? '' : ' ws-skeleton'}` });
  const imgSrc = isBlank ? mockBlankPageThumb() : page.thumbnail;
  if (imgSrc) {
    setThumb(thumb, imgSrc, {
      alt: isBlank ? 'Blank page' : `Page ${page.sourcePageNum}`,
      rotation: page.rotation,
    });
  }
  card.appendChild(thumb);

  const checkBadge = el('span', { className: 'ws-page-check floating-card-surface', innerHTML: Icons.check('0.75rem'), ariaHidden: 'true' });
  card.appendChild(checkBadge);

  const badgeText = getPageBadgeText(page);
  const badge = el('span', { className: 'ws-page-badge floating-card-surface', innerHTML: page.rotation ? `${badgeText} ${Icons.rotateCw()}` : badgeText });
  card.appendChild(badge);

  const plusBefore = el('button', { className: 'ws-page-plus ws-page-plus-before', innerHTML: Icons.plus(), ariaLabel: 'Insert blank page before selection' });
  plusBefore.addEventListener('click', (e) => {
    e.stopPropagation();
    const sorted = [...selected].sort((a, b) => a - b);
    if (sorted.length) insertBlankPage(sorted[0]);
  });
  card.appendChild(plusBefore);

  const plusAfter = el('button', { className: 'ws-page-plus ws-page-plus-after', innerHTML: Icons.plus(), ariaLabel: 'Insert blank page after selection' });
  plusAfter.addEventListener('click', (e) => {
    e.stopPropagation();
    const sorted = [...selected].sort((a, b) => a - b);
    if (sorted.length) insertBlankPage(sorted[sorted.length - 1] + 1);
  });
  card.appendChild(plusAfter);

  const delBtn = el('button', { className: 'icon-btn ws-hover-reveal ws-page-delete floating-card-surface', innerHTML: Icons.x(), ariaLabel: 'Delete' });
  delBtn.addEventListener('click', (e) => { e.stopPropagation(); deletePage(idx); });
  card.appendChild(delBtn);

  let visualAngle = page.rotation || 0;
  const rotBtn = el('button', { className: 'icon-btn ws-hover-reveal ws-page-rotate floating-card-surface', innerHTML: Icons.rotateCw(), ariaLabel: 'Rotate' });
  rotBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    pushHistory();
    page.rotation = ((page.rotation + 90) % 360) as 0 | 90 | 180 | 270;
    visualAngle += 90;
    const img = card.querySelector('.ws-page-thumb img') as HTMLImageElement | null;
    if (img) img.style.transform = `rotate(${visualAngle}deg)`;
    badge.innerHTML = page.rotation ? `${getPageBadgeText(page)} ${Icons.rotateCw()}` : getPageBadgeText(page);
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
  const gen = renderGeneration;
  queueRender(sf.bytes, p[idx].sourcePageNum, (url) => {
    // applyPayload (restore) bumps renderGeneration before swapping `pages`.
    // Drop late callbacks - both writing into a stale array and pasting an
    // old thumbnail into a new card would scramble the grid.
    if (gen !== renderGeneration) return;
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

/**
 * Run a PDF edit (merge/organize/watermark/extract) behind a progress popup.
 * The popup carries a Cancel control and Escape wired to the same
 * AbortController `fn` receives, so a long edit can always be backed out of.
 * A cancellation (`PdfEditCancelled`) is a neutral outcome, not an error - it
 * never reaches `showError`/`appendSupportContact`.
 */
async function runWithPopup<T>(
  verb: string,
  subtext: string,
  fallback: string,
  fn: (signal: AbortSignal) => Promise<T>,
  onSuccess?: (result: T) => void,
  minMs: number = 1200,
  /**
   * Called instead of a silent close when the user cancels, for the jobs that
   * build their output one file at a time. Those loops finish whole documents
   * before they are stopped, and dropping them meant Cancel could only ever be
   * paid for by redoing the files that had already succeeded. The Converter
   * has offered its finished files back since it grew a Stop button; this is
   * the same courtesy. Jobs that produce a single file have no partial state
   * and pass nothing.
   */
  onCancelled?: () => void,
): Promise<void> {
  const controller = new AbortController();
  const wrap = el('div', { className: 'ws-processing' });
  wrap.appendChild(el('h2', { textContent: `${verb}...` }));
  wrap.appendChild(el('div', { className: 'ws-spinner' }));
  wrap.appendChild(el('p', { textContent: subtext }));
  const actions = el('div', { className: 'popup-actions-footer' });
  // "Stop", not "Cancel": this abandons work already running, and the app says
  // stop everywhere else it offers that (see modeCopy in cancellation.ts).
  actions.appendChild(createPopupButton('Stop', 'btn-secondary', () => controller.abort()));
  wrap.appendChild(actions);
  showPopup(wrap, true, () => controller.abort());
  const startTime = performance.now();
  try {
    const result = await fn(controller.signal);
    await ensureMinDuration(startTime, minMs);
    if (onSuccess) onSuccess(result);
    else hidePopup();
  } catch (e: any) {
    if (e instanceof PdfEditCancelled) {
      hidePopup();
      onCancelled?.();
      return;
    }
    console.error(`[pdfWorkspace] ${verb.toLowerCase()} failed:`, e);
    hidePopup();
    const info = toUserErrorInfo(e);
    const message = info.message || fallback;
    showError(appendSupportContact(message, FEEDBACK_CONTACT_TEXT));
  }
}

/**
 * Offer the documents a cancelled job had already finished.
 *
 * Deliberately does not run the optional compression pass. The user pressed
 * Stop; spending seconds of Ghostscript on the way out is the opposite of what
 * was asked, and Original quality is what a cancelled save should hand back.
 *
 * Silent when nothing finished - `runWithPopup` has already closed the popup,
 * and a modal that says "0 files were saved" is worse than the editor simply
 * reappearing with everything intact.
 */
function offerPartialPdfResult(done: { bytes: Uint8Array; name: string }[], zipName: string | null) {
  if (done.length === 0) return;
  lastPdfResult = done;
  lastPdfZipName = done.length > 1 ? zipName : null;
  lastPdfCompression = null;

  const h2 = el('h2', { textContent: 'Stopped' });
  const p = el('p', {});
  p.innerHTML = done.length === 1
    ? `<b>${escapeHTML(shortenFileName(done[0].name, 32))}</b> was finished before you stopped, and is ready to download.`
    : `<b>${done.length}</b> files were finished before you stopped, and are ready to download.`;

  const actions = el('div', { className: 'popup-actions-footer' });
  actions.appendChild(createPopupButton(
    done.length > 1 ? `Download ${done.length} files (.zip)` : 'Download',
    'btn-primary',
    redownloadLastPdfResult,
  ));
  actions.appendChild(createPopupButton('Done', 'btn-secondary', hidePopup));
  replacePopup([h2, p, actions]);
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
  // Added here rather than at the eleven call sites: every tool routes its
  // result through `setPdfResult` and its modal through here, which is the
  // whole reason both funnels exist.
  p.innerHTML = resultHTML + compressionNote();

  const actions = el('div', { className: 'popup-actions-footer' });
  // Names the result rather than the gesture, matching the Converter and the
  // Compress card. "Download again" claimed a download had already happened.
  const dlLabel = lastPdfResult.length > 1
    ? `Download ${lastPdfResult.length} files (.zip)`
    : 'Download';
  actions.appendChild(createPopupButton(dlLabel, 'btn-primary', redownloadLastPdfResult));
  actions.appendChild(createPopupButton('Done', 'btn-secondary', hidePopup));

  replacePopup([h2, frogDiv, p, actions]);

  celebrateOnPopup(ui.popupBox);
  // Deliberately no automatic download - see the note in `actions.ts`. The
  // edit is finished and the file is held; the button is what sends it.
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
    redoStack.length = 0;
    wmSettings = { ...WM_DEFAULTS };
    wmFlatPages = [];
    wmSelected = new Set();
    knownFileIds = new Set();
    wmDisposeBitmaps();
    wmTextEncodeFont = null;
    lastPdfCompression = null;
    if (wmRafId !== null) { cancelAnimationFrame(wmRafId); wmRafId = null; }
  },
  seed(seedPages: PageEntry[], seedFiles: SourceFile[] = [], seedSelected: number[] = []) {
    pages = seedPages;
    files = seedFiles;
    // seedSelected is interpreted as positional indices (legacy test API);
    // translate to pageIds against the freshly seeded pages.
    const sel = new Set<number>();
    for (const i of seedSelected) {
      if (i >= 0 && i < pages.length) sel.add(pages[i].pageId);
    }
    selected = sel;
    knownFileIds = new Set(files.map(f => f.id));
    organizeInitialized = pages.length > 0;
    lastClickedIdx = -1;
    history.length = 0;
    redoStack.length = 0;
  },
  compressionNote,
  offerPartialPdfResult,
  cleanup,
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
  /** Flat-index view of the underlying semantic selection, for legacy tests. */
  getWmSelected: (): Set<number> => {
    const idxs = new Set<number>();
    wmFlatPages.forEach((e, i) => { if (wmSelected.has(wmKey(e))) idxs.add(i); });
    return idxs;
  },
  getWmSelectedKeys: () => wmSelected,
  setWmSelected: (s: Iterable<string | number>) => {
    // Accept either semantic keys or legacy positional flat indices so existing
    // tests don't need rewriting; numbers are translated via the current
    // wmFlatPages array.
    const next = new Set<string>();
    for (const v of s) {
      if (typeof v === 'string') next.add(v);
      else if (v >= 0 && v < wmFlatPages.length) next.add(wmKey(wmFlatPages[v]));
    }
    wmSelected = next;
  },
  getWmKnownFileIds: () => knownFileIds,
  setWmKnownFileIds: (ids: Iterable<number>) => { knownFileIds = new Set(ids); },
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
  redoStack.length = 0;
    organizeInitialized = false;
    wmFlatPages = [];
    wmSelected = new Set();
    knownFileIds = new Set();
    wmDisposeBitmaps();
    if (tab === 'organize') {
      let pos = 0;
      for (const sf of sfs) {
        for (let p = 1; p <= sf.pageCount; p++) {
          pages.push({ type: 'source', sourceFileId: sf.id, sourcePageNum: p, thumbnail: null, rotation: 0, originalPos: ++pos, pageId: getNextPageId() });
        }
      }
      organizeInitialized = pages.length > 0;
      knownFileIds = new Set(sfs.map(f => f.id));
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
      // hyphens - ARIA attribute names are one lowercase token after `aria-`).
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
