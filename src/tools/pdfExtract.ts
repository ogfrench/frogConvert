import { PDFDocument } from 'pdf-lib';
import type { FileData } from '../core/FormatHandler/FormatHandler.ts';

/**
 * Extract specific pages from a PDF.
 * @param bytes Source PDF bytes.
 * @param pageNums 1-indexed page numbers to extract.
 * @param baseName Base name for output files (without extension).
 * @param groupAsOne When true, all pages are combined into a single PDF.
 */
export async function extract(
  bytes: Uint8Array,
  pageNums: number[],
  baseName: string,
  groupAsOne = false
): Promise<FileData[]> {
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true });

  if (groupAsOne) {
    const output = await PDFDocument.create();
    const copied = await output.copyPages(source, pageNums.map(n => n - 1));
    for (const page of copied) output.addPage(page);
    const outputBytes = await output.save();
    const suffix = pageNums.length === source.getPageCount()
      ? '' : `_pages_${pageNums[0]}-${pageNums[pageNums.length - 1]}`;
    return [{ name: `${baseName}${suffix}.pdf`, bytes: new Uint8Array(outputBytes) }];
  }

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
