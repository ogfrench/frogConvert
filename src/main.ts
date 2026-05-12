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
import { initRouter, navigateTo, type RouteState } from "./router.ts";
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
const topControlsMenu = document.getElementById("top-controls-menu")!;
const converterEls = ["hero-title", "category-tabs", "convert-card", "description"].map(id => document.getElementById(id)!);
const pdfWorkspaceEl = document.getElementById("pdf-workspace")!;
const pdfDescriptionEl = document.getElementById("pdf-description")!;

let currentAppMode = "converter";

const bgEmojis = {
  converter: ["🖼️", "📝", "🎵", "🎥", "📖", "📊", "🔠", "💻", "⚡"],
  "pdf-editor": ["📄", "✂️", "🔒", "🖊️", "📑", "🗂️", "🔗", "🖨️", "📐"],
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

function setAppMode(mode: string) {
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

  // Update button icon and tooltip
  const isConverter = mode === "converter";
  modeIconConverter.style.display = isConverter ? "" : "none";
  modeIconPdf.style.display = isConverter ? "none" : "";
  modeToggleBtn.title = isConverter ? "Converter" : "PDF Editor";
  modeToggleBtn.setAttribute("aria-label", `Switch app mode: ${isConverter ? "Converter" : "PDF Editor"}`);

  // Update mobile pill group
  const mobilePill = document.getElementById("app-mode-segmented");
  if (mobilePill) {
    for (const b of mobilePill.querySelectorAll(".pill-option")) {
      const isActive = (b as HTMLElement).dataset.value === mode;
      b.classList.toggle("active", isActive);
      (b as HTMLElement).setAttribute("aria-pressed", String(isActive));
    }
  }

  // Toggle pdf-mode class on menu to hide formats section
  topControlsMenu.classList.toggle("pdf-mode", mode === "pdf-editor");

  if (mode === "pdf-editor") {
    for (const el of converterEls) el.style.display = "none";
    pdfWorkspaceEl.style.display = "";
    pdfDescriptionEl.style.display = "";
    replayEntranceAnimations([pdfWorkspaceEl, pdfDescriptionEl]);
    getPdfWorkspace().then(ws => ws.initPdfWorkspace())
      .catch((e) => console.warn("[main] PDF workspace init failed:", e));
  } else {
    // cleanup() preserves module-level state (loaded files, page order,
    // selections, watermark settings) so users who toggle modes don't lose
    // their work. resetAll() is the destructive cousin and is no longer
    // called on mode switches.
    getPdfWorkspace().then(ws => ws.cleanup())
      .catch((e) => console.warn("[main] PDF workspace cleanup failed:", e));
    pdfWorkspaceEl.style.display = "none";
    pdfDescriptionEl.style.display = "none";
    for (const el of converterEls) el.style.display = "";
    replayEntranceAnimations(converterEls);
  }
}

// Desktop mode toggle button
modeToggleBtn.addEventListener("click", () => {
  const next = currentAppMode === "converter" ? "pdf-editor" : "converter";
  setAppMode(next);
  navigateTo(next);
});

// Mobile hamburger pill control
const mobileModePill = document.getElementById("app-mode-segmented");
mobileModePill?.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest(".pill-option") as HTMLButtonElement | null;
  if (!btn || btn.classList.contains("active")) return;
  setAppMode(btn.dataset.value!);
  navigateTo(btn.dataset.value!);
});

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

/** Show or complete/hide the top-of-page thin loading bar (cold start only). */
function showLoadingBar(show: boolean) {
  const id = "loading-bar";
  if (show) {
    if (document.getElementById(id)) return;
    const bar = document.createElement("div");
    bar.id = id;
    document.body.prepend(bar);
  } else {
    const bar = document.getElementById(id) as HTMLElement | null;
    if (!bar) return;
    const currentWidth = getComputedStyle(bar).width;   // capture live animated position
    bar.style.setProperty("--bar-start", currentWidth); // feed into @keyframes loading-bar-finish 0%
    bar.style.width = currentWidth;                     // freeze: prevents flash to CSS width:0 on cancel
    bar.style.animation = "none";                       // cancel grow+breathe
    void bar.offsetHeight;                               // force reflow to commit inline values
    bar.classList.add("complete");                      // !important in .complete overrides inline animation:none
    bar.addEventListener("animationend", () => bar.remove(), { once: true });
    setTimeout(() => bar.remove(), 1500);               // fallback cleanup
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
  let hasLocalStorageCache = false;
  try {
    const stored = localStorage.getItem("supportedFormatCache");
    if (stored) {
      window.supportedFormatCache = new Map(JSON.parse(stored));
      hasCache = true;
      hasLocalStorageCache = true;
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
  if (!hasLocalStorageCache) {
    // Show loading bar whenever localStorage is empty (cold start or cache.json fallback)
    showLoadingBar(true);
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
    showLoadingBar(false);  // always hide bar when entire loading sequence ends
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
  const onPdf = document.getElementById("pdf-workspace")?.style.display !== "none";
  return {
    from: selectedFromIndex.value !== null
      ? allOptionsRef.value[selectedFromIndex.value].format.format
      : null,
    to: selectedToIndex.value !== null
      ? allOptionsRef.value[selectedToIndex.value].format.format
      : null,
    page: onPdf ? "pdf-editor" as const : "convert" as const,
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

