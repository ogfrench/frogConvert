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

/** What we can learn about a PDF cheaply, or `null` if it is not readable. */
interface PdfShape {
    pages: number;
    encrypted: boolean;
}

async function readPdfShape(bytes: Uint8Array): Promise<PdfShape | null> {
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
        return { pages: doc.getPageCount(), encrypted: doc.isEncrypted };
    } catch {
        return null;
    }
}

/**
 * Pages in a PDF, or `null` when the bytes cannot be read as one.
 *
 * `null` is a real answer rather than an error: the caller has to distinguish
 * "this document has no pages" from "this is not a document I can check", and
 * those lead to different decisions.
 */
export async function pdfPageCount(bytes: Uint8Array): Promise<number | null> {
    return (await readPdfShape(bytes))?.pages ?? null;
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
    const [before, after] = await Promise.all([readPdfShape(input), readPdfShape(output)]);

    if (before === null) {
        throw new Error(
            `Couldn't compress ${fileName}. The PDF appears to be damaged, so the ` +
            "result couldn't be checked against the original.",
        );
    }
    // Page count cannot see this one, which is why it gets its own check.
    //
    // Ghostscript has no password, so it reads an encrypted document's page
    // tree, fails to decrypt the content streams, and writes out that many
    // *empty* pages. The result is a structurally valid, no-longer-encrypted
    // PDF with exactly the right page count - so `after < before` is false and
    // every other guard here passes it.
    //
    // Measured on a LibreOffice password-protected file: 12,783 bytes and one
    // page of text became 2,188 bytes, one blank page, `isEncrypted` false and
    // zero extractable characters, reported to the user as an 83% saving. That
    // is the blank-page substitution this module exists to stop, wearing the
    // one disguise page count cannot see through - and it strips the document's
    // encryption on the way past, which no one asked for.
    if (before.encrypted) {
        throw new Error(
            `Couldn't compress ${fileName}. It's password-protected, so its contents ` +
            "can't be read - the original was kept, still encrypted.",
        );
    }
    if (after === null) {
        throw new Error(`Couldn't compress ${fileName}. The result wasn't a readable PDF.`);
    }
    if (after.pages < before.pages) {
        throw new Error(
            `Couldn't compress ${fileName}. The result lost pages ` +
            `(${before.pages} -> ${after.pages}), so the original was kept.`,
        );
    }
}
