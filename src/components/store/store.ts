import type { FileFormat, FormatHandler } from "../../core/FormatHandler/FormatHandler.ts";
import { shortenFileName, safeLocalStorageSet } from "../utils/index.ts";
import normalizeMimeType from "../../core/utils/normalizeMimeType.ts";
// --- DOM element references (lazy-initialized to allow testing) ---
const uiInternal: Record<string, any> = {};

const SELECTORS: Record<string, string> = {
  topBar: "#top-bar",
  fileInput: "#file-input",
  uploadZone: "#upload-zone",
  uploadText: "#upload-zone .upload-text",
  uploadHint: "#upload-zone .upload-hint",
  uploadFileInfo: ".upload-file-info",
  uploadFileName: ".upload-file-name",
  uploadLabel: "#upload-label",
  expandFilesBtn: "#expand-files-btn",
  replaceFileBtn: "#replace-file-btn",
  removeFileBtn: "#remove-file-btn",
  convertButton: "#convert-button",
  libreofficeNotice: "#libreoffice-notice",
  themeToggleButton: "#theme-toggle",
  modeToggleButton: "#mode-toggle",
  formatSelector: "#format-selector",
  formatModal: "#format-modal",
  formatOptions: "#format-options",
  formatSearch: "#format-search",
  formatModalBg: "#format-modal-bg",
  formatModalClose: "#format-modal-close",
  formatModalTitle: "#format-modal-title",
  categoryTabs: "#category-tabs",
  popupBox: "#popup",
  popupBackground: "#popup-bg",
  topControls: "#top-controls",
  hamburgerBtn: "#hamburger-btn",
  topControlsMenu: "#top-controls-menu",
  filesModal: "#files-modal",
  filesModalBg: "#files-modal-bg",
  filesModalClose: "#files-modal-close",
  filesModalTitle: "#files-modal-title",
  filesList: "#files-list",
  filesPagination: "#files-pagination",
  filesDropMore: "#files-drop-more",
  filesReplaceAll: "#files-replace-all",
  filesRemoveAll: "#files-remove-all",
  filesModalError: "#files-modal-error",
  filesModalErrorText: "#files-modal-error-text",
  filesModalErrorClose: "#files-modal-error-close",
};

export const ui = new Proxy({} as any, {
  get(_, prop: string) {
    if (prop in uiInternal) return uiInternal[prop];

    const selector = SELECTORS[prop];
    if (selector) {
      if (typeof document === "undefined") {
        console.warn(`Attempted to access ui.${prop} in a non-browser environment.`);
        return null;
      }
      uiInternal[prop] = document.querySelector(selector);
      return uiInternal[prop];
    }

    // Safety check for developer errors
    if (typeof prop === "string" && !["then", "toJSON", "constructor"].includes(prop)) {
      console.error(`UI element "${prop}" not found in SELECTORS map.`);
    }
    return undefined;
  },
  set(_, prop: string, value: any) {
    uiInternal[prop] = value;
    return true;
  },
}) as {
  topBar: HTMLDivElement;
  fileInput: HTMLInputElement;
  uploadZone: HTMLDivElement;
  uploadText: HTMLParagraphElement;
  uploadHint: HTMLParagraphElement;
  uploadFileInfo: HTMLDivElement;
  uploadFileName: HTMLSpanElement;
  uploadLabel: HTMLLabelElement;
  expandFilesBtn: HTMLButtonElement;
  replaceFileBtn: HTMLButtonElement;
  removeFileBtn: HTMLButtonElement;
  convertButton: HTMLButtonElement;
  libreofficeNotice: HTMLDivElement;
  themeToggleButton: HTMLButtonElement;
  modeToggleButton: HTMLButtonElement;
  formatSelector: HTMLButtonElement;
  formatModal: HTMLDivElement;
  formatOptions: HTMLDivElement;
  formatSearch: HTMLInputElement;
  formatModalBg: HTMLDivElement;
  formatModalClose: HTMLButtonElement;
  formatModalTitle: HTMLHeadingElement;
  categoryTabs: HTMLElement;
  popupBox: HTMLDivElement;
  popupBackground: HTMLDivElement;
  topControls: HTMLDivElement;
  hamburgerBtn: HTMLButtonElement;
  topControlsMenu: HTMLDivElement;
  filesModal: HTMLDivElement;
  filesModalBg: HTMLDivElement;
  filesModalClose: HTMLButtonElement;
  filesModalTitle: HTMLHeadingElement;
  filesList: HTMLDivElement;
  filesPagination: HTMLDivElement;
  filesDropMore: HTMLDivElement;
  filesReplaceAll: HTMLButtonElement;
  filesRemoveAll: HTMLButtonElement;
  filesModalError: HTMLDivElement;
  filesModalErrorText: HTMLSpanElement;
  filesModalErrorClose: HTMLButtonElement;
};

import { ABSOLUTE_MAX_FILES } from "../../constants/ui.ts";

// --- File upload safeguards ---
const SIZE_WARNING_THRESHOLD = 3.6 * 1024 * 1024 * 1024; // 3.6 GB

type SizeCheckLevel = "ok" | "warning";

export function checkFileSizeLimits(files: File[]): { level: SizeCheckLevel; totalSize: number } {
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  if (totalSize > SIZE_WARNING_THRESHOLD) return { level: "warning", totalSize };
  return { level: "ok", totalSize };
}

// --- Dynamic file count limit based on device memory + file weight ---

const FALLBACK_DEVICE_MEMORY_GB = 4;
const USABLE_MEMORY_FRACTION = 0.5;

const PROCESSING_MULTIPLIERS: Record<string, number> = {
  video: 2,
  image: 1.5,
  document: 1.5,
  audio: 1.5,
};

function getMemoryBudget(): number {
  const deviceGB = (navigator as any).deviceMemory ?? FALLBACK_DEVICE_MEMORY_GB;
  return deviceGB * USABLE_MEMORY_FRACTION * 1024 * 1024 * 1024;
}

function getMimeMultiplier(mime: string): number {
  if (mime.startsWith("video/")) return PROCESSING_MULTIPLIERS.video;
  if (mime.startsWith("image/")) return PROCESSING_MULTIPLIERS.image;
  if (mime.startsWith("audio/")) return PROCESSING_MULTIPLIERS.audio;
  if (mime.startsWith("text/") || mime.startsWith("application/vnd.") || mime === "application/pdf")
    return PROCESSING_MULTIPLIERS.document;
  return 1;
}

export function getMaxFiles(files: File[]): number {
  if (files.length === 0) return ABSOLUTE_MAX_FILES;
  const avgSize = files.reduce((sum, f) => sum + f.size, 0) / files.length;
  if (avgSize === 0) return ABSOLUTE_MAX_FILES;
  const multiplier = getMimeMultiplier(files[0].type);
  const budget = getMemoryBudget();
  return Math.max(1, Math.min(ABSOLUTE_MAX_FILES, Math.floor(budget / (avgSize * multiplier))));
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

/** Categories hidden in Core (Standard) mode. */
export const CORE_HIDDEN_CATEGORIES = ["data", "font", "code", "other"];
/** Categories hidden in Plus mode. */
export const PLUS_HIDDEN_CATEGORIES = ["code", "other"];

export type FormatMode = "core" | "plus" | "all";

/** Check if a category should be visible in the current mode. */
export function isCategoryVisible(category: string, mode: FormatMode): boolean {
  if (mode === "all") return true;
  if (mode === "plus") return !PLUS_HIDDEN_CATEGORIES.includes(category);
  return !CORE_HIDDEN_CATEGORIES.includes(category);
}

// --- Mode format whitelists ---

export const CORE_FORMATS = new Set([
  // Image
  "png", "jpeg", "gif", "webp", "svg",
  // Audio
  "mp3", "wav", "flac",
  // Video
  "mp4", "webm", "mov",
  // Document
  "pdf", "docx", "pptx", "text",
  // Archive
  "zip"
]);

export const PLUS_FORMATS = new Set([
  ...CORE_FORMATS,
  "lzh", "tar", "gz",
  // Image
  "ico",
  // Audio
  "ogg", "aac",
  // Video
  "avi", "mkv",
  // Document
  "xlsx", "csv", "markdown", "html", "tmx",
  // Data
  "json", "xml", "yaml",
  // Font
  "ttf", "woff2", "woff", "otf",
]);

const safeGetLocalStorage = (key: string) => {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
};

export const formatMode: { value: FormatMode } = {
  value: (() => {
    const saved = safeGetLocalStorage("formatMode");
    if (saved === "all" || saved === "advanced") return "all";
    if (saved === "plus") return "plus";
    return "core";
  })()
};

/**
 * Two independent quality settings, deliberately not shared.
 *
 * An earlier build made these one app-wide value. It was tidier on paper but
 * surprising in use: dialling the Compress surface up to Extreme silently
 * changed what your next conversion encoded at. Each surface now owns its own
 * setting, so changing one never moves the other.
 *
 * Note the inversion in both: the engine's `low` preset means "low quality
 * target", i.e. the *most* compression, while `high` compresses least.
 */

/** Conversion output. Includes lossless - "convert but don't compress" is a
 *  meaningful request when you're changing format. */
export type ConvertQuality = "auto" | "lossless" | "high" | "medium" | "low";

export const CONVERT_QUALITY_CHOICES: ReadonlyArray<{ value: ConvertQuality; label: string; blurb: string }> = [
  { value: "auto", label: "Automatic", blurb: "Match the source" },
  { value: "lossless", label: "No compression", blurb: "Largest files" },
  { value: "high", label: "Less compression", blurb: "Best quality" },
  { value: "medium", label: "Recommended", blurb: "Balanced" },
  { value: "low", label: "Extreme compression", blurb: "Smallest files" },
];

export const convertQuality: { value: ConvertQuality } = {
  value: (() => {
    const saved = safeGetLocalStorage("convertQuality");
    return saved === "auto" || saved === "lossless" || saved === "high" || saved === "low" ? saved : "medium";
  })(),
};

export function setConvertQuality(next: ConvertQuality) {
  convertQuality.value = next;
  try { localStorage.setItem("convertQuality", next); } catch { /* private mode */ }
}

/** Compress surface. No lossless: as a compression level it can only ever
 *  mean "do nothing", and the keep-threshold would discard every result. */
export type CompressLevel = "auto" | "high" | "medium" | "low";

export const COMPRESS_LEVEL_CHOICES: ReadonlyArray<{ value: CompressLevel; label: string; blurb: string }> = [
  { value: "auto", label: "Automatic", blurb: "Reads each file and picks its own level. Won't re-crush what's already small." },
  { value: "high", label: "Less compression", blurb: "Best quality, modest savings." },
  { value: "medium", label: "Recommended", blurb: "Balanced. Big savings, quality you won't miss." },
  { value: "low", label: "Extreme compression", blurb: "Smallest files. Quality loss you can see." },
];

export const compressLevel: { value: CompressLevel } = {
  value: (() => {
    // Automatic is the default: it's what the app did before compression had a
    // visible control, and it's the right answer when the user has no opinion.
    const saved = safeGetLocalStorage("compressLevel");
    return saved === "high" || saved === "low" || saved === "medium" ? saved : "auto";
  })(),
};

export function setCompressLevel(next: CompressLevel) {
  compressLevel.value = next;
  try { localStorage.setItem("compressLevel", next); } catch { /* private mode */ }
}

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
export const isLoadingPhase2: { value: boolean } = { value: false };
export const isLoadingHandlers: { value: boolean } = { value: false };
export const reachableIdentifiers: { value: Set<string> | null } = { value: null };

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

/** 
 * Centralized check if a format should be shown in the picker.
 * A format is visible if its category is visible AND its specific format is in the current mode's whitelist.
 */
export function isFormatVisible(format: FileFormat, mode: FormatMode): boolean {
  const cat = getFormatCategory(format);
  if (!isCategoryVisible(cat, mode)) return false;
  if (mode === "all") return true;

  const f = format.format.toLowerCase();
  if (mode === "core") return CORE_FORMATS.has(f);
  return PLUS_FORMATS.has(f);
}

// --- UI Helpers ---
export function bindDragAndDropVisuals(
  element: HTMLElement,
  activeClass: string = "drag-over",
  getOptions?: () => Array<{ format: FileFormat; handler: FormatHandler }>,
) {
  let dragCount = 0;
  window.addEventListener("dragenter", (e) => {
    if (!(e.dataTransfer?.types ?? []).includes("Files")) return;
    if (++dragCount !== 1) return;
    if (getOptions) {
      const opts = getOptions();
      if (opts.length > 0) {
        const items = Array.from(e.dataTransfer?.items ?? []);
        const allRejected = items.length > 0 && items.every(item => {
          if (!item.type || item.type === "application/octet-stream") return false;
          return !opts.some(o => o.format.from && o.format.mime === item.type);
        });
        if (allRejected) {
          element.classList.add("drag-reject");
          return;
        }
      }
    }
    element.classList.add(activeClass);
  });
  window.addEventListener("dragleave", (e) => {
    if (!(e.dataTransfer?.types ?? []).includes("Files")) return;
    dragCount = Math.max(0, dragCount - 1);
    if (dragCount === 0) {
      element.classList.remove(activeClass);
      element.classList.remove("drag-reject");
    }
  });
  window.addEventListener("drop", () => {
    dragCount = 0;
    element.classList.remove(activeClass);
    element.classList.remove("drag-reject");
  });
}

/** Build the `accept` attribute string for a file input from the current format list. */
export function buildAcceptString(
  allOptions: Array<{ format: FileFormat; handler: FormatHandler }>
): string {
  const mimes = new Set<string>();
  const exts  = new Set<string>();
  for (const { format } of allOptions) {
    if (!format.from) continue;
    if (format.mime) mimes.add(format.mime);
    if (format.extension) exts.add(`.${format.extension.toLowerCase()}`);
  }
  return [...mimes, ...exts].join(",");
}

/** Returns true if the file matches any supported input format in the current format list. */
export function isFileSupported(
  file: File,
  allOptions: Array<{ format: FileFormat; handler: FormatHandler }>
): boolean {
  const mime = normalizeMimeType(file.type);
  const ext  = file.name.split(".").pop()?.toLowerCase() ?? "";
  for (const { format } of allOptions) {
    if (!format.from) continue;
    if (format.mime && format.mime === mime) return true;
    if (format.extension && format.extension.toLowerCase() === ext) return true;
  }
  return false;
}

/** Sort files alphabetically by name. Shared by UploadZone and FilesModal. */
export function sortFilesByName(files: File[]): void {
  files.sort((a, b) => a.name.localeCompare(b.name));
}

// --- Theme ---

const THEME_ICON_SUN = '<svg class="top-control-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';
const THEME_ICON_MOON = '<svg class="top-control-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

export function initTheme() {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return;

  function applyTheme(dark: boolean, transition: boolean = true) {
    if (transition) document.documentElement.classList.add("theme-transition");
    document.documentElement.classList.toggle("dark", dark);
    if (ui.themeToggleButton) {
      ui.themeToggleButton.innerHTML = dark ? THEME_ICON_SUN : THEME_ICON_MOON;
    }
    if (transition) {
      setTimeout(() => {
        document.documentElement.classList.remove("theme-transition");
      }, 300);
    }
  }

  const savedTheme = localStorage.getItem("theme");
  const isDark = savedTheme === "dark" || (!savedTheme && !window.matchMedia("(prefers-color-scheme: light)").matches);
  applyTheme(isDark, false);

  ui.themeToggleButton?.addEventListener("click", () => {
    const currentlyDark = document.documentElement.classList.contains("dark");
    applyTheme(!currentlyDark);
    safeLocalStorageSet("theme", currentlyDark ? "light" : "dark");
  });
}

// --- Scroll Lock ---

/**
 * Checks if any modal or popup is currently open and applies/removes
 * the .scroll-lock class on the html element accordingly.
 */
export function updateScrollLock() {
  if (typeof document === "undefined") return;

  const isAnyModalOpen =
    ui.formatModal?.classList.contains("open") ||
    ui.filesModal?.classList.contains("open") ||
    ui.topControls?.classList.contains("menu-open") ||
    ui.popupBox?.classList.contains("open") ||
    !!document.querySelector(".ws-tray.ws-tray-open");

  document.documentElement.classList.toggle("scroll-lock", !!isAnyModalOpen);
}
