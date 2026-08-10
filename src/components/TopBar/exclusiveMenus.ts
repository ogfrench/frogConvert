/**
 * Mutual exclusion for the top bar's dropdowns.
 *
 * There are three - format filter, compression level, app mode - each with its
 * own toggle, its own `hidden` flag and its own Escape/click-away handling.
 * Every one of those toggles calls `stopPropagation()` so that opening it does
 * not immediately trip its *own* click-away listener, and the side effect was
 * that it did not trip the other two either: all three could be on screen at
 * once, stacked and overlapping, each partly hiding the others.
 *
 * Rather than have three modules import each other, each registers the one
 * thing the others need - how to close it - and gets back a function that
 * closes everyone else. Adding a fourth dropdown means one more registration,
 * not three more edits.
 */
type Closer = () => void;

const closers = new Set<Closer>();

/**
 * Register a dropdown's own close function.
 *
 * @returns A function to call *when opening*, which closes every other
 * registered dropdown. Safe against recursion: closing does not re-broadcast.
 */
export function registerExclusiveMenu(close: Closer): () => void {
    closers.add(close);
    return () => {
        for (const other of closers) {
            if (other !== close) other();
        }
    };
}

/** Test seam: drops every registration. */
export function resetExclusiveMenus(): void {
    closers.clear();
}

/** Test seam: how many dropdowns are participating. */
export function exclusiveMenuCount(): number {
    return closers.size;
}
