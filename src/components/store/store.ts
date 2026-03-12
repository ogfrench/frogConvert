import type { FileFormat, FormatHandler } from "../../core/FormatHandler/FormatHandler.ts";
import { shortenFileName } from "../utils.ts";
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
    if (uiInternal[prop]) return uiInternal[prop];

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

type SizeCheckLevel = "ok" | "warning";

export function checkFileSizeLimits(files: File[]): { level: SizeCheckLevel; totalSize: number } {
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  if (totalSize > SIZE_WARNING_THRESHOLD) return { level: "warning", totalSize };
  return { level: "ok", totalSize };
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
  "png", "jpeg", "gif",
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
  "webp", "svg", "ico",
  // Audio
  "ogg", "aac",
  // Video
  "avi", "mkv",
  // Document
  "xlsx", "csv", "markdown", "html",
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
  if (typeof window === "undefined" || typeof localStorage === "undefined") return;

  function applyTheme(dark: boolean, transition: boolean = true) {
    if (transition) document.documentElement.classList.add("theme-transition");
    document.documentElement.classList.toggle("dark", dark);
    if (ui.themeToggleButton) {
      ui.themeToggleButton.innerHTML = dark ? "&#9788;" : "&#9790;";
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
    localStorage.setItem("theme", currentlyDark ? "light" : "dark");
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
    ui.popupBox?.classList.contains("open");

  document.documentElement.classList.toggle("scroll-lock", !!isAnyModalOpen);
}
