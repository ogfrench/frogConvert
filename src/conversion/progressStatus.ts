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
export const KEEP_OPEN_LINE = "keep this tab open";

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
 * Percentage only when there is nothing else to say. A detail string already
 * carries the progress - a page count, a timestamp within the source's own
 * duration - and a `ratio`-derived percentage beside it restates the same
 * number a second way rather than adding one: "Rasterising page 74 of 118"
 * and "63%" are the same fact twice. The percentage is the fallback for the
 * engines that report a bare ratio with nothing to say about it.
 *
 * Returns undefined when there is nothing worth saying, which is the caller's
 * cue to keep showing the reassurance line instead.
 */
export function formatProgress(p: ProgressEvent | undefined): string | undefined {
    if (!p) return undefined;
    const detail = typeof p.detail === "string" ? p.detail.trim() : "";
    if (detail) return detail;
    if (typeof p.ratio === "number" && Number.isFinite(p.ratio)) {
        // Clamped before it is judged. FFmpeg briefly reports slightly over 1 as
        // a stream finishes (see FFmpeg.ts:934), and a "104%" would undo the
        // credibility the whole line exists to build.
        const pct = Math.round(Math.min(1, Math.max(0, p.ratio)) * 100);
        // A bare "0%" is not progress, it is the absence of it. FFmpeg resets
        // the bar to zero at the start of every run (including its internal
        // recovery retries), and with no detail beside it that event rendered
        // as a lone "0%" sitting on screen through the whole engine load -
        // technically true, and less use than the reassurance it displaced.
        if (pct === 0) return undefined;
        return `${pct}%`;
    }
    return undefined;
}

/**
 * The live line: what the engine is doing, or how long it has been doing it.
 *
 * The clock is a fallback, not an addition. Once a detail exists it already
 * answers "is this working" better than a wall-clock count does - "Encoded
 * 12.4s of 47.0s" is a position within a known duration, `00:14` is not - so
 * appending both stacked two answers to one question. The clock only shows
 * for the engines with nothing to say at all (ImageMagick and ~75 others),
 * where it is the only evidence the run is still going.
 *
 * The reassurance is no longer part of this either. It used to take turns with
 * the progress on a single line, which meant the one number worth watching
 * disappeared every few seconds - a flicker between two things, neither of
 * which you could settle on. The reassurance is static text, so it costs a line
 * and nothing else; it has its own and simply stays there.
 *
 * Returns "" when there is nothing to report yet, which is the caller's cue to
 * omit the line entirely rather than render an empty one.
 *
 * @param progressText Result of {@link formatProgress}, or undefined.
 */
export function liveLine(progressText: string | undefined): string {
    return progressText ?? "";
}

/**
 * How long a run has to last before it is worth telling anyone how long it has
 * lasted. Below this the clock is noise on a wait nobody was worried about.
 */
export const ELAPSED_AFTER_MS = 20_000;

/**
 * The elapsed clock, which rides on the reassurance line rather than this one.
 *
 * It answers a different question from everything above it: not "what is the
 * engine doing" but "how long have I been waiting", which is the input to the
 * decision to press Stop. The reassurance is the only other line about waiting
 * rather than about the work, so the clock belongs there - and putting it there
 * keeps the live line free for the engine, which is the thing worth watching.
 *
 * The threshold lives in here rather than in each caller. Two surfaces render
 * this - the modal and the PDF editor's single status line - and when they each
 * decided for themselves they disagreed: the modal held the clock back while
 * the editor showed `00:00` from the first frame. Gating it here means a third
 * surface cannot get it wrong either.
 *
 * Returns "" for a run too short to have a clock, which is every run under
 * {@link ELAPSED_AFTER_MS}.
 */
export function elapsedSuffix(elapsedMs: number | null): string {
    if (elapsedMs === null || elapsedMs < ELAPSED_AFTER_MS) return "";
    return ` · ${mmss(elapsedMs / 1000)}`;
}

/**
 * The four rows of the progress modal, rendered as one HTML string.
 *
 * Every row is emitted every time, empty ones included. The modal is
 * auto-height, so a row that is omitted rather than left blank takes ~22px of
 * box with it: the engine's own line arrives a second or two into a run and
 * disappears again at every phase change (and at every file boundary, where
 * `actions.ts` starts a fresh handle), which made the modal breathe in and out
 * under whatever the user was reading. An empty `<br>`-delimited span still
 * takes a full line box from the paragraph's strut, so a reserved row costs
 * exactly what a filled one does and the box stops moving.
 *
 * The same shape is what the phases that don't own a status handle - reading,
 * warming up, downloading an engine, packing a ZIP - render through, so those
 * are the same height as the conversion they bracket.
 *
 * SECURITY: `main` is injected as HTML and must never carry user-supplied
 * content; it is app copy in every caller. `subtitle`, `live` and `clock` are
 * escaped, which is what lets `subtitle` be a file name.
 *
 * @param live The handler's own progress, from {@link formatProgress}. Empty
 *             reserves the row.
 * @param clock The elapsed suffix, from {@link elapsedSuffix}. Rides on the
 *              reassurance row, so it costs no row of its own either way.
 */
export function statusHTML(
    { main, subtitle, live = "", clock = "" }:
        { main: string; subtitle: string; live?: string; clock?: string },
): string {
    return [
        main,
        `<span class="muted-text">${escapeHTML(subtitle)}</span>`,
        // aria-hidden, deliberately. #popup is role="status" aria-live="polite"
        // aria-atomic="true", so every write re-announces the whole modal. This
        // line changes once a second for the clock and faster still for a
        // percentage, which would turn a screen reader into a metronome. The
        // lines that carry meaning stay announced.
        `<span class="status-live muted-text" aria-hidden="true">${escapeHTML(live)}</span>`,
        // The reassurance is static text, so it costs a line and nothing else
        // and is announced once rather than re-read every tick. The clock rides
        // here rather than on the live line above: the reassurance is the only
        // other line about the waiting rather than about the work, and hanging
        // the elapsed time off it leaves the engine's own line to say one
        // thing. Two spans rather than one string because the sentence stays
        // announced while the ticking half does not.
        `<span class="muted-text">${reassuranceLine()}</span>`
        + `<span class="status-clock muted-text" aria-hidden="true">${escapeHTML(clock)}</span>`,
    ].join("<br>");
}

/**
 * Owns the progress modal for the duration of one unit of work. Four slots:
 * main line (stable), muted subtitle (the format path or the file name), a
 * muted live line (the handler's own progress), and its own permanent
 * reassurance line beneath it, carrying the elapsed clock once the run passes
 * {@link ELAPSED_AFTER_MS}. All four are always present - see
 * {@link statusHTML}.
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
    let mainLine = main;
    let subLine = subtitle;
    let currentPhase: ProgressPhase = phase;
    let painted = false;

    const render = () => {
        const html = statusHTML({
            main: mainLine,
            subtitle: subLine,
            live: liveLine(formatProgress(latest)),
            clock: elapsedSuffix(Date.now() - startedAt),
        });
        if (html === lastHTML) return;
        lastHTML = html;
        showConversionInProgress(html, title, currentPhase);
        painted = true;
    };

    render(); // initial paint, callers no longer paint the modal themselves

    /**
     * One timer, armed immediately rather than after a delay: the modal needs a
     * heartbeat from the first progress event. The elapsed clock holds itself
     * back until {@link ELAPSED_AFTER_MS} inside `elapsedSuffix`, so short runs
     * stay quiet without this loop knowing anything about it.
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
