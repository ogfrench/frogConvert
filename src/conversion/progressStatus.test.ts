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

    it("says nothing for a bare zero, which is the absence of progress", () => {
        // FFmpeg resets the bar to 0 at the start of every run. With no detail
        // beside it that rendered as a lone "0%" through the entire engine
        // load, displacing the reassurance with a less useful non-fact.
        expect(formatProgress({ ratio: 0 })).toBeUndefined();
        // But a zero with something to say is worth saying.
        expect(formatProgress({ ratio: 0, detail: "Encoded 0.0s of 20.0s of video." }))
            .toBe("Encoded 0.0s of 20.0s of video. · 0%");
    });

    it("clamps the ratio into 0-100", () => {
        // FFmpeg briefly reports slightly over 1 as a stream finishes; a "104%"
        // would undo the credibility the line exists to build.
        expect(formatProgress({ ratio: 1.04 })).toBe("100%");
        // Negative clamps to zero, and a bare zero says nothing at all.
        expect(formatProgress({ ratio: -0.2 })).toBeUndefined();
        expect(formatProgress({ ratio: -0.2, detail: "Working" })).toBe("Working · 0%");
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

    it("leads with progress for the first nine seconds of each cycle", () => {
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

    it("keeps the requested 9s / 3s rhythm", () => {
        expect(PROGRESS_WINDOW_MS).toBe(9000);
        expect(REASSURANCE_WINDOW_MS).toBe(3000);
    });

    it("gives progress three quarters of every cycle", () => {
        // The point of widening 6s to 9s: the reassurance should be a periodic
        // reminder, not an equal partner. Counted rather than asserted from the
        // constants, so the split is checked as it is actually rendered.
        const cycle = PROGRESS_WINDOW_MS + REASSURANCE_WINDOW_MS;
        let showingProgress = 0;
        for (let t = 0; t < cycle; t += 100) {
            if (alternatingLine(PROGRESS, t) === PROGRESS) showingProgress++;
        }
        expect(showingProgress / (cycle / 100)).toBeCloseTo(0.75, 2);
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
