import { describe, it, expect } from "vitest";
import {
    formatProgress,
    alternatingLine,
    mmss,
    REASSURANCE_LINE,
    PROGRESS_WINDOW_MS,
    REASSURANCE_WINDOW_MS,
} from "./progressStatus.ts";

describe("formatProgress", () => {
    it("shows the detail and the percentage together", () => {
        expect(formatProgress({ detail: "Encoded 12.4s of 47.0s of video.", ratio: 0.34 }))
            .toBe("Encoded 12.4s of 47.0s of video. · 34%");
    });

    it("shows the detail alone when the engine reports no ratio", () => {
        // pdftoimg, pdftotxt and comics count items without knowing a fraction.
        expect(formatProgress({ detail: "Page 12 of 50." })).toBe("Page 12 of 50.");
    });

    it("shows a bare percentage when there is no detail", () => {
        expect(formatProgress({ ratio: 0.5 })).toBe("50%");
    });

    it("says nothing when the event carries nothing", () => {
        expect(formatProgress({})).toBeUndefined();
        expect(formatProgress(undefined)).toBeUndefined();
        // Whitespace is not a detail.
        expect(formatProgress({ detail: "   " })).toBeUndefined();
    });

    it("clamps the ratio into 0-100", () => {
        // FFmpeg briefly reports slightly over 1 as a stream finishes; a "104%"
        // would undo the credibility the line exists to build.
        expect(formatProgress({ ratio: 1.04 })).toBe("100%");
        expect(formatProgress({ ratio: -0.2 })).toBe("0%");
    });

    it("does not add a second percentage when the engine already gave one", () => {
        // Ghostscript reports its engine download as "(52%)" while `ratio` is
        // at 26%, because the fetch is only the first half of its overall work.
        // Showing both made one line disagree with itself.
        expect(formatProgress({ detail: "Fetching the compressor (52%)", ratio: 0.26 }))
            .toBe("Fetching the compressor (52%)");
        // A percentage anywhere in the detail counts, spaced or not.
        expect(formatProgress({ detail: "Downloaded 52 %", ratio: 0.26 }))
            .toBe("Downloaded 52 %");
        // A bare number is not a percentage, so the ratio still gets appended.
        expect(formatProgress({ detail: "Page 52 of 90", ratio: 0.58 }))
            .toBe("Page 52 of 90 · 58%");
    });

    it("ignores a ratio that is not a real number", () => {
        expect(formatProgress({ detail: "Working", ratio: NaN })).toBe("Working");
        expect(formatProgress({ detail: "Working", ratio: Infinity })).toBe("Working");
    });
});

describe("alternatingLine", () => {
    const PROGRESS = "Encoded 12.4s of 47.0s of video. · 34%";

    it("shows the reassurance while there is no progress to show", () => {
        // Alternating with nothing would just be a line that blinks.
        expect(alternatingLine(undefined, 0)).toBe(REASSURANCE_LINE);
        expect(alternatingLine(undefined, 7000)).toBe(REASSURANCE_LINE);
    });

    it("leads with progress for the first six seconds of each cycle", () => {
        expect(alternatingLine(PROGRESS, 0)).toBe(PROGRESS);
        expect(alternatingLine(PROGRESS, PROGRESS_WINDOW_MS - 1)).toBe(PROGRESS);
    });

    it("switches to the reassurance for the next three", () => {
        expect(alternatingLine(PROGRESS, PROGRESS_WINDOW_MS)).toBe(REASSURANCE_LINE);
        const cycle = PROGRESS_WINDOW_MS + REASSURANCE_WINDOW_MS;
        expect(alternatingLine(PROGRESS, cycle - 1)).toBe(REASSURANCE_LINE);
    });

    it("comes back round to progress on the next cycle", () => {
        const cycle = PROGRESS_WINDOW_MS + REASSURANCE_WINDOW_MS;
        expect(alternatingLine(PROGRESS, cycle)).toBe(PROGRESS);
        expect(alternatingLine(PROGRESS, cycle + PROGRESS_WINDOW_MS)).toBe(REASSURANCE_LINE);
        expect(alternatingLine(PROGRESS, cycle * 2)).toBe(PROGRESS);
    });

    it("keeps the requested 6s / 3s rhythm", () => {
        expect(PROGRESS_WINDOW_MS).toBe(6000);
        expect(REASSURANCE_WINDOW_MS).toBe(3000);
    });

    it("never leaves the user without a line", () => {
        // Whatever the elapsed time, something is always on screen. A blank
        // status line reads as a hang, which is the whole failure being fixed.
        for (let t = 0; t < 40_000; t += 250) {
            expect(alternatingLine(PROGRESS, t).length).toBeGreaterThan(0);
        }
    });
});

describe("mmss", () => {
    it("zero-pads both halves", () => {
        expect(mmss(0)).toBe("00:00");
        expect(mmss(9)).toBe("00:09");
        expect(mmss(134)).toBe("02:14");
    });

    it("keeps counting past an hour rather than wrapping", () => {
        // A 190 MB video really can run this long, and "05:00" would be a lie.
        expect(mmss(3900)).toBe("65:00");
    });
});
