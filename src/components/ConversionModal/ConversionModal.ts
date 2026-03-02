import "./ConversionModal.css";
import { ui, escapeHTML } from "../store/store.ts";
import { showPopup, hidePopup } from "../Popup/Popup.ts";

export let isCancelled = false;

export function resetCancellation() {
    isCancelled = false;
}

export function setCancelled(val: boolean) {
    isCancelled = val;
}

export function isCancellationConfirming(): boolean {
    return !!document.getElementById("confirm-yes-btn") && ui.popupBox.style.display !== "none";
}

export function showConversionInProgress(messageHTML: string) {
    // If confirmation is showing AND visible, don't overwrite with progress updates
    if (isCancellationConfirming()) {
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

export function showCancelConfirmation() {
    const conversionProgressHTML = ui.popupBox.innerHTML;

    showPopup(
        `<h2>Cancel conversion?</h2>` +
        `<p>Are you sure you want to stop the conversion? Any progress will be lost.</p>` +
        `<div class="popup-actions">` +
        `<button class="popup-secondary" id="confirm-no-btn">No, continue</button>` +
        `<button class="popup-primary" id="confirm-yes-btn">Yes, cancel</button>` +
        `</div>`
    );

    return new Promise<void>((resolve) => {
        const noBtn = document.getElementById("confirm-no-btn");
        const yesBtn = document.getElementById("confirm-yes-btn");

        noBtn?.addEventListener("click", () => {
            ui.popupBox.innerHTML = conversionProgressHTML;
            // Re-bind cancel button if it exists in conversionProgressHTML
            const cancelBtn = document.getElementById("cancel-conversion-btn");
            cancelBtn?.addEventListener("click", () => {
                showCancelConfirmation();
            });
            resolve();
        });

        yesBtn?.addEventListener("click", () => {
            isCancelled = true;
            hidePopup();
            resolve();
        });
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
        btn.addEventListener("click", () => showCancelConfirmation());
        actions.appendChild(btn);
    }
}
