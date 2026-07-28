import type { FileFormat, FormatHandler } from "../../core/FormatHandler/FormatHandler.ts";
import "./FormatModal.css";
import { ui, CATEGORY_LABELS, formatDisplayName, formatMode, getFormatCategory, activeCategory, allOptionsRef, isLoadingPhase2, isLoadingHandlers, updateScrollLock, isFormatVisible, isCategoryVisible, reachableIdentifiers, selectedFromIndex } from "../store/store.ts";
import { formatToIdentifier } from "../../core/TraversionGraph/TraversionGraph.ts";
import { isSameFormatCompressible } from "../../core/compression/resolveCompressor.ts";

// --- Format modal ---

import { ModalManager } from "../utils/ModalManager.ts";
import { isTouchUi } from "../../core/utils/touchUi.ts";
import { showToast } from "../Toast/Toast.ts";

let _searchTimeout: ReturnType<typeof setTimeout> | undefined;

export function closeFormatModal() {
  clearTimeout(_searchTimeout);
  ModalManager.close(ui.formatModal, ui.formatModalBg);
}

export function openFormatModal() {
  const label = CATEGORY_LABELS[activeCategory.value];
  ui.formatModalTitle.textContent = label ? `Choose ${label.toLowerCase()} format` : "Choose format";
  ui.formatSearch.value = "";
  renderFormatOptions(allOptionsRef.value, activeCategory.value);
  filterFormats("");

  ModalManager.open(ui.formatModal, ui.formatModalBg, closeFormatModal);

  // Don't auto-focus search on mobile to prevent keyboard popup
  if (!isTouchUi()) {
    ui.formatSearch.focus();
  }
}

export function filterFormats(query: string) {
  const allOptions = allOptionsRef.value;
  const options = ui.formatOptions;
  const q = query.toLowerCase();
  let lastHeaderVisible = false;
  let lastHeader: HTMLElement | null = null;
  let unavailableDivider: HTMLElement | null = null;
  let unavailableDividerVisible = false;

  for (const child of Array.from(options.children)) {
    const el = child as HTMLElement;
    if (el.classList.contains("format-unavailable-header")) {
      el.style.display = "none";
      unavailableDivider = el;
      unavailableDividerVisible = false;
      lastHeader = null;
      lastHeaderVisible = false;
    } else if (el.classList.contains("format-group-header")) {
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
        if (unavailableDivider && !unavailableDividerVisible && el.classList.contains("unavailable")) {
          unavailableDivider.style.display = "";
          unavailableDividerVisible = true;
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
  allOptionsRef.value = allOptions;

  ui.formatSelector.addEventListener("click", () => {
    if (ui.formatModal.classList.contains("open")) {
      closeFormatModal();
    } else {
      openFormatModal();
    }
  });

  ui.formatSearch.addEventListener("input", () => {
    clearTimeout(_searchTimeout);
    _searchTimeout = setTimeout(() => filterFormats(ui.formatSearch.value), 80);
  });

  ui.formatOptions.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest(".format-option");
    if (btn) {
      const index = parseInt(btn.getAttribute("data-index") || "", 10);
      if (!isNaN(index)) onSelectFormat(index);
    }
  });

  ui.formatModalBg.addEventListener("click", () => closeFormatModal());
  ui.formatModalClose.addEventListener("click", () => closeFormatModal());

  // Arrow-key navigation across the visible format-option list. The list can
  // hold ~70 options; without this, keyboard users had to Tab through every
  // entry to reach the bottom.
  ui.formatSearch.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown") return;
    const first = visibleFormatOption(0);
    if (!first) return;
    e.preventDefault();
    first.focus();
  });
  ui.formatOptions.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    const opts = visibleFormatOptions();
    if (!opts.length) return;
    const current = opts.indexOf(document.activeElement as HTMLElement);
    let next = current;
    if (e.key === "ArrowDown") next = current < 0 ? 0 : Math.min(opts.length - 1, current + 1);
    else if (e.key === "ArrowUp") {
      // Up from the first option pulls focus back into the search field.
      if (current <= 0) {
        e.preventDefault();
        ui.formatSearch.focus();
        return;
      }
      next = current - 1;
    }
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = opts.length - 1;
    e.preventDefault();
    opts[next].focus();
  });

  document.getElementById("libreoffice-notice-dismiss")?.addEventListener("click", () => {
    libreofficeNoticeDismissed = true;
    ui.libreofficeNotice.hidden = true;
  });
}

function visibleFormatOptions(): HTMLElement[] {
  return Array.from(ui.formatOptions.querySelectorAll<HTMLElement>(".format-option"))
    .filter(el => el.style.display !== "none");
}

function visibleFormatOption(idx: number): HTMLElement | null {
  return visibleFormatOptions()[idx] ?? null;
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

/**
 * Compression helper line shown under the Convert button when the user
 * picks the same format for input and output AND that format supports
 * same-format compression (see `resolveSameFormatHandler`). Lazy-created
 * on first use so it only enters the DOM for users who hit the feature.
 */
let _convertHintEl: HTMLSpanElement | null = null;
function ensureConvertHint(): HTMLSpanElement {
  if (_convertHintEl && _convertHintEl.isConnected) return _convertHintEl;
  const el = document.createElement("span");
  el.className = "convert-hint";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.hidden = true;
  ui.convertButton.insertAdjacentElement("afterend", el);
  _convertHintEl = el;
  return el;
}

export function updateConvertButtonState(selectedFromIndex: number | null, selectedToIndex: number | null) {
  const hint = ensureConvertHint();
  let showCompress = false;
  let formatLabel = "";

  if (selectedFromIndex !== null && selectedToIndex !== null) {
    ui.convertButton.classList.remove("disabled");
    const fromOpt = allOptionsRef.value[selectedFromIndex];
    const toOpt = allOptionsRef.value[selectedToIndex];
    const samePick = fromOpt && toOpt
      && fromOpt.format.mime === toOpt.format.mime
      && fromOpt.format.format === toOpt.format.format;
    showCompress = !!(samePick && isSameFormatCompressible(toOpt.format));
    if (showCompress) formatLabel = toOpt.format.format.toUpperCase();
    if (showCompress) {
      ui.convertButton.innerHTML = `<span class="convert-strike">Convert</span> Compress`;
    } else {
      ui.convertButton.textContent = "Convert";
    }
  } else {
    ui.convertButton.classList.add("disabled");
    ui.convertButton.textContent = isLoadingHandlers.value ? "Loading formats…" : "Convert";
  }

  ui.convertButton.classList.toggle("compress-mode", showCompress);

  if (showCompress) {
    hint.textContent = `${formatLabel} \u2192 ${formatLabel}? This will compress it, not convert it. Available for select formats.`;
    hint.hidden = false;
  } else {
    hint.hidden = true;
    hint.textContent = "";
  }

  updateLibreofficeNoticeVisibility(selectedFromIndex, selectedToIndex);
}

/**
 * Office formats that LibreOffice can convert to PDF with high fidelity.
 * Must match the input formats declared in src/handlers/libreoffice.ts.
 */
const LIBREOFFICE_INPUT_EXTS = new Set([
  "pptx", "docx", "xlsx", "ppt", "odt", "odp", "ods"
]);

/**
 * Show the "install LibreOffice for best results" notice when the user is
 * about to convert an office document to PDF but the libreoffice handler
 * isn't available (either no local binary AND no localhost API server with
 * libreoffice enabled). Otherwise hide it.
 */
let libreofficeNoticeDismissed = false;
let mobileHintShown = false;

function updateLibreofficeNoticeVisibility(fromIdx: number | null, toIdx: number | null) {
  const notice = ui.libreofficeNotice;
  if (!notice) return;

  if (libreofficeNoticeDismissed) {
    notice.hidden = true;
    return;
  }

  // Need both formats selected to decide
  if (fromIdx === null || toIdx === null) {
    notice.hidden = true;
    return;
  }

  const fromOpt = allOptionsRef.value[fromIdx];
  const toOpt = allOptionsRef.value[toIdx];
  if (!fromOpt || !toOpt) {
    notice.hidden = true;
    return;
  }

  // Only applies to office-doc → PDF conversions
  const inputExt = (fromOpt.format.extension || "").toLowerCase();
  const outputExt = (toOpt.format.extension || "").toLowerCase();
  const isOfficeToPdf = LIBREOFFICE_INPUT_EXTS.has(inputExt) && outputExt === "pdf";
  if (!isOfficeToPdf) {
    notice.hidden = true;
    return;
  }

  // Check if libreoffice is available. The handler populates its formats
  // only when it has a working mode (native or remote). An empty entry (or
  // missing entry) means the handler is disabled.
  const lofmts = window.supportedFormatCache?.get("libreoffice");
  const libreofficeAvailable = Array.isArray(lofmts) && lofmts.length > 0;

  const shouldShow = !libreofficeAvailable;

  if (isTouchUi()) {
    // On mobile, the banner takes too much space, show a one-time toast instead.
    notice.hidden = true;
    if (shouldShow && !mobileHintShown) {
      mobileHintShown = true;
      showToast(
        "You're on mobile, so this conversion will happen without LibreOffice. Your PDF may not match your slides.",
        "warn",
        12000,
      );
    }
  } else {
    notice.hidden = !shouldShow;
  }
}

// --- Format list rendering ---

export function renderFormatOptions(
  allOptions: Array<{ format: FileFormat; handler: FormatHandler }>,
  category: string,
) {
  activeCategory.value = category;
  ui.formatOptions.innerHTML = "";

  if (allOptions.length === 0) {
    const msg = document.createElement("div");
    msg.className = "format-loading";
    msg.innerHTML = `<div class="loader-spinner"></div><p>Loading formats…</p><p class="format-loading-hint">This may take a moment on first load</p>`;
    ui.formatOptions.appendChild(msg);
    return;
  }

  const toGroups = new Map<string, Array<{ index: number; text: string }>>();
  const seenTo = new Set<string>();

  for (let i = 0; i < allOptions.length; i++) {
    const { format } = allOptions[i];
    if (!format.mime) continue;

    const cat = getFormatCategory(format);
    if (!isFormatVisible(format, formatMode.value)) continue;
    if (activeCategory.value && cat !== activeCategory.value) continue;

    const dedupeKey = `${cat}::${format.mime}::${format.format}`;

    if (format.to) {
      if (!seenTo.has(dedupeKey)) {
        seenTo.add(dedupeKey);
        if (!toGroups.has(cat)) toGroups.set(cat, []);
        toGroups.get(cat)!.push({ index: i, text: formatDisplayName(format) });
      }
    }
  }

  const categoryOrder = ["image", "audio", "video", "document", "data", "archive", "font", "code", "other"];
  const showHeaders = !category;

  const reachable = reachableIdentifiers.value;
  const fromIdx = selectedFromIndex.value;
  const sourceExt = fromIdx !== null ? (allOptions[fromIdx]?.format.extension ?? null) : null;

  const appendOption = (item: { index: number; text: string }, unavailable: boolean) => {
    const btn = document.createElement("button");
    btn.className = unavailable ? "format-option unavailable" : "format-option";
    btn.setAttribute("data-index", item.index.toString());
    if (unavailable) btn.setAttribute("aria-disabled", "true");
    btn.textContent = item.text;
    ui.formatOptions.appendChild(btn);
  };

  const unavailableByCat = new Map<string, { index: number; text: string }[]>();
  let anyAvailable = false;

  for (const cat of categoryOrder) {
    const items = toGroups.get(cat);
    if (!items || items.length === 0) continue;

    const available: Array<{ index: number; text: string }> = [];
    const unavailable: Array<{ index: number; text: string }> = [];
    if (reachable) {
      for (const it of items) {
        if (reachable.has(formatToIdentifier(allOptions[it.index].format))) available.push(it);
        else unavailable.push(it);
      }
    } else {
      available.push(...items);
    }

    if (unavailable.length > 0) unavailableByCat.set(cat, unavailable);
    if (available.length === 0) continue;
    anyAvailable = true;

    if (showHeaders) {
      const header = document.createElement("div");
      header.className = "format-group-header";
      header.textContent = CATEGORY_LABELS[cat] || cat;
      ui.formatOptions.appendChild(header);
    }

    for (const item of available) appendOption(item, false);
  }

  if (reachable && !anyAvailable && unavailableByCat.size > 0) {
    const empty = document.createElement("div");
    empty.className = "format-empty-state";
    empty.textContent = `Conversions from ${sourceExt ? sourceExt.toUpperCase() : "this file"} aren't available yet. Try a different source file.`;
    ui.formatOptions.appendChild(empty);
  }

  if (unavailableByCat.size > 0) {
    const divider = document.createElement("div");
    divider.className = "format-group-header format-unavailable-header";
    divider.textContent = `Not available from ${sourceExt ? sourceExt.toUpperCase() : "this file"}`;
    ui.formatOptions.appendChild(divider);
    for (const cat of categoryOrder) {
      const items = unavailableByCat.get(cat);
      if (!items) continue;
      if (showHeaders) {
        const header = document.createElement("div");
        header.className = "format-group-header format-group-header-unavailable";
        header.textContent = CATEGORY_LABELS[cat] || cat;
        ui.formatOptions.appendChild(header);
      }
      for (const item of items) appendOption(item, true);
    }
  }

  if (isLoadingPhase2.value) {
    const chip = document.createElement("div");
    chip.className = "format-loading-more";
    chip.innerHTML = `<span class="format-loading-dot"></span>Loading more formats\u2026`;
    ui.formatOptions.appendChild(chip);
  }
}
