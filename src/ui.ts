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
  expandFilesBtn: document.querySelector("#expand-files-btn") as HTMLButtonElement,
  replaceFileBtn: document.querySelector("#replace-file-btn") as HTMLButtonElement,
  removeFileBtn: document.querySelector("#remove-file-btn") as HTMLButtonElement,
  convertButton: document.querySelector("#convert-button") as HTMLButtonElement,
  themeToggleButton: document.querySelector("#theme-toggle") as HTMLButtonElement,
  modeToggleButton: document.querySelector("#mode-toggle") as HTMLButtonElement,
  formatSelector: document.querySelector("#format-selector") as HTMLButtonElement,
  formatModal: document.querySelector("#format-modal") as HTMLDivElement,
  formatOptions: document.querySelector("#format-options") as HTMLDivElement,
  formatSearch: document.querySelector("#format-modal .format-search") as HTMLInputElement,
  formatModalBg: document.querySelector("#format-modal-bg") as HTMLDivElement,
  formatModalClose: document.querySelector("#format-modal-close") as HTMLButtonElement,
  formatModalTitle: document.querySelector("#format-modal-title") as HTMLHeadingElement,
  categoryTabs: document.querySelector("#category-tabs") as HTMLElement,
  popupBox: document.querySelector("#popup") as HTMLDivElement,
  popupBackground: document.querySelector("#popup-bg") as HTMLDivElement,
  topControls: document.querySelector("#top-controls") as HTMLDivElement,
  hamburgerBtn: document.querySelector("#hamburger-btn") as HTMLButtonElement,
  // Files modal
  filesModal: document.querySelector("#files-modal") as HTMLDivElement,
  filesModalBg: document.querySelector("#files-modal-bg") as HTMLDivElement,
  filesModalClose: document.querySelector("#files-modal-close") as HTMLButtonElement,
  filesModalTitle: document.querySelector("#files-modal-title") as HTMLHeadingElement,
  filesList: document.querySelector("#files-list") as HTMLDivElement,
  filesPagination: document.querySelector("#files-pagination") as HTMLDivElement,
  filesDropMore: document.querySelector("#files-drop-more") as HTMLDivElement,
  filesReplaceAll: document.querySelector("#files-replace-all") as HTMLButtonElement,
  filesRemoveAll: document.querySelector("#files-remove-all") as HTMLButtonElement,
  filesModalError: document.querySelector("#files-modal-error") as HTMLDivElement,
  filesModalErrorText: document.querySelector("#files-modal-error-text") as HTMLSpanElement,
  filesModalErrorClose: document.querySelector("#files-modal-error-close") as HTMLButtonElement,
};

// --- Constants ---

const DEFAULT_UPLOAD_TEXT = "Drop files here";
const DEFAULT_UPLOAD_LABEL = "Your file";
const FILES_PER_PAGE = 20;

const PARALLAX_MAX_DIST = 600;
const PARALLAX_STRENGTH = 15;
const MOBILE_BREAKPOINT = 800;

// --- File upload safeguards ---
const MAX_FILES = 1000;
const deviceMemGB = (navigator as any).deviceMemory ?? 4;
const deviceMemBytes = deviceMemGB * 1024 * 1024 * 1024;

type SizeCheckLevel = "ok" | "soft" | "warning" | "severe" | "critical";

function checkFileSizeLimits(files: File[]): { level: SizeCheckLevel; totalSize: number } {
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  const ratio = totalSize / deviceMemBytes;
  if (ratio >= 0.9) return { level: "critical", totalSize };
  if (ratio >= 0.75) return { level: "severe", totalSize };
  if (ratio >= 0.5) return { level: "warning", totalSize };
  if (ratio >= 0.25) return { level: "soft", totalSize };
  return { level: "ok", totalSize };
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `~${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `~${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `~${(bytes / 1024).toFixed(0)} KB`;
}

function showSizeWarningPopup(
  level: SizeCheckLevel,
  totalSize: number,
  onProceed: () => void,
): void {
  const sizeStr = formatBytes(totalSize);
  const memStr = `${deviceMemGB} GB`;

  const messages: Record<string, string> = {
    soft: `That's a chunky upload (${sizeStr}). Your browser might need a moment to digest this.`,
    warning: `Whoa, that's a lot (${sizeStr} of ${memStr} RAM). Things might get sluggish \u2014 proceed with caution!`,
    severe: `Your browser is sweating (${sizeStr}). Serious risk of a crash here \u2014 save your work first!`,
    critical: `That's more than your browser can handle (${sizeStr}). Even frogs have limits! Try fewer or smaller files.`,
  };

  if (level === "critical") {
    showPopup(
      `<h2>Too large</h2>` +
      `<p>${messages[level]}</p>` +
      `<div class="popup-actions">` +
      `<button class="popup-primary" onclick="window.hidePopup()">OK</button>` +
      `</div>`,
    );
    return;
  }

  showPopup(
    `<h2>Large upload</h2>` +
    `<p>${messages[level]}</p>` +
    `<div class="popup-actions">` +
    `<button class="popup-secondary" onclick="window.hidePopup()">Cancel</button>` +
    `<button class="popup-primary" id="size-warn-proceed">Proceed anyway</button>` +
    `</div>`,
  );

  requestAnimationFrame(() => {
    const proceedBtn = document.getElementById("size-warn-proceed");
    proceedBtn?.addEventListener("click", () => {
      hidePopup();
      onProceed();
    });
  });
}

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

// --- Helpers ---

/** Format a FileFormat into a human-readable display string: "FORMAT — Clean Name" */
function formatDisplayName(format: FileFormat): string {
  const descriptor = format.format.toUpperCase();
  const cleanName = format.name
    .split("(").join(")").split(")")
    .filter((_, i) => i % 2 === 0)
    .filter(c => c !== "")
    .join(" ");
  return `${descriptor} — ${cleanName}`;
}

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
  if (savedTheme === "dark" || (!savedTheme && !window.matchMedia("(prefers-color-scheme: light)").matches)) {
    applyTheme(true);
  }

  ui.themeToggleButton.addEventListener("click", () => {
    const isDark = document.documentElement.classList.contains("dark");
    applyTheme(!isDark);
    localStorage.setItem("theme", isDark ? "light" : "dark");
  });
}

// --- Mode Toggle ---

/** Categories only shown in advanced (All Formats) mode. */
const ADVANCED_ONLY_CATEGORIES = ["code", "other"];

export function initModeToggle(onModeChanged: () => void) {
  function applyMode(advanced: boolean) {
    _isAdvancedMode = advanced;
    ui.modeToggleButton.textContent = advanced ? "All Formats" : "Core Formats";
    localStorage.setItem("formatMode", advanced ? "advanced" : "basic");

    // Show/hide advanced-only category tabs with animation
    for (const tab of Array.from(ui.categoryTabs.children) as HTMLElement[]) {
      const cat = tab.getAttribute("data-category") || "";
      if (ADVANCED_ONLY_CATEGORIES.includes(cat)) {
        tab.classList.toggle("tab-hidden", !advanced);
      }
    }
  }

  applyMode(_isAdvancedMode);

  ui.modeToggleButton.addEventListener("click", () => {
    // If an advanced-only tab is active, reset to "Any" before switching to core
    if (_isAdvancedMode) {
      const activeTab = ui.categoryTabs.querySelector(".cat-tab.active") as HTMLElement | null;
      const activeCat = activeTab?.getAttribute("data-category") || "";
      if (ADVANCED_ONLY_CATEGORIES.includes(activeCat)) {
        activeTab?.classList.remove("active");
        const anyTab = ui.categoryTabs.querySelector('.cat-tab[data-category=""]') as HTMLElement | null;
        anyTab?.classList.add("active");
        anyTab?.click();
      }
    }
    applyMode(!_isAdvancedMode);
    onModeChanged();
    ui.topControls.classList.remove("menu-open");
  });
}

export function initResponsiveMenu() {
  ui.hamburgerBtn.addEventListener("click", () => {
    ui.topControls.classList.toggle("menu-open");
  });

  // Close menu when clicking outside
  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (!ui.topControls.contains(target) && ui.topControls.classList.contains("menu-open")) {
      ui.topControls.classList.remove("menu-open");
    }
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
  ui.formatModal.classList.remove("open");
  ui.formatModalBg.classList.remove("open");
}

export function openFormatModal() {
  ui.formatModal.classList.add("open");
  ui.formatModalBg.classList.add("open");
  const label = CATEGORY_LABELS[_activeCategory];
  ui.formatModalTitle.textContent = label ? `Choose ${label.toLowerCase()} format` : "Choose format";
  ui.formatSearch.value = "";
  // Don't auto-focus search on mobile to prevent keyboard popup
  if (!window.matchMedia("(pointer: coarse)").matches) {
    ui.formatSearch.focus();
  }
  filterFormats("");
}

export function filterFormats(query: string) {
  const allOptions = _allOptionsRef;
  const options = ui.formatOptions;
  const q = query.toLowerCase();
  let lastHeaderVisible = false;
  let lastHeader: HTMLElement | null = null;

  for (const child of Array.from(options.children)) {
    const el = child as HTMLElement;
    if (el.classList.contains("format-group-header")) {
      el.style.display = "none";
      lastHeader = el;
      lastHeaderVisible = false;
    } else if (el.classList.contains("format-option")) {
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

  ui.formatSelector.addEventListener("click", () => {
    if (ui.formatModal.classList.contains("open")) {
      closeFormatModal();
    } else {
      openFormatModal();
    }
  });

  ui.formatSearch.addEventListener("input", () => {
    filterFormats(ui.formatSearch.value);
  });

  ui.formatModalBg.addEventListener("click", () => closeFormatModal());
  ui.formatModalClose.addEventListener("click", () => closeFormatModal());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && ui.formatModal.classList.contains("open")) {
      closeFormatModal();
    }
  });
}

export function setSelectedFormat(index: number, allOptions: Array<{ format: FileFormat; handler: FormatHandler }>) {
  const opt = allOptions[index];
  if (!opt) return;
  const textEl = ui.formatSelector.querySelector(".selector-text") as HTMLSpanElement;
  textEl.textContent = formatDisplayName(opt.format);
  textEl.classList.remove("placeholder");
  ui.formatSelector.classList.add("has-value");
}

export function clearFormatSelection(activeCategory: string = "") {
  const textEl = ui.formatSelector.querySelector(".selector-text") as HTMLSpanElement;
  if (activeCategory && CATEGORY_LABELS[activeCategory]) {
    textEl.textContent = `Choose ${CATEGORY_LABELS[activeCategory]} format...`;
  } else {
    textEl.textContent = "Choose a format...";
  }
  textEl.classList.add("placeholder");
  ui.formatSelector.classList.remove("has-value");
}

export function updateConvertButtonState(selectedFromIndex: number | null, selectedToIndex: number | null) {
  if (selectedFromIndex !== null && selectedToIndex !== null) {
    ui.convertButton.className = "";
  } else {
    ui.convertButton.className = "disabled";
  }
}

// --- Format list rendering ---

export function renderFormatOptions(
  allOptions: Array<{ format: FileFormat; handler: FormatHandler }>,
  activeCategory: string,
  onSelectFormat: (index: number) => void,
) {
  _activeCategory = activeCategory;
  ui.formatOptions.innerHTML = "";

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

    if (format.to) {
      if (!seenTo.has(dedupeKey)) {
        seenTo.add(dedupeKey);
        if (!toGroups.has(cat)) toGroups.set(cat, []);
        toGroups.get(cat)!.push({ index: i, text: formatDisplayName(format) });
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
      header.className = "format-group-header";
      header.textContent = CATEGORY_LABELS[cat] || cat;
      ui.formatOptions.appendChild(header);
    }

    for (const item of items) {
      const btn = document.createElement("button");
      btn.className = "format-option";
      btn.setAttribute("data-index", item.index.toString());
      btn.textContent = item.text;
      btn.addEventListener("click", () => onSelectFormat(item.index));
      ui.formatOptions.appendChild(btn);
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
  if (!hasFiles) {
    ui.uploadText.textContent = DEFAULT_UPLOAD_TEXT;
    ui.uploadLabel.textContent = DEFAULT_UPLOAD_LABEL;
  }
}

// --- Upload zone ---

let _currentFiles: File[] = [];
let _onFilesChanged: ((files: File[]) => void) | null = null;
let _onClearFiles: (() => void) | null = null;

export function initUploadZone(
  onFilesSelected: (files: File[]) => void,
  onClearFile: () => void,
) {
  _onFilesChanged = onFilesSelected;
  _onClearFiles = onClearFile;

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
    _currentFiles = [];
    onClearFile();
  });

  ui.replaceFileBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    ui.fileInput.click();
  });

  ui.expandFilesBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openFilesModal();
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

    // File count hard cap
    if (files.length > MAX_FILES) {
      showPopup(
        `<h2>Too many files</h2>` +
        `<p>You selected ${files.length} files, but the limit is ${MAX_FILES}. Please select fewer files.</p>` +
        `<div class="popup-actions">` +
        `<button class="popup-primary" onclick="window.hidePopup()">OK</button>` +
        `</div>`,
      );
      return;
    }

    const proceedWithFiles = (filesToUse: File[]) => {
      // Size safeguard check
      const { level } = checkFileSizeLimits(filesToUse);
      if (level !== "ok") {
        const totalSize = filesToUse.reduce((sum, f) => sum + f.size, 0);
        showSizeWarningPopup(level, totalSize, () => {
          filesToUse.sort((a, b) => a.name === b.name ? 0 : (a.name < b.name ? -1 : 1));
          _currentFiles = filesToUse;
          onFilesSelected(filesToUse);
        });
        return;
      }
      filesToUse.sort((a, b) => a.name === b.name ? 0 : (a.name < b.name ? -1 : 1));
      _currentFiles = filesToUse;
      onFilesSelected(filesToUse);
    };

    if (files.some(c => c.type !== files[0].type)) {
      showFileTypeMismatchPopup(files, (filtered) => {
        proceedWithFiles(filtered);
      });
      return;
    }
    proceedWithFiles(files);
  };

  ui.fileInput.addEventListener("change", fileSelectHandler);
  window.addEventListener("drop", fileSelectHandler);
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("paste", fileSelectHandler);
}

export function shortenFileName(name: string, maxLength: number = 24): string {
  if (name.length <= maxLength) return name;
  const ellipsisLen = 3;
  const charsToShow = maxLength - ellipsisLen;
  const frontChars = Math.ceil(charsToShow / 2);
  const backChars = Math.floor(charsToShow / 2);
  return name.substring(0, frontChars) + "..." + name.substring(name.length - backChars);
}

export function showFileInUploadZone(files: File[]) {
  _currentFiles = files;
  const displayName = files.length > 1
    ? `${shortenFileName(files[0].name)} (+${files.length - 1} more)`
    : shortenFileName(files[0].name);

  ui.uploadText.style.display = "none";
  ui.uploadHint.style.display = "none";
  ui.uploadFileName.textContent = displayName;
  ui.uploadFileInfo.classList.add("visible");
  ui.uploadZone.classList.add("has-file");

  // Update label based on file count
  if (files.length > 1) {
    ui.uploadLabel.textContent = `${files.length} files selected`;
  } else {
    ui.uploadLabel.textContent = "Your file";
  }
}

export function showDetectedFormat(formatName: string, fileCount: number = 1) {
  if (fileCount > 1) {
    ui.uploadLabel.textContent = `${fileCount} files ready \u2014 converting from ${formatName.toUpperCase()}`;
  } else {
    ui.uploadLabel.textContent = `Ready to convert from ${formatName.toUpperCase()}`;
  }
}

export function resetUploadZone(activeCategory: string) {
  ui.fileInput.value = "";
  ui.uploadText.style.display = "";
  ui.uploadHint.style.display = "";
  ui.uploadFileInfo.classList.remove("visible");
  ui.uploadFileName.textContent = "";
  ui.uploadZone.classList.remove("has-file");
  ui.uploadLabel.textContent = DEFAULT_UPLOAD_LABEL;
  _currentFiles = [];
}

// --- Files Management Modal ---

let _filesModalPage = 0;
let _filesModalResizeHandler: (() => void) | null = null;

function openFilesModal() {
  ui.filesModal.classList.add("open");
  ui.filesModalBg.classList.add("open");
  _filesModalPage = 0;
  renderFilesModalList();
  hideFilesModalError();
  // Lock the files list height after first render to prevent jumps on file removal
  requestAnimationFrame(() => {
    const listHeight = ui.filesList.getBoundingClientRect().height;
    if (listHeight > 0) {
      ui.filesList.style.minHeight = listHeight + "px";
    }
  });
  // Recalculate on resize so modal adapts to new viewport
  if (_filesModalResizeHandler) window.removeEventListener("resize", _filesModalResizeHandler);
  _filesModalResizeHandler = () => {
    ui.filesList.style.minHeight = "";
    requestAnimationFrame(() => {
      const h = ui.filesList.getBoundingClientRect().height;
      if (h > 0) ui.filesList.style.minHeight = h + "px";
    });
  };
  window.addEventListener("resize", _filesModalResizeHandler);
}

export function closeFilesModal() {
  ui.filesModal.classList.remove("open");
  ui.filesModalBg.classList.remove("open");
  ui.filesList.style.minHeight = "";
  if (_filesModalResizeHandler) {
    window.removeEventListener("resize", _filesModalResizeHandler);
    _filesModalResizeHandler = null;
  }
}

function hideFilesModalError() {
  ui.filesModalError.style.display = "none";
  ui.filesModalErrorText.textContent = "";
}

function showFilesModalError(msg: string) {
  ui.filesModalErrorText.textContent = msg;
  ui.filesModalError.style.display = "flex";
}

function renderFilesModalList() {
  const files = _currentFiles;
  const totalPages = Math.max(1, Math.ceil(files.length / FILES_PER_PAGE));
  if (_filesModalPage >= totalPages) _filesModalPage = totalPages - 1;

  ui.filesModalTitle.textContent = files.length > 0
    ? `Your files (${files.length})`
    : "Your files";

  const start = _filesModalPage * FILES_PER_PAGE;
  const end = Math.min(start + FILES_PER_PAGE, files.length);
  ui.filesList.innerHTML = "";

  for (let i = start; i < end; i++) {
    const file = files[i];
    const row = document.createElement("div");
    row.className = "file-row";

    const nameSpan = document.createElement("span");
    nameSpan.className = "file-row-name";
    nameSpan.textContent = shortenFileName(file.name, 36);
    nameSpan.title = file.name;

    const actions = document.createElement("div");
    actions.className = "file-row-actions";

    const replaceBtn = document.createElement("button");
    replaceBtn.className = "file-row-btn";
    replaceBtn.innerHTML = "&#8635;";
    replaceBtn.title = "Replace this file";
    replaceBtn.addEventListener("click", () => replaceFileAtIndex(i));

    const removeBtn = document.createElement("button");
    removeBtn.className = "file-row-btn";
    removeBtn.innerHTML = "&#10005;";
    removeBtn.title = "Remove this file";
    removeBtn.addEventListener("click", () => removeFileAtIndex(i));

    actions.appendChild(replaceBtn);
    actions.appendChild(removeBtn);
    row.appendChild(nameSpan);
    row.appendChild(actions);
    ui.filesList.appendChild(row);
  }

  // Pagination
  ui.filesPagination.innerHTML = "";
  if (totalPages > 1) {
    const prevBtn = document.createElement("button");
    prevBtn.className = "pagination-btn";
    prevBtn.textContent = "\u2039";
    prevBtn.disabled = _filesModalPage === 0;
    prevBtn.addEventListener("click", () => {
      _filesModalPage--;
      renderFilesModalList();
    });

    const info = document.createElement("span");
    info.className = "pagination-info";
    info.textContent = `Page ${_filesModalPage + 1} of ${totalPages}`;

    const nextBtn = document.createElement("button");
    nextBtn.className = "pagination-btn";
    nextBtn.textContent = "\u203A";
    nextBtn.disabled = _filesModalPage >= totalPages - 1;
    nextBtn.addEventListener("click", () => {
      _filesModalPage++;
      renderFilesModalList();
    });

    ui.filesPagination.appendChild(prevBtn);
    ui.filesPagination.appendChild(info);
    ui.filesPagination.appendChild(nextBtn);
  }
}

function removeFileAtIndex(index: number) {
  _currentFiles.splice(index, 1);
  if (_currentFiles.length === 0) {
    closeFilesModal();
    if (_onClearFiles) _onClearFiles();
    return;
  }
  renderFilesModalList();
  showFileInUploadZone(_currentFiles);
  if (_onFilesChanged) _onFilesChanged(_currentFiles);
}

function replaceFileAtIndex(index: number) {
  const tempInput = document.createElement("input");
  tempInput.type = "file";
  tempInput.addEventListener("change", () => {
    const newFile = tempInput.files?.[0];
    if (!newFile) return;

    if (_currentFiles.length > 0 && newFile.type !== _currentFiles[0].type) {
      showFilesModalError("That file is a different type. All files need to match.");
      return;
    }

    _currentFiles[index] = newFile;
    renderFilesModalList();
    showFileInUploadZone(_currentFiles);
    if (_onFilesChanged) _onFilesChanged(_currentFiles);
  });
  tempInput.click();
}

export function initFilesModal() {
  ui.filesModalClose.addEventListener("click", closeFilesModal);
  ui.filesModalBg.addEventListener("click", closeFilesModal);
  ui.filesModalErrorClose.addEventListener("click", hideFilesModalError);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && ui.filesModal.classList.contains("open")) {
      closeFilesModal();
    }
  });

  ui.filesRemoveAll.addEventListener("click", () => {
    _currentFiles = [];
    closeFilesModal();
    if (_onClearFiles) _onClearFiles();
  });

  ui.filesReplaceAll.addEventListener("click", () => {
    closeFilesModal();
    ui.fileInput.click();
  });

  // Drop more files zone
  ui.filesDropMore.addEventListener("click", () => {
    const tempInput = document.createElement("input");
    tempInput.type = "file";
    tempInput.multiple = true;
    tempInput.addEventListener("change", () => {
      if (tempInput.files) addMoreFiles(Array.from(tempInput.files));
    });
    tempInput.click();
  });

  ui.filesDropMore.addEventListener("dragenter", (e) => {
    e.preventDefault();
    ui.filesDropMore.classList.add("drag-over");
  });
  ui.filesDropMore.addEventListener("dragleave", () => {
    ui.filesDropMore.classList.remove("drag-over");
  });
  ui.filesDropMore.addEventListener("dragover", (e) => {
    e.preventDefault();
  });
  ui.filesDropMore.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    ui.filesDropMore.classList.remove("drag-over");
    if (e.dataTransfer?.files) {
      addMoreFiles(Array.from(e.dataTransfer.files));
    }
  });
}

function showFileTypeMismatchPopup(files: File[], onProceed: (filtered: File[]) => void) {
  const typeGroups = new Map<string, File[]>();
  for (const file of files) {
    const type = file.type || "unknown";
    if (!typeGroups.has(type)) typeGroups.set(type, []);
    typeGroups.get(type)!.push(file);
  }

  let typeSummary = "";
  const typeEntries = [...typeGroups.entries()];
  for (const [, groupFiles] of typeEntries) {
    const ext = groupFiles[0].name.split(".").pop()?.toUpperCase() || "Unknown";
    typeSummary += `<li><b>${ext}</b> \u2014 ${groupFiles.length} file${groupFiles.length > 1 ? "s" : ""}</li>`;
  }

  let actionButtons = "";
  for (const [type, groupFiles] of typeEntries) {
    const ext = groupFiles[0].name.split(".").pop()?.toUpperCase() || "Unknown";
    const count = groupFiles.length;
    actionButtons += `<button class="popup-secondary" data-type-filter="${type}">Keep only ${ext} (${count} file${count > 1 ? "s" : ""})</button>`;
  }

  showPopup(
    `<h2>Multiple file types detected</h2>` +
    `<p>All files need to be the same type to convert together. You uploaded:</p>` +
    `<ul class="type-list">${typeSummary}</ul>` +
    `<div class="popup-actions popup-actions-stacked">` +
    actionButtons +
    `<button onclick="window.hidePopup()">Cancel</button>` +
    `</div>`,
  );

  // Bind filter buttons
  requestAnimationFrame(() => {
    const btns = ui.popupBox.querySelectorAll<HTMLButtonElement>("[data-type-filter]");
    btns.forEach(btn => {
      btn.addEventListener("click", () => {
        const filterType = btn.getAttribute("data-type-filter")!;
        const filtered = files.filter(f => (f.type || "unknown") === filterType);
        hidePopup();
        onProceed(filtered);
      });
    });
  });
}

function addMoreFiles(newFiles: File[]) {
  if (newFiles.length === 0) return;
  hideFilesModalError();

  // File count hard cap
  const projectedCount = _currentFiles.length + newFiles.length;
  if (projectedCount > MAX_FILES) {
    showFilesModalError(`Too many files (${projectedCount}). The limit is ${MAX_FILES}.`);
    return;
  }

  const expectedType = _currentFiles.length > 0 ? _currentFiles[0].type : newFiles[0].type;

  const matchingFiles = newFiles.filter(f => f.type === expectedType);
  const mismatchCount = newFiles.length - matchingFiles.length;
  if (mismatchCount > 0) {
    if (matchingFiles.length > 0) {
      showFilesModalError(`${mismatchCount} file${mismatchCount > 1 ? "s" : ""} skipped (different type). Added ${matchingFiles.length} matching file${matchingFiles.length > 1 ? "s" : ""}.`);
    } else {
      showFilesModalError("Those files are a different type. All files need to match.");
      return;
    }
  }

  const filesToAdd = mismatchCount > 0 ? matchingFiles : newFiles;
  const combinedFiles = _currentFiles.concat(filesToAdd);

  // Size safeguard check
  const { level, totalSize } = checkFileSizeLimits(combinedFiles);
  if (level !== "ok") {
    closeFilesModal();
    showSizeWarningPopup(level, totalSize, () => {
      _currentFiles = combinedFiles;
      _currentFiles.sort((a, b) => a.name === b.name ? 0 : (a.name < b.name ? -1 : 1));
      showFileInUploadZone(_currentFiles);
      if (_onFilesChanged) _onFilesChanged(_currentFiles);
      openFilesModal();
    });
    return;
  }

  _currentFiles = combinedFiles;
  _currentFiles.sort((a, b) => a.name === b.name ? 0 : (a.name < b.name ? -1 : 1));

  renderFilesModalList();
  showFileInUploadZone(_currentFiles);
  if (_onFilesChanged) _onFilesChanged(_currentFiles);
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
    ui.convertButton.classList.add("disabled");
    try {
      await onClick();
    } finally {
      ui.convertButton.classList.remove("disabled");
    }
  };
}

// --- Segmented Controls (mobile) ---

export function initSegmentedControls() {
  const modeSegmented = document.querySelector("#mode-segmented") as HTMLDivElement;
  const themeSegmented = document.querySelector("#theme-segmented") as HTMLDivElement;

  // Sync initial state
  const isAdvanced = localStorage.getItem("formatMode") === "advanced";
  syncSegmentedActive(modeSegmented, isAdvanced ? "advanced" : "basic");

  const isDark = document.documentElement.classList.contains("dark");
  syncSegmentedActive(themeSegmented, isDark ? "dark" : "light");

  bindSegmented(
    modeSegmented,
    ui.modeToggleButton,
    (value) => (value === "advanced") !== (ui.modeToggleButton.textContent?.trim() === "All Formats"),
    () => { }
  );

  bindSegmented(
    themeSegmented,
    ui.themeToggleButton,
    (value) => (value === "dark") !== document.documentElement.classList.contains("dark"),
    () => { }
  );

  // Keep segmented controls in sync when desktop buttons are clicked
  new MutationObserver(() => {
    const adv = ui.modeToggleButton.textContent?.trim() === "All Formats";
    syncSegmentedActive(modeSegmented, adv ? "advanced" : "basic");
  }).observe(ui.modeToggleButton, { childList: true, characterData: true, subtree: true });

  new MutationObserver(() => {
    const dark = document.documentElement.classList.contains("dark");
    syncSegmentedActive(themeSegmented, dark ? "dark" : "light");
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
}

function bindSegmented(
  container: HTMLElement,
  desktopBtn: HTMLElement,
  isActiveValue: (value: string) => boolean,
  onSelect: (value: string) => void,
) {
  container.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest(".segmented-option") as HTMLButtonElement | null;
    if (!btn || btn.classList.contains("active")) return;
    const value = btn.getAttribute("data-value");
    if (!value) return;

    syncSegmentedActive(container, value);
    if (isActiveValue(value)) {
      desktopBtn.click();
    }
    onSelect(value);
    syncSegmentedActive(container, value);
  });
}

function syncSegmentedActive(container: HTMLElement, activeValue: string) {
  for (const opt of Array.from(container.children) as HTMLElement[]) {
    opt.classList.toggle("active", opt.getAttribute("data-value") === activeValue);
  }
}

// --- Cursor Glow ---

export function initCursorGlow() {
  const glow = document.querySelector("#cursor-glow") as HTMLDivElement | null;
  if (!glow) return;

  // Don't init on touch devices
  if (window.matchMedia("(pointer: coarse)").matches) return;

  const bgSpans = Array.from(document.querySelectorAll("#bg-visuals span")) as HTMLElement[];

  // Store original positions for parallax
  const originalPositions = bgSpans.map((span) => {
    const rect = span.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });

  let mouseX = -500;
  let mouseY = -500;
  let cursorX = -500;
  let cursorY = -500;
  const LERP_FACTOR = 0.25;

  function updateGlow() {
    // Smooth lerp toward mouse position
    cursorX += (mouseX - cursorX) * LERP_FACTOR;
    cursorY += (mouseY - cursorY) * LERP_FACTOR;

    glow!.style.left = cursorX + "px";
    glow!.style.top = cursorY + "px";

    // Parallax on background elements
    if (window.innerWidth > MOBILE_BREAKPOINT) {
      bgSpans.forEach((span, i) => {
        const pos = originalPositions[i];
        const dx = cursorX - pos.x;
        const dy = cursorY - pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const strength = Math.max(0, 1 - dist / PARALLAX_MAX_DIST) * PARALLAX_STRENGTH;
        const offsetX = (dx / (dist || 1)) * strength;
        const offsetY = (dy / (dist || 1)) * strength;
        span.style.translate = `${offsetX}px ${offsetY}px`;
      });
    }

    requestAnimationFrame(updateGlow);
  }

  // Start the continuous animation loop
  requestAnimationFrame(updateGlow);

  document.addEventListener("mousemove", (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
  });

  document.addEventListener("mouseover", (e) => {
    const target = e.target as HTMLElement;

    // Clear previous states
    glow.classList.remove("interactive", "interactive-small");

    if (target.closest("button, a, input, select, textarea, label, .clickable, .upload-action-btn, .segmented-option, .cat-tab, #upload-zone, .format-option, .file-row-btn, .pagination-btn, #files-drop-more")) {
      glow.classList.add("interactive-small");
    }
  });

  document.addEventListener("mousedown", () => glow.classList.add("active-click"));
  document.addEventListener("mouseup", () => glow.classList.remove("active-click"));

  document.addEventListener("mouseleave", () => {
    glow.style.opacity = "0";
  });
  document.addEventListener("mouseenter", () => {
    glow.style.opacity = "1";
  });
}
