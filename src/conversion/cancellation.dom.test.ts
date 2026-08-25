import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ui } from "../components/store/store.ts";
import { hidePopup } from "../components/Popup/Popup.ts";
import {
    isCancelled,
    showConversionInProgress,
    ensureCancelButton,
    removeCancelButton,
    setCancelEnabled,
    resetCancellation,
    setCancelled,
    setCanHardCancel,
    setCurrentFileProgress,
    setWorkerCancelCallback,
    setForceCleanupCallback,
    triggerCancellation,
    completeCancellation,
    showPartialDownloadPopup,
} from "./cancellation.ts";

vi.mock("../components/Popup/Popup.ts", () => ({
    showPopup: vi.fn((content: string | Node | Node[]) => {
        if (typeof content === "string") {
            ui.popupBox.innerHTML = content;
        } else {
            ui.popupBox.innerHTML = "";
            if (Array.isArray(content)) {
                content.forEach(node => ui.popupBox.appendChild(node));
            } else {
                ui.popupBox.appendChild(content);
            }
        }
        ui.popupBox.classList.add("open");
        ui.popupBackground.classList.add("open");
    }),
    hidePopup: vi.fn(() => {
        ui.popupBox.classList.remove("open");
        ui.popupBackground.classList.remove("open");
    }),
    createPopupButton: vi.fn((text: string, className: string, onClick: () => void) => {
        const btn = document.createElement("button");
        btn.className = className;
        btn.textContent = text;
        btn.addEventListener("click", onClick);
        return btn;
    }),
    replacePopup: vi.fn((content: Node[], persistent = false, onEscape?: () => void) => {
        ui.popupBox.innerHTML = "";
        content.forEach(node => ui.popupBox.appendChild(node));
        ui.popupBox.classList.add("open");
        ui.popupBackground.classList.add("open");
    }),
    showAlertPopup: vi.fn((title: string, messageHTML: string, buttonText: string = "Got it") => {
        const h2 = document.createElement("h2");
        h2.textContent = title;
        const p = document.createElement("p");
        p.innerHTML = messageHTML;
        const btn = document.createElement("button");
        btn.textContent = buttonText;
        btn.addEventListener("click", () => {
            ui.popupBox.classList.remove("open");
            ui.popupBackground.classList.remove("open");
        });
        ui.popupBox.innerHTML = "";
        ui.popupBox.appendChild(h2);
        ui.popupBox.appendChild(p);
        ui.popupBox.appendChild(btn);
        ui.popupBox.classList.add("open");
        ui.popupBackground.classList.add("open");
    }),
}));

describe("cancellation DOM bindings", () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="popup-bg"></div>
            <div id="popup" class="card-base"></div>
        `;
        ui.popupBackground = document.getElementById("popup-bg") as HTMLDivElement;
        ui.popupBox = document.getElementById("popup") as HTMLDivElement;
        resetCancellation();
    });

    afterEach(() => {
        document.body.innerHTML = "";
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    describe("cancellation state machine", () => {
        it("isCancelled is false after reset", () => {
            expect(isCancelled).toBe(false);
        });

        it("setCancelled(true) sets isCancelled to true", () => {
            setCancelled(true);
            expect(isCancelled).toBe(true);
        });

        it("resetCancellation sets isCancelled to false", () => {
            setCancelled(true);
            resetCancellation();
            expect(isCancelled).toBe(false);
        });
    });

    it("showConversionInProgress shows the modal and creates structure", () => {
        showConversionInProgress("Step 1...");
        expect(ui.popupBox.classList.contains("open")).toBe(true);
        expect(ui.popupBackground.classList.contains("open")).toBe(true);
        expect(ui.popupBox.querySelector("h2")?.textContent).toBe("Converting...");
        expect(ui.popupBox.querySelector(".loader-gooey, .loader-spinner")).not.toBeNull();
        expect(ui.popupBox.querySelector("p")?.innerHTML).toBe("Step 1...");
        expect(ui.popupBox.querySelector("#cancel-conversion-btn")).toBeNull();
    });

    it("showConversionInProgress updates spinner in-place when popup is already open", () => {
        showConversionInProgress("Step 1...", "My Title");
        showConversionInProgress("Step 2...", "My Title");
        expect(ui.popupBox.querySelectorAll(".loader-gooey, .loader-spinner").length).toBe(1);
        expect(ui.popupBox.querySelector("p")?.innerHTML).toBe("Step 2...");
        expect(ui.popupBox.querySelector("h2")?.textContent).toBe("My Title");
    });

    it("ensureCancelButton creates actions div and the button", () => {
        showConversionInProgress("Working...");
        ensureCancelButton();
        const actions = ui.popupBox.querySelector(".popup-actions-footer");
        expect(actions).not.toBeNull();
        const cancelBtn = ui.popupBox.querySelector("#cancel-conversion-btn");
        expect(cancelBtn).not.toBeNull();
        expect(cancelBtn?.textContent).toBe("Stop conversion");
    });

    describe("keeping the footer mounted, which is ~110px of modal", () => {
        // The footer goes up once, before the first phase paints, and stays up
        // for the whole run. The stretches where cancelling isn't offered -
        // warm-up, a retry path search, ZIP packing - disable it instead of
        // unmounting it, so the box doesn't move on the way in or out.
        it("disables the button without taking the footer down", () => {
            showConversionInProgress("Reading your files...");
            ensureCancelButton();

            setCancelEnabled(false);

            const btn = ui.popupBox.querySelector<HTMLButtonElement>("#cancel-conversion-btn");
            expect(btn).not.toBeNull();
            expect(btn?.disabled).toBe(true);
            expect(ui.popupBox.querySelector(".popup-actions-footer")).not.toBeNull();
        });

        it("re-enables through ensureCancelButton, without a second button", () => {
            showConversionInProgress("Reading your files...");
            ensureCancelButton();
            setCancelEnabled(false);

            ensureCancelButton();

            expect(ui.popupBox.querySelectorAll("#cancel-conversion-btn")).toHaveLength(1);
            expect(ui.popupBox.querySelector<HTMLButtonElement>("#cancel-conversion-btn")?.disabled).toBe(false);
        });

        it("is a no-op before the button exists, so the warm-up can call it freely", () => {
            showConversionInProgress("Warming up the engines...");
            expect(() => setCancelEnabled(false)).not.toThrow();
            expect(ui.popupBox.querySelector("#cancel-conversion-btn")).toBeNull();
        });

        it("a disabled control cannot start a cancellation", () => {
            showConversionInProgress("Creating a ZIP folder");
            ensureCancelButton();
            setCancelEnabled(false);

            ui.popupBox.querySelector<HTMLButtonElement>("#cancel-conversion-btn")?.click();

            expect(isCancelled).toBe(false);
        });
    });

    describe("triggerCancellation (hard-cancellable path)", () => {
        it("replaces popup with the Cancelling modal and fires worker callback", () => {
            const cb = vi.fn();
            setWorkerCancelCallback(cb);
            setCanHardCancel(true);
            showConversionInProgress("Working...");
            ensureCancelButton();

            triggerCancellation();

            expect(isCancelled).toBe(true);
            expect(cb).toHaveBeenCalledOnce();
            expect(ui.popupBox.querySelector("h2")?.textContent).toBe("Stopping conversion");
            expect(ui.popupBox.querySelector("p")?.textContent).toBe("Stopping now...");
            expect(ui.popupBox.querySelector("#cancel-conversion-btn")).toBeNull();
            resetCancellation();
        });

        it("is idempotent: a second call does not re-fire the worker callback", () => {
            const cb = vi.fn();
            setWorkerCancelCallback(cb);
            setCanHardCancel(true);
            showConversionInProgress("Working...");
            ensureCancelButton();

            triggerCancellation();
            triggerCancellation();

            expect(cb).toHaveBeenCalledTimes(1);
            resetCancellation();
        });
    });

    describe("triggerCancellation (main-thread path, cannot interrupt mid-file)", () => {
        it("updates status copy in place and disables the cancel button without unmounting it", () => {
            setCanHardCancel(false);
            setCurrentFileProgress(2, 3);
            showConversionInProgress("Converting file 2 of 3...");
            ensureCancelButton();

            triggerCancellation();

            expect(isCancelled).toBe(true);
            expect(ui.popupBox.querySelector("h2")?.textContent).toBe("Stopping conversion");
            const pHtml = ui.popupBox.querySelector("p")?.innerHTML ?? "";
            expect(pHtml).toContain("Finishing file 2 of 3, then stopping.");
            expect(pHtml).toContain("this step can't be interrupted mid-file -");
            expect(pHtml).toContain("refresh the page if you need to stop right now.");
            // Disabled, not removed: unmounting it takes the whole footer - and
            // ~110px of modal - out from under the user in the same frame they
            // pressed Stop. Dead either way, but the box stays put.
            const btn = ui.popupBox.querySelector<HTMLButtonElement>("#cancel-conversion-btn");
            expect(btn).not.toBeNull();
            expect(btn?.disabled).toBe(true);
            expect(ui.popupBox.querySelector(".popup-actions-footer")).not.toBeNull();
            resetCancellation();
        });

        it("uses 'the current file' copy when there is only one file", () => {
            setCanHardCancel(false);
            setCurrentFileProgress(1, 1);
            showConversionInProgress("Converting your file...");
            ensureCancelButton();

            triggerCancellation();

            const pHtml = ui.popupBox.querySelector("p")?.innerHTML ?? "";
            expect(pHtml).toContain("Finishing the current file, then stopping.");
            resetCancellation();
        });

        it("does not fire the worker callback (nothing to terminate mid-render)", () => {
            const cb = vi.fn();
            setWorkerCancelCallback(cb);
            setCanHardCancel(false);
            setCurrentFileProgress(1, 1);
            showConversionInProgress("Working...");
            ensureCancelButton();

            triggerCancellation();

            expect(cb).not.toHaveBeenCalled();
            resetCancellation();
        });

        it("subsequent showConversionInProgress calls from the still-running handler are suppressed", () => {
            setCanHardCancel(false);
            setCurrentFileProgress(2, 2);
            showConversionInProgress("Converting file 2 of 2...");
            ensureCancelButton();

            triggerCancellation();

            const cancelCopy = ui.popupBox.querySelector("p")?.innerHTML ?? "";
            showConversionInProgress("Rendering page 4/12...");
            expect(ui.popupBox.querySelector("p")?.innerHTML).toBe(cancelCopy);
            resetCancellation();
        });
    });

    describe("resetCancellation", () => {
        it("clears isCancelled and restores default canHardCancel=true behavior", () => {
            setCanHardCancel(false);
            setCurrentFileProgress(2, 3);
            showConversionInProgress("Working...");
            ensureCancelButton();
            triggerCancellation();

            resetCancellation();

            const cb = vi.fn();
            setWorkerCancelCallback(cb);
            showConversionInProgress("Working again...");
            ensureCancelButton();
            triggerCancellation();

            expect(cb).toHaveBeenCalledOnce();
            expect(ui.popupBox.querySelector("p")?.textContent).toBe("Stopping now...");
            resetCancellation();
        });
    });

    describe("completeCancellation", () => {
        it("is a no-op when not cancelling (cancelStartTime is null)", async () => {
            ui.popupBox.classList.add("open");
            await completeCancellation();
            expect(ui.popupBox.classList.contains("open")).toBe(true);
        });

        it("is a no-op after resetCancellation()", async () => {
            setCanHardCancel(true);
            showConversionInProgress("Working...");
            ensureCancelButton();
            triggerCancellation();
            resetCancellation();
            ui.popupBox.classList.add("open");
            await completeCancellation();
            expect(ui.popupBox.classList.contains("open")).toBe(true);
        });

        it("hides the popup after the minimum cancel duration", async () => {
            vi.useFakeTimers();
            setCanHardCancel(true);
            showConversionInProgress("Working...");
            ensureCancelButton();
            triggerCancellation();

            const completion = completeCancellation();
            await vi.advanceTimersByTimeAsync(1300);
            await completion;

            expect(vi.mocked(hidePopup)).toHaveBeenCalled();
            resetCancellation();
        });
    });

    describe("showPartialDownloadPopup", () => {
        it("renders the correct message and buttons", () => {
            const onDownload = vi.fn();
            showPartialDownloadPopup(5, onDownload);

            expect(ui.popupBox.querySelector("h2")?.textContent).toBe("Conversion stopped");
            expect(ui.popupBox.querySelector("p")?.textContent).toBe("5 files were successfully converted before stopping.");

            const downloadBtn = ui.popupBox.querySelector("#partial-download-btn") as HTMLButtonElement;
            const doneBtn = ui.popupBox.querySelector("#partial-done-btn") as HTMLButtonElement;

            expect(downloadBtn).not.toBeNull();
            expect(doneBtn).not.toBeNull();
            expect(downloadBtn.textContent).toBe("Download 5 files");
        });

        it("calls onDownload and hides popup when 'Download' is clicked", () => {
            const onDownload = vi.fn();
            showPartialDownloadPopup(5, onDownload);

            const downloadBtn = ui.popupBox.querySelector("#partial-download-btn") as HTMLButtonElement;
            downloadBtn.click();

            expect(onDownload).toHaveBeenCalledOnce();
            expect(ui.popupBox.classList.contains("open")).toBe(false);
        });

        it("hides popup when 'Done' is clicked", () => {
            showPartialDownloadPopup(5, () => { });

            const doneBtn = ui.popupBox.querySelector("#partial-done-btn") as HTMLButtonElement;
            doneBtn.click();

            expect(ui.popupBox.classList.contains("open")).toBe(false);
        });
    });

    it("removeCancelButton tears down the empty footer if no other items remain", () => {
        showConversionInProgress("Working...");
        ensureCancelButton();
        removeCancelButton();
        expect(ui.popupBox.querySelector(".popup-actions-footer")).toBeNull();
    });

    describe("hard-cancel timeout", () => {
        it("fires forceCleanupCallback if the worker never acks (hard-cancellable path)", async () => {
            vi.useFakeTimers();
            const forceCb = vi.fn();
            setForceCleanupCallback(forceCb);
            setCanHardCancel(true);
            showConversionInProgress("Working...");
            ensureCancelButton();
            triggerCancellation();

            await vi.advanceTimersByTimeAsync(1900);
            expect(forceCb).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(200);
            expect(forceCb).toHaveBeenCalledOnce();

            resetCancellation();
        });

        it("does NOT fire forceCleanupCallback on main-thread path (honors 'finishing the current file' promise)", async () => {
            vi.useFakeTimers();
            const forceCb = vi.fn();
            setForceCleanupCallback(forceCb);
            setCanHardCancel(false);
            setCurrentFileProgress(1, 1);
            showConversionInProgress("Working...");
            ensureCancelButton();
            triggerCancellation();

            // Soft cancel cannot terminate the work; the watchdog exists only for
            // stuck workers. Firing it here would cut the current file short and
            // contradict the UI copy.
            await vi.advanceTimersByTimeAsync(5000);
            expect(forceCb).not.toHaveBeenCalled();

            resetCancellation();
        });

        it("resetCancellation clears the pending hard-cancel timer", async () => {
            vi.useFakeTimers();
            const forceCb = vi.fn();
            setForceCleanupCallback(forceCb);
            setCanHardCancel(true);
            showConversionInProgress("Working...");
            ensureCancelButton();
            triggerCancellation();

            await vi.advanceTimersByTimeAsync(500);
            resetCancellation();
            await vi.advanceTimersByTimeAsync(5000);

            expect(forceCb).not.toHaveBeenCalled();
        });

        it("reconvert after reset does not inherit stale forceCleanupCallback", async () => {
            vi.useFakeTimers();
            const staleCb = vi.fn();
            const freshCb = vi.fn();

            setForceCleanupCallback(staleCb);
            setCanHardCancel(true);
            showConversionInProgress("Working...");
            ensureCancelButton();
            triggerCancellation();
            await vi.advanceTimersByTimeAsync(500);
            resetCancellation();

            setForceCleanupCallback(freshCb);
            setCanHardCancel(true);
            showConversionInProgress("Working...");
            ensureCancelButton();
            triggerCancellation();
            await vi.advanceTimersByTimeAsync(2500);

            expect(staleCb).not.toHaveBeenCalled();
            expect(freshCb).toHaveBeenCalledOnce();

            resetCancellation();
        });
    });
});
