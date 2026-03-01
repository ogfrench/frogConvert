import JSZip from "jszip";
import { saveAs } from "file-saver";
import type { FileFormat, FileData, FormatHandler, ConvertPathNode } from "./FormatHandler.js";
import handlers, { loadBackgroundHandlers } from "./handlers";
import { TraversionGraph } from "./TraversionGraph.js";
import { triggerConfetti } from "./confetti.js";
import {
  ui,
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
  showFileInUploadZone,
  showDetectedFormat,
  resetUploadZone,
  updateCategoryText,
  findMatchingFormat,
  initModeToggle,
  clearFormatSelection,
  downloadFile,
  setLastConvertedFiles,
  bindConvertButton,
  initResponsiveMenu,
  initSegmentedControls,
  initCursorGlow,
  initFilesModal,
  shortenFileName,
} from "./ui.js";

// --- State ---

let selectedFiles: File[] = [];
let activeCategory: string = "";
let selectedFromIndex: number | null = null;
let selectedToIndex: number | null = null;
const allOptions: Array<{ format: FileFormat; handler: FormatHandler }> = [];

/** Handlers that support conversion from any formats. */
const conversionsFromAnyInput: ConvertPathNode[] = handlers
  .filter(h => h.supportAnyInput && h.supportedFormats)
  .flatMap(h => h.supportedFormats!
    .filter(f => f.to)
    .map(f => ({ handler: h, format: f })));

// --- Init UI ---

initTheme();
initResponsiveMenu();
initSegmentedControls();
initCursorGlow();
initFilesModal();

initModeToggle(() => {
  renderFormatOptions(allOptions, activeCategory, selectToFormat);
});

initFormatModal(allOptions, selectToFormat);

initCategoryTabs((category) => {
  activeCategory = category;
  updateCategoryText(activeCategory, selectedFiles.length > 0);
  renderFormatOptions(allOptions, activeCategory, selectToFormat);
  if (selectedToIndex === null) {
    clearFormatSelection(activeCategory);
  }
});

initUploadZone(
  (files) => {
    selectedFiles = files;
    showFileInUploadZone(files);

    const matchIndex = findMatchingFormat(files, allOptions);
    if (matchIndex >= 0) {
      selectedFromIndex = matchIndex;
      showDetectedFormat(allOptions[matchIndex].format.format, files.length);
    } else {
      selectedFromIndex = null;
    }
    updateConvertButtonState(selectedFromIndex, selectedToIndex);
  },
  () => {
    selectedFiles = [];
    selectedFromIndex = null;
    resetUploadZone(activeCategory);
    updateConvertButtonState(selectedFromIndex, selectedToIndex);
  },
);

function selectToFormat(index: number) {
  selectedToIndex = index;
  setSelectedFormat(index, allOptions);
  updateConvertButtonState(selectedFromIndex, selectedToIndex);
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
      console.warn(`Cache miss for formats of handler "${handler.name}".`);
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
      allOptions.push({ format, handler });
    }
  }
}

function refreshUI() {
  window.traversionGraph.init(window.supportedFormatCache, handlers);
  renderFormatOptions(allOptions, activeCategory, selectToFormat);
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
      const cacheJSON = await fetch("cache.json").then(r => r.json());
      window.supportedFormatCache = new Map(cacheJSON);
    } catch {
      console.warn(
        "Missing supported format precache.\n\n" +
        "Consider saving the output of printSupportedFormatCache() to cache.json.",
      );
    }
  }

  // Phase 1: core handlers (already in handlers array)
  await loadHandlerFormats(handlers);
  refreshUI();
  console.log(`Phase 1: ${handlers.length} core handlers loaded.`);

  // Phase 2: dynamically load remaining handlers in background
  setTimeout(async () => {
    const countBefore = handlers.length;
    await loadBackgroundHandlers();
    await loadHandlerFormats(handlers.slice(countBefore));
    refreshUI();
    // Persist cache for next page load
    try {
      const entries = [...window.supportedFormatCache.entries()];
      localStorage.setItem("supportedFormatCache", JSON.stringify(entries));
    } catch (_) { }
    console.log(`Phase 2: ${handlers.length - countBefore} background handlers loaded.`);
  }, 0);
})();

// --- Conversion logic ---

let deadEndAttempts: ConvertPathNode[][];

async function attemptConvertPath(files: FileData[], path: ConvertPathNode[], batchMsg?: string) {
  const pathString = path.map(c => c.format.format).join(" \u2192 ");

  for (const deadEnd of deadEndAttempts) {
    let isDeadEnd = true;
    for (let i = 0; i < deadEnd.length; i++) {
      if (path[i] === deadEnd[i]) continue;
      isDeadEnd = false;
      break;
    }
    if (isDeadEnd) {
      const deadEndString = deadEnd.slice(-2).map(c => c.format.format).join(" \u2192 ");
      console.warn(`Skipping ${pathString} due to dead end near ${deadEndString}.`);
      return null;
    }
  }

  const messageHTML = batchMsg
    ? `${batchMsg}<br><span class="muted-text">Path: ${pathString}</span>`
    : `Converting <b>${pathString}</b>`;

  const existingSpinner = ui.popupBox.querySelector(".loader-spinner");
  if (existingSpinner) {
    const p = ui.popupBox.querySelector("p");
    if (p) p.innerHTML = messageHTML;
    const h2 = ui.popupBox.querySelector("h2");
    if (h2) h2.textContent = "Converting... 🐸";
  } else {
    ui.popupBox.innerHTML = `<div class="loader-spinner"></div>
      <h2>Converting... 🐸</h2>
      <p>${messageHTML}</p>`;
  }

  for (let i = 0; i < path.length - 1; i++) {
    const handler = path[i + 1].handler;
    try {
      let supportedFormats = window.supportedFormatCache.get(handler.name);
      if (!handler.ready) {
        await handler.init();
        if (!handler.ready) throw `Handler "${handler.name}" not ready after init.`;
        if (handler.supportedFormats) {
          window.supportedFormatCache.set(handler.name, handler.supportedFormats);
          supportedFormats = handler.supportedFormats;
        }
      }
      if (!supportedFormats) throw `Handler "${handler.name}" doesn't support any formats.`;
      const inputFormat = supportedFormats.find(c =>
        c.from
        && c.mime === path[i].format.mime
        && c.format === path[i].format.format,
      )!;
      files = (await Promise.all([
        handler.doConvert(files, inputFormat, path[i + 1].format),
        new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      ]))[0];
      if (files.some(c => !c.bytes.length)) throw "Output is empty.";
    } catch (e) {
      console.log(path.map(c => c.format.format));
      console.error(handler.name, `${path[i].format.format} \u2192 ${path[i + 1].format.format}`, e);

      const deadEndPath = path.slice(0, i + 2);
      deadEndAttempts.push(deadEndPath);
      window.traversionGraph.addDeadEndPath(path.slice(0, i + 2));

      const fallbackMsg = batchMsg
        ? `${batchMsg}<br><span class="muted-text">Trying another approach...</span>`
        : `Trying another approach...`;

      const existingSpinner = ui.popupBox.querySelector(".loader-spinner");
      if (existingSpinner) {
        const p = ui.popupBox.querySelector("p");
        if (p) p.innerHTML = fallbackMsg;
      } else {
        ui.popupBox.innerHTML = `<div class="loader-spinner"></div>
          <h2>Converting... 🐸</h2>
          <p>${fallbackMsg}</p>`;
      }
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      return null;
    }
  }

  return { files, path };
}

window.tryConvertByTraversing = async function (
  files: FileData[],
  from: ConvertPathNode,
  to: ConvertPathNode,
  batchMsg?: string
) {
  deadEndAttempts = [];
  window.traversionGraph.clearDeadEndPaths();
  for await (const path of window.traversionGraph.searchPath(from, to, true)) {
    if (path.at(-1)?.handler === to.handler) {
      path[path.length - 1] = to;
    }
    const attempt = await attemptConvertPath(files, path, batchMsg);
    if (attempt) return attempt;
  }
  return null;
};

// --- Convert button ---

bindConvertButton(async function () {
  const inputFiles = selectedFiles;
  const fileCount = inputFiles.length;

  if (fileCount === 0) {
    alert("Drop a file in to get started!");
    return;
  }

  if (selectedFromIndex === null) {
    alert("Hmm, couldn't figure out this file's format. Try another?");
    return;
  }
  if (selectedToIndex === null) {
    alert("Pick a format to convert to first!");
    return;
  }

  const inputOption = allOptions[selectedFromIndex];
  const outputOption = allOptions[selectedToIndex];

  const inputFormat = inputOption.format;
  const outputFormat = outputOption.format;

  showPopup(`<div class="loader-spinner"></div><h2>Converting... 🐸</h2>`);
  const conversionStartTime = performance.now();

  try {
    const inputFileData: FileData[] = [];
    let sameFormatCount = 0;

    for (const inputFile of inputFiles) {
      const inputBuffer = await inputFile.arrayBuffer();
      const inputBytes = new Uint8Array(inputBuffer);
      if (
        inputFormat.mime === outputFormat.mime
        && inputFormat.format === outputFormat.format
      ) {
        downloadFile(inputBytes, inputFile.name);
        sameFormatCount++;
        continue;
      }
      inputFileData.push({ name: inputFile.name, bytes: inputBytes });
    }

    if (inputFileData.length === 0) {
      // All files were same-format
      const fmt = outputFormat.format.toUpperCase();
      if (fileCount === 1) {
        const truncName = shortenFileName(inputFiles[0].name, 32);
        showPopup(
          `<h2>Already good! 🎉</h2>` +
          `<p><b>${truncName}</b> is already in <b>${fmt}</b> \u2014 nothing to convert.</p>` +
          `<div class="popup-actions">` +
          `<button class="popup-primary" onclick="window.hidePopup()">Close</button>` +
          `</div>`,
        );
      } else {
        showPopup(
          `<h2>Already good! 🎉</h2>` +
          `<p>All ${fileCount} files are already in <b>${fmt}</b> \u2014 nothing to convert.</p>` +
          `<div class="popup-actions">` +
          `<button class="popup-primary" onclick="window.hidePopup()">Close</button>` +
          `</div>`,
        );
      }
      return;
    }

    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    // For multi-file: convert each file individually with progress
    if (inputFileData.length > 1) {
      const allOutputFiles: { name: string; bytes: Uint8Array }[] = [];

      ui.popupBox.innerHTML = `<div class="loader-spinner"></div>
          <h2>Converting... 🐸</h2>
          <p>Starting conversion...</p>`;

      for (let i = 0; i < inputFileData.length; i++) {
        const batchMsg = `${i + 1} out of ${inputFileData.length} files converting`;

        const singleFile = [inputFileData[i]];
        const output = await window.tryConvertByTraversing(singleFile, inputOption, outputOption, batchMsg);

        if (!output) {
          showPopup(
            `<h2>Not available yet</h2>` +
            `<p><b>${inputFormat.format.toUpperCase()}</b> to <b>${outputFormat.format.toUpperCase()}</b> isn't available right now \u2014 but more formats are on the way!</p>` +
            `<p class="muted-text">Try picking a different format, there's loads to choose from!</p>` +
            `<div class="popup-actions">` +
            `<button class="popup-primary" onclick="window.hidePopup()">Got it</button>` +
            `</div>`
          );
          triggerConfetti();
          return;
        }

        allOutputFiles.push(...output.files);
      }

      setLastConvertedFiles(allOutputFiles);

      if (allOutputFiles.length > 1) {
        const existingSpinner = ui.popupBox.querySelector(".loader-spinner");
        if (existingSpinner) {
          const p = ui.popupBox.querySelector("p");
          if (p) p.innerHTML = "Preparing download";
          const h2 = ui.popupBox.querySelector("h2");
          if (h2) h2.textContent = "Zipping... 🐸";
        } else {
          ui.popupBox.innerHTML = `<div class="loader-spinner"></div>
            <h2>Zipping... 🐸</h2>
            <p>Preparing download</p>`;
        }

        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        const zip = new JSZip();
        for (const file of allOutputFiles) {
          zip.file(file.name, file.bytes);
        }

        const blob = await zip.generateAsync({ type: "blob" });
        saveAs(blob, `converted_files_${Date.now()}.zip`);
      } else {
        for (const file of allOutputFiles) {
          downloadFile(file.bytes, file.name);
        }
      }

      // Ensure the working modal shows for at least 600ms
      const elapsed = performance.now() - conversionStartTime;
      if (elapsed < 600) {
        await new Promise(resolve => setTimeout(resolve, 600 - elapsed));
      }

      showPopup(
        `<h2>All done! 🎉</h2>` +
        `<p>Converted ${allOutputFiles.length} files to <b>${outputFormat.format.toUpperCase()}</b>.</p>` +
        `<p>Your files have been downloaded!</p>` +
        `<div class="popup-actions">` +
        `<button class="popup-primary" onclick="window.downloadAgain()">Download again</button>` +
        `<button onclick="window.hidePopup()">Close</button>` +
        `</div>`,
      );
    } else {
      // Single file conversion
      const output = await window.tryConvertByTraversing(inputFileData, inputOption, outputOption);

      const elapsed = performance.now() - conversionStartTime;
      if (elapsed < 600) {
        await new Promise(resolve => setTimeout(resolve, 600 - elapsed));
      }

      if (!output) {
        showPopup(
          `<h2>Not available yet</h2>` +
          `<p><b>${inputFormat.format.toUpperCase()}</b> to <b>${outputFormat.format.toUpperCase()}</b> isn't available right now \u2014 but more formats are on the way!</p>` +
          `<p class="muted-text">Try picking a different format, there's loads to choose from!</p>` +
          `<div class="popup-actions">` +
          `<button class="popup-primary" onclick="window.hidePopup()">Got it</button>` +
          `</div>`
        );
        triggerConfetti();
        return;
      }

      setLastConvertedFiles(output.files);

      for (const file of output.files) {
        downloadFile(file.bytes, file.name);
      }

      const truncatedInputName = shortenFileName(selectedFiles[0].name, 32);

      showPopup(
        `<h2>Done! 🎉</h2>` +
        `<p>Converted <b>${truncatedInputName}</b> to <b>${outputFormat.format.toUpperCase()}</b>.</p>` +
        `<p>Your file has been downloaded!</p>` +
        `<div class="popup-actions">` +
        `<button class="popup-primary" onclick="window.downloadAgain()">Download again</button>` +
        `<button onclick="window.hidePopup()">Close</button>` +
        `</div>`,
      );
    }
  } catch (e) {
    hidePopup();
    alert("Something went wrong:\n" + e);
    console.error(e);
  }
});

// --- Footer Confetti ---

const footerConfettiBtn = document.querySelector("#footer-confetti-btn");
if (footerConfettiBtn) {
  footerConfettiBtn.addEventListener("click", () => {
    triggerConfetti();
  });
}
