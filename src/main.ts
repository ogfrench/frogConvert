import './styles/global.css';
import type { FormatHandler } from "./core/FormatHandler/FormatHandler.js";
import handlers, { loadBackgroundHandlers } from "./handlers";
import { TraversionGraph } from "./core/TraversionGraph/TraversionGraph.js";

import {
  initTheme,
  initFormatModal,
  initCategoryTabs,
  initUploadZone,
  showPopup,
  hidePopup,
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
initSegmentedControls();
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

initModeToggle(() => {
  renderFormatOptions(allOptionsRef.value, activeCategory.value);
});

initFormatModal(allOptionsRef.value, selectToFormat);

initCategoryTabs((category) => {
  activeCategory.value = category;
  updateCategoryText(currentFiles.value.length > 0);
  renderFormatOptions(allOptionsRef.value, activeCategory.value);
  if (selectedToIndex.value === null) {
    clearFormatSelection(activeCategory.value);
  }
  updateConvertButtonState(selectedFromIndex.value, selectedToIndex.value);
});

initUploadZone(
  (files) => {
    showFileInUploadZone(files);

    const matchIndex = findMatchingFormat(files, allOptionsRef.value);
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
window.traversionGraph = new TraversionGraph();

window.printSupportedFormatCache = () => {
  localStorage.removeItem("supportedFormatCache");
  const entries = [];
  for (const entry of window.supportedFormatCache) {
    entries.push(entry);
  }
  return JSON.stringify(entries, null, 2);
};

// --- Build option list ---

/** Synchronously populate allOptionsRef from already-loaded cache — no handler.init() calls. */
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

function refreshUI() {
  window.traversionGraph.init(window.supportedFormatCache, handlers);
  renderFormatOptions(allOptionsRef.value, activeCategory.value);
  if (ui.formatModal.classList.contains("open")) {
    filterFormats(ui.formatSearch.value);
  }

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
    // Phase 1: 9 lightweight handlers — completes in <1s on cold start
    try {
      const sizeBefore = allOptionsRef.value.length;
      await initCacheMissHandlers(handlers);
      if (allOptionsRef.value.length > sizeBefore) {
        refreshUI();
      }
      console.log(`Phase 1: ${handlers.length} core handlers loaded.`);
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
    console.log(`Phase 2: ${handlers.length - countBefore} background handlers loaded.`);
  } finally {
    showLoadingBar(false);  // always hide bar when entire loading sequence ends
    isLoadingHandlers.value = false;
    updateConvertButtonState(selectedFromIndex.value, selectedToIndex.value);
  }
})();

// --- Conversion logic ---

initConvertButton();


// Load Frogsworth at lowest priority — idle + code-split
const scheduleIdle = (cb: () => void) =>
  'requestIdleCallback' in window
    ? requestIdleCallback(cb, { timeout: 10_000 })
    : setTimeout(cb, 3_000);

scheduleIdle(() => {
  import("./components/Frogsworth/FrogsworthWidget.ts").then(({ initFrogsworth }) => {
    initFrogsworth(() => ({
      from: selectedFromIndex.value !== null
        ? allOptionsRef.value[selectedFromIndex.value].format.format
        : null,
      to: selectedToIndex.value !== null
        ? allOptionsRef.value[selectedToIndex.value].format.format
        : null,
    }));
  }).catch(() => {}); // Easter egg — silent fail is acceptable
});

// --- Footer Confetti ---

const footerConfettiBtn = document.querySelector("#footer-confetti-btn");
if (footerConfettiBtn) {
  footerConfettiBtn.addEventListener("click", () => {
    triggerConfetti();
  });
}
