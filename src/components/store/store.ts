import type { FileFormat, FormatHandler } from "../../core/FormatHandler/FormatHandler.ts";
import { showPopup, hidePopup } from "../Popup/Popup.ts";
// --- DOM element references ---
export const ui = {
  topBar: document.querySelector("#top-bar") as HTMLDivElement,
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

export const DEFAULT_UPLOAD_TEXT = "Drop your files here";
export const DEFAULT_UPLOAD_LABEL = "Your file";
export const FILES_PER_PAGE = 20;

export const PARALLAX_MAX_DIST = 600;
export const PARALLAX_STRENGTH = 15;
export const MOBILE_BREAKPOINT = 800;

// --- File upload safeguards ---
export const MAX_FILES = 100;
const SIZE_WARNING_THRESHOLD = 3.6 * 1024 * 1024 * 1024; // 3.6 GB

export function escapeHTML(str: string): string {
  return str.replace(/[&<>'"]/g,
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

type SizeCheckLevel = "ok" | "warning";

export function checkFileSizeLimits(files: File[]): { level: SizeCheckLevel; totalSize: number } {
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  if (totalSize > SIZE_WARNING_THRESHOLD) return { level: "warning", totalSize };
  return { level: "ok", totalSize };
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `~${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `~${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `~${(bytes / 1024).toFixed(0)} KB`;
}

export function showSizeWarningPopup(
  level: SizeCheckLevel,
  totalSize: number,
  onProceed: () => void,
): void {
  const sizeStr = formatBytes(totalSize);

  const message = `That's a lot of data (${sizeStr}). Browsers often struggle with files this large and might crash. Proceed with caution!`;


  showPopup(
    `<h2>Large files detected</h2>` +
    `<p>${message}</p>` +
    `<div class="popup-actions">` +
    `<button class="popup-secondary" onclick="window.hidePopup()">Cancel</button>` +
    `<button class="popup-primary" id="size-warn-proceed">Ignore limit and continue</button>` +
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

export function shortenFileName(name: string, maxLength: number = 24): string {
  if (name.length <= maxLength) return name;
  const ellipsisLen = 3;
  const charsToShow = maxLength - ellipsisLen;
  const frontChars = Math.ceil(charsToShow / 2);
  const backChars = Math.floor(charsToShow / 2);
  return name.substring(0, frontChars) + "..." + name.substring(name.length - backChars);
}

export function showFileTypeMismatchPopup(files: File[], onProceed: (filtered: File[]) => void) {
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
    `<p>All files need to be the same type to convert together. You dropped:</p>` +
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
export const BASIC_FORMATS = new Set([
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

export const isAdvancedMode = { value: localStorage.getItem("formatMode") === "advanced" };

// Lightweight reactive state: plain { value: T } wrappers shared across components.
export const currentFiles: { value: File[] } = { value: [] };
export const onFilesChanged: { value: ((files: File[]) => void) | null } = { value: null };
export const onClearFiles: { value: (() => void) | null } = { value: null };
export const filesModalPage = { value: 0 };
export const filesModalResizeHandler: { value: (() => void) | null } = { value: null };
export const allOptionsRef: { value: Array<{ format: FileFormat; handler: FormatHandler }> } = { value: [] };
export const activeCategory = { value: "" };
export const selectedFromIndex: { value: number | null } = { value: null };
export const selectedToIndex: { value: number | null } = { value: null };

// --- Helpers ---

/** Format a FileFormat into a human-readable display string: "FORMAT - Clean Name" */
export function formatDisplayName(format: FileFormat): string {
  const descriptor = format.format.toUpperCase();
  const cleanName = format.name.replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim();
  return `${descriptor} - ${cleanName}`;
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
  if (mime.startsWith("text/x-") || mime === "application/x-sh") return "code";
  if (mime.startsWith("text/")) return "document";
  if (["application/json", "application/xml", "application/yaml"].some(m => mime === m)) return "data";
  if (mime.startsWith("application/zip") || mime.includes("compressed") || mime.includes("archive")) return "archive";
  if (mime.startsWith("application/vnd.")) return "document";
  if (mime === "application/pdf") return "document";
  return "other";
}

// --- UI Helpers ---
export function bindDragAndDropVisuals(element: HTMLElement, activeClass: string = "drag-over") {
  element.addEventListener("dragenter", (e) => {
    e.preventDefault();
    element.classList.add(activeClass);
  });
  element.addEventListener("dragleave", () => {
    element.classList.remove(activeClass);
  });
  element.addEventListener("dragover", (e) => {
    e.preventDefault();
  });
  element.addEventListener("drop", () => {
    element.classList.remove(activeClass);
  });
}

/** Sort files alphabetically by name. Shared by UploadZone and FilesModal. */
export function sortFilesByName(files: File[]): void {
  files.sort((a, b) => a.name.localeCompare(b.name));
}

// --- Theme ---

export function initTheme() {
  function applyTheme(dark: boolean) {
    document.documentElement.classList.add("theme-transition");
    document.documentElement.classList.toggle("dark", dark);
    ui.themeToggleButton.innerHTML = dark ? "&#9788;" : "&#9790;";
    setTimeout(() => {
      document.documentElement.classList.remove("theme-transition");
    }, 300);
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