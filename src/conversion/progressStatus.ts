import type { ProgressEvent } from "../core/FormatHandler/FormatHandler.ts";
import { escapeHTML } from "../components/utils/index.ts";
import { ui } from "../components/store/store.ts";
import {
    showConversionInProgress,
    updateCancelProgress,
    type ProgressPhase,
} from "./cancellation.ts";

/**
 * The live status line shared by every long-running surface.
 *
 * Convert, Compress and the PDF editor all sit behind the same kind of wait -
 * a WASM engine downloading, a file being read, an encoder grinding through a
 * video - and all three used to say something different about it, or nothing at
 * all. This module owns the one answer.
 *
 * It was private to `actions.ts`, which is why Compress never had an elapsed
 * clock and the PDF editor never had a status line: they could not reach it.
 */

/** Shared with every surface that has a long wait. */
export const REASSURANCE_LINE = "feel free to switch tabs";

/**
 * How the third line alternates once real progress is arriving.
 *
 * Progress alone is not enough. The moment a handler reports its first detail
 * the reassurance used to vanish for good, so on the longest runs - the ones
 * where walking away matters most - the line telling you that it is safe to do
 * so was the first thing to disappear.
 *
 * A 1:1 flip would be noise. Six seconds is long enough to actually read a
 * frame counter and watch it move; three is long enough to register the
 * reassurance without it feeling like a flicker.
 */
export const PROGRESS_WINDOW_MS = 6000;
export const REASSURANCE_WINDOW_MS = 3000;
const CYCLE_MS = PROGRESS_WINDOW_MS + REASSURANCE_WINDOW_MS;

/** `01:23` for an elapsed-seconds count. */
export function mmss(totalSec: number): string {
    const m = Math.floor(totalSec / 60);
    const s = Math.floor(totalSec % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Render one handler progress event as a single plain-text line.
 *
 * Percentage only when the engine actually reported a ratio. FFmpeg, Ghostscript
 * and pdfCanvasCompress do; pdftoimg, pdftotxt and comics report a counted
 * detail with no ratio, and inventing one for them would mean a number that
 * jumps rather than advances.
 *
 * Returns undefined when there is nothing worth saying, which is the caller's
 * cue to keep showing the reassurance line instead.
 */
export function formatProgress(p: ProgressEvent | undefined): string | undefined {
    if (!p) return undefined;
    const parts: string[] = [];
    const detail = typeof p.detail === "string" ? p.detail.trim() : "";
    if (detail) parts.push(detail);
    // Never two percentages in one line. Ghostscript's own copy already reads
    // "Fetching the compressor (52%)" during its engine download, while `ratio`
    // is at 26% because that fetch is only the first half of its overall
    // progress - so appending it produced "(52%) · 26%", two numbers that
    // disagree about the same moment. The engine's own wording wins: it knows
    // what it is measuring.
    const detailHasPercent = /\d\s*%/.test(detail);
    // FFmpeg briefly reports slightly over 1 as a stream finishes (see the
    // clamp at FFmpeg.ts:934), and a "104%" would undo the credibility the
    // whole line exists to build.
    if (!detailHasPercent && typeof p.ratio === "number" && Number.isFinite(p.ratio)) {
        const pct = Math.round(Math.min(1, Math.max(0, p.ratio)) * 100);
        parts.push(`${pct}%`);
    }
    return parts.length ? parts.join(" · ") : undefined;
}

/**
 * Decide what the live line should say right now.
 *
 * Pure, and shared by every surface with a long wait, so the 6s/3s rhythm is
 * defined once. Before there is any progress to show it returns the reassurance
 * unconditionally - alternating with nothing would just be a line that blinks.
 *
 * @param progressText Result of {@link formatProgress}, or undefined.
 * @param elapsedMs How long this run has been going.
 */
export function alternatingLine(
    progressText: string | undefined, elapsedMs: number,
): string {
    if (!progressText) return REASSURANCE_LINE;
    return elapsedMs % CYCLE_MS < PROGRESS_WINDOW_MS ? progressText : REASSURANCE_LINE;
}

/**
 * Owns the progress modal for the duration of one unit of work. Three slots:
 * main line (stable), muted subtitle (the format path or the file name), and a
 * muted live line that alternates between the handler's latest progress and the
 * reassurance, with a ` · MM:SS` elapsed suffix once the run passes 10s.
 */
export type StatusHandle = {
    cancel: () => void;
    /** Feed a handler's progress event straight in. */
    update: (p: ProgressEvent) => void;
    /**
     * Replace the main line mid-run, for a surface that moves through phases
     * (engine download -> reading -> working) inside one handle.
     *
     * `phase` picks the spinner: "idle" is the thin ring the app already uses
     * for waits where nothing is being processed yet, "converting" the gooey one
     * for real work. That distinction existed before this change but Compress
     * never moved off "idle", so it never meant anything there.
     */
    setPhase: (main: string, opts?: { subtitle?: string; phase?: ProgressPhase }) => void;
};

export function startConversionStatus(
    { main, subtitle, title, phase = "converting" }:
        { main: string; subtitle: string; title: string; phase?: ProgressPhase },
): StatusHandle {
    const startedAt = Date.now();
    let tickTimer: ReturnType<typeof setInterval> | null = null;
    let latest: ProgressEvent | undefined;
    let lastHTML: string | null = null;
    let showElapsed = false;
    let mainLine = main;
    let subLine = subtitle;
    let currentPhase: ProgressPhase = phase;
    let painted = false;

    const render = () => {
        // Driven by elapsed time rather than a counter, so the rhythm stays
        // correct however often render() happens to be called - progress events
        // arrive at whatever rate the engine feels like.
        const leading = escapeHTML(
            alternatingLine(formatProgress(latest), Date.now() - startedAt));
        const suffix = showElapsed ? ` · ${mmss((Date.now() - startedAt) / 1000)}` : "";
        const html = [
            mainLine,
            `<span class="muted-text">${escapeHTML(subLine)}</span>`,
            // aria-hidden, deliberately. #popup is role="status" aria-live="polite"
            // aria-atomic="true", so every write re-announces the whole modal. This
            // line changes once a second for the clock and faster still for a
            // percentage, which would turn a screen reader into a metronome. The
            // lines that carry meaning - the phase and the file - stay announced.
            `<span class="muted-text" aria-hidden="true">${leading}${suffix}</span>`,
        ].join("<br>");
        if (html === lastHTML) return;
        lastHTML = html;
        showConversionInProgress(html, title, currentPhase);
        painted = true;
    };

    render(); // initial paint, callers no longer paint the modal themselves

    /**
     * One timer, armed immediately rather than after the old 10s delay: the
     * alternation needs a heartbeat from the first progress event, and the
     * elapsed clock still holds itself back until 10s so short runs stay quiet.
     */
    const stop = () => {
        if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    };

    tickTimer = setInterval(() => {
        // Self-limiting. The timer used to be armed only after ten seconds, so
        // a run that finished sooner never had one to leak; arming it up front
        // for the alternation means it has to know when it has been orphaned.
        // Once the modal is gone - results replaced it, the surface tore down,
        // the caller forgot to cancel - there is nothing left to paint, and a
        // handle that keeps ticking would write into a modal that has moved on.
        if (painted && !ui.popupBox?.classList.contains("open")) { stop(); return; }
        if (!showElapsed && Date.now() - startedAt >= 10_000) showElapsed = true;
        render();
    }, 1000);

    return {
        cancel: stop,
        update: (p) => {
            latest = p;
            // The cancel popup's sub-line wants the words, not the percentage -
            // it is explaining what is being finished, not how far along it is.
            if (typeof p.detail === "string" && p.detail.trim()) updateCancelProgress(p.detail);
            render();
        },
        setPhase: (nextMain, opts) => {
            mainLine = nextMain;
            if (typeof opts?.subtitle === "string") subLine = opts.subtitle;
            if (opts?.phase) currentPhase = opts.phase;
            // A phase change invalidates the old engine detail: "Encoded 3s of
            // 9s" under a heading that now says "Reading your file" is worse
            // than no line at all.
            latest = undefined;
            render();
        },
    };
}
