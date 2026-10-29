import { waitAtMost } from "../core/utils/waitAtMost.ts";

/*
 * The browser's print dialog, for Print, then Save as PDF.
 *
 * A web page has no way to make a PDF with real text itself: the browser's
 * PDF printer is only reachable through this dialog (the desktop app calls it
 * directly). The page carries its own print instructions (A4, backgrounds on;
 * see printableDocument), so the user only picks "Save as PDF" and saves.
 *
 * The page goes into a hidden frame with scripts off. It is already
 * sanitized; the sandbox is the second lock. `allow-modals` is what lets a
 * sandboxed frame open the print dialog at all.
 */

export type PreparedPrintPage = {
    print: () => void;
    dispose: () => void;
};

/**
 * Prepare the isolated print frame before the user presses the final button.
 * Mobile browsers may block print() when it runs after asynchronous work has
 * lost the user's activation. The returned print method is synchronous.
 *
 * The caller owns the frame and must dispose it when its export sheet closes.
 */
export async function preparePrintPage(html: string, title: string): Promise<PreparedPrintPage> {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-same-origin allow-modals");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    // Not display:none or visibility:hidden: some browsers print nothing then.
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    document.body.appendChild(frame);

    let disposed = false;
    const dispose = () => {
        if (disposed) return;
        disposed = true;
        frame.remove();
    };

    try {
        const doc = frame.contentDocument!;
        doc.open();
        doc.write(html);
        doc.close();

        // Capped: a print dialog that never opens is worse than one a moment early.
        const images = Array.from(doc.images).filter(img => !img.complete);
        await waitAtMost(Promise.all(images.map(img => new Promise(resolve => {
            img.addEventListener("load", resolve);
            img.addEventListener("error", resolve);
        }))), 10_000);
        await waitAtMost(doc.fonts?.ready, 10_000);

        return {
            dispose,
            print: () => {
                if (disposed) throw new Error("The print view is no longer available.");
                // Chrome suggests the file name from the top page's title, not the frame's.
                const previousTitle = document.title;
                document.title = title;
                try {
                    frame.contentWindow!.focus();
                    frame.contentWindow!.print();
                } finally {
                    document.title = previousTitle;
                }
            },
        };
    } catch (error) {
        dispose();
        throw error;
    }
}

// One result card offers printing at a time; a newer card replaces the frame.
let cardPage: Promise<PreparedPrintPage | null> | null = null;

/**
 * A result-card button that prints `html`. The page is prepared when the
 * button is made, so the click can call print() before any await.
 */
export function createPrintButton(html: string, title: string, label: string): HTMLButtonElement {
    void cardPage?.then(page => page?.dispose());
    const pending = preparePrintPage(html, title).catch(error => {
        console.error("[print] could not prepare print view:", error);
        return null;
    });
    cardPage = pending;
    let page: PreparedPrintPage | null = null;
    void pending.then(p => { page = p; });

    const button = document.createElement("button");
    button.type = "button";
    button.className = "convert-notice-link";
    button.textContent = label;
    let waiting = false;
    button.addEventListener("click", () => {
        if (page) {
            page.print();
            return;
        }
        // Still preparing: print once ready. A phone may refuse this late call.
        if (waiting) return;
        waiting = true;
        void pending.then(p => p?.print()).finally(() => { waiting = false; });
    });
    return button;
}
