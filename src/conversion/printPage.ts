import { waitAtMost } from "../core/utils/waitAtMost.ts";

/**
 * Open the browser's print dialog for a page, for Print, then Save as PDF.
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
/**
 * Prepare the isolated print frame before the user presses the final button.
 * Mobile browsers may block print() when it runs after asynchronous work has
 * lost the user's activation. The returned print method is synchronous.
 *
 * The caller owns the frame and must dispose it when its export sheet closes.
 */
export async function preparePrintPage(html: string, title: string): Promise<{
    print: () => void;
    dispose: () => void;
}> {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-same-origin allow-modals");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
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
                // Keep print() on the same synchronous user-gesture stack.
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

let printing = false;

export async function printPage(html: string, title: string): Promise<void> {
    // A second click while the dialog is opening opened a second dialog.
    if (printing) return;
    printing = true;
    try {
        await openPrintDialog(html, title);
    } finally {
        printing = false;
    }
}

async function openPrintDialog(html: string, title: string): Promise<void> {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-same-origin allow-modals");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    // Not display:none or visibility:hidden: some browsers print nothing then.
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    document.body.appendChild(frame);

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

    // Chrome suggests the file name from the top page's title, not the frame's.
    const appTitle = document.title;
    document.title = title;
    let removed = false;
    const remove = () => {
        if (removed) return;
        removed = true;
        frame.remove();
    };
    const win = frame.contentWindow!;
    win.addEventListener("afterprint", () => setTimeout(remove, 0));
    // Chrome and Firefox return from print() once the dialog closes; Safari
    // may return first and still be printing, so the frame stays a while.
    setTimeout(remove, 5 * 60_000);
    win.focus();
    try {
        win.print();
    } finally {
        document.title = appTitle;
    }
}
