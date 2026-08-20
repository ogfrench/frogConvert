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
// Captured rather than discarded: the composition of the rendered lines - which
// span the clock lands in, and which one is announced - is behaviour, and a
// no-op mock cannot see it.
const painted = vi.fn();
vi.mock("./cancellation.ts", () => ({
    showConversionInProgress: (html: string, title: string, phase: string) =>
        painted(html, title, phase),
    updateCancelProgress: () => {},
}));

const {
    formatProgress,
    liveLine,
    elapsedSuffix,
    ELAPSED_AFTER_MS,
    mmss,
    reassuranceLine,
    startConversionStatus,
    REASSURANCE_LINE,
    KEEP_OPEN_LINE,
} = await import("./progressStatus.ts");

describe("formatProgress", () => {
    it("shows the detail alone, not the percentage too", () => {
        // "12.4s of 47.0s" and "34%" are the same fact twice; the detail wins
        // because it is the more specific of the two.
        expect(formatProgress({ detail: "Encoded 12.4s of 47.0s of video.", ratio: 0.34 }))
            .toBe("Encoded 12.4s of 47.0s of video.");
    });

    it("shows the detail alone when the engine reports no ratio", () => {
        // pdftoimg, pdftotxt and comics count items without knowing a fraction.
        expect(formatProgress({ detail: "Page 12 of 50." })).toBe("Page 12 of 50.");
    });

    it("shows a bare percentage when there is no detail", () => {
        // The fallback for engines that report a ratio with nothing to say
        // about it - there is no detail here for a percentage to duplicate.
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
        // A zero ratio next to a real detail says nothing new either now - the
        // detail already carries the moment, so the ratio is dropped entirely.
        expect(formatProgress({ ratio: 0, detail: "Compressed 0.0s of 20.0s" }))
            .toBe("Compressed 0.0s of 20.0s");
    });

    it("clamps the ratio into 0-100 in the bare-percentage fallback", () => {
        // FFmpeg briefly reports slightly over 1 as a stream finishes; a "104%"
        // would undo the credibility the line exists to build.
        expect(formatProgress({ ratio: 1.04 })).toBe("100%");
        // Negative clamps to zero, and a bare zero says nothing at all.
        expect(formatProgress({ ratio: -0.2 })).toBeUndefined();
    });

    it("drops the ratio whenever there is a detail to show instead", () => {
        // Ghostscript reports its engine download as "(52%)" while `ratio` is
        // at 26%, because the fetch is only the first half of its overall work -
        // this used to need its own carve-out to avoid "(52%) · 26%", and now
        // needs none: no detail keeps its ratio appended any more.
        expect(formatProgress({ detail: "Fetching the compressor (52%)", ratio: 0.26 }))
            .toBe("Fetching the compressor (52%)");
        expect(formatProgress({ detail: "Downloaded 52 %", ratio: 0.26 }))
            .toBe("Downloaded 52 %");
        // Including a detail with no percentage of its own, like a page count -
        // "Page 52 of 90" already implies "58%", so the number is not repeated.
        expect(formatProgress({ detail: "Page 52 of 90", ratio: 0.58 }))
            .toBe("Page 52 of 90");
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
    const PROGRESS = "Compressed 12.4s of 20.0s";

    it("is the engine's own words and nothing else", () => {
        // This line is about the work. The elapsed clock lives on the
        // reassurance line, and the reassurance never takes turns with it.
        expect(liveLine(PROGRESS)).toBe(PROGRESS);
        expect(liveLine(PROGRESS)).not.toContain(REASSURANCE_LINE);
        expect(liveLine(PROGRESS)).not.toMatch(/\d\d:\d\d/);
    });

    it("is empty when there is nothing at all to say", () => {
        // The caller omits the line entirely rather than render a blank one.
        expect(liveLine(undefined)).toBe("");
    });
});

describe("elapsedSuffix", () => {
    it("hangs the clock off whatever precedes it", () => {
        expect(elapsedSuffix(134_000)).toBe(" · 02:14");
    });

    it("is empty before the clock starts", () => {
        // A short run never sprouts a timer it does not need.
        expect(elapsedSuffix(null)).toBe("");
        expect(elapsedSuffix(0)).toBe("");
        expect(elapsedSuffix(ELAPSED_AFTER_MS - 1)).toBe("");
    });

    it("owns the threshold, so no caller can disagree about it", () => {
        // Both surfaces used to decide this for themselves and did not match:
        // the modal held the clock back while the PDF editor showed 00:00 from
        // the first frame. The boundary lives here now, and is inclusive.
        expect(elapsedSuffix(ELAPSED_AFTER_MS)).toBe(" · 00:20");
    });

    it("is a suffix, not a sentence", () => {
        // It is concatenated onto the reassurance, so it has to carry its own
        // separator and nothing else - no leading capital, no trailing stop.
        expect(`${KEEP_OPEN_LINE}${elapsedSuffix(45_000)}`)
            .toBe("keep this tab open · 00:45");
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

describe("where the rendered lines put the clock", () => {
    // The tick self-limits once the modal is gone, judged through `ui.popupBox`,
    // so a run being observed has to have one open for the clock to ever start.
    const withOpenModal = (fn: () => void) => {
        vi.useFakeTimers();
        document.body.innerHTML = '<div id="popupBox" class="open"></div>';
        painted.mockClear();
        try { fn(); } finally {
            document.body.innerHTML = "";
            vi.useRealTimers();
        }
    };

    const lastHTML = () => painted.mock.calls.at(-1)![0] as string;

    it("hangs the clock off the reassurance, leaving the engine's line alone", () => {
        withOpenModal(() => {
            const status = startConversionStatus({
                main: "Compressing file 2 of 3...", subtitle: "large-text.pdf", title: "Busy",
            });
            status.update({ detail: "Rasterising page 74 of 118", ratio: 0.63 });
            vi.advanceTimersByTime(ELAPSED_AFTER_MS + 1_000);

            const html = lastHTML();
            // The engine says its piece, with no percentage and no clock bolted on.
            expect(html).toContain("Rasterising page 74 of 118");
            expect(html).not.toContain("63%");
            expect(html).not.toMatch(/Rasterising page 74 of 118[^<]*\d\d:\d\d/);
            // And the clock rides with the reassurance instead.
            expect(html).toContain(reassuranceLine());
            expect(html).toMatch(/aria-hidden="true">\s*·\s*\d\d:\d\d</);
            status.cancel();
        });
    });

    it("keeps the ticking half unannounced and the sentence announced", () => {
        withOpenModal(() => {
            const status = startConversionStatus({
                main: "Working", subtitle: "a.pdf", title: "Busy",
            });
            vi.advanceTimersByTime(ELAPSED_AFTER_MS + 1_000);

            const html = lastHTML();
            // #popup is aria-atomic, so anything that changes every second has
            // to be hidden from the announcement or it reads as a metronome.
            const clockSpan = html.match(/<span[^>]*>[^<]*\d\d:\d\d[^<]*<\/span>/)?.[0] ?? "";
            expect(clockSpan).toContain('aria-hidden="true"');
            // The reassurance itself stays announced - it is the part that means
            // something, and it never changes once painted.
            expect(html).toMatch(
                new RegExp(`<span class="muted-text">${reassuranceLine()}</span>`),
            );
            status.cancel();
        });
    });

    it("shows no clock at all until the run is long enough to warrant one", () => {
        withOpenModal(() => {
            const status = startConversionStatus({
                main: "Working", subtitle: "a.pdf", title: "Busy",
            });
            vi.advanceTimersByTime(ELAPSED_AFTER_MS - 1_000);
            expect(lastHTML()).not.toMatch(/\d\d:\d\d/);
            status.cancel();
        });
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
