import type { FileFormat, FormatHandler } from "../../core/FormatHandler/FormatHandler.ts";
import "./FormatModal.css";
import { ui, CATEGORY_LABELS, formatDisplayName, formatMode, getFormatCategory, activeCategory, allOptionsRef, isLoadingPhase2, isLoadingHandlers, updateScrollLock, isFormatVisible, isCategoryVisible, reachableIdentifiers, selectedFromIndex, currentFiles } from "../store/store.ts";
import { formatToIdentifier } from "../../core/TraversionGraph/TraversionGraph.ts";
import { isSameFormatCompressible } from "../../core/compression/resolveCompressor.ts";
import { COMPRESS_THESE_EVENT } from "../../constants/ui.ts";
import { AI_FLATTENING_NOTICE } from "../../core/ghostscript/postscriptInput.ts";

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
    // The input is held, not resolved again inside the debounce, for the same
    // reason the confetti timer holds its popup: `ui` reaches through to the
    // document, and a timer can outlive it.
    const input = ui.formatSearch;
    _searchTimeout = setTimeout(() => filterFormats(input.value), 80);
  });

  ui.formatOptions.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest(".format-option");
    if (btn) {
      const index = parseInt(btn.getAttribute("data-index") || "", 10);
      if (!isNaN(index)) onSelectFormat(index);
    }
  });

  // Backdrop dismissal is `ModalManager`'s, not this module's. It kept its own
  // listener from before the manager had one, so after backdrop dismissal went
  // app-wide a single click ran both: the bespoke handler closed this modal
  // and popped it off the stack, then the manager's handler called `closeTop`
  // against whatever was left - which is the modal *underneath* when this one
  // is stacked. One gesture, one owner.
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
 * Same-format notice under the Convert button. Picking one format for both
 * sides converts nothing, so say that plainly up front and label the action
 * for what it actually does - hand the file back untouched - rather than
 * letting the user press "Convert" and discover it afterwards.
 * Lazy-created so it only enters the DOM for users who hit the case.
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

/**
 * What the Convert button says while it cannot yet be pressed.
 *
 * It used to say "Loading formats…", which is wrong twice. The formats are
 * already on screen - you can open the picker and choose PNG - so a user who
 * has just done that reads a button claiming to be loading the thing they are
 * looking at. What is actually still arriving is the converter code, tens of
 * megabytes of it, fetched in the background.
 *
 * On a slow connection this state lasts a long time, and "loading" with no
 * subject and no motion is indistinguishable from frozen. Naming the download,
 * and saying plainly when there is no connection to download over, is the
 * whole fix - there is no progress number to give, because the handlers arrive
 * as a set of independent chunks.
 */
function waitingLabel(): string {
    if (!isLoadingHandlers.value) return "Convert";
    // `navigator.onLine` false is reliable (no network interface); true is a
    // hint only. Used in that direction, it is worth stating: the download
    // this button is waiting on cannot possibly finish.
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    return offline ? "Offline - can't finish downloading" : "Downloading converters…";
}

export function updateConvertButtonState(selectedFromIndex: number | null, selectedToIndex: number | null) {
  const hint = ensureConvertHint();
  const bothPicked = selectedFromIndex !== null && selectedToIndex !== null;
  let samePick = false;

  if (bothPicked) {
    ui.convertButton.classList.remove("disabled");
    const fromOpt = allOptionsRef.value[selectedFromIndex];
    const toOpt = allOptionsRef.value[selectedToIndex];
    samePick = !!(fromOpt && toOpt
      && fromOpt.format.mime === toOpt.format.mime
      && fromOpt.format.format === toOpt.format.format);
    // Honest label: this path returns the input unchanged.
    ui.convertButton.textContent = samePick ? "Download original" : "Convert";
  } else {
    ui.convertButton.classList.add("disabled");
    ui.convertButton.textContent = waitingLabel();
  }
  // A breathing button, only while it is genuinely waiting on a download.
  // Without it the disabled grey reads as broken rather than busy - which is
  // exactly how it reads on a slow connection, where this state can last a
  // minute or more with nothing on screen changing.
  ui.convertButton.classList.toggle("is-waiting", !bothPicked && isLoadingHandlers.value);

  if (samePick) {
    // Two different situations share this signpost. If Compress can shrink
    // this format, the user who picked png->png almost certainly wanted it
    // smaller, so point them at the surface built for exactly that instead of
    // leaving them at a dead end. Only when no compressor exists is "you'll
    // get it back unchanged" the whole story.
    hint.textContent = "";
    // samePick implies bothPicked, but TS cannot see through the boolean.
    const fromOpt = selectedFromIndex !== null ? allOptionsRef.value[selectedFromIndex] : undefined;
    const compressible = fromOpt
      ? isSameFormatCompressible(fromOpt.format, allOptionsRef.value)
      : false;
    if (compressible) {
      hint.append("Same format in and out, so there's nothing to convert. Want it smaller? ");
      const go = document.createElement("button");
      go.type = "button";
      go.className = "convert-hint-action";
      go.textContent = "Open Compress";
      // Carry the batch across. Sending the user to an empty Compress card
      // makes them pick the same files a second time, which reads as the
      // button having done nothing - the files are the whole reason they are
      // being offered the trip.
      go.addEventListener("click", () => {
        closeFormatModal();
        window.dispatchEvent(new CustomEvent(COMPRESS_THESE_EVENT, {
          detail: { files: currentFiles.value.slice() },
        }));
      });
      hint.append(go);
    } else {
      hint.append("Same format in and out, so there's nothing to convert. You'll get your file back unchanged.");
    }
    hint.hidden = false;
  } else if (bothPicked && isIllustratorInput(selectedFromIndex)) {
    // #19 requires AI's lossiness to be stated "wherever it is offered", and
    // this is the last moment before the user commits. The conversion is a
    // good one - the artwork comes across whole - so this is a note, not a
    // warning, and it reuses the hint slot rather than a dismissable banner
    // that a returning user would never see again.
    hint.textContent = AI_FLATTENING_NOTICE;
    hint.hidden = false;
  } else {
    hint.hidden = true;
    hint.textContent = "";
  }

  updateLibreofficeNoticeVisibility(selectedFromIndex, selectedToIndex);
}

/** True when the chosen input is an Illustrator file, whatever it converts to. */
function isIllustratorInput(fromIdx: number | null): boolean {
  if (fromIdx === null) return false;
  return allOptionsRef.value[fromIdx]?.format.format === "ai";
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
