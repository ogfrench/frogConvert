import { GS_WASM_URL } from "../core/compression/ghostscriptAssets.ts";

/**
 * Start fetching the Ghostscript payload before anyone asks for it.
 *
 * The engine is ~16 MB and is only fetched on first real use, which is the
 * right default - but by then the user is waiting on it. Every surface knows,
 * earlier than that, whether a PDF is in play: a PDF dropped on Compress, PDF
 * picked as a conversion target, a PDF-editor level set to anything but
 * Original quality. Calling this at those moments overlaps the download with
 * whatever the user does next, and costs nothing when they never follow
 * through.
 *
 * `<link rel="prefetch">` rather than a `fetch()` we throw away: the browser
 * fetches at idle priority, can abandon it under memory pressure, and stores it
 * in the HTTP cache where the real load will find it - with no 16 MB buffer
 * sitting in JS heap in the meantime.
 *
 * Deliberately no `crossOrigin`: this is same-origin, and setting it would make
 * the prefetch a CORS request whose cache entry the plain `fetch()` in the
 * handler could not reuse - the prefetch would download 16 MB for nothing.
 */
let started = false;

export function preloadGhostscript(): void {
    if (started || typeof document === "undefined") return;
    started = true;

    const link = document.createElement("link");
    link.rel = "prefetch";
    // setAttribute rather than `link.as =`: HTMLLinkElement.as is not reflected
    // by every engine (jsdom among them), and the attribute is what the
    // preload scanner actually reads.
    link.setAttribute("as", "fetch");
    link.href = GS_WASM_URL;
    document.head.appendChild(link);
}

/** Test seam: lets a suite assert the once-only behaviour from a clean slate. */
export function resetGhostscriptPreload(): void {
    started = false;
}
