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
};

// --- Constants ---

const DEFAULT_UPLOAD_TEXT = "Drop your file here";
const DEFAULT_UPLOAD_LABEL = "Your file";

const PARALLAX_MAX_DIST = 600;
const PARALLAX_STRENGTH = 15;
const MOBILE_BREAKPOINT = 800;

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

    // Show/hide advanced-only category tabs
    for (const tab of Array.from(ui.categoryTabs.children) as HTMLElement[]) {
      const cat = tab.getAttribute("data-category") || "";
      if (ADVANCED_ONLY_CATEGORIES.includes(cat)) {
        tab.style.display = advanced ? "" : "none";
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
  ui.formatModalTitle.textContent = label ? `Select ${label.toLowerCase()} format` : "Select format";
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
    textEl.textContent = `Select ${CATEGORY_LABELS[activeCategory]} format...`;
  } else {
    textEl.textContent = "Select format...";
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

export function shortenFileName(name: string, maxLength: number = 24): string {
  if (name.length <= maxLength) return name;
  const ellipsisLen = 3;
  const charsToShow = maxLength - ellipsisLen;
  const frontChars = Math.ceil(charsToShow / 2);
  const backChars = Math.floor(charsToShow / 2);
  return name.substring(0, frontChars) + "..." + name.substring(name.length - backChars);
}

export function showFileInUploadZone(files: File[]) {
  const displayName = files.length > 1
    ? `${shortenFileName(files[0].name)} (+${files.length - 1} more)`
    : shortenFileName(files[0].name);

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
  ui.uploadLabel.textContent = DEFAULT_UPLOAD_LABEL;
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
  let rafId: number | null = null;

  function updateGlow() {
    glow!.style.left = mouseX + "px";
    glow!.style.top = mouseY + "px";

    // Parallax on background elements
    if (window.innerWidth > MOBILE_BREAKPOINT) {
      bgSpans.forEach((span, i) => {
        const pos = originalPositions[i];
        const dx = mouseX - pos.x;
        const dy = mouseY - pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const strength = Math.max(0, 1 - dist / PARALLAX_MAX_DIST) * PARALLAX_STRENGTH;
        const offsetX = (dx / (dist || 1)) * strength;
        const offsetY = (dy / (dist || 1)) * strength;
        span.style.translate = `${offsetX}px ${offsetY}px`;
      });
    }

    rafId = null;
  }

  document.addEventListener("mousemove", (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    if (!rafId) {
      rafId = requestAnimationFrame(updateGlow);
    }
  });

  document.addEventListener("mouseover", (e) => {
    const target = e.target as HTMLElement;

    // Clear previous states
    glow.classList.remove("interactive", "interactive-small");

    if (target.closest("button, a, input, select, textarea, label, .clickable, .upload-action-btn, .segmented-option, .cat-tab, #upload-zone, .format-option")) {
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
