import "./UploadZone.css";
import {
  ui, currentFiles, MAX_FILES, checkFileSizeLimits, showSizeWarningPopup,
  DEFAULT_UPLOAD_LABEL, shortenFileName,
  onFilesChanged, onClearFiles, showFileTypeMismatchPopup, sortFilesByName
} from "../store/store.ts";
import { showPopup, hidePopup } from "../Popup/Popup.ts";
import { openFilesModal } from "../FilesModal/FilesModal.ts";

// --- Drop zone ---

export function initUploadZone(
  onFilesSelected: (files: File[]) => void,
  onClearFile: () => void,
) {
  onFilesChanged.value = onFilesSelected;
  onClearFiles.value = onClearFile;

  ui.uploadZone.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.closest(".upload-file-actions")) return;
    ui.fileInput.click();
  });

  ui.uploadZone.addEventListener("dragenter", (e) => {
    e.preventDefault();
    ui.uploadZone.classList.add("drag-over");
  });
  ui.uploadZone.addEventListener("dragleave", () => {
    ui.uploadZone.classList.remove("drag-over");
  });
  ui.uploadZone.addEventListener("dragover", (e) => {
    e.preventDefault();
  });
  ui.uploadZone.addEventListener("drop", () => {
    ui.uploadZone.classList.remove("drag-over");
  });

  ui.removeFileBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    currentFiles.value = [];
    onClearFile();
  });

  ui.replaceFileBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    ui.fileInput.click();
  });

  ui.expandFilesBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openFilesModal();
  });

  const fileSelectHandler = (event: Event) => {
    let inputFiles;

    if (event instanceof DragEvent) {
      inputFiles = event.dataTransfer?.files;
      if (inputFiles) event.preventDefault();
    } else if (event instanceof ClipboardEvent) {
      inputFiles = event.clipboardData?.files;
    } else {
      const eventTarget = event.target;
      if (!(eventTarget instanceof HTMLInputElement)) return;
      inputFiles = eventTarget.files;
    }

    if (!inputFiles) return;
    const files = Array.from(inputFiles);
    if (files.length === 0) return;

    // File count hard cap
    if (files.length > MAX_FILES) {
      showPopup(
        `<h2>Too many files</h2>` +
        `<p>You selected ${files.length} files, but the limit is ${MAX_FILES}. Please select fewer files.</p>` +
        `<div class="popup-actions">` +
        `<button class="popup-primary" onclick="window.hidePopup()">OK</button>` +
        `</div>`,
      );
      return;
    }

    const proceedWithFiles = (filesToUse: File[]) => {
      // Size safeguard check
      const { level } = checkFileSizeLimits(filesToUse);
      if (level !== "ok") {
        const totalSize = filesToUse.reduce((sum, f) => sum + f.size, 0);
        showSizeWarningPopup(level, totalSize, () => {
          sortFilesByName(filesToUse);
          currentFiles.value = filesToUse;
          onFilesSelected(filesToUse);
        });
        return;
      }
      sortFilesByName(filesToUse);
      currentFiles.value = filesToUse;
      onFilesSelected(filesToUse);
    };

    if (files.some(c => c.type !== files[0].type)) {
      showFileTypeMismatchPopup(files, (filtered) => {
        proceedWithFiles(filtered);
      });
      return;
    }
    proceedWithFiles(files);
  };

  ui.fileInput.addEventListener("change", fileSelectHandler);
  window.addEventListener("drop", fileSelectHandler);
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("paste", fileSelectHandler);
}


export function showFileInUploadZone(files: File[]) {
  currentFiles.value = files;
  const displayName = files.length > 1
    ? `${shortenFileName(files[0].name)} (+${files.length - 1} more)`
    : shortenFileName(files[0].name);

  ui.uploadText.style.display = "none";
  ui.uploadHint.style.display = "none";
  ui.uploadFileName.textContent = displayName;
  ui.uploadFileInfo.classList.add("visible");
  ui.uploadZone.classList.add("has-file");

  // Update label based on file count
  if (files.length > 1) {
    ui.uploadLabel.textContent = `${files.length} files selected`;
  } else {
    ui.uploadLabel.textContent = "Your file";
  }
}

export function showDetectedFormat(formatName: string, fileCount: number = 1) {
  if (fileCount > 1) {
    ui.uploadLabel.textContent = `${fileCount} files ready \u2014 converting from ${formatName.toUpperCase()}`;
  } else {
    ui.uploadLabel.textContent = `Ready to convert from ${formatName.toUpperCase()}`;
  }
}

export function resetUploadZone() {
  ui.fileInput.value = "";
  ui.uploadText.style.display = "";
  ui.uploadHint.style.display = "";
  ui.uploadFileInfo.classList.remove("visible");
  ui.uploadFileName.textContent = "";
  ui.uploadZone.classList.remove("has-file");
  ui.uploadLabel.textContent = DEFAULT_UPLOAD_LABEL;
  currentFiles.value = [];
}
