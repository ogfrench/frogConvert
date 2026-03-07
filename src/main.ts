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
  ui,
} from "./components/index.ts";
import { triggerConfetti } from "./effects/Confetti/Confetti.ts";

// --- Init UI ---

initTheme();
initResponsiveMenu();
initSegmentedControls();
initParallax();
initCustomCursor();
initFilesModal();

initModeToggle(() => {
  renderFormatOptions(allOptionsRef.value, activeCategory.value);
});

initFormatModal(allOptionsRef.value, selectToFormat);

initCategoryTabs((category) => {
  activeCategory.value = category;
  updateCategoryText(currentFiles.value.length > 0);
  renderFormatOptions(allOptionsRef.value, activeCategory.value);
  selectedToIndex.value = null;
  clearFormatSelection(activeCategory.value);
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
      if (category && category !== activeCategory.value) {
        selectCategoryTab(category);
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

async function loadHandlerFormats(subset: FormatHandler[]) {
  for (const handler of subset) {
    if (!window.supportedFormatCache.has(handler.name)) {
      console.debug(`Cache miss for formats of handler "${handler.name}".`);
      try {
        await handler.init();
      } catch (_) { continue; }
      if (handler.supportedFormats) {
        window.supportedFormatCache.set(handler.name, handler.supportedFormats);
        console.info(`Updated supported format cache for "${handler.name}".`);
      }
    }
    const supportedFormats = window.supportedFormatCache.get(handler.name);
    if (!supportedFormats) {
      console.warn(`Handler "${handler.name}" doesn't support any formats.`);
      continue;
    }
    for (const format of supportedFormats) {
      if (!format.mime) continue;
      allOptionsRef.value.push({ format, handler });
    }
  }
}

function refreshUI() {
  window.traversionGraph.init(window.supportedFormatCache, handlers);
  renderFormatOptions(allOptionsRef.value, activeCategory.value);
  if (ui.formatModal.classList.contains("open")) {
    filterFormats(ui.formatSearch.value);
  }
}

// --- Init ---

(async () => {
  // Try localStorage first, then fall back to cache.json
  try {
    const stored = localStorage.getItem("supportedFormatCache");
    if (stored) {
      window.supportedFormatCache = new Map(JSON.parse(stored));
    } else {
      throw "No localStorage cache";
    }
  } catch {
    try {
      const cacheJSON = await fetch("cache.json", { signal: AbortSignal.timeout(5000) }).then(r => r.json());
      window.supportedFormatCache = new Map(cacheJSON);
    } catch {
      console.info(
        "Missing supported format precache.\n\n" +
        "First load dynamically indexing supported formats list.",
      );
    }
  }

  try {
    // Phase 1: core handlers (already in handlers array)
    await loadHandlerFormats(handlers);
    refreshUI();
    console.log(`Phase 1: ${handlers.length} core handlers loaded.`);
  } catch (e) {
    console.error("Phase 1 init failed:", e);
  }

  // Phase 2: dynamically load remaining handlers in background
  setTimeout(async () => {
    const countBefore = handlers.length;
    await loadBackgroundHandlers();
    await loadHandlerFormats(handlers.slice(countBefore));
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
  }, 1000);
})();

// --- Conversion logic ---

initConvertButton();


// --- Footer Confetti ---

const footerConfettiBtn = document.querySelector("#footer-confetti-btn");
if (footerConfettiBtn) {
  footerConfettiBtn.addEventListener("click", () => {
    triggerConfetti();
  });
}
