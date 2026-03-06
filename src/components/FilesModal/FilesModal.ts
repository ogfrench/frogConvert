import "./FilesModal.css";
import {
  ui, currentFiles, shortenFileName, FILES_PER_PAGE, filesModalPage,
  filesModalResizeHandler, onClearFiles, onFilesChanged, MAX_FILES,
  checkFileSizeLimits, showSizeWarningPopup, showFileTypeMismatchPopup, sortFilesByName, bindDragAndDropVisuals
} from "../store/store.ts";
import { showFileInUploadZone } from "../UploadZone/UploadZone.ts";

/** Returns a friendly label for a MIME type, e.g. "image/png" -> "PNG image" */
function friendlyMimeLabel(mime: string): string {
  if (!mime) return "unknown type";
  const [category, subtype] = mime.split("/");
  const ext = (subtype || "").replace(/^x-/, "").split(";")[0].trim().toUpperCase();
  const categoryMap: Record<string, string> = {
    image: "image",
    audio: "audio file",
    video: "video",
    text: "text file",
    application: "file",
    font: "font",
  };
  const label = categoryMap[category] ?? "file";
  return ext ? `${ext} ${label}` : label;
}

// --- Files Management Modal ---

let _filesModalOpener: Element | null = null;

export function openFilesModal() {
  _filesModalOpener = document.activeElement;
  ui.filesModal.classList.add("open");
  ui.filesModalBg.classList.add("open");
  ui.filesModal.removeAttribute("aria-hidden");
  filesModalPage.value = 0;
  renderFilesModalList();
  hideFilesModalError();
  // Lock the list height after first render to prevent jumps on file removal
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const listHeight = ui.filesList.offsetHeight;
      if (listHeight > 0) {
        ui.filesList.style.height = listHeight + "px";
      }
    });
  });

  // Recalculate on resize so modal adapts to new viewport
  if (filesModalResizeHandler.value) window.removeEventListener("resize", filesModalResizeHandler.value);
  filesModalResizeHandler.value = () => {
    ui.filesList.style.height = "";
    requestAnimationFrame(() => {
      const h = ui.filesList.offsetHeight;
      if (h > 0) ui.filesList.style.height = h + "px";
    });
  };
  window.addEventListener("resize", filesModalResizeHandler.value);
}

export function closeFilesModal() {
  (_filesModalOpener as HTMLElement | null)?.focus();
  _filesModalOpener = null;
  ui.filesModal.classList.remove("open");
  ui.filesModalBg.classList.remove("open");
  ui.filesModal.setAttribute("aria-hidden", "true");
  ui.filesModal.style.minHeight = "";
  ui.filesList.style.height = "";
  if (filesModalResizeHandler.value) {
    window.removeEventListener("resize", filesModalResizeHandler.value);
    filesModalResizeHandler.value = null;
  }
}

function hideFilesModalError() {
  ui.filesModalError.style.display = "none";
  ui.filesModalErrorText.textContent = "";
}

function showFilesModalError(msg: string) {
  ui.filesModalErrorText.textContent = msg;
  ui.filesModalError.style.display = "flex";
}

function renderFilesModalList() {
  const files = currentFiles.value;
  const totalPages = Math.max(1, Math.ceil(files.length / FILES_PER_PAGE));
  if (filesModalPage.value >= totalPages) filesModalPage.value = totalPages - 1;

  ui.filesModalTitle.textContent = files.length > 0
    ? (files.length === 1 ? `Your file (1)` : `Your files (${files.length})`)
    : "Your files";

  const start = filesModalPage.value * FILES_PER_PAGE;
  const end = Math.min(start + FILES_PER_PAGE, files.length);
  ui.filesList.innerHTML = "";

  for (let i = start; i < end; i++) {
    const file = files[i];
    const row = document.createElement("div");
    row.className = "file-row";

    const nameSpan = document.createElement("span");
    nameSpan.className = "file-row-name truncate";
    nameSpan.textContent = shortenFileName(file.name, 36);
    nameSpan.title = file.name;

    const actions = document.createElement("div");
    actions.className = "file-row-actions";

    const replaceBtn = document.createElement("button");
    replaceBtn.className = "file-row-btn icon-btn";
    replaceBtn.innerHTML = "&#8635;";
    replaceBtn.title = "Replace this file";
    replaceBtn.addEventListener("click", () => replaceFileAtIndex(i));

    const removeBtn = document.createElement("button");
    removeBtn.className = "file-row-btn icon-btn";
    removeBtn.innerHTML = "&#10005;";
    removeBtn.title = "Remove this file";
    removeBtn.addEventListener("click", () => removeFileAtIndex(i));

    actions.appendChild(replaceBtn);
    actions.appendChild(removeBtn);
    row.appendChild(nameSpan);
    row.appendChild(actions);
    ui.filesList.appendChild(row);
  }

  // Pagination
  ui.filesPagination.innerHTML = "";
  if (totalPages > 1) {
    const prevBtn = document.createElement("button");
    prevBtn.className = "pagination-btn";
    prevBtn.textContent = "\u2039";
    prevBtn.disabled = filesModalPage.value === 0;
    prevBtn.addEventListener("click", () => {
      filesModalPage.value--;
      renderFilesModalList();
    });

    const info = document.createElement("span");
    info.className = "pagination-info";
    info.textContent = `Page ${filesModalPage.value + 1} of ${totalPages}`;

    const nextBtn = document.createElement("button");
    nextBtn.className = "pagination-btn";
    nextBtn.textContent = "\u203A";
    nextBtn.disabled = filesModalPage.value >= totalPages - 1;
    nextBtn.addEventListener("click", () => {
      filesModalPage.value++;
      renderFilesModalList();
    });

    ui.filesPagination.appendChild(prevBtn);
    ui.filesPagination.appendChild(info);
    ui.filesPagination.appendChild(nextBtn);
  }
}

function applyFilesUpdate(updateList: boolean = true) {
  if (updateList) renderFilesModalList();
  showFileInUploadZone(currentFiles.value);
  if (onFilesChanged.value) onFilesChanged.value(currentFiles.value);
}

function removeFileAtIndex(index: number) {
  currentFiles.value.splice(index, 1);
  if (currentFiles.value.length === 0) {
    closeFilesModal();
    if (onClearFiles.value) onClearFiles.value();
    return;
  }
  applyFilesUpdate();
}

function replaceFileAtIndex(index: number) {
  const tempInput = document.createElement("input");
  tempInput.type = "file";
  tempInput.addEventListener("change", () => {
    const newFile = tempInput.files?.[0];
    if (!newFile) return;

    if (currentFiles.value.length > 0 && newFile.type !== currentFiles.value[0].type) {
      const expected = friendlyMimeLabel(currentFiles.value[0].type);
      const got = friendlyMimeLabel(newFile.type);
      const isPlural = currentFiles.value.length > 1;
      const currentFilesText = isPlural ? `Your files are ${expected}s` : `Your file is a ${expected}`;
      showFilesModalError(`${currentFilesText} - “${newFile.name}” is a ${got}, which doesn’t match. All files must be the same type.`);
      return;
    }

    currentFiles.value[index] = newFile;
    applyFilesUpdate();
  });
  tempInput.click();
}

export function initFilesModal() {
  ui.filesModalClose.addEventListener("click", closeFilesModal);
  ui.filesModalBg.addEventListener("click", closeFilesModal);
  ui.filesModalErrorClose.addEventListener("click", hideFilesModalError);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && ui.filesModal.classList.contains("open")) {
      closeFilesModal();
    }
  });

  ui.filesRemoveAll.addEventListener("click", () => {
    currentFiles.value = [];
    closeFilesModal();
    if (onClearFiles.value) onClearFiles.value();
  });

  ui.filesReplaceAll.addEventListener("click", () => {
    closeFilesModal();
    ui.fileInput.click();
  });

  // Drop more files zone
  ui.filesDropMore.addEventListener("click", () => {
    const tempInput = document.createElement("input");
    tempInput.type = "file";
    tempInput.multiple = true;
    tempInput.addEventListener("change", () => {
      if (tempInput.files) addMoreFiles(Array.from(tempInput.files));
    });
    tempInput.click();
  });

  bindDragAndDropVisuals(ui.filesDropMore);
  ui.filesDropMore.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer?.files) {
      addMoreFiles(Array.from(e.dataTransfer.files));
    }
  });

  // Footer with Go back button
  if (!ui.filesModal.querySelector(".files-modal-footer")) {
    const footer = document.createElement("div");
    footer.className = "files-modal-footer";
    const backBtn = document.createElement("button");
    backBtn.className = "files-modal-back btn-secondary";
    backBtn.textContent = "Go back to convert";
    backBtn.addEventListener("click", closeFilesModal);
    footer.appendChild(backBtn);
    ui.filesModal.appendChild(footer);
  }
}


function addMoreFiles(newFiles: File[]) {
  if (newFiles.length === 0) return;
  hideFilesModalError();

  // File count hard cap
  const projectedCount = currentFiles.value.length + newFiles.length;
  if (projectedCount > MAX_FILES) {
    showFilesModalError(`Too many files (${projectedCount}). The limit is ${MAX_FILES}.`);
    return;
  }

  const expectedType = currentFiles.value.length > 0 ? currentFiles.value[0].type : newFiles[0].type;

  const matchingFiles = newFiles.filter(f => f.type === expectedType);
  const mismatchCount = newFiles.length - matchingFiles.length;
  if (mismatchCount > 0) {
    const expectedLabel = friendlyMimeLabel(expectedType);
    if (matchingFiles.length > 0) {
      showFilesModalError(`${mismatchCount} file${mismatchCount > 1 ? "s were" : " was"} skipped - ${mismatchCount > 1 ? `they weren’t ${expectedLabel}s` : `it wasn’t a ${expectedLabel}`}. Added ${matchingFiles.length} matching file${matchingFiles.length > 1 ? "s" : ""}.`);
    } else {
      const isPluralCurrent = currentFiles.value.length > 1;
      const currentFilesText = isPluralCurrent
        ? `Your current files are ${expectedLabel}s`
        : `Your current file is a ${expectedLabel}`;

      const addedText = newFiles.length > 1
        ? "None of those files matched"
        : "That file didn't match";

      showFilesModalError(`${addedText}. ${currentFilesText} - please add more files of the same type.`);
      return;
    }
  }

  const filesToAdd = mismatchCount > 0 ? matchingFiles : newFiles;
  const combinedFiles = currentFiles.value.concat(filesToAdd);

  // Size safeguard check
  const { level, totalSize } = checkFileSizeLimits(combinedFiles);
  if (level !== "ok") {
    closeFilesModal();
    showSizeWarningPopup(level, totalSize, combinedFiles.length, () => {
      currentFiles.value = combinedFiles;
      sortFilesByName(currentFiles.value);
      applyFilesUpdate(false);
      openFilesModal();
    });
    return;
  }

  currentFiles.value = combinedFiles;
  sortFilesByName(currentFiles.value);
  applyFilesUpdate();
}
