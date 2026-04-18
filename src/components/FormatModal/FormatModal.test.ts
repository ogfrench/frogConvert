/**
 * Unit tests for FormatModal.ts (pure-logic functions only).
 * Run with: bun test src/components/FormatModal/FormatModal.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CATEGORY_LABELS, ui, isLoadingHandlers, allOptionsRef } from "../store/store.ts";
import type { FileFormat, FormatHandler } from "../../core/FormatHandler/FormatHandler.ts";
import { updateConvertButtonState } from "./FormatModal.ts";


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

// ---------------------------------------------------------------------------
// updateConvertButtonState - actual DOM function with isLoadingHandlers
// ---------------------------------------------------------------------------

describe("updateConvertButtonState (DOM)", () => {
    beforeEach(() => {
        document.body.innerHTML = `<button id="convert-button"></button>`;
        ui.convertButton = document.getElementById("convert-button") as HTMLButtonElement;
        isLoadingHandlers.value = false;
    });

    afterEach(() => {
        document.body.innerHTML = "";
        isLoadingHandlers.value = false;
        (ui as any).convertButton = null;
    });

    it("removes 'disabled' and sets text to 'Convert' when both indices are non-null", () => {
        ui.convertButton.classList.add("disabled");
        updateConvertButtonState(0, 1);
        expect(ui.convertButton.classList.contains("disabled")).toBe(false);
        expect(ui.convertButton.textContent).toBe("Convert");
    });

    it("adds 'disabled' and text 'Convert' when from is null and isLoadingHandlers=false", () => {
        updateConvertButtonState(null, 1);
        expect(ui.convertButton.classList.contains("disabled")).toBe(true);
        expect(ui.convertButton.textContent).toBe("Convert");
    });

    it("adds 'disabled' and text 'Loading formats…' when from is null and isLoadingHandlers=true", () => {
        isLoadingHandlers.value = true;
        updateConvertButtonState(null, 1);
        expect(ui.convertButton.classList.contains("disabled")).toBe(true);
        expect(ui.convertButton.textContent).toBe("Loading formats\u2026");
    });

    it("adds 'disabled' when to is null", () => {
        updateConvertButtonState(0, null);
        expect(ui.convertButton.classList.contains("disabled")).toBe(true);
    });

    it("reverts to 'Convert' text after isLoadingHandlers goes false", () => {
        isLoadingHandlers.value = true;
        updateConvertButtonState(null, null);
        expect(ui.convertButton.textContent).toBe("Loading formats\u2026");

        isLoadingHandlers.value = false;
        updateConvertButtonState(null, null);
        expect(ui.convertButton.textContent).toBe("Convert");
    });
});

// ---------------------------------------------------------------------------
// updateConvertButtonState - same-format compression relabel + helper
// ---------------------------------------------------------------------------

describe("updateConvertButtonState (same-format compression)", () => {
    function makeFormat(mime: string, format: string, lossless = false): FileFormat {
        return {
            name: format.toUpperCase(),
            format,
            extension: format,
            mime,
            internal: format,
            from: true,
            to: true,
            lossless,
        };
    }

    function stubHandler(name: string, formats: FileFormat[]): FormatHandler {
        return { name, supportedFormats: formats, ready: true } as unknown as FormatHandler;
    }

    beforeEach(() => {
        document.body.innerHTML = `<button id="convert-button"></button>`;
        ui.convertButton = document.getElementById("convert-button") as HTMLButtonElement;
        isLoadingHandlers.value = false;
    });

    afterEach(() => {
        document.body.innerHTML = "";
        isLoadingHandlers.value = false;
        allOptionsRef.value = [];
        (window as { supportedFormatCache?: Map<string, FileFormat[]> }).supportedFormatCache = new Map();
        (ui as any).convertButton = null;
    });

    it("relabels to 'Compress' and shows helper when PNG to PNG", () => {
        const png = makeFormat("image/png", "png", true);
        const handler = stubHandler("ImageMagick", [png]);
        allOptionsRef.value = [{ format: png, handler }];
        (window as any).supportedFormatCache = new Map([["ImageMagick", [png]]]);

        updateConvertButtonState(0, 0);

        expect(ui.convertButton.classList.contains("compress-mode")).toBe(true);
        expect(ui.convertButton.textContent).toContain("Compress");
        expect(ui.convertButton.querySelector(".convert-strike")?.textContent).toBe("Convert");
        const hint = document.querySelector(".convert-hint") as HTMLElement;
        expect(hint).not.toBeNull();
        expect(hint.hidden).toBe(false);
        expect(hint.textContent).toContain("PNG");
        expect(hint.textContent).toContain("compress");
        expect(hint.getAttribute("aria-live")).toBe("polite");
    });

    it("relabels to 'Compress' for MP4 to MP4", () => {
        const mp4 = makeFormat("video/mp4", "mp4");
        const handler = stubHandler("FFmpeg", [mp4]);
        allOptionsRef.value = [{ format: mp4, handler }];
        (window as any).supportedFormatCache = new Map([["FFmpeg", [mp4]]]);

        updateConvertButtonState(0, 0);

        expect(ui.convertButton.classList.contains("compress-mode")).toBe(true);
        expect(ui.convertButton.textContent).toContain("Compress");
        const hint = document.querySelector(".convert-hint") as HTMLElement;
        expect(hint.textContent).toContain("MP4");
    });

    it("stays 'Convert' for PDF to PDF (not compressible)", () => {
        const pdf = makeFormat("application/pdf", "pdf");
        const handler = stubHandler("pdftoimg", [pdf]);
        allOptionsRef.value = [{ format: pdf, handler }];
        (window as any).supportedFormatCache = new Map([["pdftoimg", [pdf]]]);

        updateConvertButtonState(0, 0);

        expect(ui.convertButton.textContent).toBe("Convert");
        const hint = document.querySelector(".convert-hint") as HTMLElement;
        expect(hint.hidden).toBe(true);
    });

    it("stays 'Convert' for SVG to SVG (excluded from whitelist even though image)", () => {
        const svg = makeFormat("image/svg+xml", "svg");
        const handler = stubHandler("ImageMagick", [svg]);
        allOptionsRef.value = [{ format: svg, handler }];
        (window as any).supportedFormatCache = new Map([["ImageMagick", [svg]]]);

        updateConvertButtonState(0, 0);

        expect(ui.convertButton.textContent).toBe("Convert");
    });

    it("stays 'Convert' when input and output formats differ", () => {
        const png = makeFormat("image/png", "png", true);
        const jpeg = makeFormat("image/jpeg", "jpeg");
        const handler = stubHandler("ImageMagick", [png, jpeg]);
        allOptionsRef.value = [
            { format: png, handler },
            { format: jpeg, handler },
        ];
        (window as any).supportedFormatCache = new Map([["ImageMagick", [png, jpeg]]]);

        updateConvertButtonState(0, 1);

        expect(ui.convertButton.textContent).toBe("Convert");
        const hint = document.querySelector(".convert-hint") as HTMLElement;
        expect(hint.hidden).toBe(true);
    });

    it("stays 'Convert' when required handler is absent (fallback)", () => {
        const png = makeFormat("image/png", "png", true);
        const canvasHandler = stubHandler("canvasToBlob", [png]);
        allOptionsRef.value = [{ format: png, handler: canvasHandler }];
        (window as any).supportedFormatCache = new Map([["canvasToBlob", [png]]]);

        updateConvertButtonState(0, 0);

        expect(ui.convertButton.textContent).toBe("Convert");
    });
});
