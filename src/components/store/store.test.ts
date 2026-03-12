import { describe, it, expect } from "vitest";
import { isCategoryVisible, isFormatVisible, type FormatMode } from "./store.ts";

describe("store visibility logic", () => {
    const mockFormat = (format: string, mime?: string) => ({
        format,
        name: "Mock",
        extension: format,
        mime: mime || (format === "png" || format === "webp" || format === "tiff" ? `image/${format}` :
            format === "pdf" ? "application/pdf" :
                format === "xml" ? "application/xml" :
                    "application/octet-stream"),
        to: true,
        from: true,
        internal: "mock-internal"
    } as any);

    describe("isCategoryVisible", () => {
        it("hides data, font, code, other in 'core' mode", () => {
            expect(isCategoryVisible("image", "core")).toBe(true);
            expect(isCategoryVisible("data", "core")).toBe(false);
            expect(isCategoryVisible("font", "core")).toBe(false);
            expect(isCategoryVisible("code", "core")).toBe(false);
            expect(isCategoryVisible("other", "core")).toBe(false);
        });

        it("hides code and other in 'plus' mode", () => {
            expect(isCategoryVisible("data", "plus")).toBe(true);
            expect(isCategoryVisible("font", "plus")).toBe(true);
            expect(isCategoryVisible("code", "plus")).toBe(false);
            expect(isCategoryVisible("other", "plus")).toBe(false);
        });

        it("shows everything in 'all' mode", () => {
            expect(isCategoryVisible("code", "all")).toBe(true);
            expect(isCategoryVisible("other", "all")).toBe(true);
        });
    });

    describe("isFormatVisible", () => {
        it("blocks formats if their category is hidden", () => {
            const xml = mockFormat("xml"); // 'data' category (by extension logic in store.ts)
            expect(isFormatVisible(xml, "core")).toBe(false);
        });

        it("only shows CORE_FORMATS in 'core' mode", () => {
            expect(isFormatVisible(mockFormat("png"), "core")).toBe(true);
            expect(isFormatVisible(mockFormat("webp"), "core")).toBe(false);
            expect(isFormatVisible(mockFormat("pdf"), "core")).toBe(true);
        });

        it("shows PLUS_FORMATS in 'plus' mode", () => {
            expect(isFormatVisible(mockFormat("png"), "plus")).toBe(true);
            expect(isFormatVisible(mockFormat("webp"), "plus")).toBe(true);
            expect(isFormatVisible(mockFormat("tiff"), "plus")).toBe(false);
        });

        it("shows everything in 'all' mode", () => {
            expect(isFormatVisible(mockFormat("tiff"), "all")).toBe(true);
            expect(isFormatVisible(mockFormat("xml"), "all")).toBe(true);
        });
    });
});
