import { describe, it, expect, beforeEach } from "vitest";
import {
    registerExclusiveMenu,
    resetExclusiveMenus,
    exclusiveMenuCount,
} from "./exclusiveMenus.ts";

/**
 * Reported from a screenshot: the format filter, the compression level and the
 * app mode dropdown were all open at once, overlapping each other. Each toggle
 * calls `stopPropagation()` so it does not trip its own click-away listener,
 * which meant it did not trip the other two's either.
 */
describe("top bar dropdowns are mutually exclusive", () => {
    beforeEach(() => resetExclusiveMenus());

    /** A dropdown that records whether it is open. */
    function menu() {
        const state = { open: false };
        const closeOthers = registerExclusiveMenu(() => { state.open = false; });
        return {
            state,
            open() { closeOthers(); state.open = true; },
            close() { state.open = false; },
        };
    }

    it("closes the others when one opens", () => {
        const formats = menu(), quality = menu(), appMode = menu();

        formats.open();
        expect([formats.state.open, quality.state.open, appMode.state.open]).toEqual([true, false, false]);

        quality.open();
        expect([formats.state.open, quality.state.open, appMode.state.open]).toEqual([false, true, false]);

        appMode.open();
        expect([formats.state.open, quality.state.open, appMode.state.open]).toEqual([false, false, true]);
    });

    it("never leaves two open at once, whatever the order", () => {
        const menus = [menu(), menu(), menu()];
        for (const order of [[0, 1, 2], [2, 0, 1], [1, 1, 0], [0, 0, 0]]) {
            for (const i of order) {
                menus[i].open();
                expect(menus.filter(m => m.state.open)).toHaveLength(1);
            }
        }
    });

    it("does not close the one being opened", () => {
        const only = menu();
        only.open();
        expect(only.state.open).toBe(true);
        // Re-opening an already-open menu must not close it via its own closer.
        only.open();
        expect(only.state.open).toBe(true);
    });

    it("leaves the others alone when a menu simply closes", () => {
        const a = menu(), b = menu();
        a.open();
        b.close();
        expect(a.state.open).toBe(true);
    });

    it("registers each participant once", () => {
        menu(); menu(); menu();
        expect(exclusiveMenuCount()).toBe(3);
    });
});
