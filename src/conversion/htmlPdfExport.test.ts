import { beforeEach, describe, expect, it, vi } from "vitest";
import { ui } from "../components/store/store.ts";
import { preparePrintPage } from "./printPage.ts";
import { isBrowserHtmlPdfExport, showHtmlPdfExport } from "./htmlPdfExport.ts";

vi.mock("../handlers/svgForeignObject.ts", () => ({
    printableDocument: vi.fn((html: string) => html),
}));
vi.mock("../components/Frogsworth/DancingFrog.ts", () => ({
    createDancingFrog: () => document.createElement("div"),
}));
vi.mock("./printPage.ts", () => ({
    preparePrintPage: vi.fn(),
}));
vi.mock("../components/Popup/Popup.ts", () => ({
    showPopup: vi.fn((content: Node[]) => {
        ui.popupBox.replaceChildren(...content);
        ui.popupBox.classList.add("open");
    }),
    replacePopup: vi.fn((content: Node[]) => {
        ui.popupBox.replaceChildren(...content);
        ui.popupBox.classList.add("open");
    }),
    hidePopup: vi.fn(() => ui.popupBox.classList.remove("open")),
    showAlertPopup: vi.fn(),
    createPopupButton: (label: string, cls: string, click: () => void) => {
        const button = document.createElement("button");
        button.textContent = label;
        button.className = cls;
        button.addEventListener("click", click);
        return button;
    },
}));

function file(name = "slides.html"): File {
    return { name, text: async () => "<html><body><h1>Slides</h1></body></html>" } as File;
}

describe("browser HTML PDF route", () => {
    it.each([
        ["html", "pdf", 1, "https:", true],
        ["htm", "pdf", 1, "https:", true],
        ["HTML", "PDF", 1, "http:", true],
        ["html", "pdf", 2, "https:", false],
        ["md", "pdf", 1, "https:", false],
        ["pptx", "pdf", 1, "https:", false],
        ["png", "pdf", 1, "https:", false],
        ["html", "png", 1, "https:", false],
        ["html", "pdf", 1, "app:", false],
    ] as const)("%s to %s, %i file(s), %s uses preflight: %s", (from, to, count, protocol, expected) => {
        expect(isBrowserHtmlPdfExport(from, to, count, protocol)).toBe(expected);
    });
});

describe("HTML PDF export sheet", () => {
    const print = vi.fn();
    const dispose = vi.fn();

    beforeEach(() => {
        document.body.innerHTML = '<div id="popup"></div>';
        ui.popupBox = document.getElementById("popup")!;
        print.mockClear();
        dispose.mockClear();
        vi.mocked(preparePrintPage).mockResolvedValue({ print, dispose });
    });

    it("prepares before showing the action and prints only when pressed", async () => {
        const fallback = vi.fn();
        await showHtmlPdfExport(file(), fallback);
        expect(preparePrintPage).toHaveBeenCalledOnce();
        expect(print).not.toHaveBeenCalled();
        const button = [...ui.popupBox.querySelectorAll("button")]
            .find(b => b.textContent === "Open Save as PDF");
        expect(button).toBeDefined();
        button!.click();
        expect(print).toHaveBeenCalledOnce();
        expect(fallback).not.toHaveBeenCalled();
        expect(ui.popupBox.textContent).not.toMatch(/PDF ready|has been saved/i);
    });

    it("the explicit image fallback leaves printing and resumes the original conversion", async () => {
        const fallback = vi.fn();
        await showHtmlPdfExport(file(), fallback);
        const button = [...ui.popupBox.querySelectorAll("button")]
            .find(b => b.textContent === "Create image-based PDF instead");
        button!.click();
        expect(fallback).toHaveBeenCalledOnce();
        expect(print).not.toHaveBeenCalled();
        expect(dispose).toHaveBeenCalledOnce();
    });

    it("closing the sheet disposes the prepared frame", async () => {
        await showHtmlPdfExport(file(), vi.fn());
        const button = [...ui.popupBox.querySelectorAll("button")]
            .find(b => b.textContent === "Done");
        button!.click();
        expect(dispose).toHaveBeenCalledOnce();
    });
});
