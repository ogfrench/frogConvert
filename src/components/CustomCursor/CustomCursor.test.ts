import { expect, test, describe } from "vitest";
import { initCustomCursor } from "./CustomCursor";

describe("CustomCursor Component", () => {
    test("initializes pointer tracker if not using coarse pointer", () => {
        // Mock matchMedia to simulate fine pointer (desktop)
        globalThis.matchMedia = (query: string) => ({
            matches: query === "(pointer: coarse)" ? false : true,
            media: query,
            onchange: null,
            addListener: () => { },
            removeListener: () => { },
            addEventListener: () => { },
            removeEventListener: () => { },
            dispatchEvent: () => false,
        }) as MediaQueryList;

        let cursor = document.getElementById("custom-cursor");
        expect(cursor).toBeNull();

        initCustomCursor();

        cursor = document.getElementById("custom-cursor");
        expect(cursor).not.toBeNull();
        expect(cursor?.tagName.toLowerCase()).toBe("div");
        expect(document.documentElement.classList.contains("custom-cursor-active")).toBe(true);
    });
});
