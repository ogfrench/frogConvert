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
 * Compression: one control, three independent settings.
 *
 * Every mode compresses something, so the control appears in all three - but
 * they mean different things ("how much quality to give up while changing
 * format" vs "how hard to squeeze" vs "should editing this PDF also shrink
 * it"), and an earlier build that shared one value was surprising in use:
 * dialling Compress up silently changed what your next conversion encoded at.
 * Each surface owns its own value and its own default.
 *
 * Note the inversion throughout: the engine's `low` preset means "low quality
 * target", i.e. the *most* compression, while `high` compresses least.
 */

/** The whole vocabulary. Each surface offers an ordered subset. */
export type QualityLevel = "auto" | "lossless" | "high" | "medium" | "low";

/**
 * Labels live here once so a level cannot be called "Balanced" in one menu and
 * "Recommended" in another. Naming follows the quality-forward convention
 * Acrobat and the OS export dialogs use ("High Quality", "Smallest File Size")
 * rather than the compression-amount wording of the online PDF tools: it puts
 * every option on one axis (how good does the output look), and it avoids the
 * incoherence of listing "No compression" beside "Extreme compression", which
 * read as opposite ends of two different scales.
 */
const QUALITY_LABELS: Record<QualityLevel, string> = {
  auto: "Automatic",
  lossless: "Original quality",
  high: "High quality",
  medium: "Balanced",
  low: "Smallest file",
};

export type QualityChoice<T extends QualityLevel = QualityLevel> =
  { value: T; label: string; blurb: string };

/** Build a surface's menu: pick the levels it can honour, in order, and say
 *  what each one means *there*. Labels come from the shared map. */
function choices<T extends QualityLevel>(
  order: readonly T[],
  blurbs: Record<T, string>,
): ReadonlyArray<QualityChoice<T>> {
  return order.map(value => ({ value, label: QUALITY_LABELS[value], blurb: blurbs[value] }));
}

/** Reads a persisted level, falling back to the surface's default when the
 *  stored value isn't one this surface offers (or storage is unavailable). */
function persisted<T extends QualityLevel>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): { value: T } {
  const saved = safeGetLocalStorage(key);
  return { value: (allowed as readonly string[]).includes(saved ?? "") ? saved as T : fallback };
}

function persist(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
}

// --- Converter -------------------------------------------------------------
// Includes lossless: "convert but don't compress" is a meaningful request when
// you're changing format.

export type ConvertQuality = QualityLevel;

export const CONVERT_QUALITY_CHOICES = choices(
  ["lossless", "auto", "high", "medium", "low"] as const,
  {
    lossless: "No compression, just the format change",
    auto: "Reads each file and picks a level",
    high: "Slightly smaller files",
    medium: "Recommended for most files",
    low: "Visible quality loss",
  },
);

/**
 * Original quality: a conversion changes the *format*, and nothing else.
 *
 * This used to default to Automatic, which reads each file and steps it down a
 * tier. That is the right instinct on the Compress surface, where making the
 * file smaller is the entire request. It is the wrong one here. Somebody who
 * asks for JPG has asked for JPG - not for a smaller JPG - and Automatic
 * answers a question they did not put. The cost is not theoretical: below
 * "high" the plan applies a long-edge cap, so a 4032x3024 photo comes back at
 * 2560 or 1920 px. Resolution does not come back, the conversion is the only
 * copy the user keeps, and nothing on screen said it happened.
 *
 * So the default matches what each surface is *for*: Convert hands back your
 * file in a new format, the PDF editor hands back the document you edited, and
 * Compress - where shrinking is the point - still defaults to Automatic.
 * Anyone who wants the conversion to shrink says so, and Automatic is one item
 * away.
 *
 * It also keeps the promise cheap. At Original quality no probe reads the
 * file and no compression engine is fetched, so the common path costs nothing
 * it does not use.
 */
export const CONVERT_QUALITY_DEFAULT: ConvertQuality = "lossless";

export const convertQuality = persisted(
  "convertQuality", CONVERT_QUALITY_CHOICES.map(c => c.value), CONVERT_QUALITY_DEFAULT);

export function setConvertQuality(next: ConvertQuality) {
  convertQuality.value = next;
  persist("convertQuality", next);
}

// --- Compress surface ------------------------------------------------------
// No lossless: as a compression level it can only ever mean "do nothing", and
// the keep-threshold would discard every result.

export type CompressLevel = Exclude<QualityLevel, "lossless">;

export const COMPRESS_LEVEL_CHOICES = choices(
  ["auto", "high", "medium", "low"] as const,
  {
    // Fragments without trailing full stops, matching the Converter's set.
    // These sat side by side in one menu and were punctuated differently.
    auto: "Reads each file and picks a level",
    high: "Smaller, at close to full quality",
    // Promising the user won't notice is a promise about their eyes and their
    // file, and this surface cannot make it: the same level is imperceptible
    // on a photo and obvious on a screenshot of text.
    medium: "Much smaller, some quality given up",
    low: "Smallest, with visible quality loss",
  },
);

/** Automatic: it's what the app did before compression had a visible control,
 *  and it's the right answer when the user has no opinion. */
export const COMPRESS_LEVEL_DEFAULT: CompressLevel = "auto";

export const compressLevel = persisted(
  "compressLevel", COMPRESS_LEVEL_CHOICES.map(c => c.value), COMPRESS_LEVEL_DEFAULT);

export function setCompressLevel(next: CompressLevel) {
  compressLevel.value = next;
  persist("compressLevel", next);
}

// --- PDF editor ------------------------------------------------------------
// Merging, organizing and watermarking are edits, not exports: the output is
// expected to be the same document. So the default is Original quality and the
// editor touches nothing. Pick any other level and the finished PDF is run
// through Ghostscript on the way out.
//
// Automatic is offered but is *not* the default, which is the whole point.
// "Read the file and decide" is a good answer for someone who wants a smaller
// PDF and a surprising one applied silently to an edit, so it is available to
// anyone who goes looking and never happens to anyone who doesn't. It resolves
// through the same `decideAutoQuality` the other two surfaces use, including
// the PDF-specific rule that a lower preset can produce a *larger* file.

export type PdfQuality = QualityLevel;

export const PDF_QUALITY_CHOICES = choices(
  ["lossless", "auto", "high", "medium", "low"] as const,
  {
    // A blurb that opens by repeating its own label ("Balanced. Good for...")
    // spends the reader's attention saying nothing.
    lossless: "No compression, your pages untouched",
    auto: "Reads your PDF and picks a level",
    high: "Print-quality images",
    medium: "Good for sharing and email",
    low: "Visible quality loss on images",
  },
);

/** Original quality: an edit hands back the document you edited, untouched. */
export const PDF_QUALITY_DEFAULT: PdfQuality = "lossless";

export const pdfQuality = persisted(
  "pdfQuality", PDF_QUALITY_CHOICES.map(c => c.value), PDF_QUALITY_DEFAULT);

export function setPdfQuality(next: PdfQuality) {
  pdfQuality.value = next;
  persist("pdfQuality", next);
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
