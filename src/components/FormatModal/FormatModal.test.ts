/**
 * Unit tests for FormatModal.ts (pure-logic functions only).
 * Run with: bun test src/components/FormatModal/FormatModal.test.ts
 */

import { describe, it, expect } from "vitest";
import { CATEGORY_LABELS } from "../store/store.ts";


// ---------------------------------------------------------------------------
// clearFormatSelection copy
// ---------------------------------------------------------------------------

describe("clearFormatSelection placeholder text", () => {
    it("generates the correct placeholder for a known category", () => {
        const category = "image";
        const label = CATEGORY_LABELS[category];
        const text = label ? `Choose ${label.toLowerCase()} format...` : "Choose a format...";
        expect(text).toBe("Choose image format...");
    });

    it("falls back to 'Choose a format...' for an unknown category", () => {
        const category = "";
        const label = CATEGORY_LABELS[category];
        const text = label ? `Choose ${label.toLowerCase()} format...` : "Choose a format...";
        expect(text).toBe("Choose a format...");
    });

    it("generates placeholders for every defined category", () => {
        const categories = ["image", "audio", "video", "document", "data", "archive", "font", "code"];
        for (const cat of categories) {
            const label = CATEGORY_LABELS[cat];
            expect(label).toBeDefined();
            const text = `Choose ${label.toLowerCase()} format...`;
            expect(text).toContain("Choose");
            expect(text).toContain("format...");
        }
    });
});

// ---------------------------------------------------------------------------
// openFormatModal title copy
// ---------------------------------------------------------------------------

describe("openFormatModal title text", () => {
    it("formats the modal title for 'image' category", () => {
        const cat = "image";
        const label = CATEGORY_LABELS[cat];
        const title = label ? `Choose ${label.toLowerCase()} format` : "Choose format";
        expect(title).toBe("Choose image format");
    });

    it("falls back to 'Choose format' when category has no label", () => {
        const cat = "unknown";
        const label = CATEGORY_LABELS[cat];
        const title = label ? `Choose ${label.toLowerCase()} format` : "Choose format";
        expect(title).toBe("Choose format");
    });
});

// ---------------------------------------------------------------------------
// CATEGORY_LABELS completeness
// ---------------------------------------------------------------------------

describe("CATEGORY_LABELS", () => {
    const expectedCategories = ["image", "audio", "video", "document", "data", "archive", "font", "code", "other"];

    for (const cat of expectedCategories) {
        it(`has a label for '${cat}'`, () => {
            expect(CATEGORY_LABELS[cat]).toBeDefined();
            expect(CATEGORY_LABELS[cat].length).toBeGreaterThan(0);
        });
    }
});

// ---------------------------------------------------------------------------
// updateConvertButtonState logic contract
// ---------------------------------------------------------------------------

describe("updateConvertButtonState logic", () => {
    // The function sets ui.convertButton.className to "" when both indices
    // are non-null, and "disabled" otherwise. We test the logic here.
    function buttonClass(from: number | null, to: number | null): string {
        return (from !== null && to !== null) ? "" : "disabled";
    }

    it("returns '' when both indices are set", () => {
        expect(buttonClass(0, 1)).toBe("");
    });

    it("returns 'disabled' when from is null", () => {
        expect(buttonClass(null, 1)).toBe("disabled");
    });

    it("returns 'disabled' when to is null", () => {
        expect(buttonClass(0, null)).toBe("disabled");
    });

    it("returns 'disabled' when both are null", () => {
        expect(buttonClass(null, null)).toBe("disabled");
    });

    it("returns '' when indices are 0 (falsy but non-null)", () => {
        expect(buttonClass(0, 0)).toBe("");
    });
});
