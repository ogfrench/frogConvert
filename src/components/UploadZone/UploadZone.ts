import "./UploadZone.css";
import {
  ui, currentFiles, getMaxFiles, checkFileSizeLimits,
  onFilesChanged, onClearFiles, sortFilesByName, bindDragAndDropVisuals,
  allOptionsRef, isLoadingHandlers, isLoadingPhase2, isFileSupported,
} from "../store/store.ts";
import { DEFAULT_UPLOAD_LABEL } from "../../constants/ui.ts";
import { showSizeWarningPopup, showFileTypeMismatchPopup, showUploadSummaryPopup, LEGACY_OFFICE_HINT, type UploadResult } from "../Popup/Popup.ts";
import { showToast } from "../Toast/Toast.ts";
import { shortenFileName } from "../utils/index.ts";
import { openFilesModal } from "../FilesModal/FilesModal.ts";
import { markConvertDirty, clearConvertSession } from "../persistence/convertPersist.ts";

// --- Drop zone ---

const preventDragover = (e: Event) => e.preventDefault();

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

  // The upload zone has role="button" tabindex="0" but is a <div>, so it
  // doesn't get Enter/Space activation for free. Forward keyboard activation
  // to the same path as a click.
  ui.uploadZone.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const target = e.target as HTMLElement;
    if (target.closest(".upload-file-actions")) return;
    e.preventDefault();
    ui.fileInput.click();
  });

  bindDragAndDropVisuals(ui.uploadZone, "drag-over", () => allOptionsRef.value);

  ui.removeFileBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    currentFiles.value = [];
    clearConvertSession();
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
    // Skip window-level drop/paste when the converter UI is hidden (e.g. PDF mode)
    if ((event instanceof DragEvent || event instanceof ClipboardEvent) &&
        ui.uploadZone.offsetParent === null) return;

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

    // Reject unsupported files before they enter the pipeline.
    // Only filter when handlers are fully loaded; during cold start fall through to the
    // existing loading-phase handling in the onFilesSelected callback.
    if (!isLoadingHandlers.value && !isLoadingPhase2.value && allOptionsRef.value.length > 0) {
      const unsupported = files.filter(f => !isFileSupported(f, allOptionsRef.value));
      if (unsupported.length === files.length) {
        if (files.length === 1) {
          const ext = files[0].name.split(".").pop()?.toUpperCase() ?? "?";
          const hint = LEGACY_OFFICE_HINT[ext.toLowerCase()];
          const msg = hint
            ? `.${ext} isn't supported. Open it in ${hint.app} and save as .${hint.modern} to convert it here.`
            : `.${ext} isn't supported yet.`;
          showToast(msg, "warn", 8000);
        } else {
          const results: UploadResult[] = files.map(f => ({ name: f.name, status: "skipped", reason: "unsupported" }));
          showUploadSummaryPopup(results);
        }
        return;
      }
    }

    // Dynamic file count cap based on device memory + file weight
    const maxFiles = getMaxFiles(files);
    if (files.length > maxFiles) {
      const results: UploadResult[] = files.map(f =>
        ({ name: f.name, status: "skipped", reason: "file-limit" }));
      showUploadSummaryPopup(results, { files: maxFiles });
      return;
    }

    const proceedWithFiles = (filesToUse: File[]) => {
      const applySelection = () => {
        sortFilesByName(filesToUse);
        currentFiles.value = filesToUse;
        markConvertDirty('files');
        onFilesSelected(filesToUse);
      };

      // Size safeguard check
      const { level, totalSize } = checkFileSizeLimits(filesToUse);
      if (level !== "ok") {
        showSizeWarningPopup(totalSize, filesToUse.length, applySelection);
        return;
      }
      applySelection();
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
  window.addEventListener("dragover", preventDragover);
  window.addEventListener("paste", fileSelectHandler);
}


export function showFileInUploadZone(files: File[]) {
  currentFiles.value = files;
  markConvertDirty('files');
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
    ui.uploadLabel.textContent = "";
  }
}

export function showDetectedFormat(formatName: string, fileCount: number = 1) {
  if (fileCount > 1) {
    ui.uploadLabel.textContent = `${fileCount} files ready, converting from ${formatName.toUpperCase()}`;
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
  clearConvertSession();
}
