import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ui } from "../components/store/store.ts";
import {
    showConversionInProgress,
    resetCancellation,
    setCanHardCancel,
    setCurrentFileProgress,
    ensureCancelButton,
    triggerCancellation,
    updateCancelProgress,
} from "./cancellation.ts";
import { statusHTML } from "./progressStatus.ts";
import { LIVE_CARRY_MS, LIVE_FADE_MS, createLiveCarry } from "./liveRow.ts";

vi.mock("../components/Popup/Popup.ts", () => ({
    showPopup: vi.fn((content: string | Node | Node[]) => {
        ui.popupBox.innerHTML = "";
        if (typeof content === "string") ui.popupBox.innerHTML = content;
        else if (Array.isArray(content)) content.forEach(n => ui.popupBox.appendChild(n));
        else ui.popupBox.appendChild(content);
        ui.popupBox.classList.add("open");
    }),
    hidePopup: vi.fn(() => ui.popupBox.classList.remove("open")),
    createPopupButton: vi.fn((text: string, className: string, onClick: () => void) => {
        const btn = document.createElement("button");
        btn.className = className;
        btn.textContent = text;
        btn.addEventListener("click", onClick);
        return btn;
    }),
    replacePopup: vi.fn(),
}));

/**
 * The row the modal reserves for whatever the engine is saying. Reserving it
 * kept the box still; keeping something in it is what these cover.
 */
describe("the engine's line, across the gaps where nothing is reported", () => {
    const row = () => ui.popupBox.querySelector(".status-live, .cancel-live-progress");
    const live = () => row()?.textContent ?? null;

    /** A phase with the engine reporting, then one where it has gone quiet. */
    const working = (main: string, engine = "") => showConversionInProgress(
        statusHTML({ main, subtitle: "holiday.mp4", live: engine }),
        "Compressing your files",
    );

    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = `<div id="popup-bg"></div><div id="popup"></div>`;
        ui.popupBackground = document.getElementById("popup-bg") as HTMLDivElement;
        ui.popupBox = document.getElementById("popup") as HTMLDivElement;
        resetCancellation();
    });

    afterEach(() => {
        vi.useRealTimers();
        document.body.innerHTML = "";
        vi.restoreAllMocks();
    });

    it("keeps the last line up through a phase change rather than blanking it", () => {
        working("Compressing file 1 of 3...", "Encoded 12.4s of 47.0s");
        // The hand-off: `setPhase` drops the engine's detail on purpose, and
        // this is the frame where the row used to be empty on screen.
        working("Reading your file...");
        expect(live()).toBe("Encoded 12.4s of 47.0s");
    });

    it("swaps straight to the next real line, with no empty frame between", () => {
        working("Compressing file 1 of 3...", "Encoded 47.0s of 47.0s");
        working("Compressing file 2 of 3...");
        expect(live()).toBe("Encoded 47.0s of 47.0s");

        working("Compressing file 2 of 3...", "Encoded 0.4s of 31.0s");
        expect(live()).toBe("Encoded 0.4s of 31.0s");
    });

    it("lets go once the hold is spent, by fading rather than blinking out", () => {
        working("Compressing file 1 of 3...", "Encoded 12.4s of 47.0s");
        working("Reading your file...");

        vi.advanceTimersByTime(LIVE_CARRY_MS);
        expect(row()?.classList.contains("is-fading")).toBe(true);
        // Still readable while it fades - the row empties at the end of it.
        expect(live()).toBe("Encoded 12.4s of 47.0s");

        vi.advanceTimersByTime(LIVE_FADE_MS);
        expect(live()).toBe("");
        expect(row()?.classList.contains("is-fading")).toBe(false);
    });

    it("times the hold from the last real line, not from the last repaint", () => {
        working("Compressing file 1 of 3...", "Encoded 12.4s of 47.0s");
        vi.advanceTimersByTime(LIVE_CARRY_MS / 2);
        working("Reading your file...");
        // The phases either side of a hand-off repaint on their own clocks. A
        // hold that restarted with each of them would hold a stale line for as
        // long as the phase lasted.
        vi.advanceTimersByTime(LIVE_CARRY_MS / 2);
        working("Getting the video compressor ready...");

        vi.advanceTimersByTime(LIVE_FADE_MS);
        expect(live()).toBe("");
    });

    it("carries nothing into a run that has not started yet", () => {
        working("Compressing file 1 of 3...", "Encoded 12.4s of 47.0s");
        vi.advanceTimersByTime(LIVE_CARRY_MS + LIVE_FADE_MS);

        // A modal built from scratch is the next run: the results modal it
        // replaced is gone, and so is what the last one was saying.
        ui.popupBox.innerHTML = "";
        ui.popupBox.classList.remove("open");
        working("Getting things ready...");
        expect(live()).toBe("");
    });

    it("hands the line to the stop notice, which is finishing that same file", () => {
        setCanHardCancel(false);
        setCurrentFileProgress(2, 3);
        working("Compressing file 2 of 3...", "Rasterising page 74 of 118");
        ensureCancelButton();
        triggerCancellation();

        expect(live()).toBe("Rasterising page 74 of 118");

        // And the engine's own next word still wins, without the hold clearing
        // it out from under the notice.
        updateCancelProgress("Rasterising page 75 of 118");
        vi.advanceTimersByTime(LIVE_CARRY_MS + LIVE_FADE_MS);
        expect(live()).toBe("Rasterising page 75 of 118");
    });
});

/**
 * The hold, with no opinion about where the line is drawn. The modal bridges a
 * reserved row with it; the PDF editor, which composes its status into a single
 * line, holds the same words the same way.
 */
describe("the hold itself", () => {
    it("passes the engine's own words straight through", () => {
        const carry = createLiveCarry();
        expect(carry.take("Page 1 of 12", 0)).toBe("Page 1 of 12");
        expect(carry.take("Page 2 of 12", 100)).toBe("Page 2 of 12");
    });

    it("hands back the last real line when the engine goes quiet", () => {
        // Recorded from a real merge: Ghostscript says nothing between starting
        // up and reaching page 1, and the line used to collapse to the
        // reassurance alone for the ~170ms in between.
        const carry = createLiveCarry();
        carry.take("Starting the document compressor", 0);
        expect(carry.take("", 170)).toBe("Starting the document compressor");
        expect(carry.take("Page 1 of 12", 200)).toBe("Page 1 of 12");
    });

    it("lets go once the hold is spent, and stays let go", () => {
        const carry = createLiveCarry();
        carry.take("Page 12 of 12", 0);
        expect(carry.take("", LIVE_CARRY_MS - 1)).toBe("Page 12 of 12");
        expect(carry.take("", LIVE_CARRY_MS)).toBe("");
        expect(carry.take("", LIVE_CARRY_MS + 5_000)).toBe("");
    });

    it("times the hold from the last real line, not from the last paint", () => {
        const carry = createLiveCarry();
        carry.take("Page 12 of 12", 0);
        carry.take("", 500);
        carry.take("", 1_000);
        expect(carry.take("", LIVE_CARRY_MS)).toBe("");
    });

    it("reports what is left, which is what the fade is scheduled on", () => {
        const carry = createLiveCarry();
        expect(carry.remaining(0)).toBe(0);
        carry.take("Encoded 12.4s of 47.0s", 0);
        expect(carry.remaining(500)).toBe(LIVE_CARRY_MS - 500);
        expect(carry.remaining(LIVE_CARRY_MS + 1)).toBe(0);
    });

    it("forgets on reset, so a new run carries nothing into it", () => {
        const carry = createLiveCarry();
        carry.take("Page 12 of 12", 0);
        carry.reset();
        expect(carry.take("", 1)).toBe("");
        expect(carry.held()).toBe("");
    });
});
