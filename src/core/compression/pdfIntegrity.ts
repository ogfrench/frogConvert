import { PDFDocument } from "pdf-lib";

/**
 * Compression engine - the guard that a PDF pass did not eat the document.
 *
 * Ghostscript treats a damaged PDF as something to *recover*, not something to
 * refuse. Handed a truncated file it repairs what it can, exits 0, and writes a
 * perfectly valid PDF containing a single blank page. Every check the handlers
 * had passed that result straight through:
 *
 *  - `rc !== 0` - no, it succeeded, by its own definition of success
 *  - the `%PDF-` header - no, the blank page is a real PDF
 *  - the 98% keep-threshold - no, 2 KB is *wildly* under 98% of the input
 *
 * So the surface reported "99.8% saved" over a blank page. Measured on a
 * capgemini report truncated at 40 KB / 200 KB / 1 MB / 3 MB: every one came
 * back as the same 2,183-byte single blank page, reported as a success.
 * Someone who trusted that number and deleted the original lost the document.
 *
 * Page count is the right invariant because compression is not allowed to
 * change it - resampling images and rebuilding object streams leaves the page
 * tree alone. Verified across every real compression measured for this release:
 * 3 -> 3, 1 -> 1, 84 -> 84, 71 -> 71 pages, at every level. So this rejects the
 * blank-page substitution without touching a single case that works.
 */

/**
 * Pages in a PDF, or `null` when the bytes cannot be read as one.
 *
 * `null` is a real answer rather than an error: the caller has to distinguish
 * "this document has no pages" from "this is not a document I can check", and
 * those lead to different decisions.
 */
export async function pdfPageCount(bytes: Uint8Array): Promise<number | null> {
    try {
        const doc = await PDFDocument.load(bytes, {
            // A file we are only measuring does not need decrypting, and an
            // encrypted PDF still reports its page count.
            ignoreEncryption: true,
            // Real-world PDFs carry broken objects that no viewer minds. This
            // guard is about losing *pages*, so tolerate everything else.
            throwOnInvalidObject: false,
            updateMetadata: false,
        });
        return doc.getPageCount();
    } catch {
        return null;
    }
}

/**
 * Throws unless `output` still has every page `input` had.
 *
 * The unreadable-input case throws too, and deliberately. Ghostscript producing
 * a clean PDF from bytes no parser will touch is not a compression we can stand
 * behind - it is the exact shape of the blank-page substitution this exists to
 * stop. Refusing costs an unverifiable saving on an already-damaged file; the
 * caller passes the original through untouched, which is the honest outcome.
 */
export async function assertPdfPagesPreserved(
    input: Uint8Array,
    output: Uint8Array,
    fileName: string,
): Promise<void> {
    const [before, after] = await Promise.all([pdfPageCount(input), pdfPageCount(output)]);

    if (before === null) {
        throw new Error(
            `Couldn't compress ${fileName}. The PDF appears to be damaged, so the ` +
            "result couldn't be checked against the original.",
        );
    }
    if (after === null) {
        throw new Error(`Couldn't compress ${fileName}. The result wasn't a readable PDF.`);
    }
    if (after < before) {
        throw new Error(
            `Couldn't compress ${fileName}. The result lost pages ` +
            `(${before} -> ${after}), so the original was kept.`,
        );
    }
}
