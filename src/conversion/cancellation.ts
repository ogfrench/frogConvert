import "./conversion.css";
import { ui } from "../components/store/store.ts";
import { showPopup, hidePopup, createPopupButton, replacePopup } from "../components/Popup/Popup.ts";
import { ModalManager } from "../components/utils/ModalManager.ts";
import { ensureMinDuration } from "../components/utils/index.ts";

export let isCancelled = false;
let softCancelRequested = false;
let _activeBatchSize = 0;

export function resetCancellation() {
    isCancelled = false;
    softCancelRequested = false;
    _activeBatchSize = 0;
    cancelStartTime = null;
    // Clear DOM artifacts from a previous soft-cancel so they don't leak
    // into the next conversion if the popup is reused without a full rebuild.
    ui.popupBox.querySelector(".conversion-wrap-up")?.remove();
    const cancelBtn = ui.popupBox.querySelector<HTMLButtonElement>("#cancel-conversion-btn");
    if (cancelBtn) cancelBtn.textContent = "Cancel conversion";
}

/** Tell the cancel system how many files are in the current batch. */
export function setActiveBatchSize(n: number) {
    _activeBatchSize = n;
}

export function setCancelled(val: boolean) {
    isCancelled = val;
}

/**
 * True once the user has clicked Cancel once. The batch loop stops starting
 * new files but lets the current one finish. A second click (or Escape)
 * escalates to a hard cancel that terminates the worker.
 */
export function isSoftCancelRequested() {
    return softCancelRequested;
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

// Safari's blur+contrast filter doesn't sharpen gooey edges cleanly - fall back to the plain spinner.
const CONVERSION_SPINNER_CLASS = navigator.vendor === 'Apple Computer, Inc.' ? "loader-spinner" : "loader-gooey";

export function showConversionInProgress(messageHTML: string, title: string = "Converting...") {
    // If cancellation is in progress, don't overwrite the popup
    if (cancelStartTime !== null) {
        return;
    }

    const existingSpinner = ui.popupBox.classList.contains("open")
        ? ui.popupBox.querySelector(".loader-gooey, .loader-spinner")
        : null;
    if (existingSpinner) {
        // Ensure we are using the right loader for conversions
        if (!existingSpinner.classList.contains(CONVERSION_SPINNER_CLASS)) {
            existingSpinner.classList.remove("loader-gooey", "loader-spinner");
            existingSpinner.classList.add(CONVERSION_SPINNER_CLASS);
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
            // Re-append the soft-cancel subtitle if the user has already clicked
            // Cancel once — otherwise it would be wiped on every status update.
            if (softCancelRequested) _appendWrapUpSubtitle();
        }

        // Ensure visibility is handled by ModalManager/classes
    } else {
        const h2 = document.createElement("h2");
        h2.textContent = title;

        const spinner = document.createElement("div");
        spinner.className = CONVERSION_SPINNER_CLASS;

        const p = document.createElement("p");
        p.innerHTML = messageHTML;

        showPopup([h2, spinner, p], true);
    }
}

/**
 * Cancel button handler. Behavior depends on batch size:
 *
 * **Single-file runs (`_activeBatchSize <= 1`):** one click = immediate hard
 * cancel. There's no "next file" to protect, so soft cancel is meaningless —
 * skipping the two-stage avoids a confusing no-op.
 *
 * **Batch runs (`_activeBatchSize > 1`):** two-stage:
 *   1st call → soft cancel. Current file finishes; batch loop breaks.
 *   2nd call → hard cancel. Worker terminated, in-progress file discarded.
 *
 * Escape also routes here, same rules apply.
 */
export function triggerCancellation() {
    if (isCancelled) return;  // guard against double-calls overwriting cancelStartTime

    const isBatch = _activeBatchSize > 1;

    if (isBatch && !softCancelRequested) {
        // First click on a batch: soft cancel. Leave the worker running.
        softCancelRequested = true;
        _updateCancelButtonForSoftCancel();
        _appendWrapUpSubtitle();
        return;
    }

    // Hard cancel: single-file (any click) OR batch second click.
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

/** Swaps the cancel button label to "Stop now" in-place, without rebuilding the footer. */
function _updateCancelButtonForSoftCancel() {
    const btn = ui.popupBox.querySelector<HTMLButtonElement>("#cancel-conversion-btn");
    if (btn) btn.textContent = "Stop now";
}

/** Adds a muted "Wrapping up the current file..." subtitle under the existing status line. */
function _appendWrapUpSubtitle() {
    const existingSpinner = ui.popupBox.classList.contains("open")
        ? ui.popupBox.querySelector(".loader-gooey, .loader-spinner")
        : null;
    if (!existingSpinner) return;
    const p = existingSpinner.nextElementSibling as HTMLElement | null;
    if (!p || p.tagName !== "P") return;
    // Only append once even if triggerCancellation is called twice in quick succession.
    if (p.querySelector(".conversion-wrap-up")) return;
    const sub = document.createElement("span");
    sub.className = "conversion-wrap-up muted-text";
    sub.innerHTML = `<br>Wrapping up the current file. You'll be able to download what's been converted so far`;
    p.appendChild(sub);
}

export function removeCancelButton() {
    const actions = ui.popupBox.querySelector(".popup-actions-footer");
    if (actions) {
        actions.querySelector("#cancel-conversion-btn")?.remove();
        if (!actions.children.length) actions.remove();
    }
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

// --- Engines loading popup ---

let _enginesLoadingPollId: ReturnType<typeof setInterval> | null = null;

export function showEnginesLoadingPopup() {
    if (_enginesLoadingPollId !== null) {
        clearInterval(_enginesLoadingPollId);
        _enginesLoadingPollId = null;
    }

    const popupStartTime = performance.now();

    showPopup(
        `<h2>Wow, you're fast! ⚡</h2>` +
        `<div class="loader-spinner"></div>` +
        `<p>Engines are starting up. This only happens on first load, so it'll be instant next time!</p>` +
        `<div class="popup-actions">` +
        `<button class="btn-secondary" id="engines-dismiss-btn">Dismiss</button>` +
        `</div>`,
    );
    ui.popupBox.dataset.enginesLoading = "1";
    requestAnimationFrame(() => {
        document.getElementById("engines-dismiss-btn")?.addEventListener("click", () => {
            delete ui.popupBox.dataset.enginesLoading;
            hidePopup();
        });
    });
    _enginesLoadingPollId = setInterval(async () => {
        if (window.traversionGraph.nodeCount > 0) {
            clearInterval(_enginesLoadingPollId!);
            _enginesLoadingPollId = null;
            await ensureMinDuration(popupStartTime, 1000);
            _updatePopupToEnginesReady();
        }
    }, 200);
}

function _updatePopupToEnginesReady() {
    // Guard 1: popup was dismissed before engines loaded - don't update a hidden popup
    if (!ui.popupBox.classList.contains("open")) return;
    // Guard 2: another popup replaced our content - check for the unique marker set when this popup opened
    if (!ui.popupBox.dataset.enginesLoading) return;
    delete ui.popupBox.dataset.enginesLoading;
    const spinner = ui.popupBox.querySelector<HTMLElement>(".loader-spinner");
    if (!spinner) return;

    const h2 = ui.popupBox.querySelector("h2");
    const p = ui.popupBox.querySelector("p");
    const actions = ui.popupBox.querySelector(".popup-actions");

    const icon = document.createElement("div");
    icon.className = "engines-ready-icon";
    spinner.replaceWith(icon);

    if (h2) h2.textContent = "Engines ready!";
    if (p) p.textContent = "All conversion engines loaded. Ready to convert!";
    if (actions) {
        actions.innerHTML = "";
        const btn = document.createElement("button");
        btn.className = "btn-primary";
        btn.textContent = "Convert now";
        btn.addEventListener("click", () => {
            hidePopup();
            ui.convertButton.click();
        });
        actions.appendChild(btn);
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
