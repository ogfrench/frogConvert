import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { showConversionInProgress, ensureCancelButton, resetCancellation, setWorkerCancelCallback, triggerCancellation, completeCancellation } from "./ConversionModal.ts";
import { ui } from "../store/store.ts";

describe("ConversionModal DOM bindings", () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="popup-bg" style="display: none;"></div>
            <div id="popup" style="display: none;"></div>
        `;
        ui.popupBackground = document.getElementById("popup-bg") as HTMLDivElement;
        ui.popupBox = document.getElementById("popup") as HTMLDivElement;
        resetCancellation();

        // Polyfill hidePopup globally so it doesn't fail
        (window as any).hidePopup = () => {
            ui.popupBox.style.display = "none";
            ui.popupBackground.style.display = "none";
        };
    });

    afterEach(() => {
        document.body.innerHTML = "";
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
        expect(ui.popupBox.querySelector("h2")?.textContent).toBe("Converting... 🐸");
        expect(ui.popupBox.querySelector(".loader-spinner")).not.toBeNull();
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
            expect(ui.popupBox.querySelector("h2")?.textContent).toBe("Cancelling... 🐸");
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
});
