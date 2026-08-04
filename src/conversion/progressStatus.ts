import type { ProgressEvent } from "../core/FormatHandler/FormatHandler.ts";
import { escapeHTML } from "../components/utils/index.ts";
import { ui } from "../components/store/store.ts";
import { isTouchUi } from "../core/utils/touchUi.ts";
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

/** What we tell a desktop user, where it is true. */
export const REASSURANCE_LINE = "feel free to switch tabs";

/** What we tell a touch user, where the other thing is not true. */
export const KEEP_OPEN_LINE = "keep this tab open while it works";

/**
 * The reassurance, which is only reassuring where it is honest.
 *
 * On desktop a Web Worker keeps running in a background tab - timers get
 * throttled, but the WASM compute this app does is unaffected - so "feel free
 * to switch tabs" is a promise the browser keeps.
 *
 * On phones it is not. iOS Safari suspends a backgrounded page almost at once,
 * and Android Chrome freezes background tabs and discards them under memory
 * pressure; switching *apps* is harder still than switching tabs. The longer
 * the run, the likelier the kill - so the advice failed exactly where it was
 * being given most confidently, on the five-minute video that prompted all of
 * this. The app already assumes this elsewhere: CompressWorkspace flushes its
 * state on `visibilitychange` and `pagehide` precisely because the page can
 * die mid-run.
 *
 * Chosen on pointer type rather than user agent, matching `isTouchUi()`
 * everywhere else in the app.
 */
export function reassuranceLine(): string {
    return isTouchUi() ? KEEP_OPEN_LINE : REASSURANCE_LINE;
}

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
    if (!detailHasPercent && typeof p.ratio === "number" && Number.isFinite(p.ratio)) {
        // Clamped before it is judged. FFmpeg briefly reports slightly over 1 as
        // a stream finishes (see FFmpeg.ts:934), and a "104%" would undo the
        // credibility the whole line exists to build.
        const pct = Math.round(Math.min(1, Math.max(0, p.ratio)) * 100);
        // A bare "0%" is not progress, it is the absence of it. FFmpeg resets
        // the bar to zero at the start of every run (including its internal
        // recovery retries), and with no detail beside it that event rendered
        // as a lone "0%" sitting on screen through the whole engine load -
        // technically true, and less use than the reassurance it displaced.
        // Once a detail arrives, "Encoded 0.0s of 20.0s · 0%" is worth showing.
        if (!detail && pct === 0) return undefined;
        parts.push(`${pct}%`);
    }
    return parts.length ? parts.join(" · ") : undefined;
}

/**
 * The live line: what the engine is doing, and how long it has been doing it.
 *
 * The reassurance is no longer part of this. It used to take turns with the
 * progress on a single line, which meant the one number worth watching
 * disappeared every few seconds - a flicker between two things, neither of
 * which you could settle on. The reassurance is static text, so it costs a line
 * and nothing else; it now has its own and simply stays there.
 *
 * Returns "" when there is nothing to report yet, which is the caller's cue to
 * omit the line entirely rather than render an empty one.
 *
 * @param progressText Result of {@link formatProgress}, or undefined.
 * @param elapsedMs How long this run has been going, or null before the clock starts.
 */
export function liveLine(
    progressText: string | undefined, elapsedMs: number | null,
): string {
    const parts: string[] = [];
    if (progressText) parts.push(progressText);
    if (elapsedMs !== null) parts.push(mmss(elapsedMs / 1000));
    return parts.join(" · ");
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
        const live = liveLine(
            formatProgress(latest),
            showElapsed ? Date.now() - startedAt : null);
        const lines = [
            mainLine,
            `<span class="muted-text">${escapeHTML(subLine)}</span>`,
        ];
        // Omitted entirely when there is nothing to report, rather than left as
        // an empty row pushing the reassurance around.
        if (live) {
            // aria-hidden, deliberately. #popup is role="status" aria-live="polite"
            // aria-atomic="true", so every write re-announces the whole modal.
            // This line changes once a second for the clock and faster still for
            // a percentage, which would turn a screen reader into a metronome.
            // The lines that carry meaning stay announced.
            lines.push(`<span class="muted-text" aria-hidden="true">${escapeHTML(live)}</span>`);
        }
        // Its own line, always. This used to take turns with the progress on a
        // single row, so the one number worth watching vanished every few
        // seconds and came back - a flicker between two things, neither of which
        // you could settle on. It is static text; it costs a line and nothing
        // else, and it is announced once instead of being re-read every tick.
        lines.push(`<span class="muted-text">${reassuranceLine()}</span>`);
        const html = lines.join("<br>");
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
        // Nothing to paint on, so stop rather than reach for it. A repeating
        // timer can outlive the document it was painting - a page torn down
        // mid-run, or a test environment disposed of between ticks - and every
        // line below this one goes through `ui`, which resolves against that
        // document. This is the structural end of the failure, not a guard
        // against one caller: it holds for every surface that starts a status,
        // including ones not written yet.
        if (typeof document === "undefined") { stop(); return; }
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
