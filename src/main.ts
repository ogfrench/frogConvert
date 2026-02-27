import type { FileFormat, FileData, FormatHandler, ConvertPathNode } from "./FormatHandler.js";
import normalizeMimeType from "./normalizeMimeType.js";
import handlers from "./handlers";
import { TraversionGraph } from "./TraversionGraph.js";

/** Files currently selected for conversion */
let selectedFiles: File[] = [];

/** Active category filter (empty string = All) */
let activeCategory: string = "";

/** Currently selected format indices */
let selectedFromIndex: number | null = null;
let selectedToIndex: number | null = null;

/** Handlers that support conversion from any formats. */
const conversionsFromAnyInput: ConvertPathNode[] = handlers
  .filter(h => h.supportAnyInput && h.supportedFormats)
  .flatMap(h => h.supportedFormats!
    .filter(f => f.to)
    .map(f => ({ handler: h, format: f })))

const ui = {
  fileInput: document.querySelector("#file-input") as HTMLInputElement,
  uploadZone: document.querySelector("#upload-zone") as HTMLDivElement,
  uploadText: document.querySelector("#upload-zone .upload-text") as HTMLParagraphElement,
  uploadHint: document.querySelector("#upload-zone .upload-hint") as HTMLParagraphElement,
  uploadFileInfo: document.querySelector(".upload-file-info") as HTMLDivElement,
  uploadFileName: document.querySelector(".upload-file-name") as HTMLSpanElement,
  uploadLabel: document.querySelector("#upload-label") as HTMLLabelElement,
  replaceFileBtn: document.querySelector("#replace-file-btn") as HTMLButtonElement,
  removeFileBtn: document.querySelector("#remove-file-btn") as HTMLButtonElement,
  convertButton: document.querySelector("#convert-button") as HTMLButtonElement,
  themeToggleButton: document.querySelector("#theme-toggle") as HTMLButtonElement,
  toSelector: document.querySelector("#to-selector") as HTMLButtonElement,
  toDropdown: document.querySelector("#to-dropdown") as HTMLDivElement,
  toOptions: document.querySelector("#to-options") as HTMLDivElement,
  toSearch: document.querySelector("#to-dropdown .dropdown-search") as HTMLInputElement,
  categoryTabs: document.querySelector("#category-tabs") as HTMLElement,
  popupBox: document.querySelector("#popup") as HTMLDivElement,
  popupBackground: document.querySelector("#popup-bg") as HTMLDivElement
};

// --- Theme toggle ---
function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
  ui.themeToggleButton.innerHTML = dark ? "&#9788;" : "&#9790;";
}

const savedTheme = localStorage.getItem("theme");
if (savedTheme === "dark" || (!savedTheme && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
  applyTheme(true);
}

ui.themeToggleButton.addEventListener("click", () => {
  const isDark = document.documentElement.classList.contains("dark");
  applyTheme(!isDark);
  localStorage.setItem("theme", isDark ? "light" : "dark");
});

// --- Category helpers ---

/** Category display order and mapping */
const CATEGORY_MAP: Record<string, string[]> = {
  image: ["image", "vector"],
  audio: ["audio"],
  video: ["video"],
  document: ["document", "text", "spreadsheet", "presentation"],
  data: ["data"],
  archive: ["archive"],
  font: ["font"],
  code: ["code"],
};

const CATEGORY_LABELS: Record<string, string> = {
  image: "Image",
  audio: "Audio",
  video: "Video",
  document: "Document",
  data: "Data",
  archive: "Archive",
  font: "Font",
  code: "Code",
  other: "Other",
};

/** Per-category upload text (blurb is always the same) */
const CATEGORY_UPLOAD_TEXT: Record<string, { upload: string; uploadLabel: string }> = {
  "": { upload: "Click to add your file", uploadLabel: "Upload your file for conversion" },
  image: { upload: "Click to add your file", uploadLabel: "Upload your file for conversion to an image file" },
  audio: { upload: "Click to add your file", uploadLabel: "Upload your file for conversion to an audio file" },
  video: { upload: "Click to add your file", uploadLabel: "Upload your file for conversion to a video file" },
  document: { upload: "Click to add your file", uploadLabel: "Upload your file for conversion to a document file" },
  data: { upload: "Click to add your file", uploadLabel: "Upload your file for conversion to a data file" },
  archive: { upload: "Click to add your file", uploadLabel: "Upload your file for conversion to an archive file" },
  font: { upload: "Click to add your file", uploadLabel: "Upload your file for conversion to a font file" },
  code: { upload: "Click to add your file", uploadLabel: "Upload your file for conversion to a code file" },
  other: { upload: "Click to add your file", uploadLabel: "Upload your file for conversion" },
};

function getFormatCategory(format: FileFormat): string {
  if (format.category) {
    const cats = Array.isArray(format.category) ? format.category : [format.category];
    for (const cat of cats) {
      for (const [displayCat, rawCats] of Object.entries(CATEGORY_MAP)) {
        if (rawCats.includes(cat)) return displayCat;
      }
    }
  }
  const mime = format.mime || "";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("font/")) return "font";
  if (mime.startsWith("text/x-") || mime === "text/x-python" || mime === "application/x-sh") return "code";
  if (mime.startsWith("text/")) return "document";
  if (["application/json", "application/xml", "application/yaml"].some(m => mime === m)) return "data";
  if (mime.startsWith("application/zip") || mime.includes("compressed") || mime.includes("archive")) return "archive";
  if (mime.startsWith("application/vnd.")) return "document";
  if (mime === "application/pdf") return "document";
  return "other";
}

// --- Dropdown logic ---

function closeDropdown() {
  ui.toDropdown.classList.remove("open");
}

function openDropdown() {
  ui.toDropdown.classList.add("open");
  ui.toSearch.value = "";
  ui.toSearch.focus();
  filterDropdownOptions("");
}

function filterDropdownOptions(query: string) {
  const options = ui.toOptions;
  const q = query.toLowerCase();
  let lastHeaderVisible = false;
  let lastHeader: HTMLElement | null = null;

  for (const child of Array.from(options.children)) {
    const el = child as HTMLElement;
    if (el.classList.contains("dropdown-group-header")) {
      el.style.display = "none";
      lastHeader = el;
      lastHeaderVisible = false;
    } else if (el.classList.contains("dropdown-option")) {
      const text = el.textContent?.toLowerCase() || "";
      const idx = el.getAttribute("data-index");
      let extMatch = false;
      if (idx) {
        const opt = allOptions[parseInt(idx)];
        if (opt) extMatch = opt.format.extension.toLowerCase().includes(q);
      }
      if (!q || text.includes(q) || extMatch) {
        el.style.display = "";
        if (lastHeader && !lastHeaderVisible) {
          lastHeader.style.display = "";
          lastHeaderVisible = true;
        }
      } else {
        el.style.display = "none";
      }
    }
  }
}

function updateConvertButtonState() {
  if (selectedFromIndex !== null && selectedToIndex !== null) {
    ui.convertButton.className = "";
  } else {
    ui.convertButton.className = "disabled";
  }
}

function setSelectorText(selector: HTMLButtonElement, index: number) {
  const opt = allOptions[index];
  if (!opt) return;
  const textEl = selector.querySelector(".selector-text") as HTMLSpanElement;
  const formatDescriptor = opt.format.format.toUpperCase();
  const cleanName = opt.format.name
    .split("(").join(")").split(")")
    .filter((_, i) => i % 2 === 0)
    .filter(c => c !== "")
    .join(" ");
  textEl.textContent = `${formatDescriptor} — ${cleanName}`;
  textEl.classList.remove("placeholder");
}

function resetSelector(selector: HTMLButtonElement) {
  const textEl = selector.querySelector(".selector-text") as HTMLSpanElement;
  textEl.textContent = "Select format...";
  textEl.classList.add("placeholder");
}

function selectToFormat(index: number) {
  selectedToIndex = index;
  setSelectorText(ui.toSelector, index);
  updateConvertButtonState();
  closeDropdown();
}

// Selector click handler
ui.toSelector.addEventListener("click", () => {
  if (ui.toDropdown.classList.contains("open")) {
    closeDropdown();
  } else {
    openDropdown();
  }
});

// Search handler
ui.toSearch.addEventListener("input", () => {
  filterDropdownOptions(ui.toSearch.value);
});

// Close dropdown when clicking outside
document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (!target.closest("#to-field")) {
    closeDropdown();
  }
});

// --- Category tabs ---
function updateCategoryText() {
  const text = CATEGORY_UPLOAD_TEXT[activeCategory] || CATEGORY_UPLOAD_TEXT[""];
  // Only update upload text if no file is selected
  if (!selectedFiles.length) {
    ui.uploadText.textContent = text.upload;
    ui.uploadLabel.textContent = text.uploadLabel;
  }
  // Blurb is always the same — no need to update
}

ui.categoryTabs.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (!target.classList.contains("cat-tab")) return;

  for (const tab of Array.from(ui.categoryTabs.children)) {
    tab.classList.remove("active");
  }
  target.classList.add("active");

  activeCategory = target.getAttribute("data-category") || "";
  updateCategoryText();
  renderDropdownOptions();
});

// --- Upload zone ---
ui.uploadZone.addEventListener("click", (e) => {
  // Don't open file picker if clicking action buttons
  const target = e.target as HTMLElement;
  if (target.closest(".upload-file-actions")) return;
  ui.fileInput.click();
});

// Drag-and-drop visual feedback
ui.uploadZone.addEventListener("dragenter", (e) => {
  e.preventDefault();
  ui.uploadZone.classList.add("drag-over");
});
ui.uploadZone.addEventListener("dragleave", () => {
  ui.uploadZone.classList.remove("drag-over");
});
ui.uploadZone.addEventListener("dragover", (e) => {
  e.preventDefault();
});
ui.uploadZone.addEventListener("drop", (e) => {
  ui.uploadZone.classList.remove("drag-over");
});

// --- Clear / Replace file ---
function clearFile() {
  selectedFiles = [];
  selectedFromIndex = null;
  ui.fileInput.value = "";

  // Restore upload zone to initial state
  ui.uploadText.style.display = "";
  ui.uploadHint.style.display = "";
  ui.uploadFileInfo.classList.remove("visible");
  ui.uploadFileName.textContent = "";
  ui.uploadZone.classList.remove("has-file");

  // Restore label to category-appropriate text
  const text = CATEGORY_UPLOAD_TEXT[activeCategory] || CATEGORY_UPLOAD_TEXT[""];
  ui.uploadLabel.textContent = text.uploadLabel;

  updateConvertButtonState();
}

ui.removeFileBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  clearFile();
});

ui.replaceFileBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  ui.fileInput.click();
});

/**
 * Validates and stores user selected files.
 */
const fileSelectHandler = (event: Event) => {
  let inputFiles;

  if (event instanceof DragEvent) {
    inputFiles = event.dataTransfer?.files;
    if (inputFiles) event.preventDefault();
  } else if (event instanceof ClipboardEvent) {
    inputFiles = event.clipboardData?.files;
  } else {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    inputFiles = target.files;
  }

  if (!inputFiles) return;
  const files = Array.from(inputFiles);
  if (files.length === 0) return;

  if (files.some(c => c.type !== files[0].type)) {
    return alert("All input files must be of the same type.");
  }
  files.sort((a, b) => a.name === b.name ? 0 : (a.name < b.name ? -1 : 1));
  selectedFiles = files;

  // Update upload zone to show file name with action buttons
  const displayName = files.length > 1
    ? `${files[0].name} (+${files.length - 1} more)`
    : files[0].name;

  ui.uploadText.style.display = "none";
  ui.uploadHint.style.display = "none";
  ui.uploadFileName.textContent = displayName;
  ui.uploadFileInfo.classList.add("visible");
  ui.uploadZone.classList.add("has-file");

  let mimeType = normalizeMimeType(files[0].type);
  const fileExtension = files[0].name.split(".").pop()?.toLowerCase();

  // Find matching format by MIME type
  const matchingByMime = allOptions.filter((opt) =>
    opt.format.from && opt.format.mime === mimeType
  );

  let matchIndex = -1;
  if (matchingByMime.length > 1) {
    const extMatch = matchingByMime.find(opt => opt.format.extension === fileExtension);
    matchIndex = extMatch ? allOptions.indexOf(extMatch) : allOptions.indexOf(matchingByMime[0]);
  } else if (matchingByMime.length === 1) {
    matchIndex = allOptions.indexOf(matchingByMime[0]);
  }

  if (matchIndex === -1 && fileExtension) {
    const extMatch = allOptions.find(opt => opt.format.from && opt.format.extension.toLowerCase() === fileExtension);
    if (extMatch) matchIndex = allOptions.indexOf(extMatch);
  }

  if (matchIndex >= 0) {
    selectedFromIndex = matchIndex;
    const fmt = allOptions[matchIndex].format;
    ui.uploadLabel.textContent = `Detected: ${fmt.format.toUpperCase()}`;
  } else {
    selectedFromIndex = null;
  }
  updateConvertButtonState();
};

ui.fileInput.addEventListener("change", fileSelectHandler);
window.addEventListener("drop", fileSelectHandler);
window.addEventListener("dragover", e => e.preventDefault());
window.addEventListener("paste", fileSelectHandler);

// --- Popup ---
window.showPopup = function (html: string) {
  ui.popupBox.innerHTML = html;
  ui.popupBox.style.display = "block";
  ui.popupBackground.style.display = "block";
}
window.hidePopup = function () {
  ui.popupBox.style.display = "none";
  ui.popupBackground.style.display = "none";
}

// --- Format data ---
const allOptions: Array<{ format: FileFormat, handler: FormatHandler }> = [];

window.supportedFormatCache = new Map();
window.traversionGraph = new TraversionGraph();

window.printSupportedFormatCache = () => {
  const entries = [];
  for (const entry of window.supportedFormatCache) {
    entries.push(entry);
  }
  return JSON.stringify(entries, null, 2);
}


/**
 * Renders dropdown options for the to-dropdown based on
 * current allOptions and activeCategory.
 */
function renderDropdownOptions() {
  ui.toOptions.innerHTML = "";

  const toGroups = new Map<string, Array<{ index: number, text: string }>>();
  const seenTo = new Set<string>();

  for (let i = 0; i < allOptions.length; i++) {
    const { format, handler } = allOptions[i];
    if (!format.mime) continue;

    const cat = getFormatCategory(format);
    if (activeCategory && cat !== activeCategory) continue;

    const dedupeKey = `${format.mime}::${format.format}`;
    const formatDescriptor = format.format.toUpperCase();
    const cleanName = format.name
      .split("(").join(")").split(")")
      .filter((_, idx) => idx % 2 === 0)
      .filter(c => c !== "")
      .join(" ");
    const displayText = `${formatDescriptor} — ${cleanName} (${format.mime})`;

    if (format.to) {
      if (!seenTo.has(dedupeKey)) {
        seenTo.add(dedupeKey);
        if (!toGroups.has(cat)) toGroups.set(cat, []);
        toGroups.get(cat)!.push({ index: i, text: displayText });
      }
    }
  }

  const categoryOrder = ["image", "audio", "video", "document", "data", "archive", "font", "code", "other"];
  const showHeaders = !activeCategory;

  for (const cat of categoryOrder) {
    const items = toGroups.get(cat);
    if (!items || items.length === 0) continue;

    if (showHeaders) {
      const header = document.createElement("div");
      header.className = "dropdown-group-header";
      header.textContent = CATEGORY_LABELS[cat] || cat;
      ui.toOptions.appendChild(header);
    }

    for (const item of items) {
      const btn = document.createElement("button");
      btn.className = "dropdown-option";
      btn.setAttribute("data-index", item.index.toString());
      btn.textContent = item.text;
      btn.addEventListener("click", () => selectToFormat(item.index));
      ui.toOptions.appendChild(btn);
    }
  }
}

/**
 * Builds the allOptions array from handlers and renders dropdowns.
 */
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
  renderDropdownOptions();
  window.hidePopup();
}

// --- Init ---
(async () => {
  try {
    const cacheJSON = await fetch("cache.json").then(r => r.json());
    window.supportedFormatCache = new Map(cacheJSON);
  } catch {
    console.warn(
      "Missing supported format precache.\n\n" +
      "Consider saving the output of printSupportedFormatCache() to cache.json."
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

  ui.popupBox.innerHTML = `<h2>Finding conversion route...</h2>
    <p>Trying <b>${pathString}</b>...</p>`;

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
        && c.format === path[i].format.format
      )!;
      files = (await Promise.all([
        handler.doConvert(files, inputFormat, path[i + 1].format),
        new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      ]))[0];
      if (files.some(c => !c.bytes.length)) throw "Output is empty.";
    } catch (e) {
      console.log(path.map(c => c.format.format));
      console.error(handler.name, `${path[i].format.format} → ${path[i + 1].format.format}`, e);

      const deadEndPath = path.slice(0, i + 2);
      deadEndAttempts.push(deadEndPath);
      window.traversionGraph.addDeadEndPath(path.slice(0, i + 2));

      ui.popupBox.innerHTML = `<h2>Finding conversion route...</h2>
        <p>Looking for a valid path...</p>`;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      return null;
    }
  }

  return { files, path };
}

window.tryConvertByTraversing = async function (
  files: FileData[],
  from: ConvertPathNode,
  to: ConvertPathNode
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
}

/** Stores converted output files for re-download */
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

ui.convertButton.onclick = async function () {
  const inputFiles = selectedFiles;

  if (inputFiles.length === 0) {
    return alert("Select an input file.");
  }

  if (selectedFromIndex === null) return alert("Could not detect input file format.");
  if (selectedToIndex === null) return alert("Specify output file format.");

  const inputOption = allOptions[selectedFromIndex];
  const outputOption = allOptions[selectedToIndex];

  const inputFormat = inputOption.format;
  const outputFormat = outputOption.format;

  window.showPopup("<h2>Finding conversion route...</h2>");

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
      window.hidePopup();
      return;
    }

    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const output = await window.tryConvertByTraversing(inputFileData, inputOption, outputOption);

    if (!output) {
      window.hidePopup();
      alert("Failed to find conversion route.");
      return;
    }

    lastConvertedFiles = output.files;

    // Download files
    for (const file of output.files) {
      downloadFile(file.bytes, file.name);
    }

    // Build descriptive file names list
    const fileNames = output.files.map(f => f.name).join(", ");
    const fileCount = output.files.length;
    const fileLabel = fileCount === 1 ? "file" : `${fileCount} files`;

    // Show success modal
    window.showPopup(
      `<h2>Conversion complete!</h2>` +
      `<p><b>${selectedFiles[0].name}</b> has been successfully converted to <b>${outputFormat.format.toUpperCase()}</b>.</p>` +
      `<p>Downloaded ${fileLabel}: <b>${fileNames}</b></p>` +
      `<div class="popup-actions">` +
      `<button class="popup-primary" onclick="window.downloadAgain()">Download again</button>` +
      `<button onclick="window.hidePopup()">Close</button>` +
      `</div>`
    );
  } catch (e) {
    window.hidePopup();
    alert("Unexpected error while routing:\n" + e);
    console.error(e);
  }
};

window.downloadAgain = function () {
  downloadAllConvertedFiles();
};
