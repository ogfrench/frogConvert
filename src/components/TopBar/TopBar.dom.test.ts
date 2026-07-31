import { describe, it, expect, beforeEach, vi } from "vitest";
import { ui, formatMode } from "../store/store.ts";
import { applyMode, initModeToggle, FORMAT_MODE_LABELS } from "./TopBar.ts";

/**
 * The format filter decides how much of the app's format list a user can even
 * see, and it used to be a three-state cycle behind a single button: the
 * options were invisible, you could not jump to one, and going back a step
 * meant pressing twice. These tests pin the dropdown that replaced it.
 */

function mountTopBar() {
    document.body.innerHTML = `
    <div id="top-controls-menu">
      <div id="format-mode-picker">
        <button id="mode-toggle" aria-haspopup="menu" aria-expanded="false"
          aria-controls="format-mode-menu" aria-label="Format filter: Core Formats. Change">
          <span id="mode-toggle-text">Core Formats</span>
        </button>
        <div id="format-mode-menu" role="menu" aria-label="Format filter" hidden>
          <button class="quality-item" role="menuitem" data-value="core" tabindex="-1"><span class="quality-item-label">Core Formats</span></button>
          <button class="quality-item" role="menuitem" data-value="plus" tabindex="-1"><span class="quality-item-label">Core+ Formats</span></button>
          <button class="quality-item" role="menuitem" data-value="all" tabindex="-1"><span class="quality-item-label">All Formats</span></button>
        </div>
      </div>
    </div>
    <div id="category-tabs"><button class="cat-tab active" data-category=""></button></div>`;

    ui.modeToggleButton = document.getElementById("mode-toggle") as HTMLButtonElement;
    ui.categoryTabs = document.getElementById("category-tabs") as HTMLDivElement;
    ui.topBar = document.createElement("div");
}

const menu = () => document.getElementById("format-mode-menu") as HTMLElement;
const toggle = () => document.getElementById("mode-toggle") as HTMLElement;
const rows = () => [...document.querySelectorAll<HTMLElement>("#format-mode-menu .quality-item")];

beforeEach(() => {
    formatMode.value = "core";
    mountTopBar();
});

describe("format filter dropdown", () => {
    it("starts closed and opens on click", () => {
        initModeToggle(() => {});
        expect(menu().hidden).toBe(true);
        expect(toggle().getAttribute("aria-expanded")).toBe("false");

        toggle().click();
        expect(menu().hidden).toBe(false);
        expect(toggle().getAttribute("aria-expanded")).toBe("true");
    });

    it("marks the active mode rather than leaving it to be guessed", () => {
        // The cycle it replaced showed only its own label; which of the three
        // you were on, and what the others were, was invisible.
        initModeToggle(() => {});
        const current = rows().filter(r => r.getAttribute("aria-current") === "true");
        expect(current).toHaveLength(1);
        expect(current[0].dataset.value).toBe("core");
    });

    it("applies a pick, closes, and moves the mark", () => {
        const onChange = vi.fn();
        initModeToggle(onChange);
        toggle().click();
        rows().find(r => r.dataset.value === "all")!.click();

        expect(formatMode.value).toBe("all");
        expect(menu().hidden).toBe(true);
        expect(document.getElementById("mode-toggle-text")!.textContent).toBe("All Formats");
        expect(rows().filter(r => r.getAttribute("aria-current") === "true")[0].dataset.value).toBe("all");
        expect(onChange).toHaveBeenCalled();
    });

    it("does not repaint the format list when the pick is the current mode", () => {
        // Rebuilding every format option to arrive where you already were is
        // wasted work on a list this large.
        const onChange = vi.fn();
        initModeToggle(onChange);
        toggle().click();
        rows().find(r => r.dataset.value === "core")!.click();
        expect(onChange).not.toHaveBeenCalled();
        expect(menu().hidden).toBe(true);
    });

    it("closes on Escape and hands focus back to the trigger", () => {
        initModeToggle(() => {});
        toggle().click();
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        expect(menu().hidden).toBe(true);
        expect(document.activeElement).toBe(toggle());
    });

    it("closes on a click outside the picker", () => {
        initModeToggle(() => {});
        toggle().click();
        document.body.click();
        expect(menu().hidden).toBe(true);
    });

    it("keeps the button label, title and aria-label saying the same thing", () => {
        // Three separate literals is how they drift; one map is why they cannot.
        for (const mode of ["core", "plus", "all"] as const) {
            applyMode(mode);
            const label = FORMAT_MODE_LABELS[mode];
            expect(document.getElementById("mode-toggle-text")!.textContent).toBe(label);
            expect(toggle().getAttribute("aria-label")).toContain(label);
            expect((toggle() as HTMLButtonElement).title).toContain(label);
        }
    });
});
