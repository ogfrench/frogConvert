import "./ConversionModal.css";
import { ui } from "../store/store.ts";
import { showPopup, hidePopup } from "../Popup/Popup.ts";

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
    const elapsed = performance.now() - cancelStartTime;
    const remaining = CANCEL_MIN_MS - elapsed;
    if (remaining > 0) {
        await new Promise<void>(resolve => setTimeout(resolve, remaining));
    }
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

    const existingSpinner = ui.popupBox.querySelector(".loader-gooey, .loader-spinner");
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

        // Ensure visibility in case it was hidden or we are updating
        ui.popupBox.style.display = "block";
        ui.popupBackground.style.display = "block";
    } else {
        const html = `
      <h2>${title}</h2>
      <div class="loader-gooey"></div>
      <p>${messageHTML}</p>`;
        showPopup(html);
    }
    ensureCancelButton();
}

export function triggerCancellation() {
    isCancelled = true;
    workerCancelCallback?.();
    workerCancelCallback = null;
    cancelStartTime = performance.now();
    showPopup(`
        <h2>Cancelling conversion</h2>
        <div class="loader-spinner"></div>
        <p>Stopping conversion...<br><span class="conversion-path">This may take a moment</span></p>`);
}

export function ensureCancelButton() {
    let actions = ui.popupBox.querySelector(".popup-actions-footer");
    if (!actions) {
        actions = document.createElement("div");
        actions.className = "popup-actions-footer";
        ui.popupBox.appendChild(actions);
    }

    if (!actions.querySelector("#cancel-conversion-btn")) {
        const btn = document.createElement("button");
        btn.className = "btn-secondary";
        btn.id = "cancel-conversion-btn";
        btn.textContent = "Cancel conversion";
        btn.addEventListener("click", () => triggerCancellation());
        actions.appendChild(btn);
    }
}

export function showPartialDownloadPopup(count: number, onDownload: () => void) {
    const html = `
        <h2>Conversion cancelled</h2>
        <p>${count} file${count > 1 ? "s" : ""} ${count > 1 ? "were" : "was"} successfully converted before stopping.</p>
        <div class="popup-actions-footer">
            <button id="partial-download-btn" class="popup-primary">Download ${count} file${count > 1 ? "s" : ""}</button>
            <button id="partial-done-btn" class="btn-secondary">Done</button>
        </div>`;
    showPopup(html);

    const downloadBtn = ui.popupBox.querySelector("#partial-download-btn");
    downloadBtn?.addEventListener("click", () => {
        onDownload();
        hidePopup();
    });

    const doneBtn = ui.popupBox.querySelector("#partial-done-btn");
    doneBtn?.addEventListener("click", () => {
        hidePopup();
    });
}
