import "./ConversionModal.css";
import { ui } from "../store/store.ts";
import { showPopup, hidePopup, createPopupButton, replacePopup } from "../Popup/Popup.ts";
import { ModalManager } from "../utils/ModalManager.ts";
import { ensureMinDuration } from "../utils.ts";

export let isCancelled = false;

export function resetCancellation() {
    isCancelled = false;
    cancelStartTime = null;
}

export function setCancelled(val: boolean) {
    isCancelled = val;
}

let workerCancelCallback: (() => void) | null = null;

export function setWorkerCancelCallback(cb: (() => void) | null) {
    workerCancelCallback = cb;
}

let cancelStartTime: number | null = null;
const CANCEL_MIN_MS = 1000;

export async function completeCancellation(shouldHide = true) {
    if (cancelStartTime === null) return;
    await ensureMinDuration(cancelStartTime, CANCEL_MIN_MS);
    cancelStartTime = null;
    if (shouldHide) {
        hidePopup();
    }
}

export function showConversionInProgress(messageHTML: string, title: string = "Converting...") {
    // If cancellation is in progress, don't overwrite the popup
    if (cancelStartTime !== null) {
        return;
    }

    const existingSpinner = ui.popupBox.classList.contains("open")
        ? ui.popupBox.querySelector(".loader-gooey, .loader-spinner")
        : null;
    if (existingSpinner) {
        // Ensure we are using the gooey loader for conversions
        if (existingSpinner.classList.contains("loader-spinner")) {
            existingSpinner.classList.remove("loader-spinner");
            existingSpinner.classList.add("loader-gooey");
        }

        const h2 = ui.popupBox.querySelector("h2");
        if (h2) h2.textContent = title;

        const p = existingSpinner.nextElementSibling as HTMLElement;
        if (p && p.tagName === "P") {
            p.innerHTML = messageHTML;
            // If the status paragraph was muted (from cancellation popup), make it normal
            if (p.classList.contains("muted-text")) {
                p.classList.remove("muted-text");
            }
        }

        // Ensure visibility is handled by ModalManager/classes
    } else {
        const h2 = document.createElement("h2");
        h2.textContent = title;

        const spinner = document.createElement("div");
        spinner.className = "loader-gooey";

        const p = document.createElement("p");
        p.innerHTML = messageHTML;

        showPopup([h2, spinner, p], true);
    }
}

export function triggerCancellation() {
    isCancelled = true;
    workerCancelCallback?.();
    workerCancelCallback = null;
    cancelStartTime = performance.now();

    const h2 = document.createElement("h2");
    h2.textContent = "Cancelling conversion";

    const spinner = document.createElement("div");
    spinner.className = "loader-spinner";

    const p = document.createElement("p");
    p.innerHTML = `Stopping conversion...<br><span class="conversion-path">This may take a moment</span>`;

    replacePopup([h2, spinner, p], true);
}

export function removeCancelButton() {
    ui.popupBox.querySelector(".popup-actions-footer")?.remove();
    ModalManager.updateTop({ onEscape: undefined });
}

export function ensureCancelButton() {
    let actions = ui.popupBox.querySelector(".popup-actions-footer");
    if (!actions) {
        actions = document.createElement("div");
        actions.className = "popup-actions-footer";
        ui.popupBox.appendChild(actions);
    }

    if (!actions.querySelector("#cancel-conversion-btn")) {
        const btn = createPopupButton("Cancel conversion", "btn-secondary", () => triggerCancellation());
        btn.id = "cancel-conversion-btn";
        actions.appendChild(btn);
        ModalManager.updateTop({ onEscape: triggerCancellation });
    }
}

export function showPartialDownloadPopup(count: number, onDownload: () => void) {
    const h2 = document.createElement("h2");
    h2.textContent = "Conversion cancelled";

    const p = document.createElement("p");
    p.textContent = `${count} file${count > 1 ? "s" : ""} ${count > 1 ? "were" : "was"} successfully converted before stopping.`;

    const actions = document.createElement("div");
    actions.className = "popup-actions-footer";

    const downloadBtn = createPopupButton(`Download ${count} file${count > 1 ? "s" : ""}`, "btn-primary", () => {
        onDownload();
        hidePopup();
    });
    downloadBtn.id = "partial-download-btn";

    const doneBtn = createPopupButton("Done", "btn-secondary", () => hidePopup());
    doneBtn.id = "partial-done-btn";

    actions.appendChild(downloadBtn);
    actions.appendChild(doneBtn);

    replacePopup([h2, p, actions]);
}
