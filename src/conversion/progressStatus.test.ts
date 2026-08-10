import { describe, it, expect, vi } from "vitest";

// `isTouchUi` captures one matchMedia result at module load, so pointer type
// has to be swappable from here rather than set on the document.
let coarsePointer = false;
vi.mock("../core/utils/touchUi.ts", () => ({
    isTouchUi: () => coarsePointer,
    subscribeTouchUi: () => () => {},
}));

// The status tick reaches the DOM two ways, and the test below is about what
// happens when the document behind both of them goes away. `ui` is stubbed the
// way the real store behaves - resolving elements lazily, through `document` -
// because resolving them eagerly would hide the very thing being tested.
vi.mock("../components/store/store.ts", () => ({
    ui: new Proxy({} as Record<string, HTMLElement | null>, {
        get: (_, prop: string) => document.querySelector(`#${prop}`),
    }),
}));
vi.mock("./cancellation.ts", () => ({
    showConversionInProgress: () => {},
    updateCancelProgress: () => {},
}));

const {
    formatProgress,
    liveLine,
    mmss,
    reassuranceLine,
    startConversionStatus,
    REASSURANCE_LINE,
    KEEP_OPEN_LINE,
} = await import("./progressStatus.ts");

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
        expect(formatProgress({ ratio: 0, detail: "Compressed 0.0s of 20.0s" }))
            .toBe("Compressed 0.0s of 20.0s · 0%");
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

describe("liveLine", () => {
    const PROGRESS = "Compressed 12.4s of 20.0s · 62%";

    it("joins the progress and the clock", () => {
        expect(liveLine(PROGRESS, 134_000)).toBe(`${PROGRESS} · 02:14`);
    });

    it("is the progress alone before the clock starts", () => {
        // The elapsed clock holds itself back for the first ten seconds so a
        // short run never sprouts a timer it does not need.
        expect(liveLine(PROGRESS, null)).toBe(PROGRESS);
    });

    it("is the clock alone when the engine reports nothing", () => {
        // ImageMagick and ~75 others never emit. The run is still going, and
        // saying how long for is better than an empty row.
        expect(liveLine(undefined, 7_000)).toBe("00:07");
    });

    it("is empty when there is nothing at all to say", () => {
        // The caller omits the line entirely rather than render a blank one.
        expect(liveLine(undefined, null)).toBe("");
    });

    it("no longer takes turns with the reassurance", () => {
        // The reassurance has its own permanent line now. Whatever the elapsed
        // time, this line is about the work and only the work - it never
        // swaps itself out for a different sentence.
        for (const t of [0, 5_000, 9_000, 12_000, 60_000]) {
            expect(liveLine(PROGRESS, t)).toContain(PROGRESS);
            expect(liveLine(PROGRESS, t)).not.toContain(REASSURANCE_LINE);
        }
    });
});

describe("reassuranceLine", () => {
    const setPointer = (coarse: boolean) => { coarsePointer = coarse; };

    it("promises tab-switching only where the browser keeps that promise", () => {
        setPointer(false);
        expect(reassuranceLine()).toBe(REASSURANCE_LINE);
        expect(REASSURANCE_LINE).toMatch(/switch tabs/);
    });

    it("asks a phone to stay put instead", () => {
        setPointer(true);
        expect(reassuranceLine()).toBe(KEEP_OPEN_LINE);
        // iOS suspends a backgrounded page and Android freezes it, so telling a
        // phone it may leave is advice that loses the user their work.
        expect(KEEP_OPEN_LINE).not.toMatch(/switch tabs/);
        expect(KEEP_OPEN_LINE).toMatch(/keep this tab open/);
    });
});

describe("the status tick outliving its document", () => {
    // A status handle owns a 1s interval, and not every run cancels it: a run
    // that stalls, or a page torn down mid-encode, leaves one ticking. Every
    // line in that tick reaches through `ui` to the document, so a tick that
    // lands after the document has gone used to throw where nothing could
    // catch it. In CI that read as a run with every test passing and the job
    // still failing - twice, on two different timers, because the first fix
    // only moved the failure to the next one along.
    //
    // Measured in the Compress suite: 7 of 51 intervals armed were still
    // running at the end, all of them from deliberately stalled runs.
    it("stops instead of reaching for a document that is gone", () => {
        vi.useFakeTimers();
        try {
            startConversionStatus({ main: "Working", subtitle: "a file", title: "Busy" });
            vi.stubGlobal("document", undefined);
            expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
            // And it does not keep trying every second forever.
            expect(() => vi.advanceTimersByTime(10_000)).not.toThrow();
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.unstubAllGlobals();
            vi.useRealTimers();
        }
    });
});
