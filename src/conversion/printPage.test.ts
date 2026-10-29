import { afterEach, describe, expect, it, vi } from "vitest";
import { createPrintButton, preparePrintPage } from "./printPage.ts";

describe("prepared HTML print view", () => {
    afterEach(() => {
        document.querySelectorAll("iframe").forEach(f => f.remove());
        vi.restoreAllMocks();
    });

    it("prepares a sandboxed, script-disabled frame before print is clicked", async () => {
        document.title = "frogConvert";
        const prepared = await preparePrintPage(
            '<!doctype html><html><head><style>@page{size:16in 9in}</style></head><body>Test</body></html>',
            "my-slides",
        );
        const frame = document.querySelector("iframe")!;
        expect(frame).not.toBeNull();
        expect(frame.getAttribute("sandbox")).toBe("allow-same-origin allow-modals");
        expect(frame.getAttribute("sandbox")).not.toContain("allow-scripts");
        expect(frame.contentDocument?.body.textContent).toContain("Test");
        expect(frame.contentDocument?.querySelector("style")?.textContent).toContain("16in 9in");

        const nativePrint = vi.fn();
        Object.defineProperty(frame.contentWindow!, "print", { value: nativePrint, configurable: true });
        prepared.print();
        expect(nativePrint).toHaveBeenCalledOnce();
        expect(document.title).toBe("frogConvert");
        prepared.dispose();
        expect(document.querySelector("iframe")).toBeNull();
    });

    it("does not leave a print frame behind after preparation errors", async () => {
        const prepared = await preparePrintPage("<html><body>Ready</body></html>", "ready");
        prepared.dispose();
        expect(() => prepared.print()).toThrow("no longer available");
    });

    it("prints a card's page inside the click, with no await before print()", async () => {
        const button = createPrintButton("<html><body>Card</body></html>", "card", "Print as PDF");
        await new Promise(resolve => setTimeout(resolve, 0));
        const frame = document.querySelector("iframe")!;
        const nativePrint = vi.fn();
        Object.defineProperty(frame.contentWindow!, "print", { value: nativePrint, configurable: true });
        button.click();
        expect(nativePrint).toHaveBeenCalledOnce();
    });

    it("keeps one card print frame: a newer card disposes the previous one", async () => {
        createPrintButton("<html><body>First</body></html>", "first", "Print as PDF");
        createPrintButton("<html><body>Second</body></html>", "second", "Print as PDF");
        await new Promise(resolve => setTimeout(resolve, 0));
        const frames = document.querySelectorAll("iframe");
        expect(frames).toHaveLength(1);
        expect(frames[0].contentDocument?.body.textContent).toBe("Second");
    });
});
