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

export async function completeCancellation() {
    if (cancelStartTime === null) return;
    const elapsed = performance.now() - cancelStartTime;
    const remaining = CANCEL_MIN_MS - elapsed;
    if (remaining > 0) {
        await new Promise<void>(resolve => setTimeout(resolve, remaining));
    }
    cancelStartTime = null;
    hidePopup();
}

export function showConversionInProgress(messageHTML: string) {
    // If cancellation is in progress, don't overwrite the popup
    if (cancelStartTime !== null) {
        return;
    }

    const existingSpinner = ui.popupBox.querySelector(".loader-spinner");
    if (existingSpinner) {
        const p = ui.popupBox.querySelector(".loader-spinner + p");
        if (p) p.innerHTML = messageHTML;
        const h2 = ui.popupBox.querySelector("h2");
        if (h2) h2.textContent = "Converting... 🐸";

        // Ensure visibility in case it was hidden or we are updating
        ui.popupBox.style.display = "block";
        ui.popupBackground.style.display = "block";
    } else {
        const html = `
      <h2>Converting... 🐸</h2>
      <div class="loader-spinner"></div>
      <p>${messageHTML}</p>
      <p class="muted-text">Large file conversions may take a while</p>`;
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
        <h2>Cancelling... 🐸</h2>
        <div class="loader-spinner"></div>
        <p class="muted-text">Stopping conversion. This may take a moment</p>`);
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
