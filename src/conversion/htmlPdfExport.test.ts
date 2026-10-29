import { beforeEach, describe, expect, it, vi } from "vitest";
import { ui } from "../components/store/store.ts";
import { preparePrintPage } from "./printPage.ts";
import { clearConvertSession } from "../components/persistence/convertPersist.ts";
import { isBrowserHtmlPdfExport, showHtmlPdfExport } from "./htmlPdfExport.ts";

vi.mock("../components/persistence/convertPersist.ts", () => ({
    clearConvertSession: vi.fn(),
}));
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
        print.mockReset();
        dispose.mockReset();
        vi.mocked(clearConvertSession).mockClear();
        vi.mocked(preparePrintPage).mockReset();
        vi.mocked(preparePrintPage).mockResolvedValue({ print, dispose });
    });

    it("prepares before showing the action and prints only when pressed", async () => {
        const fallback = vi.fn();
        await showHtmlPdfExport(file(), fallback);
        expect(preparePrintPage).toHaveBeenCalledOnce();
        expect(print).not.toHaveBeenCalled();
        const notice = ui.popupBox.querySelector(".html-pdf-export-notice");
        expect(notice).not.toBeNull();
        expect(notice?.textContent).toContain('Tap "Open print options" below.');
        expect(notice?.textContent).toContain('In the next screen, choose "Save as PDF".');
        expect(notice?.textContent).toContain('Tap "Save" to save your file.');
        expect(notice?.textContent).toContain('No printer needed.');
        expect(notice?.textContent).not.toMatch(/select and copy text/i);
        expect(ui.popupBox.textContent).not.toContain("picture-only");
        expect([...ui.popupBox.querySelectorAll("button")].map(b => b.textContent)).toEqual([
            "Open print options", "Done",
        ]);
        expect(notice?.textContent).not.toMatch(/native page layout|A4 fallback/i);
        const button = [...ui.popupBox.querySelectorAll("button")]
            .find(b => b.textContent === "Open print options");
        expect(button).toBeDefined();
        button!.click();
        expect(print).toHaveBeenCalledOnce();
        expect(ui.popupBox.textContent).toContain("Didn't save it?");
        expect(ui.popupBox.textContent).toContain('Tap "Open print options" below to try again.');
        expect(fallback).not.toHaveBeenCalled();
        expect(ui.popupBox.textContent).not.toMatch(/PDF ready|has been saved/i);
        [...ui.popupBox.querySelectorAll("button")].find(b => b.textContent === "Done")!.click();
        expect(clearConvertSession).toHaveBeenCalledOnce();
    });

    it("offers the picture-only fallback only when preparing the print view fails", async () => {
        const fallback = vi.fn();
        vi.mocked(preparePrintPage).mockRejectedValueOnce(new Error("Cannot create print iframe"));
        await showHtmlPdfExport(file(), fallback);
        expect(ui.popupBox.textContent).toContain("Print view unavailable");
        expect(ui.popupBox.textContent).toContain("text can't be selected or copied");
        const button = [...ui.popupBox.querySelectorAll("button")]
            .find(b => b.textContent === "Download picture-only PDF");
        expect(button).toBeDefined();
        button!.click();
        expect(fallback).toHaveBeenCalledOnce();
        expect(print).not.toHaveBeenCalled();
        expect(clearConvertSession).not.toHaveBeenCalled();
    });

    it("shows the fallback if the browser throws when opening the print dialog", async () => {
        const fallback = vi.fn();
        print.mockImplementationOnce(() => { throw new Error("Print blocked"); });
        await showHtmlPdfExport(file(), fallback);
        [...ui.popupBox.querySelectorAll("button")]
            .find(b => b.textContent === "Open print options")!.click();
        expect(ui.popupBox.textContent).toContain("Print view unavailable");
        expect(dispose).toHaveBeenCalledOnce();
        [...ui.popupBox.querySelectorAll("button")]
            .find(b => b.textContent === "Download picture-only PDF")!.click();
        expect(fallback).toHaveBeenCalledOnce();
        expect(clearConvertSession).not.toHaveBeenCalled();
    });

    it("prevents duplicate export sheets until the first one closes", async () => {
        const fallback = vi.fn();
        await showHtmlPdfExport(file(), fallback);
        await showHtmlPdfExport(file("other.html"), fallback);
        expect(preparePrintPage).toHaveBeenCalledOnce();
        const done = [...ui.popupBox.querySelectorAll("button")]
            .find(b => b.textContent === "Done")!;
        done.click();
        expect(dispose).toHaveBeenCalledOnce();
        await showHtmlPdfExport(file("other.html"), fallback);
        expect(preparePrintPage).toHaveBeenCalledTimes(2);
        [...ui.popupBox.querySelectorAll("button")].find(b => b.textContent === "Done")!.click();
    });

    it("cleans up and allows retry when another component closes the popup", async () => {
        await showHtmlPdfExport(file(), vi.fn());
        ui.popupBox.classList.remove("open");
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(dispose).toHaveBeenCalledOnce();

        await showHtmlPdfExport(file("retry.html"), vi.fn());
        expect(preparePrintPage).toHaveBeenCalledTimes(2);
        [...ui.popupBox.querySelectorAll("button")].find(b => b.textContent === "Done")!.click();
    });

    it("cleans up when another flow replaces the open popup", async () => {
        await showHtmlPdfExport(file(), vi.fn());
        ui.popupBox.replaceChildren(document.createElement("aside"));
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(dispose).toHaveBeenCalledOnce();

        await showHtmlPdfExport(file("retry.html"), vi.fn());
        expect(preparePrintPage).toHaveBeenCalledTimes(2);
        [...ui.popupBox.querySelectorAll("button")].find(b => b.textContent === "Done")!.click();
    });

    it("releases the guard when a pending file read is replaced", async () => {
        let finishRead!: (source: string) => void;
        const delayed = new Promise<string>(resolve => { finishRead = resolve; });
        const first = showHtmlPdfExport({ name: "slow.html", text: () => delayed } as File, vi.fn());
        ui.popupBox.replaceChildren(document.createElement("aside"));
        await new Promise(resolve => setTimeout(resolve, 0));

        await showHtmlPdfExport(file("retry.html"), vi.fn());
        expect(preparePrintPage).toHaveBeenCalledOnce();
        finishRead("<html><body>Old file</body></html>");
        await first;
        expect(preparePrintPage).toHaveBeenCalledOnce();
        [...ui.popupBox.querySelectorAll("button")].find(b => b.textContent === "Done")!.click();
    });

    it("disposes a late print frame after its sheet is replaced", async () => {
        let finishPrepare!: (view: { print: typeof print; dispose: typeof dispose }) => void;
        vi.mocked(preparePrintPage).mockImplementationOnce(() =>
            new Promise(resolve => { finishPrepare = resolve; }),
        );
        const first = showHtmlPdfExport(file("slow.html"), vi.fn());
        await vi.waitFor(() => expect(preparePrintPage).toHaveBeenCalledOnce());
        ui.popupBox.replaceChildren(document.createElement("aside"));
        await new Promise(resolve => setTimeout(resolve, 0));
        finishPrepare({ print, dispose });
        await first;
        expect(dispose).toHaveBeenCalledOnce();

        await showHtmlPdfExport(file("retry.html"), vi.fn());
        expect(preparePrintPage).toHaveBeenCalledTimes(2);
        [...ui.popupBox.querySelectorAll("button")].find(b => b.textContent === "Done")!.click();
    });

    it("closing the sheet disposes the prepared frame", async () => {
        await showHtmlPdfExport(file(), vi.fn());
        const button = [...ui.popupBox.querySelectorAll("button")]
            .find(b => b.textContent === "Done");
        button!.click();
        expect(dispose).toHaveBeenCalledOnce();
    });
});
