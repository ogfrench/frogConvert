/**
 * Unit tests for FormatModal.ts (pure-logic functions only).
 * Run with: bun test src/components/FormatModal/FormatModal.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CATEGORY_LABELS, ui, isLoadingHandlers, allOptionsRef, currentFiles, formatMode, activeCategory, reachableIdentifiers, isLoadingPhase2 } from "../store/store.ts";
import type { FileFormat, FormatHandler } from "../../core/FormatHandler/FormatHandler.ts";
import { prepareOfficePdfConversion, updateConvertButtonState, renderFormatOptions, filterFormats } from "./FormatModal.ts";
import { COMPRESS_THESE_EVENT } from "../../constants/ui.ts";


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

    it("adds 'disabled' and names the download when from is null and isLoadingHandlers=true", () => {
        isLoadingHandlers.value = true;
        updateConvertButtonState(null, 1);
        expect(ui.convertButton.classList.contains("disabled")).toBe(true);
        expect(ui.convertButton.textContent).toBe("Downloading converters\u2026");
    });

    it("adds 'disabled' when to is null", () => {
        updateConvertButtonState(0, null);
        expect(ui.convertButton.classList.contains("disabled")).toBe(true);
    });

    it("reverts to 'Convert' text after isLoadingHandlers goes false", () => {
        isLoadingHandlers.value = true;
        updateConvertButtonState(null, null);
        expect(ui.convertButton.textContent).toBe("Downloading converters\u2026");

        isLoadingHandlers.value = false;
        updateConvertButtonState(null, null);
        expect(ui.convertButton.textContent).toBe("Convert");
    });

    // --- what the button says while it cannot be pressed ---
        const setOnline = (v: boolean) =>
            Object.defineProperty(navigator, "onLine", { value: v, configurable: true });

        afterEach(() => { setOnline(true); isLoadingHandlers.value = false; });

        it("names the download rather than the formats already on screen", () => {
            // "Loading formats..." was wrong twice: the formats are in the picker
            // and selectable, and what is still arriving is the converter code.
            isLoadingHandlers.value = true;
            updateConvertButtonState(null, null);
            expect(ui.convertButton.textContent).toBe("Downloading converters…");
            expect(ui.convertButton.textContent).not.toMatch(/formats/i);
        });

        it("breathes while it waits, so the disabled state does not read as frozen", () => {
            isLoadingHandlers.value = true;
            updateConvertButtonState(null, null);
            expect(ui.convertButton.classList.contains("is-waiting")).toBe(true);
        });

        it("says so when there is no connection to download over", () => {
            isLoadingHandlers.value = true;
            setOnline(false);
            updateConvertButtonState(null, null);
            expect(ui.convertButton.textContent).toMatch(/offline/i);
        });

        it("stops breathing once both formats are picked", () => {
            isLoadingHandlers.value = true;
            updateConvertButtonState(0, 1);
            expect(ui.convertButton.classList.contains("is-waiting")).toBe(false);
        });

        it("reads Convert when nothing is downloading", () => {
            isLoadingHandlers.value = false;
            updateConvertButtonState(null, null);
            expect(ui.convertButton.textContent).toBe("Convert");
            expect(ui.convertButton.classList.contains("is-waiting")).toBe(false);
        });

});

// ---------------------------------------------------------------------------
// updateConvertButtonState - same-format signpost to the Compress surface
// ---------------------------------------------------------------------------

describe("updateConvertButtonState (same-format signpost)", () => {
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

    it("labels the same-format pick as a pass-through, not a conversion", () => {
        const png = makeFormat("image/png", "png", true);
        const handler = stubHandler("ImageMagick", [png]);
        allOptionsRef.value = [{ format: png, handler }];
        (window as any).supportedFormatCache = new Map([["ImageMagick", [png]]]);

        updateConvertButtonState(0, 0);

        // The button says what actually happens: you get your file back.
        expect(ui.convertButton.textContent).toBe("Download original");
        const hint = document.querySelector(".convert-hint") as HTMLElement;
        expect(hint.hidden).toBe(false);
        expect(hint.textContent).toContain("nothing to convert");
        expect(hint.getAttribute("aria-live")).toBe("polite");
    });

    it("says what an Illustrator conversion costs before the user commits", () => {
        // A modern .ai is a PDF with an Illustrator payload beside it. The
        // conversion is genuinely good - all the artwork survives - but the
        // editability does not, and #19 asks for that to be said out loud
        // rather than discovered when the file won't reopen properly.
        const ai = makeFormat("application/illustrator", "ai");
        const pdf = makeFormat("application/pdf", "pdf");
        const handler = stubHandler("Ghostscript", [ai, pdf]);
        allOptionsRef.value = [{ format: ai, handler }, { format: pdf, handler }];

        updateConvertButtonState(0, 1);

        const hint = document.querySelector(".convert-hint") as HTMLElement;
        expect(hint.hidden).toBe(false);
        expect(hint.textContent).toMatch(/layers/i);
        expect(hint.textContent).toMatch(/flattened/i);
        // Still a normal conversion, so the button must not be relabelled.
        expect(ui.convertButton.textContent).toBe("Convert");
    });

    it("keeps the hint out of the way for conversions that lose nothing", () => {
        const png = makeFormat("image/png", "png", true);
        const pdf = makeFormat("application/pdf", "pdf");
        const handler = stubHandler("Ghostscript", [png, pdf]);
        allOptionsRef.value = [{ format: pdf, handler }, { format: png, handler }];

        updateConvertButtonState(0, 1);

        expect((document.querySelector(".convert-hint") as HTMLElement).hidden).toBe(true);
    });

    it("labels the pass-through regardless of whether that format has a compressor", () => {
        // This registry has no Ghostscript loaded, so pdf->pdf has no
        // compressor to offer. Picking it still converts nothing, so the
        // signpost is still the honest answer, without the Compress nudge.
        const pdf = makeFormat("application/pdf", "pdf");
        allOptionsRef.value = [{ format: pdf, handler: stubHandler("pdftoimg", [pdf]) }];

        updateConvertButtonState(0, 0);

        expect(ui.convertButton.textContent).toBe("Download original");
        const hint = document.querySelector(".convert-hint") as HTMLElement;
        expect(hint.hidden).toBe(false);
        expect(hint.textContent).toContain("unchanged");
        expect(hint.querySelector(".convert-hint-action")).toBeNull();
    });

    it("points a compressible same-format pick at the Compress surface", () => {
        // png->png with ImageMagick loaded: the user almost certainly wanted
        // the file smaller, and a surface exists for exactly that. A dead-end
        // "you get it back unchanged" would hide the feature at the one moment
        // it is wanted.
        const png = makeFormat("image/png", "png", true);
        const handler = stubHandler("ImageMagick", [png]);
        allOptionsRef.value = [{ format: png, handler }];
        (window as any).supportedFormatCache = new Map([["ImageMagick", [png]]]);

        updateConvertButtonState(0, 0);

        const hint = document.querySelector(".convert-hint") as HTMLElement;
        expect(hint.textContent).toContain("Want it smaller?");
        const action = hint.querySelector<HTMLButtonElement>(".convert-hint-action");
        expect(action).not.toBeNull();

        // The files go with them. Landing on an empty Compress card means
        // picking the same files a second time, which reads as the button
        // having done nothing at all.
        currentFiles.value = [new File(["x"], "photo.png", { type: "image/png" })];
        const dispatched: File[][] = [];
        window.addEventListener(COMPRESS_THESE_EVENT, (e) =>
            dispatched.push((e as CustomEvent).detail.files), { once: true });
        action!.click();
        expect(dispatched).toHaveLength(1);
        expect(dispatched[0].map(f => f.name)).toEqual(["photo.png"]);
    });

    it("hands over a copy, so later edits to the converter's batch don't follow", () => {
        const png = makeFormat("image/png", "png", true);
        allOptionsRef.value = [{ format: png, handler: stubHandler("ImageMagick", [png]) }];
        (window as any).supportedFormatCache = new Map([["ImageMagick", [png]]]);
        updateConvertButtonState(0, 0);

        currentFiles.value = [new File(["x"], "a.png", { type: "image/png" })];
        let handed: File[] = [];
        window.addEventListener(COMPRESS_THESE_EVENT, (e) => {
            handed = (e as CustomEvent).detail.files;
        }, { once: true });
        document.querySelector<HTMLButtonElement>(".convert-hint-action")!.click();

        currentFiles.value.push(new File(["y"], "b.png", { type: "image/png" }));
        expect(handed).toHaveLength(1);
    });

    it("stays quiet when input and output formats differ", () => {
        const png = makeFormat("image/png", "png", true);
        const jpeg = makeFormat("image/jpeg", "jpeg");
        const handler = stubHandler("ImageMagick", [png, jpeg]);
        allOptionsRef.value = [
            { format: png, handler },
            { format: jpeg, handler },
        ];

        updateConvertButtonState(0, 1);

        expect(ui.convertButton.textContent).toBe("Convert");
        expect((document.querySelector(".convert-hint") as HTMLElement).hidden).toBe(true);
    });
});


// ---------------------------------------------------------------------------
// prepareOfficePdfConversion
// ---------------------------------------------------------------------------

describe("prepareOfficePdfConversion", () => {
    const realUA = navigator.userAgent;
    const setUA = (ua: string) => Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });

    beforeEach(() => {
        document.body.innerHTML = `<div id="libreoffice-notice" hidden></div>`;
        ui.libreofficeNotice = document.getElementById("libreoffice-notice") as HTMLDivElement;
        window.supportedFormatCache = new Map();
    });

    afterEach(() => {
        setUA(realUA);
        document.body.innerHTML = "";
    });

    it("lets the desktop app without LibreOffice make the picture PDF its banner describes", async () => {
        setUA("Mozilla/5.0 (X11; Linux x86_64) frogConvert Electron/44.9.3");
        await expect(prepareOfficePdfConversion("docx", "pdf")).resolves.toBe("limited");
    });

    it("leaves non-Office conversions alone", async () => {
        await expect(prepareOfficePdfConversion("png", "pdf")).resolves.toBe("ready");
    });

    it("blocks a legacy format in the browser until the user picks limited conversion", async () => {
        await expect(prepareOfficePdfConversion("ppt", "pdf")).resolves.toBe("blocked");
        expect(ui.libreofficeNotice.hidden).toBe(false);
    });
});


describe("format picker global search", () => {
    const make = (format: string, category: string): FileFormat => ({
        name: format.toUpperCase(), format, extension: format,
        mime: `application/x-${format}`, internal: format,
        category, from: true, to: true, lossless: false,
    });
    const formats = [make("png", "image"), make("xlsx", "spreadsheet"), make("djot", "document")];
    const handler = { name: "fake", ready: true, supportedFormats: formats } as FormatHandler;
    const items = formats.map(format => ({ format, handler }));

    beforeEach(() => {
        document.body.innerHTML = '<input id="search" /><div id="format-options"></div>';
        ui.formatSearch = document.getElementById("search") as HTMLInputElement;
        ui.formatOptions = document.getElementById("format-options") as HTMLDivElement;
        allOptionsRef.value = items;
        formatMode.value = "core";
        activeCategory.value = "image";
        reachableIdentifiers.value = null;
        isLoadingPhase2.value = false;
    });
    afterEach(() => {
        document.body.innerHTML = "";
        formatMode.value = "core";
        activeCategory.value = "";
        reachableIdentifiers.value = null;
        allOptionsRef.value = [];
    });
    const displayed = () => Array.from(ui.formatOptions.querySelectorAll<HTMLButtonElement>(".format-option"))
        .map(node => ({ name: node.firstChild?.textContent, tier: node.querySelector(".format-tier-tag")?.textContent }));

    it("finds Plus and All formats outside the active tier and category", () => {
        renderFormatOptions(items, "image");
        expect(displayed()).toEqual([{ name: "PNG", tier: undefined }]);
        filterFormats("xlsx");
        expect(displayed()).toEqual([{ name: "XLSX", tier: "Core+" }]);
        filterFormats("DJOT");
        expect(displayed()).toEqual([{ name: "DJOT", tier: "All" }]);
        expect(activeCategory.value).toBe("image");
        expect(formatMode.value).toBe("core");
    });

    it("restores the original browsing filters when search is cleared", () => {
        filterFormats("djot");
        filterFormats("");
        expect(displayed()).toEqual([{ name: "PNG", tier: undefined }]);
    });

    it("finds by category and shows an empty state for an unknown format", () => {
        filterFormats("spreadsheet");
        expect(displayed()).toEqual([{ name: "XLSX", tier: "Core+" }]);
        filterFormats("does-not-exist");
        expect(displayed()).toEqual([]);
        expect(ui.formatOptions.textContent).toContain("No matching formats.");
    });
});
