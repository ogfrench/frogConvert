/**
 * DOM tests for FrogsworthWidget slot placement logic.
 * Verifies that the widget is placed in #frogsworth-slot on mobile/small screens
 * and in document.body on desktop, and that it responds to matchMedia changes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Returns a mock MediaQueryList and the list of registered change listeners
function mockMatchMedia(matches: boolean) {
    const listeners: ((e: { matches: boolean }) => void)[] = [];
    const mql = {
        matches,
        addEventListener: vi.fn((_type: string, cb: any) => listeners.push(cb)),
        removeEventListener: vi.fn(),
    };
    (window as any).matchMedia = vi.fn().mockReturnValue(mql);
    return { mql, listeners };
}

describe("FrogsworthWidget - slot placement", () => {
    let slot: HTMLDivElement;

    beforeEach(() => {
        vi.resetModules();
        slot = document.createElement("div");
        slot.id = "frogsworth-slot";
        document.body.appendChild(slot);
    });

    afterEach(async () => {
        // The widget arms a 15s idle timer and three window listeners in its
        // constructor. Emptying the body drops the element but leaves both
        // running, so tear it down through its own teardown path.
        const { destroyFrogsworth } = await import("./FrogsworthWidget.ts");
        destroyFrogsworth();
        document.body.innerHTML = "";
        vi.restoreAllMocks();
    });

    it("places widget inside #frogsworth-slot when matchMedia matches (mobile)", async () => {
        mockMatchMedia(true);
        const { initFrogsworth } = await import("./FrogsworthWidget.ts");
        initFrogsworth(() => ({ from: null, to: null }));
        expect(slot.querySelector(".frogsworth-widget")).not.toBeNull();
    });

    it("places widget in document.body when matchMedia does not match (desktop)", async () => {
        mockMatchMedia(false);
        const { initFrogsworth } = await import("./FrogsworthWidget.ts");
        initFrogsworth(() => ({ from: null, to: null }));
        expect(slot.querySelector(".frogsworth-widget")).toBeNull();
        expect(document.body.querySelector(".frogsworth-widget")).not.toBeNull();
    });

    it("falls back to document.body when #frogsworth-slot is absent", async () => {
        slot.remove();
        mockMatchMedia(true);
        const { initFrogsworth } = await import("./FrogsworthWidget.ts");
        initFrogsworth(() => ({ from: null, to: null }));
        expect(document.body.querySelector(".frogsworth-widget")).not.toBeNull();
    });

    it("moves widget into slot when matchMedia changes to mobile", async () => {
        const { listeners } = mockMatchMedia(false);
        const { initFrogsworth } = await import("./FrogsworthWidget.ts");
        initFrogsworth(() => ({ from: null, to: null }));
        expect(slot.querySelector(".frogsworth-widget")).toBeNull();

        listeners.forEach(cb => cb({ matches: true }));
        expect(slot.querySelector(".frogsworth-widget")).not.toBeNull();
    });

    it("moves widget back to document.body when matchMedia changes to desktop", async () => {
        const { listeners } = mockMatchMedia(true);
        const { initFrogsworth } = await import("./FrogsworthWidget.ts");
        initFrogsworth(() => ({ from: null, to: null }));
        expect(slot.querySelector(".frogsworth-widget")).not.toBeNull();

        listeners.forEach(cb => cb({ matches: false }));
        expect(slot.querySelector(".frogsworth-widget")).toBeNull();
        expect(document.body.querySelector(".frogsworth-widget")).not.toBeNull();
    });
});
