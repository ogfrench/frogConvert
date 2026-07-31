import { PDFDocument } from 'pdf-lib';
import type { FileData } from '../core/FormatHandler/FormatHandler.ts';
import { checkpoint } from './cancellation.ts';

// See src/tools/cancellation.ts - checked every Nth page/output so the yield
// cost stays negligible on a small document.
const CHECKPOINT_INTERVAL = 10;

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
  groupAsOne = false,
  signal?: AbortSignal
): Promise<FileData[]> {
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true });

  if (groupAsOne) {
    const output = await PDFDocument.create();
    await checkpoint(signal);
    // Deliberately one `copyPages` call rather than a per-page loop with a
    // checkpoint inside it. pdf-lib builds a fresh object copier per call, so
    // it deduplicates shared resources *within* a call but never *across*
    // calls: splitting this loop gives every page its own copy of the shared
    // font or letterhead image. Measured on 30 pages sharing one image, that
    // is a 132% larger output. Coarser cancellation is the cheaper trade -
    // the `save()` below dominates the runtime anyway.
    const copied = await output.copyPages(source, pageNums.map(n => n - 1));
    for (const page of copied) output.addPage(page);
    const outputBytes = await output.save();
    const suffix = pageNums.length === source.getPageCount()
      ? '' : `_pages_${pageNums[0]}-${pageNums[pageNums.length - 1]}`;
    return [{ name: `${baseName}${suffix}.pdf`, bytes: new Uint8Array(outputBytes) }];
  }

  const results: FileData[] = [];
  for (let i = 0; i < pageNums.length; i++) {
    if (i % CHECKPOINT_INTERVAL === 0) await checkpoint(signal);
    const pageNum = pageNums[i];
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
