import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ui } from "../store/store.ts";
import { showConversionInProgress, ensureCancelButton, resetCancellation, setWorkerCancelCallback, triggerCancellation, completeCancellation, showPartialDownloadPopup } from "./ConversionModal.ts";

vi.mock("../Popup/Popup.ts", () => ({
    showPopup: vi.fn((html: string) => {
        ui.popupBox.innerHTML = html;
        ui.popupBox.style.display = "block";
        ui.popupBackground.style.display = "block";
    }),
    hidePopup: vi.fn(() => {
        ui.popupBox.style.display = "none";
        ui.popupBackground.style.display = "none";
    }),
}));

describe("ConversionModal DOM bindings", () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="popup-bg" style="display: none;"></div>
            <div id="popup" style="display: none;"></div>
        `;
        ui.popupBackground = document.getElementById("popup-bg") as HTMLDivElement;
        ui.popupBox = document.getElementById("popup") as HTMLDivElement;
        resetCancellation();

        // Polyfill hidePopup globally so it doesn't fail if called via window
        (window as any).hidePopup = () => {
            ui.popupBox.style.display = "none";
            ui.popupBackground.style.display = "none";
        };
    });

    afterEach(() => {
        document.body.innerHTML = "";
        vi.clearAllMocks();
    });

    describe("cancellation state machine", () => {
        it("isCancelled is false on module load/reset", async () => {
            const { isCancelled } = await import("./ConversionModal.ts");
            expect(isCancelled).toBe(false);
        });

        it("setCancelled(true) sets isCancelled to true", async () => {
            const { setCancelled, isCancelled } = await import("./ConversionModal.ts");
            setCancelled(true);
            const mod = await import("./ConversionModal.ts");
            expect(mod.isCancelled).toBe(true);
        });

        it("resetCancellation sets isCancelled to false", async () => {
            const { setCancelled, resetCancellation } = await import("./ConversionModal.ts");
            setCancelled(true);
            resetCancellation();
            const mod = await import("./ConversionModal.ts");
            expect(mod.isCancelled).toBe(false);
        });
    });

    it("showConversionInProgress shows the modal and creates structure", () => {
        showConversionInProgress("Step 1...");
        expect(ui.popupBox.style.display).not.toBe("none");
        expect(ui.popupBackground.style.display).not.toBe("none");
        expect(ui.popupBox.querySelector("h2")?.textContent).toBe("Converting...");
        expect(ui.popupBox.querySelector(".loader-gooey")).not.toBeNull();
        expect(ui.popupBox.querySelector("p")?.textContent).toBe("Step 1...");
        expect(ui.popupBox.querySelector("#cancel-conversion-btn")).not.toBeNull();
    });

    it("ensureCancelButton creates actions div and the button", () => {
        ensureCancelButton();
        const actions = ui.popupBox.querySelector(".popup-actions-footer");
        expect(actions).not.toBeNull();
        const cancelBtn = ui.popupBox.querySelector("#cancel-conversion-btn");
        expect(cancelBtn).not.toBeNull();
    });

    describe("triggerCancellation", () => {
        it("sets isCancelled to true", async () => {
            showConversionInProgress("Working...");
            triggerCancellation();
            const mod = await import("./ConversionModal.ts");
            expect(mod.isCancelled).toBe(true);
            resetCancellation();
        });

        it("invokes and clears the registered workerCancelCallback", () => {
            const cb = vi.fn();
            setWorkerCancelCallback(cb);
            showConversionInProgress("Working...");
            triggerCancellation();
            expect(cb).toHaveBeenCalledOnce();
            // Callback is consumed (calling triggerCancellation again should NOT call cb again)
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
            ui.popupBox.style.display = "block";
            await completeCancellation();
            // hidePopup was never called, so display remains block
            expect(ui.popupBox.style.display).toBe("block");
        });

        it("is a no-op after resetCancellation()", async () => {
            showConversionInProgress("Working...");
            triggerCancellation();
            resetCancellation(); // clears cancelStartTime
            ui.popupBox.style.display = "block";
            await completeCancellation(); // must be a true no-op now
            expect(ui.popupBox.style.display).toBe("block");
        });

        it("hides the popup after the minimum cancel duration", async () => {
            vi.useFakeTimers();
            showConversionInProgress("Working...");
            triggerCancellation();

            const completion = completeCancellation();
            // Advance past the 1000ms cancel minimum, then past Popup.ts's 160ms hide animation
            await vi.advanceTimersByTimeAsync(1100);
            await completion;
            await vi.advanceTimersByTimeAsync(200); // flush hidePopup's internal 160ms setTimeout

            expect(ui.popupBox.style.display).toBe("none");
            expect(ui.popupBackground.style.display).toBe("none");

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
            expect(ui.popupBox.style.display).toBe("none");
        });

        it("hides popup when 'Done' is clicked", () => {
            showPartialDownloadPopup(5, () => { });

            const doneBtn = ui.popupBox.querySelector("#partial-done-btn") as HTMLButtonElement;
            doneBtn.click();

            expect(ui.popupBox.style.display).toBe("none");
        });
    });
});
