import "./Popup.css";
import { ui, updateScrollLock } from "../store/store.ts";
import { escapeHTML, formatBytes } from "../utils.ts";

// --- Popup ---

const HIDE_MS = 160;

let _hideTimer: ReturnType<typeof setTimeout> | null = null;

export function showPopup(html: string) {
  if (_hideTimer !== null) {
    clearTimeout(_hideTimer);
    _hideTimer = null;
  }
  ui.popupBox.classList.remove("closing", "popup-visible");
  ui.popupBackground.classList.remove("closing", "popup-visible");
  ui.popupBox.innerHTML = html;
  ui.popupBox.style.display = "block";
  ui.popupBackground.style.display = "block";
  void ui.popupBox.offsetWidth; // force reflow to restart animation
  ui.popupBox.classList.add("popup-visible");
  ui.popupBackground.classList.add("popup-visible");
  updateScrollLock();
}

export function hidePopup() {
  ui.popupBox.classList.remove("popup-visible");
  ui.popupBackground.classList.remove("popup-visible");
  ui.popupBox.classList.add("closing");
  ui.popupBackground.classList.add("closing");
  _hideTimer = setTimeout(() => {
    _hideTimer = null;
    ui.popupBox.style.display = "none";
    ui.popupBackground.style.display = "none";
    ui.popupBox.classList.remove("closing");
    ui.popupBackground.classList.remove("closing");
    updateScrollLock();
  }, HIDE_MS);
}

// --- Helpers ---

export { escapeHTML, formatBytes };

export function showSizeWarningPopup(
  totalSize: number,
  fileCount: number,
  onProceed: () => void,
): void {
  const sizeStr = formatBytes(totalSize);
  const title = fileCount > 1 ? "Large files detected" : "Large file detected";
  const body = fileCount > 1
    ? `These files are ${sizeStr} total. Browsers can struggle with large files and may slow down or crash.`
    : `This file is ${sizeStr}. Browsers can struggle with large files and may slow down or crash.`;

  showPopup(sizeStr ? `<h2>${title}</h2>` +
    `<p>${body}</p>` +
    `<div class="popup-actions">` +
    `<button class="popup-secondary" onclick="window.hidePopup()">‹ Go back</button>` +
    `<button class="popup-primary" id="size-warn-proceed">Convert anyway</button>` +
    `</div>` : "");

  requestAnimationFrame(() => {
    const proceedBtn = document.getElementById("size-warn-proceed");
    proceedBtn?.addEventListener("click", () => {
      hidePopup();
      onProceed();
    });
  });
}

export function showFileTypeMismatchPopup(files: File[], onProceed: (filtered: File[]) => void) {
  const typeGroups = new Map<string, File[]>();
  for (const file of files) {
    const type = file.type || "unknown";
    if (!typeGroups.has(type)) typeGroups.set(type, []);
    typeGroups.get(type)!.push(file);
  }

  const typeEntries = [...typeGroups.entries()];
  let actionButtons = "";
  for (const [type, groupFiles] of typeEntries) {
    const ext = groupFiles[0].name.split(".").pop()?.toUpperCase() || "Unknown";
    const count = groupFiles.length;
    actionButtons += `<button class="type-filter-row" data-type-filter="${type}"><span>Keep only ${ext} (${count} file${count > 1 ? "s" : ""})</span><span class="type-filter-arrow">›</span></button>`;
  }

  showPopup(
    `<h2>Multiple file types detected</h2>` +
    `<p>Select which files to keep:</p>` +
    `<div class="popup-actions popup-actions-stacked">` +
    actionButtons +
    `<button class="popup-secondary" onclick="window.hidePopup()">‹ Go back</button>` +
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
