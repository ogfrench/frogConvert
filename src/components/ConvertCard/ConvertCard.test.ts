/**
 * Unit tests for ConvertCard component.
 * Run with: bun test src/components/ConvertCard/ConvertCard.test.ts
 *
 * The ConvertCard is currently a CSS-only component (no exported logic).
 * These tests validate that the stylesheet exists and contains the expected
 * selectors so regressions (e.g. accidental deletion or misplaced rules)
 * are caught early.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const css = readFileSync(
    resolve(__dirname, "ConvertCard.css"),
    "utf-8",
);

describe("ConvertCard.css", () => {
    it("defines #convert-card base rule", () => {
        expect(css).toContain("#convert-card");
    });

    it("defines #convert-button base rule", () => {
        expect(css).toContain("#convert-button");
    });

    it("includes mobile media query for #convert-card", () => {
        expect(css).toMatch(/@media[^{]*max-width:\s*800px/);
    });

    it("uses --modal-width for mobile card width", () => {
        expect(css).toContain("var(--modal-width)");
    });

    it("uses --mobile-content-width for mobile max-width cap", () => {
        expect(css).toContain("var(--mobile-content-width)");
    });

    it("sets min-width: 300px for mobile", () => {
        expect(css).toContain("min-width: 300px");
    });
});
