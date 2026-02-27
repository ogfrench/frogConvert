import type { FileFormat, FileData, FormatHandler, ConvertPathNode } from "./FormatHandler.js";
import handlers from "./handlers";
import { TraversionGraph } from "./TraversionGraph.js";
import {
  ui,
  initTheme,
  initFormatModal,
  initCategoryTabs,
  initUploadZone,
  showPopup,
  hidePopup,
  closeFormatModal,
  setSelectorText,
  updateConvertButtonState,
  renderDropdownOptions,
  showFileInUploadZone,
  showDetectedFormat,
  resetUploadZone,
  updateCategoryText,
  findMatchingFormat,
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

initFormatModal(allOptions, selectToFormat);

initCategoryTabs((category) => {
  activeCategory = category;
  updateCategoryText(activeCategory, selectedFiles.length > 0);
  renderDropdownOptions(allOptions, activeCategory, selectToFormat);
});

initUploadZone(
  (files) => {
    selectedFiles = files;
    showFileInUploadZone(files);

    const matchIndex = findMatchingFormat(files, allOptions);
    if (matchIndex >= 0) {
      selectedFromIndex = matchIndex;
      showDetectedFormat(allOptions[matchIndex].format.format);
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
  setSelectorText(index, allOptions);
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
  const entries = [];
  for (const entry of window.supportedFormatCache) {
    entries.push(entry);
  }
  return JSON.stringify(entries, null, 2);
};

// --- Build option list ---

async function buildOptionList() {
  allOptions.length = 0;

  for (const handler of handlers) {
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

  window.traversionGraph.init(window.supportedFormatCache, handlers);
  renderDropdownOptions(allOptions, activeCategory, selectToFormat);
  hidePopup();
}

// --- Init ---

(async () => {
  try {
    const cacheJSON = await fetch("cache.json").then(r => r.json());
    window.supportedFormatCache = new Map(cacheJSON);
  } catch {
    console.warn(
      "Missing supported format precache.\n\n" +
      "Consider saving the output of printSupportedFormatCache() to cache.json.",
    );
  } finally {
    await buildOptionList();
    console.log("Built initial format list.");
  }
})();

// --- Conversion logic ---

let deadEndAttempts: ConvertPathNode[][];

async function attemptConvertPath(files: FileData[], path: ConvertPathNode[]) {
  const pathString = path.map(c => c.format.format).join(" → ");

  for (const deadEnd of deadEndAttempts) {
    let isDeadEnd = true;
    for (let i = 0; i < deadEnd.length; i++) {
      if (path[i] === deadEnd[i]) continue;
      isDeadEnd = false;
      break;
    }
    if (isDeadEnd) {
      const deadEndString = deadEnd.slice(-2).map(c => c.format.format).join(" → ");
      console.warn(`Skipping ${pathString} due to dead end near ${deadEndString}.`);
      return null;
    }
  }

  ui.popupBox.innerHTML = `<div class="loader-spinner"></div>
    <h2>Converting...</h2>
    <p>Trying <b>${pathString}</b></p>`;

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
      console.error(handler.name, `${path[i].format.format} → ${path[i + 1].format.format}`, e);

      const deadEndPath = path.slice(0, i + 2);
      deadEndAttempts.push(deadEndPath);
      window.traversionGraph.addDeadEndPath(path.slice(0, i + 2));

      ui.popupBox.innerHTML = `<div class="loader-spinner"></div>
        <h2>Converting...</h2>
        <p>Finding an alternative route...</p>`;
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
) {
  deadEndAttempts = [];
  window.traversionGraph.clearDeadEndPaths();
  for await (const path of window.traversionGraph.searchPath(from, to, true)) {
    if (path.at(-1)?.handler === to.handler) {
      path[path.length - 1] = to;
    }
    const attempt = await attemptConvertPath(files, path);
    if (attempt) return attempt;
  }
  return null;
};

// --- Download helpers ---

let lastConvertedFiles: FileData[] = [];

function downloadFile(bytes: Uint8Array, name: string) {
  const blob = new Blob([bytes as BlobPart], { type: "application/octet-stream" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
}

function downloadAllConvertedFiles() {
  for (const file of lastConvertedFiles) {
    downloadFile(file.bytes, file.name);
  }
}

window.downloadAgain = function () {
  downloadAllConvertedFiles();
};

// --- Convert button ---

ui.convertButton.onclick = async function () {
  const inputFiles = selectedFiles;

  if (inputFiles.length === 0) {
    return alert("Please add a file first.");
  }

  if (selectedFromIndex === null) return alert("Couldn't detect this file's format. Try a different file.");
  if (selectedToIndex === null) return alert("Please choose an output format.");

  const inputOption = allOptions[selectedFromIndex];
  const outputOption = allOptions[selectedToIndex];

  const inputFormat = inputOption.format;
  const outputFormat = outputOption.format;

  showPopup(`<div class="loader-spinner"></div><h2>Converting...</h2>`);

  try {
    const inputFileData: FileData[] = [];
    for (const inputFile of inputFiles) {
      const inputBuffer = await inputFile.arrayBuffer();
      const inputBytes = new Uint8Array(inputBuffer);
      if (
        inputFormat.mime === outputFormat.mime
        && inputFormat.format === outputFormat.format
      ) {
        downloadFile(inputBytes, inputFile.name);
        continue;
      }
      inputFileData.push({ name: inputFile.name, bytes: inputBytes });
    }

    if (inputFileData.length === 0) {
      hidePopup();
      return;
    }

    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const output = await window.tryConvertByTraversing(inputFileData, inputOption, outputOption);

    if (!output) {
      hidePopup();
      alert("No conversion path found between these formats. Try a different combination.");
      return;
    }

    lastConvertedFiles = output.files;

    for (const file of output.files) {
      downloadFile(file.bytes, file.name);
    }

    const fileNames = output.files.map(f => f.name).join(", ");
    const fileCount = output.files.length;
    const fileLabel = fileCount === 1 ? "file" : `${fileCount} files`;

    showPopup(
      `<h2>Done!</h2>` +
      `<p>Converted <b>${selectedFiles[0].name}</b> to <b>${outputFormat.format.toUpperCase()}</b>.</p>` +
      `<p>Downloaded ${fileLabel}: <b>${fileNames}</b></p>` +
      `<div class="popup-actions">` +
      `<button class="popup-primary" onclick="window.downloadAgain()">Download again</button>` +
      `<button onclick="window.hidePopup()">Close</button>` +
      `</div>`,
    );
  } catch (e) {
    hidePopup();
    alert("Something went wrong during conversion:\n" + e);
    console.error(e);
  }
};
