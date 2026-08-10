import { describe, it, expect, beforeEach } from "vitest";
import { preloadGhostscript, resetGhostscriptPreload } from "./ghostscriptPreload.ts";
import { GS_WASM_URL } from "../core/compression/ghostscriptAssets.ts";

/**
 * The preload exists to overlap a 16 MB download with whatever the user does
 * next. Everything worth testing here is a property that, if it broke, would
 * silently turn that saving into a 16 MB *waste* rather than an error anyone
 * would notice.
 */
describe("preloadGhostscript", () => {
    beforeEach(() => {
        document.head.innerHTML = "";
        resetGhostscriptPreload();
    });

    it("prefetches the engine at the URL the handler will fetch", () => {
        preloadGhostscript();
        const link = document.head.querySelector<HTMLLinkElement>('link[rel="prefetch"]');
        expect(link).not.toBeNull();
        expect(link!.getAttribute("href")).toBe(GS_WASM_URL);
    });

    it("declares as=fetch, matching how the handler retrieves it", () => {
        // A mismatched `as` gives the prefetch its own cache entry, so the real
        // load downloads all 16 MB again.
        preloadGhostscript();
        expect(document.head.querySelector("link")!.getAttribute("as")).toBe("fetch");
    });

    it("sets no crossOrigin, so the cache entry is reusable", () => {
        // This is same-origin. Setting crossOrigin would make the prefetch a
        // CORS request whose entry the handler's plain fetch() cannot reuse -
        // the download would happen twice and the preload would be pure cost.
        preloadGhostscript();
        expect(document.head.querySelector("link")!.hasAttribute("crossorigin")).toBe(false);
    });

    it("only ever fetches once, however many surfaces ask", () => {
        // Compress, Convert and the PDF editor all call this, and dropping ten
        // PDFs calls it ten times.
        for (let i = 0; i < 10; i++) preloadGhostscript();
        expect(document.head.querySelectorAll('link[rel="prefetch"]')).toHaveLength(1);
    });
});
