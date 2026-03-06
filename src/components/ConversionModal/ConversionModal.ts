import "./ConversionModal.css";
import { ui, escapeHTML } from "../store/store.ts";
import { showPopup, hidePopup } from "../Popup/Popup.ts";

export let isCancelled = false;
let _isConfirming = false;
let _lastProgressMessage = "";

export function resetCancellation() {
    isCancelled = false;
    _isConfirming = false;
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

export function isCancellationConfirming(): boolean {
    return _isConfirming;
}

export function showConversionInProgress(messageHTML: string) {
    _lastProgressMessage = messageHTML;
    // If cancellation is in progress, don't overwrite the popup
    if (cancelStartTime !== null) {
        return;
    }

    const existingSpinner = ui.popupBox.querySelector(".loader-spinner");
    if (existingSpinner) {
        const p = ui.popupBox.querySelector("p");
        if (p) p.innerHTML = messageHTML;
        const h2 = ui.popupBox.querySelector("h2");
        if (h2) h2.textContent = "Converting... 🐸";

        // Ensure visibility in case it was hidden or we are updating
        ui.popupBox.style.display = "block";
        ui.popupBackground.style.display = "block";
    } else {
        const html = `
      <div class="loader-spinner"></div>
      <h2>Converting... 🐸</h2>
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
        <div class="loader-spinner"></div>
        <h2>Cancelling... 🐸</h2>
        <p class="muted-text">Stopping conversion...</p>`);
}

export function showCancelConfirmation(): Promise<void> {
    _isConfirming = true;
    ui.popupBox.innerHTML = `<h2>Cancel conversion?</h2>`;

    const actions = document.createElement("div");
    actions.className = "popup-actions";

    return new Promise<void>((resolve) => {
        const noBtn = document.createElement("button");
        noBtn.id = "confirm-no-btn";
        noBtn.className = "popup-secondary";
        noBtn.textContent = "No, continue";
        noBtn.addEventListener("click", () => {
            _isConfirming = false;
            showConversionInProgress(_lastProgressMessage);
            resolve();
        });

        const yesBtn = document.createElement("button");
        yesBtn.id = "confirm-yes-btn";
        yesBtn.className = "popup-danger";
        yesBtn.textContent = "Yes, cancel";
        yesBtn.addEventListener("click", () => {
            _isConfirming = false;
            triggerCancellation();
            resolve();
        });

        actions.appendChild(noBtn);
        actions.appendChild(yesBtn);
        ui.popupBox.appendChild(actions);
    });
}

export function ensureCancelButton() {
    let actions = ui.popupBox.querySelector(".popup-actions");
    if (!actions) {
        actions = document.createElement("div");
        actions.className = "popup-actions";
        ui.popupBox.appendChild(actions);
    }

    if (!actions.querySelector("#cancel-conversion-btn")) {
        const btn = document.createElement("button");
        btn.className = "popup-secondary";
        btn.id = "cancel-conversion-btn";
        btn.textContent = "Cancel";
        btn.addEventListener("click", () => triggerCancellation());
        actions.appendChild(btn);
    }
}
