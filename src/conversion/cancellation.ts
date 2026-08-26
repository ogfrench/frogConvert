import "./conversion.css";
import { ui } from "../components/store/store.ts";
import { showPopup, hidePopup, createPopupButton, replacePopup } from "../components/Popup/Popup.ts";
import { ModalManager } from "../components/utils/ModalManager.ts";
import { ensureMinDuration } from "../components/utils/index.ts";

export let isCancelled = false;
let canHardCancel = true;
let _currentFileIndex = 0;
let _currentFileTotal = 0;

export type ConversionMode = "convert" | "compress";
let _activeMode: ConversionMode = "convert";
export function setActiveConversionMode(mode: ConversionMode) {
    _activeMode = mode;
}
export function getActiveConversionMode(): ConversionMode {
    return _activeMode;
}
/**
 * One verb for stopping, everywhere.
 *
 * The app used to run two vocabularies side by side: the button said "Cancel
 * compression", the interstitial said "Cancelling compression", the finished
 * state said "Compression cancelled" - and then the results list labelled those
 * same files *stopped*, and the partial-download popup said they were converted
 * "before stopping". One popup managed to say "cancelled" in its title and
 * "stopping" in its body.
 *
 * Settled on **stop**. It is the plainer word, it is what the results rows and
 * the documentation already used, and on a button that abandons work in flight
 * it is the more accurate one: "Cancel" in a dialog usually means *dismiss this
 * dialog*, which is the opposite of what this control does.
 */
export function modeCopy() {
    return _activeMode === "compress"
        ? {
            verb: "compressed",
            verbIng: "compressing",
            action: "compression",
            failedTitle: "Compression failed",
            routeLabel: "compression route",
            toolLabel: "compressor",
            readyLabel: "Ready to compress!",
            cancellingTitle: "Stopping compression",
            cancelledTitle: "Compression stopped",
            cancelButton: "Stop compression",
            titleIng: "Compressing...",
            actionButton: "Compress now",
            successTitleSingle: "File compressed! 🎉",
            successTitleBatch: "Files compressed! 🎉",
        }
        : {
            verb: "converted",
            verbIng: "converting",
            action: "conversion",
            failedTitle: "Conversion failed",
            routeLabel: "conversion route",
            toolLabel: "converter",
            readyLabel: "Ready to convert!",
            cancellingTitle: "Stopping conversion",
            cancelledTitle: "Conversion stopped",
            cancelButton: "Stop conversion",
            titleIng: "Converting...",
            actionButton: "Convert now",
            successTitleSingle: "File converted! 🎉",
            successTitleBatch: "Files converted! 🎉",
        };
}

export function resetCancellation() {
    isCancelled = false;
    canHardCancel = true;
    _currentFileIndex = 0;
    _currentFileTotal = 0;
    _activeMode = "convert";
    cancelStartTime = null;
    if (hardCancelTimeoutId !== null) {
        clearTimeout(hardCancelTimeoutId);
        hardCancelTimeoutId = null;
    }
    forceCleanupCallback = null;
}

/**
 * Tell the cancel system whether the current conversion path can be
 * interrupted mid-file. True = every hop is worker-based (cancel terminates
 * the worker instantly). False = path has at least one `requiresMainThread`
 * handler, which can't be interrupted inside `doConvert`, so the loop has
 * to wait for the current file to finish. Call this after every findConversionPath.
 */
export function setCanHardCancel(v: boolean) {
    canHardCancel = v;
}

/**
 * Tell the cancel system which file (1-based) is currently being converted
 * and the total count, so the cancel copy can read "Finishing file 2 of 3".
 */
export function setCurrentFileProgress(current: number, total: number) {
    _currentFileIndex = current;
    _currentFileTotal = total;
}

export function setCancelled(val: boolean) {
    isCancelled = val;
}

let workerCancelCallback: (() => void) | null = null;

export function setWorkerCancelCallback(cb: (() => void) | null) {
    workerCancelCallback = cb;
}

let cancelStartTime: number | null = null;
const CANCEL_MIN_MS = 1200;

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

export type ProgressPhase = "idle" | "converting";

let lastShownTitle: string | null = null;
let lastShownMessage: string | null = null;

export function showConversionInProgress(
    messageHTML: string,
    title: string = modeCopy().titleIng,
    phase: ProgressPhase = "converting",
) {
    // If cancellation is in progress, don't overwrite the popup
    if (cancelStartTime !== null) {
        return;
    }

    // Idle phases (pathfinding, WASM download, file reading) get the plain
    // rotating ring so users can tell we're not encoding yet.
    const targetClass = phase === "idle" ? "loader-spinner" : CONVERSION_SPINNER_CLASS;

    const existingSpinner = ui.popupBox.classList.contains("open")
        ? ui.popupBox.querySelector(".loader-gooey, .loader-spinner")
        : null;
    if (existingSpinner) {
        if (!existingSpinner.classList.contains(targetClass)) {
            existingSpinner.classList.remove("loader-gooey", "loader-spinner");
            existingSpinner.classList.add(targetClass);
        }

        // Hot path: pathfinding fires every "searching" tick with constant
        // content. Skip DOM writes when nothing changed so we don't reparse
        // the message subtree on every event.
        if (title !== lastShownTitle) {
            const h2 = ui.popupBox.querySelector("h2");
            if (h2) h2.textContent = title;
            lastShownTitle = title;
        }

        const p = existingSpinner.nextElementSibling as HTMLElement;
        if (p && p.tagName === "P") {
            // For the case where the paragraph being reused came from some
            // other popup that happened to have a spinner - the engines-loading
            // notice, most often - so the height floor travels with the class
            // rather than with the position. Guarded rather than unconditional:
            // this is the same hot path the message diff below protects, and it
            // runs on every pathfinding tick.
            if (!p.classList.contains("conversion-status")) {
                p.classList.add("conversion-status");
            }
            if (messageHTML !== lastShownMessage) {
                p.innerHTML = messageHTML;
                lastShownMessage = messageHTML;
            }
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
        spinner.className = targetClass;

        const p = document.createElement("p");
        p.className = "conversion-status";
        p.innerHTML = messageHTML;

        showPopup([h2, spinner, p], true);
        lastShownTitle = title;
        lastShownMessage = messageHTML;
    }
}

// Hard-timeout for cancellation. If the worker doesn't yield (stuck inside a
// synchronous WASM call), workerCancelCallback may never run, and the UI
// stays on "Cancelling..." forever. After this window we give up waiting and
// force the finally path to run, even if the worker ack never arrives.
const HARD_CANCEL_TIMEOUT_MS = 2000;
let hardCancelTimeoutId: ReturnType<typeof setTimeout> | null = null;
let forceCleanupCallback: (() => void) | null = null;

/** Registered by the conversion flow so the hard-cancel timer can force an
 *  abort even when the worker never acks. */
export function setForceCleanupCallback(cb: (() => void) | null) {
    forceCleanupCallback = cb;
}

function armHardCancelTimer() {
    if (hardCancelTimeoutId !== null) clearTimeout(hardCancelTimeoutId);
    hardCancelTimeoutId = setTimeout(() => {
        hardCancelTimeoutId = null;
        if (forceCleanupCallback) {
            console.warn("[cancellation] worker did not ack cancel within timeout, forcing cleanup");
            const fn = forceCleanupCallback;
            forceCleanupCallback = null;
            try { fn(); } catch (e) { console.error("[cancellation] forceCleanup threw:", e); }
        }
    }, HARD_CANCEL_TIMEOUT_MS);
}

/**
 * Single cancel handler. Behavior is path-aware, not click-count-aware:
 *
 * - **`canHardCancel = true`** (every hop runs in a worker): terminate the
 *   worker, show the brief "Stopping conversion / Stopping now..." popup.
 *   The in-flight file is discarded; already-converted files are kept and
 *   offered via the partial-download popup in the conversion's finally block.
 *
 * - **`canHardCancel = false`** (at least one hop is `requiresMainThread`,
 *   e.g. pdftoimg): the current file can't be interrupted inside `doConvert`.
 *   Update the status copy in place to say so honestly ("Finishing file N of M,
 *   then stopping"), remove the cancel button, and let the loop exit naturally
 *   on the next iteration when it sees `isCancelled`.
 *
 * Escape key routes here via ensureCancelButton().
 */
export function triggerCancellation() {
    if (isCancelled) return;  // guard against double-calls overwriting cancelStartTime
    isCancelled = true;

    if (canHardCancel) {
        cancelStartTime = performance.now();
        workerCancelCallback?.();
        workerCancelCallback = null;
        armHardCancelTimer();

        const h2 = document.createElement("h2");
        h2.textContent = modeCopy().cancellingTitle;

        const spinner = document.createElement("div");
        spinner.className = "loader-spinner";

        const p = document.createElement("p");
        p.className = "conversion-status";
        p.textContent = "Stopping now...";

        replacePopup([h2, spinner, p], true);
    } else {
        // Update status copy in place BEFORE setting cancelStartTime. The
        // guard at the top of showConversionInProgress bails once cancelStartTime
        // is non-null, so we need to get the final update in first.
        // "this file", not "the current file". Both lines below have a row
        // budget: measured in Chromium against the real app at a 320px
        // viewport, the notice's paragraph is 250px wide and the four-row
        // floor gives it 89.6px, which buys one row of main copy, one for the
        // engine's detail and two for the note. "Finishing the current file,
        // then stopping." is 42 characters and wraps to two, which took the
        // whole block to 128.73px and grew the modal to 432.73px against the
        // 393.59px every other phase sits at. At 35 characters this is one row,
        // as is the "file 2 of 3" form at 37.
        const fileRef = _currentFileTotal > 1
            ? `file ${_currentFileIndex} of ${_currentFileTotal}`
            : "this file";
        showConversionInProgress(
            `Finishing ${fileRef}, then stopping.<br>`
            // The engine's live detail lands here. The row is in the markup
            // from the start, empty, so the detail arrives into a box that
            // already existed - see updateCancelProgress for what it cost when
            // it did not. aria-hidden for the same reason statusHTML's live row
            // is: #popup is role="status" aria-live="polite" aria-atomic="true",
            // so a line that changes per page would re-announce the whole
            // notice every time it ticked.
            + `<span class="cancel-live-progress muted-text" aria-hidden="true"></span>`
            // 76 characters, which is two rows at 250px. The 89-character
            // version this replaces was three, and three rows of note plus one
            // of detail does not fit under the floor whatever the main line
            // says. Same two facts, one sentence each.
            + `<span class="conversion-path">this step can't be interrupted mid-file. Refresh the page to stop right now.</span>`,
            modeCopy().cancellingTitle,
        );
        // Disabled rather than removed: clicking it again only hits the
        // isCancelled guard and is a no-op, but taking the footer off the modal
        // takes ~110px of box with it, and shrinking the modal in the same
        // frame the user pressed Stop reads as the dialog collapsing under
        // them. A disabled control is just as dead and weighs the same.
        setCancelEnabled(false);
        cancelStartTime = performance.now();
        // No watchdog here: soft cancel promises to finish the current file.
        // The hard-cancel watchdog exists to rescue a stuck worker that never
        // acks terminate(). Main-thread handlers can't be terminated, so firing
        // it would break the "finish the current file" promise; users who
        // really need out are told to refresh.
    }
}

/**
 * Keep the UI alive during a soft cancel: the cancel title + "Finishing file
 * N of M" line stay locked, but the handler can push its live progress (page
 * counter, encode timestamp) into a sub-line so the user sees the work is
 * actually still happening.
 *
 * Called via `slowHandle.update({ detail })`, the same channel that feeds the
 * normal slow-conversion notice. No-op when cancel isn't active.
 *
 * Fills a row that is already there; it does not build one. It used to insert a
 * `<br>` and the span the first time a detail arrived, into a paragraph whose
 * main line already ended in a `<br>` - so the pair rendered as two consecutive
 * breaks and the detail cost an empty row as well as its own. Measured in
 * Chromium against the real stylesheets, that grew the modal 394.59px ->
 * 414.55px at 1280, 375 and 320px alike, at the moment the engine first
 * reported anything: the box moved under the user one beat after they pressed
 * Stop. One row, reserved in the markup, fits under the four-row floor
 * `.conversion-status` already imposes (87.18px of 89.6px), so the notice is now
 * the same height as every phase around it, before and after the detail lands.
 *
 * No-op when the row is absent, which is the hard-cancel popup. That path
 * replaces the modal with a bare "Stopping now..." line and terminates the
 * worker; a late detail from an in-flight handler used to build itself a row
 * there too and grow that modal instead. There is nothing left to report the
 * progress of, so there is nothing to say.
 */
export function updateCancelProgress(detail: string) {
    if (cancelStartTime === null) return;
    if (!ui.popupBox.classList.contains("open")) return;
    if (!detail) return;
    const liveSpan = ui.popupBox.querySelector<HTMLElement>(".cancel-live-progress");
    if (!liveSpan) return;
    liveSpan.textContent = detail;
}

export function removeCancelButton() {
    const actions = ui.popupBox.querySelector(".popup-actions-footer");
    if (actions) {
        actions.querySelector("#cancel-conversion-btn")?.remove();
        if (!actions.children.length) actions.remove();
    }
    ModalManager.updateTop({ onEscape: undefined });
}

/**
 * Take cancelling off the table without taking the footer off the modal.
 *
 * There are stretches of a run where cancelling isn't offered - the warm-up
 * before a retry path search, the ZIP packing at the end, the wind-down after
 * a soft cancel - and the way to express that used to be to delete the button,
 * which deleted the footer with it: a border, 40px of padding and a 45px
 * button, ~110px of modal, appearing and disappearing three phases into a
 * conversation the user is reading. The invariant those callers care about is
 * that cancelling can't be *reached*, and a disabled button plus an unbound
 * Escape says that exactly as well while leaving the box where it was.
 *
 * Safe to call before the button exists; the phases that mount it call
 * {@link ensureCancelButton}, which leaves it enabled.
 */
export function setCancelEnabled(enabled: boolean) {
    const btn = ui.popupBox.querySelector<HTMLButtonElement>("#cancel-conversion-btn");
    if (!btn) return;
    btn.disabled = !enabled;
    ModalManager.updateTop({ onEscape: enabled ? triggerCancellation : undefined });
}

export function ensureCancelButton() {
    let actions = ui.popupBox.querySelector(".popup-actions-footer");
    if (!actions) {
        actions = document.createElement("div");
        actions.className = "popup-actions-footer";
        ui.popupBox.appendChild(actions);
    }

    if (!actions.querySelector("#cancel-conversion-btn")) {
        const btn = createPopupButton(modeCopy().cancelButton, "btn-secondary", () => triggerCancellation());
        btn.id = "cancel-conversion-btn";
        actions.appendChild(btn);
    }

    // Unconditional, so this doubles as the re-enable after a stretch where
    // cancelling was disabled rather than removed.
    setCancelEnabled(true);
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
        `<p>${modeCopy().action} engines are starting up. This only happens on first load, so it'll be instant next time!</p>` +
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
        // This one polls every 200ms and only stops itself once the graph has
        // loaded - so if it never does, it never stops. Nothing to poll for
        // once the window is gone; see the note on the status tick.
        if (typeof window === "undefined") {
            clearInterval(_enginesLoadingPollId!);
            _enginesLoadingPollId = null;
            return;
        }
        if (window.traversionGraph.nodeCount > 0) {
            clearInterval(_enginesLoadingPollId!);
            _enginesLoadingPollId = null;
            await ensureMinDuration(popupStartTime, 1200);
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

    if (h2) h2.textContent = `${modeCopy().action} engines ready!`;
    if (p) p.textContent = `All ${modeCopy().action} engines loaded. ${modeCopy().readyLabel}`;
    if (actions) {
        actions.innerHTML = "";
        const btn = document.createElement("button");
        btn.className = "btn-primary";
        btn.textContent = modeCopy().actionButton;
        btn.addEventListener("click", () => {
            hidePopup();
            ui.convertButton.click();
        });
        actions.appendChild(btn);
    }
}

export function showPartialDownloadPopup(count: number, onDownload: () => void) {
    const { cancelledTitle, verb } = modeCopy();
    const h2 = document.createElement("h2");
    h2.textContent = cancelledTitle;

    const p = document.createElement("p");
    p.textContent = `${count} file${count > 1 ? "s" : ""} ${count > 1 ? "were" : "was"} successfully ${verb} before stopping.`;

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
