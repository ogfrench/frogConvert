import { createDancingFrog } from "../components/Frogsworth/DancingFrog.ts";
import { createPopupButton, hidePopup, replacePopup, showAlertPopup, showPopup } from "../components/Popup/Popup.ts";
import { ui } from "../components/store/store.ts";
import { shortenFileName } from "../components/utils/index.ts";
import { clearConvertSession } from "../components/persistence/convertPersist.ts";
import { preparePrintPage } from "./printPage.ts";

// A second Convert trigger must not create another printable iframe while the
// first export sheet remains open, even if the underlying button is clicked
// programmatically.
let exportSheetOpen = false;

/** This UI handoff is intentionally limited to one browser HTML document. */
export function isBrowserHtmlPdfExport(from: string, to: string, fileCount: number, protocol: string): boolean {
    return fileCount === 1
        && (from.toLowerCase() === "html" || from.toLowerCase() === "htm")
        && to.toLowerCase() === "pdf"
        && protocol !== "app:";
}

/**
 * Prepare a native browser print view before offering its action. The final
 * print() must run directly in the button click for mobile browser activation.
 * This is not a conversion success screen: the app cannot know whether the
 * system print dialog was completed or cancelled.
 */
export async function showHtmlPdfExport(file: File, onImagePdf: () => void): Promise<void> {
    if (exportSheetOpen) return;
    exportSheetOpen = true;
    const heading = document.createElement("h2");
    heading.textContent = "Preparing PDF export";
    const description = document.createElement("p");
    description.textContent = "Getting the document ready for browser printing…";

    let closed = false;
    let prepared: Awaited<ReturnType<typeof preparePrintPage>> | null = null;
    let observer: MutationObserver | null = null;
    let activeHeading: HTMLElement = heading;

    const dispose = () => {
        observer?.disconnect();
        observer = null;
        prepared?.dispose();
        prepared = null;
    };
    const abandon = () => {
        closed = true;
        exportSheetOpen = false;
        dispose();
    };
    const close = () => {
        abandon();
        hidePopup();
    };

    try {
        showPopup([heading, createDancingFrog(), description], false, close);
        // Observe from the first async operation: replacing the preparing
        // sheet must release the guard even if file.text() never settles.
        observer = new MutationObserver(() => {
            if (!ui.popupBox.classList.contains("open") || !activeHeading.isConnected) abandon();
        });
        observer.observe(ui.popupBox, {
            attributes: true,
            attributeFilter: ["class"],
            childList: true,
            subtree: true,
        });
        const title = file.name.replace(/\.html?$/i, "") || file.name;
        const source = await file.text();
        // Do not pull pdf-lib and the image renderer into the initial app shell.
        const { printableDocument } = await import("../handlers/svgForeignObject.ts");
        const html = printableDocument(source, title);
        if (closed || !heading.isConnected || !ui.popupBox.classList.contains("open")) {
            abandon();
            return;
        }

        prepared = await preparePrintPage(html, title);
        if (closed || !heading.isConnected || !ui.popupBox.classList.contains("open")) {
            abandon();
            return;
        }

        const h2 = document.createElement("h2");
        h2.textContent = "Save as PDF";
        const p = document.createElement("p");
        const name = document.createElement("b");
        name.textContent = shortenFileName(file.name, 32);
        p.append(name, " is ready for your browser's PDF printer.");

        const notice = document.createElement("div");
        notice.className = "convert-notice";
        const noticeTitle = document.createElement("span");
        noticeTitle.className = "convert-notice-title";
        noticeTitle.textContent = "Selectable text, native page layout";
        const noticeText = document.createElement("p");
        noticeText.className = "convert-notice-text";
        noticeText.textContent = "Choose Save as PDF in your browser's print dialog. The document's available print styles take precedence over the A4 fallback. Nothing is uploaded.";
        notice.append(noticeTitle, noticeText);

        const fallback = document.createElement("button");
        fallback.type = "button";
        fallback.className = "convert-notice-link";
        fallback.textContent = "Create image-based PDF instead";
        fallback.addEventListener("click", () => {
            close();
            onImagePdf();
        });
        notice.appendChild(fallback);

        const footer = document.createElement("div");
        footer.className = "popup-actions-footer";
        footer.appendChild(createPopupButton("Open Save as PDF", "btn-primary", () => {
            try {
                // Must not await anything between the click and print().
                prepared?.print();
                noticeText.textContent = "In the browser print dialog, choose Save as PDF. If you cancelled, you can open the dialog again.";
            } catch (error) {
                console.error("[html-pdf] print failed:", error);
                close();
                showAlertPopup("Unable to open print", "Your browser could not open its print dialog. Try again or choose an image-based PDF.");
            }
        }));
        footer.appendChild(createPopupButton("Done", "btn-secondary", () => {
            // The explicit Done action ends this export workflow. Dismissing
            // the dialog or cancelling OS printing does not prove success.
            void clearConvertSession();
            close();
        }));

        activeHeading = h2;
        replacePopup([h2, createDancingFrog(), p, notice, footer], false, close);
    } catch (error) {
        if (closed || !heading.isConnected) {
            abandon();
            return;
        }
        close();
        const h2 = document.createElement("h2");
        h2.textContent = "Print view unavailable";
        const p = document.createElement("p");
        p.textContent = "The browser couldn't prepare this page for printing. You can still generate an image-based PDF.";
        const footer = document.createElement("div");
        footer.className = "popup-actions-footer";
        footer.appendChild(createPopupButton("Create image-based PDF", "btn-primary", () => {
            hidePopup();
            onImagePdf();
        }));
        footer.appendChild(createPopupButton("Done", "btn-secondary", hidePopup));
        showPopup([h2, p, footer]);
        console.error("[html-pdf] could not prepare print view:", error);
    }
}
