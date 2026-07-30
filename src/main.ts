import './styles/global.css';
import { initFrogsworth } from "./components/Frogsworth/FrogsworthWidget.ts";
import type { FormatHandler } from "./core/FormatHandler/FormatHandler.js";
import handlers, { loadBackgroundHandlers } from "./handlers";
type PdfWorkspaceModule = typeof import("./components/PdfWorkspace/PdfWorkspace.ts");
let _pdfWsPromise: Promise<PdfWorkspaceModule> | null = null;
let _pdfWsModule: PdfWorkspaceModule | null = null;
function getPdfWorkspace(): Promise<PdfWorkspaceModule> {
  _pdfWsPromise ??= import("./components/PdfWorkspace/PdfWorkspace.ts").then(m => { _pdfWsModule = m; return m; });
  return _pdfWsPromise;
}
type CompressWorkspaceModule = typeof import("./components/CompressWorkspace/CompressWorkspace.ts");
let _compressWsPromise: Promise<CompressWorkspaceModule> | null = null;
let _compressWsModule: CompressWorkspaceModule | null = null;
function getCompressWorkspace(): Promise<CompressWorkspaceModule> {
  _compressWsPromise ??= import("./components/CompressWorkspace/CompressWorkspace.ts").then(m => { _compressWsModule = m; return m; });
  return _compressWsPromise;
}
import { initRouter, navigateTo, type RouteState, type AppMode } from "./router.ts";
import { isTouchUi } from "./core/utils/touchUi.ts";

// Kick off TraversionGraph load immediately in the background - does not block paint.
// refreshUI() awaits this promise before calling .init(), so it's always ready in time.
const traversionGraphReady = import("./core/TraversionGraph/TraversionGraph.js").then(
  ({ TraversionGraph }) => { window.traversionGraph = new TraversionGraph(); }
);

import { formatToIdentifier } from "./core/TraversionGraph/TraversionGraph.js";
import { showToast } from "./components/Toast/Toast.ts";

import {
  initTheme,
  initFormatModal,
  initCategoryTabs,
  selectCategoryTab,
  initUploadZone,
  showPopup,
  hidePopup,
  createPopupButton,
  showUnsupportedFilePopup,
  closeFormatModal,
  setSelectedFormat,
  updateConvertButtonState,
  renderFormatOptions,
  filterFormats,
  showFileInUploadZone,
  showDetectedFormat,
  resetUploadZone,
  updateCategoryText,
  initModeToggle,
  applyMode,
  clearFormatSelection,
  initResponsiveMenu,
  initSegmentedControls,
  initParallax,
  initFilesModal,
  initCustomCursor,
  currentFiles,
  activeCategory,
  selectedFromIndex,
  selectedToIndex,
  allOptionsRef,
  isLoadingPhase2,
  isLoadingHandlers,
  reachableIdentifiers,
  ui,
  formatMode,
  formatDisplayName,
  buildAcceptString,
} from "./components/index.ts";
import {
  convertQuality,
  setConvertQuality,
  CONVERT_QUALITY_CHOICES,
  type ConvertQuality,
  compressLevel,
  setCompressLevel,
  COMPRESS_LEVEL_CHOICES,
  type CompressLevel,
  pdfQuality,
  setPdfQuality,
  PDF_QUALITY_CHOICES,
  type PdfQuality,
} from "./components/store/store.ts";
import { preloadGhostscript } from "./tools/ghostscriptPreload.ts";
import {
  findMatchingFormat,
  initConvertButton,
  getIsConverting,
  setOnConversionEnd,
} from "./conversion/actions.ts";
import { triggerConfetti } from "./effects/Confetti/Confetti.ts";
import {
  markConvertDirty,
  flushConvertOnHide,
  tryRestoreConvertSession,
} from "./components/persistence/convertPersist.ts";
import { showConfirmPopup } from "./components/Popup/Popup.ts";
import CommonFormats from "./core/CommonFormats/CommonFormats.ts";
import { EXTERNAL_FILES_EVENT, type ExternalFilesDetail } from "./pwa/shareTargetConstants.ts";

getPdfWorkspace().catch((e) => console.warn("[main] PDF workspace module load failed:", e));

// Last-line safety net for errors that escape every other catch site.
// Logs to console for dev, and shows a one-shot recovery popup so users
// get a way out of a stuck UI instead of a silent dead tab.
let recoveryPopupOpen = false;
function surfaceUnhandled(kind: string, reason: unknown) {
  console.error(`[main] ${kind}:`, reason);
  if (recoveryPopupOpen) return;
  try {
    recoveryPopupOpen = true;
    const h2 = document.createElement("h2");
    h2.textContent = "Something went wrong";
    const p = document.createElement("p");
    p.textContent = "The app ran into an unexpected error. Reload to try again.";
    const actions = document.createElement("div");
    actions.className = "popup-actions-footer";
    actions.appendChild(createPopupButton("Reload", "btn-primary", () => location.reload()));
    actions.appendChild(createPopupButton("Dismiss", "btn-secondary", () => {
      hidePopup();
      recoveryPopupOpen = false;
    }));
    showPopup([h2, p, actions]);
  } catch (popupErr) {
    // If the popup machinery itself failed we can't do much, leave the flag
    // armed so we don't loop, and keep the console log.
    console.error("[main] recovery popup failed:", popupErr);
  }
}
window.addEventListener("unhandledrejection", (ev) => surfaceUnhandled("unhandled promise rejection", ev.reason));
window.addEventListener("error", (ev) => surfaceUnhandled("uncaught error", ev.error ?? ev.message));

// --- Init UI ---

initTheme();
initResponsiveMenu();
initParallax();
initCustomCursor();
initFilesModal();

// Set device-appropriate browse hint ("or click to browse" vs "or tap to browse")
const browseHint = isTouchUi()
  ? "or tap to browse"
  : "or click to browse";
for (const el of document.querySelectorAll<HTMLElement>(".upload-hint")) {
  el.textContent = browseHint;
}

const onModeChanged = () => renderFormatOptions(allOptionsRef.value, activeCategory.value);
initModeToggle(onModeChanged);
initSegmentedControls(onModeChanged);

initFormatModal(allOptionsRef.value, selectToFormat);

initCategoryTabs((category) => {
  activeCategory.value = category;
  updateCategoryText(currentFiles.value.length > 0);
  renderFormatOptions(allOptionsRef.value, activeCategory.value);
  if (selectedToIndex.value === null) {
    clearFormatSelection(activeCategory.value);
  }
  updateConvertButtonState(selectedFromIndex.value, selectedToIndex.value);
  navigateTo('converter');
});

const mobileCategoryMq = window.matchMedia("(max-width: 800px)");
const resetHiddenMobileCategory = () => {
  if (!mobileCategoryMq.matches || !activeCategory.value) return;
  selectCategoryTab("", { notify: false });
  activeCategory.value = "";
  if (ui.formatModal.classList.contains("open")) {
    renderFormatOptions(allOptionsRef.value, "");
    if (ui.formatSearch.value) filterFormats(ui.formatSearch.value);
  }
  if (selectedToIndex.value === null) clearFormatSelection("");
};
resetHiddenMobileCategory();
mobileCategoryMq.addEventListener("change", resetHiddenMobileCategory);

// --- App Mode Navigation (Converter ↔ PDF Editor) ---

const modeToggleBtn = document.getElementById("app-mode-toggle")!;
const modeIconConverter = document.getElementById("mode-icon-converter")!;
const modeIconPdf = document.getElementById("mode-icon-pdf")!;
const modeIconCompress = document.getElementById("mode-icon-compress")!;
const topControlsMenu = document.getElementById("top-controls-menu")!;
const converterEls = ["hero-title", "category-tabs", "convert-card", "description"].map(id => document.getElementById(id)!);
const pdfWorkspaceEl = document.getElementById("pdf-workspace")!;
const pdfDescriptionEl = document.getElementById("pdf-description")!;
const compressWorkspaceEl = document.getElementById("compress-workspace")!;
const compressDescriptionEl = document.getElementById("compress-description")!;

let currentAppMode: AppMode = "converter";

/** Ordered so the desktop single-button control can cycle predictably. */
const APP_MODES: AppMode[] = ["converter", "pdf-editor", "compress"];

const MODE_LABELS: Record<AppMode, string> = {
  converter: "Converter",
  "pdf-editor": "PDF Editor",
  compress: "Compress",
};

/** Elements owned by each mode; everything not in the active list gets hidden. */
const MODE_SURFACES: Record<AppMode, HTMLElement[]> = {
  converter: converterEls,
  "pdf-editor": [pdfWorkspaceEl, pdfDescriptionEl],
  compress: [compressWorkspaceEl, compressDescriptionEl],
};

const MODE_ICONS: Record<AppMode, HTMLElement> = {
  converter: modeIconConverter,
  "pdf-editor": modeIconPdf,
  compress: modeIconCompress,
};

const bgEmojis = {
  converter: ["🖼️", "📝", "🎵", "🎥", "📖", "📊", "🎨", "💻", "📦"],
  "pdf-editor": ["📄", "✂️", "💧", "🔗", "🗂️", "📑", "🔖", "👁️", "📓"],
  compress: ["🗜️", "📉", "🤏", "📦", "⚡", "🫙", "🎈", "🪄", "🐸"],
};
const bgEmojiSpans = document.querySelectorAll<HTMLSpanElement>("#bg-visuals .bg-pop span");

function replayEntranceAnimations(roots: Element[]) {
  const pairs: [HTMLElement, string][] = [];
  for (const root of roots) {
    const all = [
      ...(root.matches('.entrance, .word-entrance') ? [root as HTMLElement] : []),
      ...root.querySelectorAll<HTMLElement>('.entrance, .word-entrance'),
    ];
    for (const el of all)
      pairs.push([el, el.classList.contains('entrance') ? 'entrance' : 'word-entrance']);
  }
  for (const [el, cls] of pairs) el.classList.remove(cls);
  if (pairs.length) void pairs[0][0].offsetHeight; // single reflow
  for (const [el, cls] of pairs) el.classList.add(cls);
}

function setAppMode(mode: AppMode) {
  currentAppMode = mode;

  // Swap background emojis with pop animation
  const set = bgEmojis[mode as keyof typeof bgEmojis] ?? bgEmojis.converter;
  bgEmojiSpans.forEach((span, i) => {
    if (!set[i]) return;
    span.style.animationPlayState = "paused";
    span.style.transition = "scale 0.2s ease-in";
    span.style.scale = "0";
  });
  setTimeout(() => {
    bgEmojiSpans.forEach((span, i) => {
      if (!set[i]) return;
      span.textContent = set[i];
      span.style.transition = "scale 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)";
      span.style.scale = "1";
      setTimeout(() => {
        span.style.animationPlayState = "";
        span.style.scale = "";
        span.style.transition = "";
      }, 350);
    });
  }, 200);

  // The trigger icon shows where you are; the menu shows where you can go.
  for (const m of APP_MODES) MODE_ICONS[m].style.display = m === mode ? "" : "none";
  modeToggleBtn.title = MODE_LABELS[mode];
  modeToggleBtn.setAttribute("aria-label", `App mode: ${MODE_LABELS[mode]}. Change app mode`);

  // Update mobile pill group
  const mobilePill = document.getElementById("app-mode-segmented");
  if (mobilePill) {
    for (const b of mobilePill.querySelectorAll(".pill-option")) {
      const isActive = (b as HTMLElement).dataset.value === mode;
      b.classList.toggle("active", isActive);
      (b as HTMLElement).setAttribute("aria-pressed", String(isActive));
    }
  }

  // The format filter only makes sense while picking a target format.
  topControlsMenu.classList.toggle("not-converter", mode !== "converter");
  // The compression control is present in every mode — it just rebinds to that
  // mode's own value and offers the levels that mode can honour.
  renderQualityOptions();
  syncQualityUI();
  // Entering the PDF editor with compression already enabled means the next
  // save needs Ghostscript; start fetching it now rather than then.
  if (mode === "pdf-editor" && pdfQuality.value !== "lossless") preloadGhostscript();

  // Show the active mode's elements, hide every other mode's.
  for (const m of APP_MODES) {
    const visible = m === mode;
    for (const el of MODE_SURFACES[m]) el.style.display = visible ? "" : "none";
  }
  replayEntranceAnimations(MODE_SURFACES[mode]);

  // Lazy surfaces: init on enter, cleanup on leave. cleanup() preserves
  // module-level state (loaded files, page order, selections, watermark
  // settings, the compress batch) so users who toggle modes don't lose their
  // work. resetAll() is the destructive cousin and is not called here.
  // Only *entering* a mode pulls its chunk in; leaving cleans up through the
  // already-resolved module so a user who never opens a surface never
  // downloads it.
  if (mode === "pdf-editor") {
    getPdfWorkspace().then(ws => ws.initPdfWorkspace())
      .catch((e) => console.warn("[main] PDF workspace init failed:", e));
  } else {
    _pdfWsModule?.cleanup();
  }

  if (mode === "compress") {
    getCompressWorkspace().then(ws => ws.initCompressWorkspace())
      .catch((e) => console.warn("[main] Compress workspace init failed:", e));
  } else {
    _compressWsModule?.cleanup();
  }
}

// Desktop mode picker. A dropdown rather than a cycling button: with three
// modes, cycling hides the destination and never reveals that a third exists.
const modeMenu = document.getElementById("app-mode-menu")!;

function setModeMenuOpen(open: boolean) {
  modeMenu.hidden = !open;
  modeToggleBtn.setAttribute("aria-expanded", String(open));
  if (open) {
    for (const item of modeMenu.querySelectorAll<HTMLElement>(".app-mode-item")) {
      item.setAttribute("aria-current", String(item.dataset.value === currentAppMode));
      item.tabIndex = -1;
    }
    modeMenu.querySelector<HTMLElement>(".app-mode-item")?.focus();
  }
}

modeToggleBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  setModeMenuOpen(modeMenu.hidden);
});

modeMenu.addEventListener("click", (e) => {
  const item = (e.target as HTMLElement).closest(".app-mode-item") as HTMLElement | null;
  if (!item) return;
  const mode = item.dataset.value as AppMode;
  setModeMenuOpen(false);
  modeToggleBtn.focus();
  if (mode === currentAppMode) return;
  setAppMode(mode);
  navigateTo(mode);
});

// Roving arrow-key navigation, matching the PDF tablist's keyboard contract.
modeMenu.addEventListener("keydown", (e) => {
  const items = [...modeMenu.querySelectorAll<HTMLElement>(".app-mode-item")];
  const at = items.indexOf(document.activeElement as HTMLElement);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const delta = e.key === "ArrowDown" ? 1 : -1;
    items[(at + delta + items.length) % items.length]?.focus();
  } else if (e.key === "Escape") {
    setModeMenuOpen(false);
    modeToggleBtn.focus();
  }
});

document.addEventListener("click", (e) => {
  if (modeMenu.hidden) return;
  if ((e.target as HTMLElement).closest("#app-mode-picker")) return;
  setModeMenuOpen(false);
});

// Mobile hamburger pill control
const mobileModePill = document.getElementById("app-mode-segmented");
mobileModePill?.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest(".pill-option") as HTMLButtonElement | null;
  if (!btn || btn.classList.contains("active")) return;
  setAppMode(btn.dataset.value as AppMode);
  navigateTo(btn.dataset.value!);
});

// In-app deep links to another mode come through as an event so components can
// route without a handle on the shell.
window.addEventListener("frog:set-mode", (e) => {
  const mode = (e as CustomEvent<string>).detail as AppMode;
  if (!APP_MODES.includes(mode) || mode === currentAppMode) return;
  setAppMode(mode);
  navigateTo(mode);
});

// --- Compression setting ---
// One control, three backing values. Every mode compresses something, so the
// control is present in all three — hiding it anywhere made the setting look
// like it only existed where you last saw it. But the three mean different
// things, and each carries its own default:
//
//   Converter    "how much quality to give up while changing format" → Automatic
//   Compress     "how hard to squeeze"                               → Automatic
//   PDF Editor   "should editing this also shrink it"                → Original
//
// The PDF editor defaults to Original quality because merging and watermarking
// are edits, not exports: you expect the same document back. The other two are
// asked to produce a new file, where reading the input and picking a level is
// the better default than a fixed tier.
//
// Sharing one value across surfaces was tried and reverted — changing it in
// one place silently moved the others.

const qualityToggle = document.getElementById("quality-toggle")!;
const qualityMenu = document.getElementById("quality-menu")!;
const qualitySegmented = document.getElementById("quality-segmented");

/**
 * The control is a view over whichever setting the active mode owns. One table
 * rather than a chain of conditionals: adding a fourth surface means adding a
 * row, and it is impossible for the read and the write to disagree about which
 * value they are touching.
 */
type QualityBinding = {
  choices: ReadonlyArray<{ value: string; label: string; blurb: string }>;
  get: () => string;
  set: (v: string) => void;
  /** Completes "Compression …: Balanced" in the control's accessible name. */
  scope: string;
};

const QUALITY_BINDINGS: Record<AppMode, QualityBinding> = {
  converter: {
    choices: CONVERT_QUALITY_CHOICES,
    get: () => convertQuality.value,
    set: (v) => setConvertQuality(v as ConvertQuality),
    scope: "when converting",
  },
  compress: {
    choices: COMPRESS_LEVEL_CHOICES,
    get: () => compressLevel.value,
    set: (v) => setCompressLevel(v as CompressLevel),
    scope: "when compressing",
  },
  "pdf-editor": {
    choices: PDF_QUALITY_CHOICES,
    get: () => pdfQuality.value,
    set: (v) => setPdfQuality(v as PdfQuality),
    scope: "when saving a PDF",
  },
};

function qualityContext() {
  const binding = QUALITY_BINDINGS[currentAppMode];
  return { ...binding, current: binding.get() };
}

/** Rebuild the option rows so each mode only offers levels it can honour. */
function renderQualityOptions() {
  const { choices, current } = qualityContext();
  // Only the rows are replaced, so the "Compression" heading keeps its place
  // at the top without being moved back there.
  qualityMenu.querySelectorAll(".quality-item").forEach(el => el.remove());
  for (const c of choices) {
    const btn = document.createElement("button");
    btn.className = "quality-item";
    btn.type = "button";
    btn.setAttribute("role", "menuitem");
    btn.tabIndex = -1;
    btn.dataset.value = c.value;
    btn.setAttribute("aria-current", String(c.value === current));
    const label = document.createElement("span");
    label.textContent = c.label;
    const blurb = document.createElement("span");
    blurb.className = "quality-item-blurb";
    blurb.textContent = c.blurb;
    btn.append(label, blurb);
    qualityMenu.appendChild(btn);
  }

  // The mobile pill list mirrors the same option set.
  if (qualitySegmented) {
    qualitySegmented.innerHTML = "";
    for (const c of choices) {
      const pill = document.createElement("button");
      pill.className = "pill-option";
      pill.type = "button";
      pill.dataset.value = c.value;
      pill.textContent = c.label;
      qualitySegmented.appendChild(pill);
    }
  }
}

function syncQualityUI() {
  const { choices, current, scope } = qualityContext();
  const label = choices.find(c => c.value === current)?.label ?? "Balanced";
  qualityToggle.title = `Compression: ${label}`;
  qualityToggle.setAttribute("aria-label", `Compression ${scope}: ${label}. Change`);
  for (const item of qualityMenu.querySelectorAll<HTMLElement>(".quality-item")) {
    item.setAttribute("aria-current", String(item.dataset.value === current));
  }
  for (const pill of qualitySegmented?.querySelectorAll<HTMLElement>(".pill-option") ?? []) {
    const active = pill.dataset.value === current;
    pill.classList.toggle("active", active);
    pill.setAttribute("aria-pressed", String(active));
  }
}

function setQualityMenuOpen(open: boolean) {
  qualityMenu.hidden = !open;
  qualityToggle.setAttribute("aria-expanded", String(open));
  if (open) qualityMenu.querySelector<HTMLElement>(".quality-item")?.focus();
}

function chooseQuality(next: string) {
  QUALITY_BINDINGS[currentAppMode].set(next);

  if (currentAppMode === "compress") {
    // The Compress card renders its own copy of this setting, so tell it to
    // repaint rather than leaving the two views disagreeing.
    window.dispatchEvent(new CustomEvent("frog:compress-level"));
  }
  // Asking the PDF editor to compress means Ghostscript is now on the critical
  // path of the next save. Start the 16 MB fetch while the user is still
  // picking pages instead of at the moment they hit Save.
  if (currentAppMode === "pdf-editor" && next !== "lossless") preloadGhostscript();

  syncQualityUI();
}

qualityToggle.addEventListener("click", (e) => {
  e.stopPropagation();
  setQualityMenuOpen(qualityMenu.hidden);
});

qualityMenu.addEventListener("click", (e) => {
  const item = (e.target as HTMLElement).closest(".quality-item") as HTMLElement | null;
  if (!item) return;
  setQualityMenuOpen(false);
  qualityToggle.focus();
  chooseQuality(item.dataset.value!);
});

qualityMenu.addEventListener("keydown", (e) => {
  const items = [...qualityMenu.querySelectorAll<HTMLElement>(".quality-item")];
  const at = items.indexOf(document.activeElement as HTMLElement);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  } else if (e.key === "Escape") {
    setQualityMenuOpen(false);
    qualityToggle.focus();
  }
});

qualitySegmented?.addEventListener("click", (e) => {
  const pill = (e.target as HTMLElement).closest(".pill-option") as HTMLElement | null;
  if (!pill || pill.classList.contains("active")) return;
  chooseQuality(pill.dataset.value!);
});

document.addEventListener("click", (e) => {
  if (qualityMenu.hidden) return;
  if ((e.target as HTMLElement).closest("#quality-picker")) return;
  setQualityMenuOpen(false);
});

// The Compress card carries its own copy of this setting; keep the menu in
// step when the change originates there.
window.addEventListener("frog:compress-level", () => syncQualityUI());

renderQualityOptions();
syncQualityUI();

// --- Router (URL ↔ state sync) ---

function applyRoute(route: RouteState) {
  setAppMode(route.mode);
}

const initialRoute = initRouter(applyRoute);
if (initialRoute.mode !== 'converter') {
  applyRoute(initialRoute);
}

initUploadZone(
  (files) => {
    const matchIndex = findMatchingFormat(files, allOptionsRef.value);

    // If no match found and we're not in the middle of a "cold start" loading phase,
    // block the upload and show an unsupported file popup.
    if (matchIndex < 0 && !isLoadingHandlers.value && !isLoadingPhase2.value) {
      showUnsupportedFilePopup(files);
      return;
    }

    showFileInUploadZone(files);

    if (matchIndex >= 0) {
      selectedFromIndex.value = matchIndex;
      showDetectedFormat(allOptionsRef.value[matchIndex].format.format, files.length);

    } else {
      selectedFromIndex.value = null;
    }
    computeReachability();
    updateConvertButtonState(selectedFromIndex.value, selectedToIndex.value);
  },
  () => {
    selectedFromIndex.value = null;
    selectedToIndex.value = null;
    clearFormatSelection(activeCategory.value);
    computeReachability();
    resetUploadZone();
    updateConvertButtonState(selectedFromIndex.value, selectedToIndex.value);
  },
);

function selectToFormat(index: number) {
  selectedToIndex.value = index;
  setSelectedFormat(index, allOptionsRef.value);
  updateConvertButtonState(selectedFromIndex.value, selectedToIndex.value);
  markConvertDirty('manifest');
  // A conversion that ends in a PDF routes through Ghostscript, so start the
  // 16 MB fetch at format-pick time rather than when Convert is pressed.
  if (allOptionsRef.value[index]?.format.format?.toLowerCase() === "pdf") preloadGhostscript();
  closeFormatModal();
}

// --- Popup (global) ---

window.showPopup = showPopup;
window.hidePopup = hidePopup;

// --- Format cache ---

window.supportedFormatCache = new Map();

window.printSupportedFormatCache = () => {
  const entries = [];
  for (const entry of window.supportedFormatCache) {
    entries.push(entry);
  }
  return JSON.stringify(entries, null, 2);
};

// --- Build option list ---

/** Synchronously populate allOptionsRef from already-loaded cache - no handler.init() calls. */
function populateFromCache(subset: FormatHandler[]) {
  for (const handler of subset) {
    const supportedFormats = window.supportedFormatCache.get(handler.name);
    if (!supportedFormats) continue;
    for (const format of supportedFormats) {
      if (!format.mime) continue;
      allOptionsRef.value.push({ format, handler });
    }
  }
}

/** Init only handlers not yet in cache, then add their formats to allOptionsRef. */
async function initCacheMissHandlers(subset: FormatHandler[]) {
  for (const handler of subset) {
    if (window.supportedFormatCache.has(handler.name)) continue;
    console.debug(`Cache miss for formats of handler "${handler.name}".`);
    try {
      await handler.init();
    } catch (_) { continue; }
    if (handler.supportedFormats) {
      window.supportedFormatCache.set(handler.name, handler.supportedFormats);
      console.info(`Updated supported format cache for "${handler.name}".`);
      let added = 0;
      for (const format of handler.supportedFormats) {
        if (!format.mime) continue;
        allOptionsRef.value.push({ format, handler });
        added++;
      }
      // Incrementally show formats as each handler loads (DOM render only, no graph rebuild)
      if (added > 0 && ui.formatModal.classList.contains("open")) {
        renderFormatOptions(allOptionsRef.value, activeCategory.value);
        if (ui.formatSearch.value) filterFormats(ui.formatSearch.value);
      }
    }
  }
}

function updateFileInputAccept() {
  ui.fileInput.accept = buildAcceptString(allOptionsRef.value);
}

function computeReachability() {
  const fromIdx = selectedFromIndex.value;
  if (fromIdx === null || !window.traversionGraph || window.traversionGraph.nodeCount === 0) {
    reachableIdentifiers.value = null;
    return;
  }
  const fromFormat = allOptionsRef.value[fromIdx].format;
  const reachable = window.traversionGraph.getReachableIdentifiers(formatToIdentifier(fromFormat));
  reachableIdentifiers.value = reachable;

  const toIdx = selectedToIndex.value;
  if (toIdx === null) return;
  const toOpt = allOptionsRef.value[toIdx];
  if (!toOpt || reachable.has(formatToIdentifier(toOpt.format))) return;

  const toName = toOpt.format.format.toUpperCase();
  const fromName = fromFormat.format.toUpperCase();
  selectedToIndex.value = null;
  clearFormatSelection(activeCategory.value);
  showToast(`${toName} isn't reachable from ${fromName}. Pick another format.`, "warn");
}

async function refreshUI() {
  updateFileInputAccept();
  await traversionGraphReady;
  window.traversionGraph.init(window.supportedFormatCache, handlers);
  computeReachability();
  renderFormatOptions(allOptionsRef.value, activeCategory.value);
  if (ui.formatModal.classList.contains("open")) {
    filterFormats(ui.formatSearch.value);
  }

  // Refresh convert button + notice banner (handler availability may have changed)
  updateConvertButtonState(selectedFromIndex.value, selectedToIndex.value);

  // Re-attempt format detection if a file is loaded but wasn't matched when uploaded
  if (currentFiles.value.length > 0 && selectedFromIndex.value === null) {
    const matchIndex = findMatchingFormat(currentFiles.value, allOptionsRef.value);
    if (matchIndex >= 0) {
      selectedFromIndex.value = matchIndex;
      showDetectedFormat(allOptionsRef.value[matchIndex].format.format, currentFiles.value.length);
      computeReachability();
      updateConvertButtonState(selectedFromIndex.value, selectedToIndex.value);
    }
  }
}

// --- Init ---

// Hoisted ahead of the init IIFE so the synchronous localStorage-cache path
// at line ~473 can call attemptConvertRestore() without hitting a TDZ on this
// `let` (the function declaration itself hoists, but the variable does not).
let convertRestoreAttempted = false;

(async () => {
  isLoadingHandlers.value = true;
  updateConvertButtonState(selectedFromIndex.value, selectedToIndex.value);

  // Load cache: localStorage → cache.json → nothing (cold start)
  let hasCache = false;
  try {
    const stored = localStorage.getItem("supportedFormatCache");
    if (stored) {
      window.supportedFormatCache = new Map(JSON.parse(stored));
      hasCache = true;
    } else {
      throw "No localStorage cache";
    }
  } catch {
    try {
      const cacheJSON = await fetch("cache.json", { signal: AbortSignal.timeout(5000) }).then(r => r.json());
      window.supportedFormatCache = new Map(cacheJSON);
      hasCache = true;
    } catch {
      console.info(
        "Missing supported format precache.\n\n" +
        "First load dynamically indexing supported formats list.",
      );
    }
  }

  if (hasCache) {
    // Warm load: populate format list from cache instantly, no handler.init() needed
    populateFromCache(handlers);
    refreshUI();
    attemptConvertRestore();
  }

  try {
    // Phase 1: lightweight core handlers - completes in <1s on cold start
    try {
      const sizeBefore = allOptionsRef.value.length;
      await initCacheMissHandlers(handlers);
      if (allOptionsRef.value.length > sizeBefore) {
        refreshUI();
      }
      console.debug(`Phase 1: ${handlers.length} core handlers loaded.`);
      attemptConvertRestore();
    } catch (e) {
      console.error("Phase 1 init failed:", e);
    }

    // Phase 2: heavy handlers (FFmpeg, ImageMagick, Pandoc) + background handlers
    const countBefore = handlers.length;
    try {
      isLoadingPhase2.value = true;
      if (ui.formatModal.classList.contains("open")) {
        renderFormatOptions(allOptionsRef.value, activeCategory.value);
        if (ui.formatSearch.value) filterFormats(ui.formatSearch.value);
      }
      await loadBackgroundHandlers();
      populateFromCache(handlers.slice(countBefore));
      await initCacheMissHandlers(handlers.slice(countBefore));
    } finally {
      isLoadingPhase2.value = false;
    }
    // Defer graph rebuild if a conversion is currently in progress to avoid sending a new
    // 'init' message to the route-search worker mid-pathfinding. The graph will be rebuilt
    // immediately after the conversion's finally block runs.
    if (!getIsConverting()) {
      refreshUI();
      attemptConvertRestore();
    } else {
      setOnConversionEnd(refreshUI);
    }
    // Persist cache for next page load. localStorage.setItem throws a
    // QuotaExceededError synchronously when origin storage is full; if
    // uncaught it takes the Phase-2 load path down with it. Log and move on.
    try {
      const entries = [...window.supportedFormatCache.entries()];
      localStorage.setItem("supportedFormatCache", JSON.stringify(entries));
    } catch (e) {
      console.warn("[main] localStorage persist failed (quota or disabled):", e);
    }
    console.debug(`Phase 2: ${handlers.length - countBefore} background handlers loaded.`);
  } finally {
    isLoadingHandlers.value = false;
    updateConvertButtonState(selectedFromIndex.value, selectedToIndex.value);
    document.body.classList.add("app-ready");  // dismiss cold-start splash overlay
  }
})();

// --- Conversion logic ---

initConvertButton();

// --- Session persistence: flush on hide, restore on cold start ---

function attemptConvertRestore(): void {
  // Run once, after handlers + format options are ready so target lookup works.
  if (convertRestoreAttempted) return;
  convertRestoreAttempted = true;
  void tryRestoreConvertSession({
    applyFiles: (files) => {
      currentFiles.value = files;
      // Drive the same downstream UI path as a fresh upload - detect format,
      // update convert button, paint upload zone - without re-saving.
      const matchIndex = findMatchingFormat(files, allOptionsRef.value);
      showFileInUploadZone(files);
      if (matchIndex >= 0) {
        selectedFromIndex.value = matchIndex;
        showDetectedFormat(allOptionsRef.value[matchIndex].format.format, files.length);
      } else {
        selectedFromIndex.value = null;
      }
      computeReachability();
      updateConvertButtonState(selectedFromIndex.value, selectedToIndex.value);
    },
    applyTargetFormat: (formatKey) => {
      const idx = allOptionsRef.value.findIndex(o => o.format.format === formatKey);
      if (idx < 0) return;
      selectedToIndex.value = idx;
      setSelectedFormat(idx, allOptionsRef.value);
      updateConvertButtonState(selectedFromIndex.value, selectedToIndex.value);
    },
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushConvertOnHide();
  });
}
// pagehide is the canonical signal for "page is being unloaded" on mobile
// (visibilitychange isn't always raised when the OS kills a backgrounded
// tab). Fire-and-forget the async flush; browsers honour outstanding work
// for a brief grace window.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { void flushConvertOnHide(); });
}

initFrogsworth(() => {
  // Both read the same source. Asking the DOM for one and the state variable
  // for the other invites them to disagree, and inline styles are only correct
  // after the first setAppMode() anyway.
  const onPdf = currentAppMode === "pdf-editor";
  const onCompress = currentAppMode === "compress";
  // The converter's format selection is meaningless on the other surfaces, and
  // pick() prefers format quips whenever from/to are set - so clear them or the
  // frog talks about PNG while you're compressing.
  const from = !onPdf && !onCompress && selectedFromIndex.value !== null
    ? allOptionsRef.value[selectedFromIndex.value].format.format
    : null;
  const to = !onPdf && !onCompress && selectedToIndex.value !== null
    ? allOptionsRef.value[selectedToIndex.value].format.format
    : null;
  return {
    from,
    to,
    page: onCompress ? "compress" as const
      : onPdf ? "pdf-editor" as const
      : "convert" as const,
    pdfTool: onPdf ? _pdfWsModule?.getActiveTool() : undefined,
  };
});

// --- Footer Confetti ---

const footerConfettiBtn = document.querySelector("#footer-confetti-btn");
if (footerConfettiBtn) {
  footerConfettiBtn.addEventListener("click", () => {
    triggerConfetti();
  });

  const confettiMq = window.matchMedia("(max-width: 1100px), (max-height: 350px)");
  const updateConfettiPlacement = (mobile: boolean) => {
    footerConfettiBtn.classList.toggle("confetti-below-footer", mobile);
    document.body.appendChild(footerConfettiBtn);
  };
  updateConfettiPlacement(confettiMq.matches);
  confettiMq.addEventListener("change", (e) => updateConfettiPlacement(e.matches));
}

import { registerPWA } from "./pwa/registerSW";
import { initShareTargetAndLaunchQueue } from "./pwa/shareTarget";

registerPWA();
initShareTargetAndLaunchQueue();

// Web Share Target / launchQueue routing lives here because it needs
// app-mode state and the lazy PDF Workspace loader, both already in this file.
function isPdfFile(f: File): boolean {
  const pdfExt = `.${CommonFormats.PDF.extension}`;
  return f.type === CommonFormats.PDF.mime || f.name.toLowerCase().endsWith(pdfExt);
}

function deliverSharedToConverter(files: File[]) {
  if (currentAppMode !== "converter") {
    setAppMode("converter");
    navigateTo("converter");
  }
  // Re-fire as a real DragEvent so UploadZone's existing window-level listener
  // runs the full pipeline (size warnings, MIME filtering, file-type-mismatch
  // popup, markConvertDirty). Defer to the next microtask so we leave the
  // current event-handler call stack before the synthetic dispatch.
  queueMicrotask(() => {
    try {
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(f);
      window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    } catch (err) {
      console.warn("[main] could not deliver shared files to Converter:", err);
    }
  });
}

function deliverSharedToPdfEditor(files: File[]) {
  if (currentAppMode !== "pdf-editor") {
    setAppMode("pdf-editor");
    navigateTo("pdf-editor");
  }
  void getPdfWorkspace().then(ws => ws.ingestExternalFiles(files))
    .catch(err => console.warn("[main] could not deliver shared files to PDF Editor:", err));
}

window.addEventListener(EXTERNAL_FILES_EVENT, (e) => {
  const files = (e as CustomEvent<ExternalFilesDetail>).detail?.files ?? [];
  if (files.length === 0) return;

  if (!files.every(isPdfFile)) {
    deliverSharedToConverter(files);
    return;
  }

  // All PDFs: ambiguous between convert and edit.
  showConfirmPopup(
    files.length === 1 ? "Open shared PDF" : `Open ${files.length} shared PDFs`,
    "Convert to another format, or edit (merge, organize, watermark)?",
    { label: "Edit", onClick: () => deliverSharedToPdfEditor(files) },
    { label: "Convert", onClick: () => deliverSharedToConverter(files) },
  );
});

