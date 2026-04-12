import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ui } from "../store/store.ts";
import { hidePopup } from "../Popup/Popup.ts";
import {
    isCancelled,
    isSoftCancelRequested,
    setActiveBatchSize,
    showConversionInProgress,
    ensureCancelButton,
    removeCancelButton,
    resetCancellation,
    setCancelled,
    setWorkerCancelCallback,
    triggerCancellation,
    completeCancellation,
    showPartialDownloadPopup,
} from "./ConversionModal.ts";

vi.mock("../Popup/Popup.ts", () => ({
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

describe("ConversionModal DOM bindings", () => {
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
        vi.clearAllMocks();
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
        // popup is now open - next call should mutate rather than recreate
        showConversionInProgress("Step 2...", "My Title");
        // Still only one spinner
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
    });

    describe("triggerCancellation — single-file (immediate hard cancel)", () => {
        it("one click hard-cancels immediately: sets isCancelled, fires worker callback", () => {
            const cb = vi.fn();
            setWorkerCancelCallback(cb);
            setActiveBatchSize(1);
            showConversionInProgress("Working...");
            ensureCancelButton();
            triggerCancellation();
            expect(isCancelled).toBe(true);
            expect(isSoftCancelRequested()).toBe(false);
            expect(cb).toHaveBeenCalledOnce();
            expect(ui.popupBox.querySelector("h2")?.textContent).toBe("Cancelling conversion");
            resetCancellation();
        });

        it("does not show the soft-cancel subtitle on single-file runs", () => {
            setActiveBatchSize(1);
            showConversionInProgress("Working...");
            ensureCancelButton();
            triggerCancellation();
            expect(ui.popupBox.querySelector(".conversion-wrap-up")).toBeNull();
            resetCancellation();
        });
    });

    describe("triggerCancellation — batch (two-stage)", () => {
        it("first call is a soft cancel: isCancelled stays false, isSoftCancelRequested becomes true", () => {
            setActiveBatchSize(3);
            showConversionInProgress("Working...");
            ensureCancelButton();
            triggerCancellation();
            expect(isSoftCancelRequested()).toBe(true);
            expect(isCancelled).toBe(false);
            resetCancellation();
        });

        it("first click relabels the cancel button to 'Stop now' and shows the wrap-up subtitle", () => {
            setActiveBatchSize(3);
            showConversionInProgress("Converting file 2 of 5...");
            ensureCancelButton();
            triggerCancellation();
            const btn = ui.popupBox.querySelector("#cancel-conversion-btn") as HTMLButtonElement;
            expect(btn.textContent).toBe("Stop now");
            expect(ui.popupBox.querySelector(".conversion-wrap-up")).not.toBeNull();
            resetCancellation();
        });

        it("soft-cancel subtitle survives subsequent showConversionInProgress updates", () => {
            setActiveBatchSize(3);
            showConversionInProgress("Converting file 2 of 5...");
            ensureCancelButton();
            triggerCancellation();
            expect(ui.popupBox.querySelector(".conversion-wrap-up")).not.toBeNull();
            showConversionInProgress("Converting file 2 of 5...<br><span class=\"muted-text\">path</span>");
            expect(ui.popupBox.querySelector(".conversion-wrap-up")).not.toBeNull();
            resetCancellation();
        });

        it("second call escalates to hard cancel: sets isCancelled, fires worker callback, shows Cancelling popup", () => {
            const cb = vi.fn();
            setWorkerCancelCallback(cb);
            setActiveBatchSize(3);
            showConversionInProgress("Working...");
            ensureCancelButton();
            triggerCancellation();               // soft
            expect(cb).not.toHaveBeenCalled();
            triggerCancellation();               // hard
            expect(isCancelled).toBe(true);
            expect(cb).toHaveBeenCalledOnce();
            expect(ui.popupBox.querySelector("h2")?.textContent).toBe("Cancelling conversion");
            // Callback is consumed - further calls must NOT re-fire it
            triggerCancellation();
            expect(cb).toHaveBeenCalledTimes(1);
            resetCancellation();
        });

        it("resetCancellation clears softCancelRequested and activeBatchSize", () => {
            setActiveBatchSize(3);
            showConversionInProgress("Working...");
            ensureCancelButton();
            triggerCancellation();
            expect(isSoftCancelRequested()).toBe(true);
            resetCancellation();
            expect(isSoftCancelRequested()).toBe(false);
        });

        it("resetCancellation removes DOM artifacts from a previous soft-cancel", () => {
            setActiveBatchSize(3);
            showConversionInProgress("Working...");
            ensureCancelButton();
            triggerCancellation(); // soft — adds wrap-up subtitle + relabels button

            // Verify artifacts exist before reset
            expect(ui.popupBox.querySelector(".conversion-wrap-up")).not.toBeNull();
            expect(ui.popupBox.querySelector("#cancel-conversion-btn")?.textContent).toBe("Stop now");

            resetCancellation();

            // All artifacts should be cleaned up
            expect(ui.popupBox.querySelector(".conversion-wrap-up")).toBeNull();
            expect(ui.popupBox.querySelector("#cancel-conversion-btn")?.textContent).toBe("Cancel conversion");
        });
    });

    describe("completeCancellation", () => {
        it("is a no-op when not cancelling (cancelStartTime is null)", async () => {
            // Should not throw and should not hide the popup
            ui.popupBox.classList.add("open");
            await completeCancellation();
            expect(ui.popupBox.classList.contains("open")).toBe(true);
        });

        it("is a no-op after resetCancellation()", async () => {
            setActiveBatchSize(3);
            showConversionInProgress("Working...");
            ensureCancelButton();
            triggerCancellation(); // soft
            triggerCancellation(); // hard
            resetCancellation(); // clears cancelStartTime
            ui.popupBox.classList.add("open");
            await completeCancellation(); // must be a true no-op now
            expect(ui.popupBox.classList.contains("open")).toBe(true);
        });

        it("hides the popup after the minimum cancel duration (two-stage cancel)", async () => {
            vi.useFakeTimers();
            setActiveBatchSize(3);
            showConversionInProgress("Working...");
            ensureCancelButton();
            triggerCancellation(); // soft
            triggerCancellation(); // hard — this is what arms cancelStartTime

            const completion = completeCancellation();
            await vi.advanceTimersByTimeAsync(1100);
            await completion;

            expect(vi.mocked(hidePopup)).toHaveBeenCalled();

            vi.useRealTimers();
            resetCancellation();
        });
    });

    describe("showPartialDownloadPopup", () => {
        it("renders the correct message and buttons", () => {
            const onDownload = vi.fn();
            showPartialDownloadPopup(5, onDownload);

            expect(ui.popupBox.querySelector("h2")?.textContent).toBe("Conversion cancelled");
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
});
