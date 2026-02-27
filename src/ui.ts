import type { FileFormat, FormatHandler } from "./FormatHandler.js";
import normalizeMimeType from "./normalizeMimeType.js";

// --- DOM element references ---
export const ui = {
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
  modeToggleButton: document.querySelector("#mode-toggle") as HTMLButtonElement,
  toSelector: document.querySelector("#to-selector") as HTMLButtonElement,
  toDropdown: document.querySelector("#to-dropdown") as HTMLDivElement,
  toOptions: document.querySelector("#to-options") as HTMLDivElement,
  toSearch: document.querySelector("#to-dropdown .dropdown-search") as HTMLInputElement,
  formatModalBg: document.querySelector("#format-modal-bg") as HTMLDivElement,
  formatModalClose: document.querySelector("#format-modal-close") as HTMLButtonElement,
  formatModalTitle: document.querySelector("#format-modal-title") as HTMLHeadingElement,
  categoryTabs: document.querySelector("#category-tabs") as HTMLElement,
  popupBox: document.querySelector("#popup") as HTMLDivElement,
  popupBackground: document.querySelector("#popup-bg") as HTMLDivElement,
};

// --- Constants ---

export const CATEGORY_MAP: Record<string, string[]> = {
  image: ["image", "vector"],
  audio: ["audio"],
  video: ["video"],
  document: ["document", "text", "spreadsheet", "presentation"],
  data: ["data"],
  archive: ["archive"],
  font: ["font"],
  code: ["code"],
};

export const CATEGORY_LABELS: Record<string, string> = {
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

const CATEGORY_UPLOAD_TEXT: Record<string, { upload: string; uploadLabel: string }> = {
  "": { upload: "Drop your file in here!", uploadLabel: "Your file" },
  image: { upload: "Drop your file in here!", uploadLabel: "Your file" },
  audio: { upload: "Drop your file in here!", uploadLabel: "Your file" },
  video: { upload: "Drop your file in here!", uploadLabel: "Your file" },
  document: { upload: "Drop your file in here!", uploadLabel: "Your file" },
  data: { upload: "Drop your file in here!", uploadLabel: "Your file" },
  archive: { upload: "Drop your file in here!", uploadLabel: "Your file" },
  font: { upload: "Drop your file in here!", uploadLabel: "Your file" },
  code: { upload: "Drop your file in here!", uploadLabel: "Your file" },
  other: { upload: "Drop your file in here!", uploadLabel: "Your file" },
};

// --- Basic mode format whitelist (common consulting/design formats) ---
const BASIC_FORMATS = new Set([
  // Image
  "png", "jpeg", "webp", "gif", "svg", "tiff", "bmp", "ico",
  // Audio
  "mp3", "wav", "ogg", "flac", "aac",
  // Video
  "mp4", "webm", "mov", "avi",
  // Document
  "pdf", "docx", "xlsx", "pptx", "html", "markdown", "text", "csv",
  // Data
  "json", "xml", "yaml",
  // Archive
  "zip",
  // Font
  "ttf", "otf", "woff", "woff2",
]);

let _isAdvancedMode = localStorage.getItem("formatMode") === "advanced";

// --- Category helpers ---

export function getFormatCategory(format: FileFormat): string {
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

// --- Theme ---

export function initTheme() {
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
}

// --- Mode Toggle ---

export function initModeToggle(onModeChanged: () => void) {
  function applyMode(advanced: boolean) {
    _isAdvancedMode = advanced;
    ui.modeToggleButton.textContent = advanced ? "All Formats" : "Core Formats";
    localStorage.setItem("formatMode", advanced ? "advanced" : "basic");
  }

  applyMode(_isAdvancedMode);

  ui.modeToggleButton.addEventListener("click", () => {
    applyMode(!_isAdvancedMode);
    onModeChanged();
  });
}

// --- Popup ---

export function showPopup(html: string) {
  ui.popupBox.innerHTML = html;
  ui.popupBox.style.display = "block";
  ui.popupBackground.style.display = "block";
}

export function hidePopup() {
  ui.popupBox.style.display = "none";
  ui.popupBackground.style.display = "none";
}

// --- Format modal ---

let _allOptionsRef: Array<{ format: FileFormat; handler: FormatHandler }> = [];
let _activeCategory: string = "";

export function closeFormatModal() {
  ui.toDropdown.classList.remove("open");
  ui.formatModalBg.classList.remove("open");
}

export function openFormatModal() {
  ui.toDropdown.classList.add("open");
  ui.formatModalBg.classList.add("open");
  const label = CATEGORY_LABELS[_activeCategory];
  ui.formatModalTitle.textContent = label ? `Select ${label.toLowerCase()} format` : "Select format";
  ui.toSearch.value = "";
  ui.toSearch.focus();
  filterFormatOptions("");
}

export function filterFormatOptions(query: string) {
  const allOptions = _allOptionsRef;
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

export function initFormatModal(
  allOptions: Array<{ format: FileFormat; handler: FormatHandler }>,
  onSelectFormat: (index: number) => void,
) {
  _allOptionsRef = allOptions;

  ui.toSelector.addEventListener("click", () => {
    if (ui.toDropdown.classList.contains("open")) {
      closeFormatModal();
    } else {
      openFormatModal();
    }
  });

  ui.toSearch.addEventListener("input", () => {
    filterFormatOptions(ui.toSearch.value);
  });

  ui.formatModalBg.addEventListener("click", () => closeFormatModal());
  ui.formatModalClose.addEventListener("click", () => closeFormatModal());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && ui.toDropdown.classList.contains("open")) {
      closeFormatModal();
    }
  });
}

export function setSelectorText(index: number, allOptions: Array<{ format: FileFormat; handler: FormatHandler }>) {
  const opt = allOptions[index];
  if (!opt) return;
  const textEl = ui.toSelector.querySelector(".selector-text") as HTMLSpanElement;
  const formatDescriptor = opt.format.format.toUpperCase();
  const cleanName = opt.format.name
    .split("(").join(")").split(")")
    .filter((_, i) => i % 2 === 0)
    .filter(c => c !== "")
    .join(" ");
  textEl.textContent = `${formatDescriptor} — ${cleanName}`;
  textEl.classList.remove("placeholder");
}

export function resetSelector(activeCategory: string = "") {
  const textEl = ui.toSelector.querySelector(".selector-text") as HTMLSpanElement;
  if (activeCategory && CATEGORY_LABELS[activeCategory]) {
    textEl.textContent = `Select ${CATEGORY_LABELS[activeCategory]} format...`;
  } else {
    textEl.textContent = "Select format...";
  }
  textEl.classList.add("placeholder");
}

export function updateConvertButtonState(selectedFromIndex: number | null, selectedToIndex: number | null) {
  if (selectedFromIndex !== null && selectedToIndex !== null) {
    ui.convertButton.className = "";
  } else {
    ui.convertButton.className = "disabled";
  }
}

// --- Dropdown rendering ---

export function renderDropdownOptions(
  allOptions: Array<{ format: FileFormat; handler: FormatHandler }>,
  activeCategory: string,
  onSelectFormat: (index: number) => void,
) {
  _activeCategory = activeCategory;
  ui.toOptions.innerHTML = "";

  const toGroups = new Map<string, Array<{ index: number; text: string }>>();
  const seenTo = new Set<string>();

  for (let i = 0; i < allOptions.length; i++) {
    const { format } = allOptions[i];
    if (!format.mime) continue;

    const cat = getFormatCategory(format);
    if (activeCategory && cat !== activeCategory) continue;

    if (!_isAdvancedMode && !BASIC_FORMATS.has(format.format.toLowerCase())) {
      continue;
    }

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
      btn.addEventListener("click", () => onSelectFormat(item.index));
      ui.toOptions.appendChild(btn);
    }
  }
}

// --- Category tabs ---

export function initCategoryTabs(
  onCategoryChange: (category: string) => void,
) {
  ui.categoryTabs.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains("cat-tab")) return;

    for (const tab of Array.from(ui.categoryTabs.children)) {
      tab.classList.remove("active");
    }
    target.classList.add("active");

    const category = target.getAttribute("data-category") || "";
    onCategoryChange(category);
  });
}

export function updateCategoryText(activeCategory: string, hasFiles: boolean) {
  const text = CATEGORY_UPLOAD_TEXT[activeCategory] || CATEGORY_UPLOAD_TEXT[""];
  if (!hasFiles) {
    ui.uploadText.textContent = text.upload;
    ui.uploadLabel.textContent = text.uploadLabel;
  }
}

// --- Upload zone ---

export function initUploadZone(
  onFilesSelected: (files: File[]) => void,
  onClearFile: () => void,
) {
  ui.uploadZone.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.closest(".upload-file-actions")) return;
    ui.fileInput.click();
  });

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
  ui.uploadZone.addEventListener("drop", () => {
    ui.uploadZone.classList.remove("drag-over");
  });

  ui.removeFileBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    onClearFile();
  });

  ui.replaceFileBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    ui.fileInput.click();
  });

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
    onFilesSelected(files);
  };

  ui.fileInput.addEventListener("change", fileSelectHandler);
  window.addEventListener("drop", fileSelectHandler);
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("paste", fileSelectHandler);
}

export function showFileInUploadZone(files: File[]) {
  const displayName = files.length > 1
    ? `${files[0].name} (+${files.length - 1} more)`
    : files[0].name;

  ui.uploadText.style.display = "none";
  ui.uploadHint.style.display = "none";
  ui.uploadFileName.textContent = displayName;
  ui.uploadFileInfo.classList.add("visible");
  ui.uploadZone.classList.add("has-file");
}

export function showDetectedFormat(formatName: string) {
  ui.uploadLabel.textContent = `Detected format: ${formatName.toUpperCase()}`;
}

export function resetUploadZone(activeCategory: string) {
  ui.fileInput.value = "";
  ui.uploadText.style.display = "";
  ui.uploadHint.style.display = "";
  ui.uploadFileInfo.classList.remove("visible");
  ui.uploadFileName.textContent = "";
  ui.uploadZone.classList.remove("has-file");

  const text = CATEGORY_UPLOAD_TEXT[activeCategory] || CATEGORY_UPLOAD_TEXT[""];
  ui.uploadLabel.textContent = text.uploadLabel;
}

// --- Format matching ---

export function findMatchingFormat(
  files: File[],
  allOptions: Array<{ format: FileFormat; handler: FormatHandler }>,
): number {
  const mimeType = normalizeMimeType(files[0].type);
  const fileExtension = files[0].name.split(".").pop()?.toLowerCase();

  const matchingByMime = allOptions.filter((opt) =>
    opt.format.from && opt.format.mime === mimeType,
  );

  let matchIndex = -1;
  if (matchingByMime.length > 1) {
    const extMatch = matchingByMime.find((opt) => opt.format.extension === fileExtension);
    matchIndex = extMatch ? allOptions.indexOf(extMatch) : allOptions.indexOf(matchingByMime[0]);
  } else if (matchingByMime.length === 1) {
    matchIndex = allOptions.indexOf(matchingByMime[0]);
  }

  if (matchIndex === -1 && fileExtension) {
    const extMatch = allOptions.find(
      (opt) => opt.format.from && opt.format.extension.toLowerCase() === fileExtension,
    );
    if (extMatch) matchIndex = allOptions.indexOf(extMatch);
  }

  return matchIndex;
}

// --- Download & Actions Helpers ---

let lastConvertedFiles: { name: string; bytes: Uint8Array }[] = [];

export function setLastConvertedFiles(files: { name: string; bytes: Uint8Array }[]) {
  lastConvertedFiles = files;
}

export function downloadFile(bytes: Uint8Array, name: string) {
  const blob = new Blob([bytes as BlobPart], { type: "application/octet-stream" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
}

export function downloadAllConvertedFiles() {
  for (const file of lastConvertedFiles) {
    downloadFile(file.bytes, file.name);
  }
}

window.downloadAgain = function () {
  downloadAllConvertedFiles();
};

export function bindConvertButton(onClick: () => Promise<void>) {
  ui.convertButton.onclick = async () => {
    // Disable button to prevent double-clicks
    ui.convertButton.classList.add("disabled");
    try {
      await onClick();
    } finally {
      // Re-enable if we didn't navigate away
      ui.convertButton.classList.remove("disabled");
    }
  };
}
