/**
 * Unit tests for ModalManager.ts — stack-based modal management.
 * Run with: bun run test src/components/utils/ModalManager.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ModalManager } from "./ModalManager.ts";

function makeModal(id: string): HTMLElement {
    const el = document.createElement("div");
    el.id = id;
    el.setAttribute("aria-hidden", "true");
    document.body.appendChild(el);
    return el;
}

function makeBg(id: string): HTMLElement {
    const el = document.createElement("div");
    el.id = id;
    document.body.appendChild(el);
    return el;
}

beforeEach(() => {
    document.body.innerHTML = "";
    // Clear the static stack between tests
    (ModalManager as any).activeModals = [];
});

afterEach(() => {
    document.body.innerHTML = "";
    (ModalManager as any).activeModals = [];
});

// ---------------------------------------------------------------------------
// open / close
// ---------------------------------------------------------------------------

describe("ModalManager.open", () => {
    it("adds 'open' class to modal and bg", () => {
        const modal = makeModal("m");
        const bg = makeBg("bg");
        ModalManager.open(modal, bg);
        expect(modal.classList.contains("open")).toBe(true);
        expect(bg.classList.contains("open")).toBe(true);
    });

    it("removes aria-hidden from modal", () => {
        const modal = makeModal("m");
        const bg = makeBg("bg");
        ModalManager.open(modal, bg);
        expect(modal.hasAttribute("aria-hidden")).toBe(false);
    });
});

describe("ModalManager.close", () => {
    it("removes 'open' class from modal and bg", () => {
        const modal = makeModal("m");
        const bg = makeBg("bg");
        ModalManager.open(modal, bg);
        ModalManager.close(modal, bg);
        expect(modal.classList.contains("open")).toBe(false);
        expect(bg.classList.contains("open")).toBe(false);
    });

    it("sets aria-hidden='true' on close", () => {
        const modal = makeModal("m");
        const bg = makeBg("bg");
        ModalManager.open(modal, bg);
        ModalManager.close(modal, bg);
        expect(modal.getAttribute("aria-hidden")).toBe("true");
    });

    it("calls the onClose callback", () => {
        const modal = makeModal("m");
        const bg = makeBg("bg");
        const onClose = vi.fn();
        ModalManager.open(modal, bg, onClose);
        ModalManager.close(modal, bg);
        expect(onClose).toHaveBeenCalledOnce();
    });

    it("is a no-op for an unregistered modal", () => {
        const modal = makeModal("m");
        const bg = makeBg("bg");
        // close without ever opening — should not throw
        expect(() => ModalManager.close(modal, bg)).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// isOpen
// ---------------------------------------------------------------------------

describe("ModalManager.isOpen", () => {
    it("returns false before open", () => {
        const modal = makeModal("m");
        expect(ModalManager.isOpen(modal)).toBe(false);
    });

    it("returns true after open", () => {
        const modal = makeModal("m");
        const bg = makeBg("bg");
        ModalManager.open(modal, bg);
        expect(ModalManager.isOpen(modal)).toBe(true);
    });

    it("returns false after close", () => {
        const modal = makeModal("m");
        const bg = makeBg("bg");
        ModalManager.open(modal, bg);
        ModalManager.close(modal, bg);
        expect(ModalManager.isOpen(modal)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// closeTop
// ---------------------------------------------------------------------------

describe("ModalManager.closeTop", () => {
    it("is a no-op when stack is empty", () => {
        expect(() => ModalManager.closeTop()).not.toThrow();
    });

    it("closes the top modal", () => {
        const modal = makeModal("m");
        const bg = makeBg("bg");
        ModalManager.open(modal, bg);
        ModalManager.closeTop();
        expect(ModalManager.isOpen(modal)).toBe(false);
    });

    it("does NOT close a persistent modal", () => {
        const modal = makeModal("m");
        const bg = makeBg("bg");
        ModalManager.open(modal, bg, undefined, /* persistent */ true);
        ModalManager.closeTop();
        expect(ModalManager.isOpen(modal)).toBe(true); // still open
    });

    it("calls onEscape instead of closing when onEscape is set", () => {
        const modal = makeModal("m");
        const bg = makeBg("bg");
        const onEscape = vi.fn();
        ModalManager.open(modal, bg, undefined, false, onEscape);
        ModalManager.closeTop();
        expect(onEscape).toHaveBeenCalledOnce();
        // Modal stays open because onEscape handled it
        expect(ModalManager.isOpen(modal)).toBe(true);
    });

    it("closes the most recently opened modal in a stack", () => {
        const m1 = makeModal("m1");
        const bg1 = makeBg("bg1");
        const m2 = makeModal("m2");
        const bg2 = makeBg("bg2");
        ModalManager.open(m1, bg1);
        ModalManager.open(m2, bg2);
        ModalManager.closeTop();
        expect(ModalManager.isOpen(m2)).toBe(false);
        expect(ModalManager.isOpen(m1)).toBe(true); // m1 still open
    });
});

// ---------------------------------------------------------------------------
// updateTop
// ---------------------------------------------------------------------------

describe("ModalManager.updateTop", () => {
    it("is a no-op when stack is empty", () => {
        expect(() => ModalManager.updateTop({ persistent: true })).not.toThrow();
    });

    it("updates persistent flag on the top modal", () => {
        const modal = makeModal("m");
        const bg = makeBg("bg");
        ModalManager.open(modal, bg);
        ModalManager.updateTop({ persistent: true });
        // closeTop should now be a no-op because persistent
        ModalManager.closeTop();
        expect(ModalManager.isOpen(modal)).toBe(true);
    });

    it("updates onEscape on the top modal", () => {
        const modal = makeModal("m");
        const bg = makeBg("bg");
        ModalManager.open(modal, bg);
        const onEscape = vi.fn();
        ModalManager.updateTop({ onEscape });
        ModalManager.closeTop();
        expect(onEscape).toHaveBeenCalledOnce();
    });

    it("clears onEscape when set to undefined", () => {
        const modal = makeModal("m");
        const bg = makeBg("bg");
        const onEscape = vi.fn();
        ModalManager.open(modal, bg, undefined, false, onEscape);
        ModalManager.updateTop({ onEscape: undefined });
        ModalManager.closeTop();
        // onEscape cleared → modal should close normally
        expect(onEscape).not.toHaveBeenCalled();
        expect(ModalManager.isOpen(modal)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// replaceTop
// ---------------------------------------------------------------------------

describe("ModalManager.replaceTop", () => {
    it("opens the modal if it is not already in the stack", () => {
        const modal = makeModal("m");
        const bg = makeBg("bg");
        ModalManager.replaceTop(modal, bg);
        expect(ModalManager.isOpen(modal)).toBe(true);
    });

    it("updates the callbacks when the modal is already open", () => {
        const modal = makeModal("m");
        const bg = makeBg("bg");
        const firstClose = vi.fn();
        const secondClose = vi.fn();
        ModalManager.open(modal, bg, firstClose);
        ModalManager.replaceTop(modal, bg, secondClose);
        ModalManager.close(modal, bg);
        expect(firstClose).not.toHaveBeenCalled();
        expect(secondClose).toHaveBeenCalledOnce();
    });

    it("moves an existing non-top modal to the top of the stack", () => {
        const m1 = makeModal("m1");
        const bg1 = makeBg("bg1");
        const m2 = makeModal("m2");
        const bg2 = makeBg("bg2");
        ModalManager.open(m1, bg1);
        ModalManager.open(m2, bg2);
        // Replace m1 (bottom) — should move it to top
        ModalManager.replaceTop(m1, bg1);
        // Now closeTop closes m1
        ModalManager.closeTop();
        expect(ModalManager.isOpen(m1)).toBe(false);
        expect(ModalManager.isOpen(m2)).toBe(true);
    });

    it("does not duplicate the entry when called on an already-open modal", () => {
        const modal = makeModal("m");
        const bg = makeBg("bg");
        ModalManager.open(modal, bg);
        ModalManager.replaceTop(modal, bg);
        const stack = (ModalManager as any).activeModals as unknown[];
        expect(stack.length).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Escape key global listener
// ---------------------------------------------------------------------------

describe("Escape key listener", () => {
    it("closes the top modal when Escape is pressed", () => {
        const modal = makeModal("m");
        const bg = makeBg("bg");
        ModalManager.open(modal, bg);

        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

        expect(ModalManager.isOpen(modal)).toBe(false);
    });

    it("calls onEscape instead of closing when onEscape is set and Escape is pressed", () => {
        const modal = makeModal("m");
        const bg = makeBg("bg");
        const onEscape = vi.fn();
        ModalManager.open(modal, bg, undefined, false, onEscape);

        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

        expect(onEscape).toHaveBeenCalledOnce();
        expect(ModalManager.isOpen(modal)).toBe(true);
    });

    it("does not close a persistent modal on Escape", () => {
        const modal = makeModal("m");
        const bg = makeBg("bg");
        ModalManager.open(modal, bg, undefined, true);

        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

        expect(ModalManager.isOpen(modal)).toBe(true);
    });

    it("ignores non-Escape keydown events", () => {
        const modal = makeModal("m");
        const bg = makeBg("bg");
        ModalManager.open(modal, bg);

        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

        expect(ModalManager.isOpen(modal)).toBe(true);
    });
});
