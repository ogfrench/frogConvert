import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ui } from "../store/store.ts";
import { hidePopup } from "../Popup/Popup.ts";
import {
    isCancelled,
    showConversionInProgress,
    ensureCancelButton,
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
        expect(ui.popupBox.querySelector(".loader-gooey")).not.toBeNull();
        expect(ui.popupBox.querySelector("p")?.innerHTML).toBe("Step 1...");
        expect(ui.popupBox.querySelector("#cancel-conversion-btn")).toBeNull();
    });

    it("showConversionInProgress updates spinner in-place when popup is already open", () => {
        showConversionInProgress("Step 1...", "My Title");
        // popup is now open — next call should mutate rather than recreate
        showConversionInProgress("Step 2...", "My Title");
        // Still only one spinner
        expect(ui.popupBox.querySelectorAll(".loader-gooey").length).toBe(1);
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

    describe("triggerCancellation", () => {
        it("sets isCancelled to true", () => {
            showConversionInProgress("Working...");
            triggerCancellation();
            expect(isCancelled).toBe(true);
            resetCancellation();
        });

        it("invokes and clears the registered workerCancelCallback", () => {
            const cb = vi.fn();
            setWorkerCancelCallback(cb);
            showConversionInProgress("Working...");
            triggerCancellation();
            expect(cb).toHaveBeenCalledOnce();
            // Callback is consumed — calling triggerCancellation again must NOT call cb again
            triggerCancellation();
            expect(cb).toHaveBeenCalledTimes(1);
            resetCancellation();
        });

        it("shows the Cancelling popup", () => {
            showConversionInProgress("Working...");
            triggerCancellation();
            expect(ui.popupBox.querySelector("h2")?.textContent).toBe("Cancelling conversion");
            resetCancellation();
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
            showConversionInProgress("Working...");
            triggerCancellation();
            resetCancellation(); // clears cancelStartTime
            ui.popupBox.classList.add("open");
            await completeCancellation(); // must be a true no-op now
            expect(ui.popupBox.classList.contains("open")).toBe(true);
        });

        it("hides the popup after the minimum cancel duration", async () => {
            vi.useFakeTimers();
            showConversionInProgress("Working...");
            triggerCancellation();

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
});
