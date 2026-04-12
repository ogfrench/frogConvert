import { PDFDocument } from 'pdf-lib';
import type { FileData } from '../core/FormatHandler/FormatHandler.ts';

/**
 * Extract specific pages from a PDF into individual single-page PDFs.
 * @param bytes Source PDF bytes.
 * @param pageNums 1-indexed page numbers to extract.
 * @param baseName Base name for output files (without extension).
 */
export async function split(
  bytes: Uint8Array,
  pageNums: number[],
  baseName: string
): Promise<FileData[]> {
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const results: FileData[] = [];

  for (const pageNum of pageNums) {
    const output = await PDFDocument.create();
    // copyPages uses 0-indexed
    const [copied] = await output.copyPages(source, [pageNum - 1]);
    output.addPage(copied);
    const outputBytes = await output.save();
    results.push({
      name: `${baseName}_page_${pageNum}.pdf`,
      bytes: new Uint8Array(outputBytes),
    });
  }

  return results;
}
