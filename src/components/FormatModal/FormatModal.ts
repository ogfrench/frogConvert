import type { FileFormat, FormatHandler } from "../../core/FormatHandler/FormatHandler.ts";
import "./FormatModal.css";
import { ui, CATEGORY_LABELS, formatDisplayName, formatMode, getFormatCategory, activeCategory, allOptionsRef, isLoadingPhase2, isLoadingHandlers, updateScrollLock, isFormatVisible, isCategoryVisible, reachableIdentifiers, selectedFromIndex, selectedToIndex, currentFiles } from "../store/store.ts";
import { formatToIdentifier } from "../../core/TraversionGraph/TraversionGraph.ts";
import { isSameFormatCompressible } from "../../core/compression/resolveCompressor.ts";
import { COMPRESS_THESE_EVENT } from "../../constants/ui.ts";
import { AI_FLATTENING_NOTICE } from "../../core/ghostscript/postscriptInput.ts";

// --- Format modal ---

import { ModalManager } from "../utils/ModalManager.ts";
import { isTouchUi } from "../../core/utils/touchUi.ts";
import { showToast } from "../Toast/Toast.ts";
import { officeEngineSupport, officeEngineDownloadSize, downloadOfficeEngine, isOfficeEngineCached } from "../../core/officeEngine/officeEngine.ts";
import { formatBytes } from "../utils/index.ts";

let _searchTimeout: ReturnType<typeof setTimeout> | undefined;

export function closeFormatModal() {
  clearTimeout(_searchTimeout);
  ModalManager.close(ui.formatModal, ui.formatModalBg);
}

function openFormatModal() {
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
  // Search the registry, not the already tier-filtered DOM.
  renderFormatOptions(allOptionsRef.value, activeCategory.value, query);
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
    if (btn && !btn.classList.contains("unavailable")) {
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
  // index.html ships it disabled; without this, assistive tech announced
  // Convert as disabled even once it worked.
  ui.convertButton.setAttribute("aria-disabled", String(!bothPicked));

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

/** The browser engine supports modern Office formats only. */
const BROWSER_OFFICE_INPUTS = new Set(["pptx", "docx", "xlsx", "odt", "odp", "ods"]);

let libreofficeNoticeDismissed = false;
let allowLimitedOnce = false;
let officeDownload: Promise<boolean> | null = null;
let officeDownloadController: AbortController | null = null;

export function isOfficePdfConversion(from: string, to: string): boolean {
  return LIBREOFFICE_INPUT_EXTS.has(from.toLowerCase()) && to.toLowerCase() === "pdf";
}

function hasOfficeHandler(inputExt: string): boolean {
  const formats = window.supportedFormatCache?.get("libreoffice");
  return Array.isArray(formats) && formats.some(f => f.from && f.format === inputExt);
}

function updateLibreofficeNoticeVisibility(fromIdx: number | null, toIdx: number | null) {
  const notice = ui.libreofficeNotice;
  if (!notice) return;

  const fromOpt = fromIdx === null ? null : allOptionsRef.value[fromIdx];
  const toOpt = toIdx === null ? null : allOptionsRef.value[toIdx];
  const inputExt = fromOpt?.format.extension.toLowerCase() ?? "";
  const outputExt = toOpt?.format.extension.toLowerCase() ?? "";
  if (!isOfficePdfConversion(inputExt, outputExt) || hasOfficeHandler(inputExt)) {
    notice.hidden = true;
    return;
  }

  if (libreofficeNoticeDismissed && navigator.userAgent.includes("Electron")) {
    notice.hidden = true;
    return;
  }
  notice.hidden = false;
  const dismiss = notice.querySelector<HTMLElement>(".convert-notice-dismiss");
  if (dismiss) dismiss.hidden = !navigator.userAgent.includes("Electron");
  if (navigator.userAgent.includes("Electron")) applyDesktopLibreofficeCopy(notice);
  else void applyBrowserEngineOffer(notice, inputExt);
}

/** The conversion action calls this before it reads files or chooses a route. */
export async function prepareOfficePdfConversion(inputExt: string, outputExt: string): Promise<"ready" | "limited" | "blocked"> {
  inputExt = inputExt.toLowerCase();
  if (!isOfficePdfConversion(inputExt, outputExt)) return "ready";
  if (allowLimitedOnce) {
    allowLimitedOnce = false;
    return "limited";
  }
  if (hasOfficeHandler(inputExt)) return "ready";
  // The desktop banner says the PDF will be a picture without LibreOffice, and
  // has no limited-conversion button to unblock it, so that is what it does.
  if (navigator.userAgent.includes("Electron")) return "limited";
  if (!BROWSER_OFFICE_INPUTS.has(inputExt)) {
    ui.libreofficeNotice.hidden = false;
    return "blocked";
  }

  const support = await officeEngineSupport();
  if (support === "unsupported") {
    ui.libreofficeNotice.hidden = false;
    return "blocked";
  }
  if (support === "available" && !(await installOfficeEngine(ui.libreofficeNotice))) return "blocked";
  if (support === "cached" && !(await activateOfficeEngine(ui.libreofficeNotice))) return "blocked";
  return hasOfficeHandler(inputExt) ? "ready" : "blocked";
}

/**
 * The desktop app converts through an installed LibreOffice
 * (src/electron-office.cjs), so there, unlike in a browser, installing it is
 * the fix. Swap the banner's advice once; the browser copy stays in index.html.
 */
function applyDesktopLibreofficeCopy(notice: HTMLElement) {
  if (!navigator.userAgent.includes("Electron") || notice.dataset.desktop) return;
  notice.dataset.desktop = "1";
  const title = notice.querySelector(".convert-notice-title");
  const text = notice.querySelector(".convert-notice-text");
  if (title) title.textContent = "Install LibreOffice for an exact PDF";
  if (text) text.textContent = "Without it this PDF will be a picture of your document, with no selectable text. frogConvert uses LibreOffice when it is installed on this computer: install it, then restart frogConvert. Nothing is uploaded.";
  const link = document.createElement("a");
  link.className = "convert-notice-link";
  link.href = "https://www.libreoffice.org/download/download-libreoffice/";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Get LibreOffice \u2192";
  notice.appendChild(link);
}

/** Make the existing inline Office notice available on all capable browsers. */
async function applyBrowserEngineOffer(notice: HTMLElement, inputExt: string): Promise<void> {
  if (officeDownload) return;
  const title = notice.querySelector<HTMLElement>(".convert-notice-title");
  const text = notice.querySelector<HTMLElement>(".convert-notice-text");
  const download = notice.querySelector<HTMLButtonElement>("#office-engine-download")
    ?? document.createElement("button");
  download.type = "button";
  download.id = "office-engine-download";
  download.className = "convert-notice-link";
  const limited = notice.querySelector<HTMLButtonElement>("#office-limited-convert")
    ?? document.createElement("button");
  limited.type = "button";
  limited.id = "office-limited-convert";
  limited.className = "convert-notice-secondary";
  limited.textContent = "Try limited conversion";
  limited.onclick = () => {
    allowLimitedOnce = true;
    ui.convertButton.click();
    // A click rejected by the conversion reentrancy guard must not affect the next file.
    queueMicrotask(() => { allowLimitedOnce = false; });
  };
  const support = await officeEngineSupport();
  if (hasOfficeHandler(inputExt) || notice.hidden) return;
  if (inputExt !== (selectedFromIndex.value === null
    ? "" : allOptionsRef.value[selectedFromIndex.value]?.format.extension.toLowerCase())) return;
  if (selectedToIndex.value === null || allOptionsRef.value[selectedToIndex.value]?.format.extension.toLowerCase() !== "pdf") return;

  if (title) title.textContent = "Preserve your Office document";
  if (text) text.textContent = "Without the Office engine, layouts and images may be lost and text will not be selectable. Limited conversion is optional.";
  if (support === "available" && BROWSER_OFFICE_INPUTS.has(inputExt)) {
    const bytes = await officeEngineDownloadSize();
    if (notice.hidden || hasOfficeHandler(inputExt)) return;
    if (title) title.textContent = "Get a high-quality PDF";
    if (text) text.textContent = "Download the Office engine once to preserve slides, images, formatting and selectable text as closely as possible. Conversion stays on this device. The engine can use around 1.5 GB of memory.";
    if (!ui.convertButton.classList.contains("disabled")) ui.convertButton.textContent = "Download engine & convert";
    download.textContent = bytes ? `Download engine (${formatBytes(bytes)})` : "Download Office engine";
    download.onclick = () => {
      if (officeDownloadController) officeDownloadController.abort();
      else void installOfficeEngine(notice);
    };
    notice.appendChild(download);
  } else if (support === "cached" && BROWSER_OFFICE_INPUTS.has(inputExt)) {
    download.remove();
    if (title) title.textContent = "Office engine already downloaded";
    if (text) text.textContent = "The Office engine is stored on this device. Press Convert to initialize it and preserve the document layout."; 
  } else {
    download.remove();
    if (title) title.textContent = BROWSER_OFFICE_INPUTS.has(inputExt)
      ? "Office engine unavailable in this browser"
      : "This older Office format needs updating";
    if (text) text.textContent = BROWSER_OFFICE_INPUTS.has(inputExt)
      ? "This browser cannot run the Office engine. Export a PDF from your Office app, or try the limited conversion below."
      : `Save this .${inputExt} file as a modern Office format first, or export a PDF from its original app. A limited conversion may lose layout and images.`;
  }
  notice.appendChild(limited);
}

async function activateOfficeEngine(notice: HTMLElement): Promise<boolean> {
  const text = notice.querySelector<HTMLElement>(".convert-notice-text");
  if (text) text.textContent = "Preparing the Office engine...";
  try {
    await new Promise<void>((resolve, reject) => {
      window.dispatchEvent(new CustomEvent("frog:office-engine-ready", {
        detail: { resolve, reject, refreshDuringConversion: true },
      }));
    });
    return true;
  } catch (err) {
    if (text) text.textContent = `The Office engine could not start: ${err instanceof Error ? err.message : String(err)}. Try again or export from your Office app.`;
    return false;
  }
}

function installOfficeEngine(notice: HTMLElement): Promise<boolean> {
  if (officeDownload) return officeDownload;
  const text = notice.querySelector<HTMLElement>(".convert-notice-text");
  const title = notice.querySelector<HTMLElement>(".convert-notice-title");
  const button = notice.querySelector<HTMLButtonElement>("#office-engine-download");
  const controller = new AbortController();
  officeDownloadController = controller;
  if (button) button.textContent = "Cancel download";

  officeDownload = (async () => {
    try {
      if (!(await isOfficeEngineCached())) {
        await downloadOfficeEngine(({ loaded, total, stage }) => {
          const label = stage === "saving" ? "Saving Office engine"
            : stage === "unpacking" ? "Unpacking Office engine" : "Downloading Office engine";
          if (text) text.textContent = `${label}: ${Math.floor((loaded / total) * 100)}%. You can continue using the app.`;
        }, controller.signal);
      }
      officeDownloadController = null;
      if (!(await activateOfficeEngine(notice))) return false;
      if (title) title.textContent = "Office engine ready";
      if (text) text.textContent = "Your Office files can now become high-quality PDFs on this device.";
      showToast("Office engine ready for PDF conversion.", "info", 6000);
      return true;
    } catch (err) {
      if (text) text.textContent = controller.signal.aborted
        ? "Download cancelled. Your file has not been converted."
        : `Office engine download failed: ${err instanceof Error ? err.message : String(err)}. Try again.`;
      return false;
    } finally {
      officeDownload = null;
      officeDownloadController = null;
      if (button) {
        button.textContent = "Try downloading again";
        button.onclick = () => { void installOfficeEngine(notice); };
      }
    }
  })();
  return officeDownload;
}

// --- Format list rendering ---

export function renderFormatOptions(
  allOptions: Array<{ format: FileFormat; handler: FormatHandler }>,
  category: string,
  query = ui.formatSearch.value,
) {
  activeCategory.value = category;
  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
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
    if (!searching && !isFormatVisible(format, formatMode.value)) continue;
    if (!searching && activeCategory.value && cat !== activeCategory.value) continue;
    if (searching && ![formatDisplayName(format), format.format, format.extension, CATEGORY_LABELS[cat] || cat,
        ...(Array.isArray(format.category) ? format.category : format.category ? [format.category] : [])]
      .some(value => value.toLowerCase().includes(q))) continue;

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
  const showHeaders = searching || !category;

  const reachable = reachableIdentifiers.value;
  const fromIdx = selectedFromIndex.value;
  const sourceExt = fromIdx !== null ? (allOptions[fromIdx]?.format.extension ?? null) : null;

  const appendOption = (item: { index: number; text: string }, unavailable: boolean) => {
    const btn = document.createElement("button");
    btn.className = unavailable ? "format-option unavailable" : "format-option";
    btn.setAttribute("data-index", item.index.toString());
    if (unavailable) btn.setAttribute("aria-disabled", "true");
    btn.textContent = item.text;
    if (searching) {
      const format = allOptions[item.index].format;
      const tier = isFormatVisible(format, "core") ? "Core" : isFormatVisible(format, "plus") ? "Core+" : "All";
      const label = document.createElement("span");
      label.className = "format-tier-tag";
      label.textContent = tier;
      btn.appendChild(label);
    }
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

  if (searching && !anyAvailable && unavailableByCat.size === 0) {
    const empty = document.createElement("div");
    empty.className = "format-empty-state";
    empty.textContent = isLoadingPhase2.value ? "Still loading formats…" : "No matching formats.";
    ui.formatOptions.appendChild(empty);
  }

  if (isLoadingPhase2.value) {
    const chip = document.createElement("div");
    chip.className = "format-loading-more";
    chip.innerHTML = `<span class="format-loading-dot"></span>Loading more formats\u2026`;
    ui.formatOptions.appendChild(chip);
  }
}
