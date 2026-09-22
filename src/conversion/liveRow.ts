import { ui } from "../components/store/store.ts";

/**
 * The engine's line, held across the gaps where nothing is being reported.
 *
 * `statusHTML` reserves a row for whatever the engine is saying, so the modal
 * keeps its height whether or not there is anything in it. What it cannot do is
 * keep anything *in* that row across a hand-off, and a run is mostly hand-offs:
 *
 *   - `setPhase` drops the previous detail on purpose, because "Encoded 3s of
 *     9s" under a heading that now reads "Reading your file" is a lie;
 *   - `actions.ts` starts a fresh `StatusHandle` for every file in a batch, so
 *     file 2 begins with nothing to say;
 *   - the phases that own no handle at all - warming up, reading, packing a
 *     ZIP - render `statusHTML` directly, with no `live` at all.
 *
 * At each of those the row emptied, then filled again a beat later when the
 * engine got going: a line blinking out and back in under whatever the user was
 * reading, several times a run. The box never moved, which was the point of
 * reserving the row, but the content still flickered.
 *
 * So the row is bridged rather than blanked. The last line the engine really
 * reported stays on screen through the gap, and the next real line replaces it
 * directly - no empty frame in between. The bridge is bounded, because a line
 * held indefinitely stops being a bridge and becomes a claim: past
 * {@link LIVE_CARRY_MS} with nothing new to say, it fades out instead.
 *
 * This lives at the DOM write rather than in `statusHTML` for two reasons: the
 * formatter is pure and its callers test it as such, and three of the four
 * surfaces that paint this row never go through a `StatusHandle` at all. Every
 * one of them goes through `showConversionInProgress`.
 *
 * The policy is {@link createLiveCarry} and the modal's DOM is only one of its
 * renderers. The PDF editor composes its status into a single line rather than
 * a stack of rows, so it has no row to bridge - but it has the same gap, and
 * it showed the same hole: recorded mid-merge, "Starting the document
 * compressor · feel free to switch tabs" dropped to "feel free to switch
 * tabs" for a fifth of a second before "Page 1 of 12" arrived. One policy, two
 * renderers, so neither surface can drift from the other.
 */

/**
 * The hold itself, with no opinion about where the line is drawn.
 *
 * `take` is the whole interface: hand it what the engine has to say this paint
 * and it hands back what to show. Something real passes straight through and
 * becomes what the next gap is bridged with; nothing at all gets the last real
 * line back, until the hold runs out and it gets nothing too.
 */
export type LiveCarry = {
    take: (next: string, now?: number) => string;
    /** The last real line, or "". */
    held: () => string;
    /** Milliseconds left on the held line, 0 when there is nothing to hold. */
    remaining: (now?: number) => number;
    reset: () => void;
};

export function createLiveCarry(holdMs: number = LIVE_CARRY_MS): LiveCarry {
    let held = "";
    let heldAt = 0;
    return {
        take(next, now = Date.now()) {
            if (next) {
                held = next;
                heldAt = now;
                return next;
            }
            return now - heldAt < holdMs ? held : "";
        },
        held: () => held,
        remaining(now = Date.now()) {
            return held ? Math.max(0, holdMs - (now - heldAt)) : 0;
        },
        reset() {
            held = "";
            heldAt = 0;
        },
    };
}

/**
 * Both rows this applies to: the running modal's engine line and the
 * soft-cancel notice's. They are the same row in different clothes - the notice
 * is what the modal becomes when Stop is pressed mid-file, and the file being
 * finished is the one whose progress was on screen a moment earlier, so the
 * line carries over rather than starting from nothing there too.
 */
const LIVE_ROW_SELECTOR = ".status-live, .cancel-live-progress";

/**
 * How long a line outlives the work that produced it.
 *
 * Sized for the hand-off it exists to cover, not for the silence beyond it. A
 * file boundary, a phase change and a worker round-trip are all well under two
 * seconds, so the bridge spans them; an engine that has genuinely stopped
 * reporting - ImageMagick and the ~75 handlers that say nothing at all - is
 * past this long before anyone reads the line twice.
 */
export const LIVE_CARRY_MS = 2000;

/** Long enough to read as a fade, short enough not to be a third state. */
export const LIVE_FADE_MS = 250;

/** The class that fades a carried line out. Paired with conversion.css. */
const FADING_CLASS = "is-fading";

/** The modal's own hold. The PDF editor keeps its own, for its own line. */
const modalCarry = createLiveCarry();
let timer: ReturnType<typeof setTimeout> | null = null;

function stopTimer() {
    if (timer !== null) {
        clearTimeout(timer);
        timer = null;
    }
}

/** A row is showing our carried text rather than the engine's own. */
function isCarrying(row: HTMLElement, text: string): boolean {
    return row.dataset.carried === "1" && text === modalCarry.held();
}

function liveRow(): HTMLElement | null {
    return ui.popupBox?.querySelector<HTMLElement>(LIVE_ROW_SELECTOR) ?? null;
}

/** Forget the last line. A new run has nothing to carry into it. */
export function resetLiveCarry() {
    stopTimer();
    modalCarry.reset();
}

/**
 * Remember what the engine just said, or - if the row came back empty - put the
 * last thing it said back.
 *
 * Call it after every write to the status paragraph, with the paragraph that
 * was written. Writes that change nothing don't need it: the row still holds
 * whatever this put there, and re-reading it as a fresh line would restart the
 * clock on a line that has not moved.
 */
export function carryLiveRow(root: HTMLElement | null = ui.popupBox ?? null) {
    const row = root?.querySelector<HTMLElement>(LIVE_ROW_SELECTOR) ?? null;
    if (!row) return;
    const text = row.textContent ?? "";

    if (text && !isCarrying(row, text)) {
        // The engine's own words. They are what a later gap gets bridged with,
        // and they end any bridge already running - including a fade caught
        // mid-way, which writes into the same span rather than replacing it.
        modalCarry.take(text);
        delete row.dataset.carried;
        row.classList.remove(FADING_CLASS);
        stopTimer();
        return;
    }
    // Already bridging this row, and already on the clock for it.
    if (text) return;

    const bridge = modalCarry.take("");
    if (!bridge) return;

    row.textContent = bridge;
    row.dataset.carried = "1";
    stopTimer();
    // The clock runs from the last real line, not from this paint, so a phase
    // that repaints every second cannot hold a stale line open forever.
    timer = setTimeout(fadeOut, modalCarry.remaining());
}

function fadeOut() {
    timer = null;
    const row = liveRow();
    if (!row || row.dataset.carried !== "1") return;
    row.classList.add(FADING_CLASS);
    timer = setTimeout(() => {
        timer = null;
        // Re-checked rather than assumed: a real line may have landed in this
        // same span during the fade, and clearing it would take the engine's
        // own words off the screen.
        const still = liveRow();
        if (!still || still.dataset.carried !== "1") return;
        still.textContent = "";
        delete still.dataset.carried;
        still.classList.remove(FADING_CLASS);
    }, LIVE_FADE_MS);
}
