import './styles/global.css';
import { initFrogsworth } from "./components/Frogsworth/FrogsworthWidget.ts";
import type { FormatHandler } from "./core/FormatHandler/FormatHandler.js";
import handlers, { loadBackgroundHandlers } from "./handlers";
import { initPdfWorkspace, selectPdfTool } from "./components/PdfWorkspace/PdfWorkspace.ts";
import { initRouter, navigateTo, type RouteState } from "./router.ts";

// Kick off TraversionGraph load immediately in the background - does not block paint.
// refreshUI() awaits this promise before calling .init(), so it's always ready in time.
const traversionGraphReady = import("./core/TraversionGraph/TraversionGraph.js").then(
  ({ TraversionGraph }) => { window.traversionGraph = new TraversionGraph(); }
);

import {
  initTheme,
  initFormatModal,
  initCategoryTabs,
  initUploadZone,
  showPopup,
  hidePopup,
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
  findMatchingFormat,
  initModeToggle,
  applyMode,
  clearFormatSelection,
  initConvertButton,
  getIsConverting,
  setOnConversionEnd,
  initResponsiveMenu,
  initSegmentedControls,
  initParallax,
  initFilesModal,
  initCustomCursor,
  selectCategoryTab,
  getFormatCategory,
  currentFiles,
  activeCategory,
  selectedFromIndex,
  selectedToIndex,
  allOptionsRef,
  isLoadingPhase2,
  isLoadingHandlers,
  ui,
  isCategoryVisible,
  formatMode,
  formatDisplayName,
} from "./components/index.ts";
import { triggerConfetti } from "./effects/Confetti/Confetti.ts";

// --- Init UI ---

initTheme();
initResponsiveMenu();
initParallax();
initCustomCursor();
initFilesModal();

// Set device-appropriate browse hint ("or click to browse" vs "or tap to browse")
const browseHint = window.matchMedia("(pointer: coarse)").matches
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
  navigateTo('converter', category);
});

// --- App Mode Navigation (Converter ↔ PDF Editor) ---

const modeToggleBtn = document.getElementById("app-mode-toggle")!;
const modeIconConverter = document.getElementById("mode-icon-converter")!;
const modeIconPdf = document.getElementById("mode-icon-pdf")!;
const topControlsMenu = document.getElementById("top-controls-menu")!;
const converterEls = ["hero-title", "category-tabs", "convert-card", "description"].map(id => document.getElementById(id)!);
const pdfWorkspaceEl = document.getElementById("pdf-workspace")!;

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
    replayEntranceAnimations([pdfWorkspaceEl]);
    initPdfWorkspace();
  } else {
    pdfWorkspaceEl.style.display = "none";
    for (const el of converterEls) el.style.display = "";
    replayEntranceAnimations(converterEls);
  }
}

function subForMode(mode: string): string {
  if (mode === 'converter') return activeCategory.value;
  return document.querySelector('#pdf-editor-tabs .cat-tab.active')?.getAttribute('data-tool') || '';
}

// Desktop mode toggle button
modeToggleBtn.addEventListener("click", () => {
  const next = currentAppMode === "converter" ? "pdf-editor" : "converter";
  setAppMode(next);
  navigateTo(next, subForMode(next));
});

// Mobile hamburger pill control
const mobileModePill = document.getElementById("app-mode-segmented");
mobileModePill?.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest(".pill-option") as HTMLButtonElement | null;
  if (!btn || btn.classList.contains("active")) return;
  setAppMode(btn.dataset.value!);
  navigateTo(btn.dataset.value!, subForMode(btn.dataset.value!));
});

// PDF tool tabs → update URL
document.getElementById("pdf-editor-tabs")!.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest(".cat-tab") as HTMLButtonElement | null;
  if (!btn || btn.classList.contains("active")) return;
  navigateTo('pdf-editor', btn.dataset.tool || '');
});

// --- Router (URL ↔ state sync) ---

function minModeForCategory(category: string) {
  if (isCategoryVisible(category, 'core')) return 'core' as const;
  if (isCategoryVisible(category, 'plus')) return 'plus' as const;
  return 'all' as const;
}

function applyRoute(route: RouteState) {
  setAppMode(route.mode);
  if (route.mode === 'converter') {
    if (route.sub && !isCategoryVisible(route.sub, formatMode.value)) {
      applyMode(minModeForCategory(route.sub));
    }
    selectCategoryTab(route.sub || '');
  } else {
    selectPdfTool(route.sub || 'merge');
  }
}

const initialRoute = initRouter(applyRoute);
// Apply initial route from URL (only if non-default to avoid redundant work)
if (initialRoute.mode !== 'converter' || initialRoute.sub !== '') {
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

      // Dynamically select the tab related to the uploaded file
      const category = getFormatCategory(allOptionsRef.value[matchIndex].format);
      if (category && category !== activeCategory.value && selectedToIndex.value === null) {
        if (isCategoryVisible(category, formatMode.value)) {
          selectCategoryTab(category);
        }
      }
    } else {
      selectedFromIndex.value = null;
    }
    updateConvertButtonState(selectedFromIndex.value, selectedToIndex.value);
  },
  () => {
    selectedFromIndex.value = null;
    resetUploadZone();
    updateConvertButtonState(selectedFromIndex.value, selectedToIndex.value);
  },
);

function selectToFormat(index: number) {
  selectedToIndex.value = index;
  setSelectedFormat(index, allOptionsRef.value);
  updateConvertButtonState(selectedFromIndex.value, selectedToIndex.value);
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

async function refreshUI() {
  await traversionGraphReady;
  window.traversionGraph.init(window.supportedFormatCache, handlers);
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
      const category = getFormatCategory(allOptionsRef.value[matchIndex].format);
      if (category && category !== activeCategory.value && selectedToIndex.value === null) {
        if (isCategoryVisible(category, formatMode.value)) {
          selectCategoryTab(category);
        }
      }
      updateConvertButtonState(selectedFromIndex.value, selectedToIndex.value);
    }
  }
}

// --- Init ---

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
    } else {
      setOnConversionEnd(refreshUI);
    }
    // Persist cache for next page load
    try {
      const entries = [...window.supportedFormatCache.entries()];
      localStorage.setItem("supportedFormatCache", JSON.stringify(entries));
    } catch (_) { }
    console.debug(`Phase 2: ${handlers.length - countBefore} background handlers loaded.`);
  } finally {
    showLoadingBar(false);  // always hide bar when entire loading sequence ends
    isLoadingHandlers.value = false;
    updateConvertButtonState(selectedFromIndex.value, selectedToIndex.value);
  }
})();

// --- Conversion logic ---

initConvertButton();

initFrogsworth(() => ({
  from: selectedFromIndex.value !== null
    ? allOptionsRef.value[selectedFromIndex.value].format.format
    : null,
  to: selectedToIndex.value !== null
    ? allOptionsRef.value[selectedToIndex.value].format.format
    : null,
  page: document.getElementById("pdf-workspace")?.style.display !== "none"
    ? "pdf-editor" as const
    : "convert" as const,
}));

// --- Footer Confetti ---

const footerConfettiBtn = document.querySelector("#footer-confetti-btn");
if (footerConfettiBtn) {
  footerConfettiBtn.addEventListener("click", () => {
    triggerConfetti();
  });
}
