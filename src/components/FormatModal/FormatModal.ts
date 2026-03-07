import type { FileFormat, FormatHandler } from "../../core/FormatHandler/FormatHandler.ts";
import "./FormatModal.css";
import { ui, CATEGORY_LABELS, formatDisplayName, isAdvancedMode, BASIC_FORMATS, getFormatCategory, activeCategory, allOptionsRef, isLoadingPhase2 } from "../store/store.ts";

// --- Format modal ---

let _formatModalOpener: Element | null = null;
let _searchTimeout: ReturnType<typeof setTimeout> | undefined;

export function closeFormatModal() {
  clearTimeout(_searchTimeout);
  (_formatModalOpener as HTMLElement | null)?.focus();
  _formatModalOpener = null;
  ui.formatModal.classList.remove("open");
  ui.formatModalBg.classList.remove("open");
  ui.formatModal.setAttribute("aria-hidden", "true");
}

export function openFormatModal() {
  _formatModalOpener = document.activeElement;
  ui.formatModal.classList.add("open");
  ui.formatModalBg.classList.add("open");
  ui.formatModal.removeAttribute("aria-hidden");
  const label = CATEGORY_LABELS[activeCategory.value];
  ui.formatModalTitle.textContent = label ? `Choose ${label.toLowerCase()} format` : "Choose format";
  ui.formatSearch.value = "";
  // Don't auto-focus search on mobile to prevent keyboard popup
  if (!window.matchMedia("(pointer: coarse)").matches) {
    ui.formatSearch.focus();
  }
  renderFormatOptions(allOptionsRef.value, activeCategory.value);
  filterFormats("");
}

export function filterFormats(query: string) {
  const allOptions = allOptionsRef.value;
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
    ui.convertButton.classList.remove("disabled");
  } else {
    ui.convertButton.classList.add("disabled");
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
    if (activeCategory.value && cat !== activeCategory.value) continue;

    if (!isAdvancedMode.value && !BASIC_FORMATS.has(format.format.toLowerCase())) {
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
  const showHeaders = !category;

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
      ui.formatOptions.appendChild(btn);
    }
  }

  if (isLoadingPhase2.value) {
    const chip = document.createElement("div");
    chip.className = "format-loading-more";
    chip.innerHTML = `<span class="format-loading-dot"></span>Loading more formats\u2026`;
    ui.formatOptions.appendChild(chip);
  }
}
