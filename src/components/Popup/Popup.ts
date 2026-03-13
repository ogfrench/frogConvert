import "./Popup.css";
import { ui } from "../store/store.ts";
import { formatBytes } from "../utils.ts";

import { ModalManager } from "../utils/ModalManager.ts";

// --- Popup ---

export function showPopup(content: string | Node | Node[], persistent = false, onEscape?: () => void) {
  if (typeof content === "string") {
    ui.popupBox.innerHTML = content;
  } else {
    ui.popupBox.innerHTML = "";
    if (Array.isArray(content)) {
      content.forEach(node => ui.popupBox.appendChild(node));
    } else {
      ui.popupBox.appendChild(content);
    }
  }
  ModalManager.open(ui.popupBox, ui.popupBackground, hidePopup, persistent, onEscape);
}

export function hidePopup() {
  ModalManager.close(ui.popupBox, ui.popupBackground);
}

export function replacePopup(content: Node[], persistent = false, onEscape?: () => void) {
  ui.popupBox.innerHTML = "";
  content.forEach(node => ui.popupBox.appendChild(node));
  ModalManager.replaceTop(ui.popupBox, ui.popupBackground, hidePopup, persistent, onEscape);
}

// --- Helpers ---

/** Create a button element for use in popups */
export function createPopupButton(
  text: string,
  className: string,
  onClick: () => void,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = className;
  btn.textContent = text;
  btn.addEventListener("click", onClick);
  return btn;
}

/** Show a simple alert popup with a title, message, and dismiss button */
export function showAlertPopup(
  title: string,
  messageHTML: string,
  buttonText: string = "Got it",
): void {
  const h2 = document.createElement("h2");
  h2.textContent = title;

  const p = document.createElement("p");
  p.innerHTML = messageHTML;

  const actions = document.createElement("div");
  actions.className = "popup-actions";
  actions.appendChild(createPopupButton(buttonText, "btn-primary", () => hidePopup()));

  showPopup([h2, p, actions]);
}

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

  const h2 = document.createElement("h2");
  h2.textContent = title;
  const p = document.createElement("p");
  p.textContent = body;

  const actions = document.createElement("div");
  actions.className = "popup-actions";

  actions.appendChild(createPopupButton("Go back", "btn-secondary", () => hidePopup()));
  actions.appendChild(createPopupButton("Convert anyway", "btn-primary", () => {
    hidePopup();
    onProceed();
  }));

  showPopup([h2, p, actions]);
}

export function showFileTypeMismatchPopup(files: File[], onProceed: (filtered: File[]) => void) {
  const typeGroups = new Map<string, File[]>();
  for (const file of files) {
    const type = file.type || "unknown";
    if (!typeGroups.has(type)) typeGroups.set(type, []);
    typeGroups.get(type)!.push(file);
  }

  const typeEntries = [...typeGroups.entries()];
  const h2 = document.createElement("h2");
  h2.textContent = "Multiple file types detected";
  const p = document.createElement("p");
  p.textContent = "Select which files to keep:";

  const actions = document.createElement("div");
  actions.className = "popup-actions popup-actions-stacked";

  for (const [type, groupFiles] of typeEntries) {
    const ext = groupFiles[0].name.split(".").pop()?.toUpperCase() || "Unknown";
    const count = groupFiles.length;

    const btn = document.createElement("button");
    btn.className = "type-filter-row";

    const spanText = document.createElement("span");
    spanText.textContent = `Keep only ${ext} (${count} file${count > 1 ? "s" : ""})`;

    const spanArrow = document.createElement("span");
    spanArrow.className = "type-filter-arrow";
    spanArrow.textContent = "›";

    btn.appendChild(spanText);
    btn.appendChild(spanArrow);

    btn.addEventListener("click", () => {
      const filtered = files.filter(f => (f.type || "unknown") === type);
      hidePopup();
      onProceed(filtered);
    });

    actions.appendChild(btn);
  }

  actions.appendChild(createPopupButton("Go back", "btn-secondary", () => hidePopup()));

  showPopup([h2, p, actions]);
}
