import { PDFDocument } from 'pdf-lib';

/**
 * Loading a PDF that is about to be *edited*, as opposed to merely measured.
 *
 * Every tool here used to call `PDFDocument.load(bytes, { ignoreEncryption:
 * true })` directly, and that flag does not do what the call sites assumed. It
 * suppresses the throw, so the document loads and reports a correct page count -
 * but pdf-lib has no password, so the content streams stay encrypted. Copy those
 * pages into a new document and what lands is a page of the right size with
 * nothing on it.
 *
 * Measured, merging a LibreOffice password-protected file with a 4-page
 * document: the output had all 5 pages, pages 2-5 carried 3,930 / 3,953 / 3,953
 * / 2,635 characters, and page 1 - the protected one - carried **zero**. No
 * error, no warning, and a plausible-looking file to save over the original.
 *
 * Measuring a PDF is different and still uses the flag on purpose: page count
 * reads fine through encryption, and `pdfIntegrity` needs exactly that to catch
 * the compression side of this same defect.
 */
export async function loadEditablePdf(
    bytes: Uint8Array,
    fileName = 'This PDF',
): Promise<PDFDocument> {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    if (doc.isEncrypted) {
        throw new Error(
            `${fileName} is password-protected, so its pages can't be read. ` +
            'Remove the password and try again.',
        );
    }
    return doc;
}
