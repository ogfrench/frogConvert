import "./Popup.css";
import { ui, allOptionsRef, isFileSupported } from "../store/store.ts";
import { formatBytes, shortenFileName } from "../utils/index.ts";

import { ModalManager } from "../utils/ModalManager.ts";

// --- Popup ---

/**
 * SECURITY: When content is a string it is injected via innerHTML.
 * Only pass hardcoded HTML strings, never pass user-supplied content.
 * Prefer the Node | Node[] overload to avoid innerHTML entirely.
 */
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

/**
 * Show a simple alert popup with a title, message, and dismiss button.
 * SECURITY: messageHTML is injected via innerHTML. Any user-supplied content
 * must be escaped with escapeHTML() before being passed as messageHTML.
 */
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
  actions.className = "popup-actions-footer";
  actions.appendChild(createPopupButton(buttonText, "btn-primary", () => hidePopup()));

  replacePopup([h2, p, actions]);
}

/**
 * Show a two-button confirm popup. Title + plain-text body + primary/secondary
 * buttons. Each button click hides the popup, then runs its callback if any.
 */
export function showConfirmPopup(
  title: string,
  body: string,
  primary: { label: string; onClick?: () => void | Promise<void> },
  secondary: { label: string; onClick?: () => void | Promise<void> },
): void {
  const h2 = document.createElement("h2");
  h2.textContent = title;
  const p = document.createElement("p");
  p.textContent = body;
  const actions = document.createElement("div");
  actions.className = "popup-actions-footer";
  actions.appendChild(createPopupButton(primary.label, "btn-primary", async () => {
    hidePopup();
    if (primary.onClick) await primary.onClick();
  }));
  actions.appendChild(createPopupButton(secondary.label, "btn-secondary", async () => {
    hidePopup();
    if (secondary.onClick) await secondary.onClick();
  }));
  replacePopup([h2, p, actions]);
}

export function showSizeWarningPopup(
  totalSize: number,
  fileCount: number,
  onProceed: () => void,
): void {
  const sizeStr = `~${formatBytes(totalSize)}`;
  const title = fileCount > 1 ? "Large files detected" : "Large file detected";
  const body = fileCount > 1
    ? `These files are ${sizeStr} total. Browsers can struggle with large files and may slow down or crash.`
    : `This file is ${sizeStr}. Browsers can struggle with large files and may slow down or crash.`;

  const h2 = document.createElement("h2");
  h2.textContent = title;
  const p = document.createElement("p");
  p.textContent = body;

  const actions = document.createElement("div");
  actions.className = "popup-actions-footer";

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

  const opts = allOptionsRef.value;
  type Entry = { type: string; files: File[]; ext: string; supported: boolean; hint?: { app: string; modern: string } };
  const entries: Entry[] = [...typeGroups.entries()].map(([type, groupFiles]) => {
    const ext = groupFiles[0].name.split(".").pop()?.toUpperCase() || "Unknown";
    const supported = opts.length === 0 || isFileSupported(groupFiles[0], opts);
    const hint = LEGACY_OFFICE_HINT[ext.toLowerCase()];
    return { type, files: groupFiles, ext, supported, hint };
  });
  entries.sort((a, b) => Number(b.supported) - Number(a.supported));

  const h2 = document.createElement("h2");
  h2.textContent = "Multiple file types detected";
  const p = document.createElement("p");
  p.textContent = "Select which files to keep:";

  const actions = document.createElement("div");
  actions.className = "popup-actions popup-actions-stacked type-filter-scroll";

  for (const entry of entries) {
    const count = entry.files.length;
    const btn = document.createElement("button");
    btn.className = "type-filter-row";

    const spanText = document.createElement("span");
    spanText.textContent = entry.supported
      ? `Keep only ${entry.ext} (${count} file${count > 1 ? "s" : ""})`
      : `${entry.ext} not available (${count} file${count > 1 ? "s" : ""})`;
    btn.appendChild(spanText);

    if (entry.supported) {
      const spanArrow = document.createElement("span");
      spanArrow.className = "type-filter-arrow";
      spanArrow.textContent = "›";
      btn.appendChild(spanArrow);

      btn.addEventListener("click", () => {
        const filtered = files.filter(f => (f.type || "unknown") === entry.type);
        hidePopup();
        onProceed(filtered);
      });
    } else {
      btn.classList.add("type-filter-row--unsupported");
      btn.disabled = true;
      const tag = document.createElement("span");
      tag.className = "type-filter-tag";
      tag.textContent = entry.hint ? `Save as .${entry.hint.modern}` : "Not supported";
      btn.appendChild(tag);
    }

    actions.appendChild(btn);
  }

  const footer = document.createElement("div");
  footer.className = "popup-actions-footer";
  footer.appendChild(createPopupButton("Go back", "btn-secondary", () => hidePopup()));

  showPopup([h2, p, actions, footer]);
}

// --- Upload summary (read-only list of which files were added / skipped) ---

export type UploadSkipReason = "unsupported" | "too-large" | "page-limit" | "file-limit" | "load-error";

export type UploadResult =
  | { name: string; status: "added" }
  | { name: string; status: "skipped"; reason: UploadSkipReason };

const SKIP_LABEL: Record<UploadSkipReason, string> = {
  "unsupported": "Not supported",
  "too-large":   "Too large",
  "page-limit":  "Page limit",
  "file-limit":  "File limit",
  "load-error":  "Couldn't read PDF",
};

export interface UploadLimits {
  pages?: number;
  sizeBytes?: number;
  files?: number;
}

export function showUploadSummaryPopup(results: UploadResult[], limits?: UploadLimits): void {
  let added = 0;
  const reasons = new Set<UploadSkipReason>();
  for (const r of results) {
    if (r.status === "added") added++;
    else reasons.add(r.reason);
  }
  const skipped = results.length - added;

  const h2 = document.createElement("h2");
  h2.textContent = added === 0
    ? "Couldn't add all files"
    : skipped === 0
      ? `Added ${added} file${added !== 1 ? "s" : ""}`
      : `Added ${added} of ${results.length} files`;

  const nodes: Node[] = [h2];

  const parts: string[] = [];
  if (reasons.has("file-limit") && limits?.files != null) parts.push(`${limits.files} files`);
  if (reasons.has("page-limit") && limits?.pages != null) parts.push(`${limits.pages} pages`);
  if (reasons.has("too-large")  && limits?.sizeBytes != null) parts.push(formatBytes(limits.sizeBytes));
  if (parts.length) {
    const sub = document.createElement("p");
    sub.className = "upload-summary-sub";
    sub.textContent = parts.length === 1
      ? `Limit: ${parts[0]} total.`
      : `Limits: ${parts.join(" · ")} total.`;
    nodes.push(sub);
  }

  const list = document.createElement("ul");
  list.className = "upload-summary-list";

  const frag = document.createDocumentFragment();
  for (const r of results) {
    const li = document.createElement("li");
    li.className = `upload-summary-row upload-summary-row--${r.status}`;

    const name = document.createElement("span");
    name.className = "upload-summary-name truncate";
    name.textContent = shortenFileName(r.name, 36);
    name.title = r.name;
    li.appendChild(name);

    const tag = document.createElement("span");
    tag.className = "upload-summary-tag";
    tag.textContent = r.status === "added" ? "Added" : SKIP_LABEL[r.reason];
    li.appendChild(tag);

    frag.appendChild(li);
  }
  list.appendChild(frag);

  nodes.push(list);

  const actions = document.createElement("div");
  actions.className = "popup-actions-footer";
  actions.appendChild(createPopupButton("Got it", "btn-primary", () => hidePopup()));
  nodes.push(actions);

  showPopup(nodes);
}

export const LEGACY_OFFICE_HINT: Record<string, { app: string; modern: string }> = {
  doc:  { app: "Word",       modern: "DOCX" },
  docm: { app: "Word",       modern: "DOCX" },
  xls:  { app: "Excel",      modern: "XLSX" },
  xlsm: { app: "Excel",      modern: "XLSX" },
  xlsb: { app: "Excel",      modern: "XLSX" },
  ppt:  { app: "PowerPoint", modern: "PPTX" },
  pptm: { app: "PowerPoint", modern: "PPTX" },
};

export function showUnsupportedFilePopup(files: File[]) {
  const h2 = document.createElement("h2");
  h2.textContent = files.length > 1 ? "Unsupported files" : "Unsupported file";

  const p = document.createElement("p");
  if (files.length > 1) {
    p.innerHTML = `These formats aren't supported yet.<br><br>Stay tuned, they might be on the way!`;
  } else {
    const ext = files[0].name.split(".").pop()?.toUpperCase() || "this";
    const extLower = ext.toLowerCase();
    const bold = document.createElement("b");
    bold.textContent = `.${ext}`;
    p.appendChild(bold);
    p.appendChild(document.createTextNode(" isn't supported yet."));
    p.appendChild(document.createElement("br"));
    p.appendChild(document.createElement("br"));
    const hint = LEGACY_OFFICE_HINT[extLower];
    if (hint) {
      p.appendChild(document.createTextNode(`Open it in ${hint.app} and save as .${hint.modern} to convert it here.`));
    } else {
      p.appendChild(document.createTextNode("Stay tuned, this format might be on the way!"));
    }
  }

  const actions = document.createElement("div");
  actions.className = "popup-actions-footer";
  actions.appendChild(createPopupButton("Got it", "btn-primary", () => hidePopup()));

  showPopup([h2, p, actions]);
}
