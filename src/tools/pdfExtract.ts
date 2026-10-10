import { PDFDocument, degrees, type PDFPage } from 'pdf-lib';
import { loadEditablePdf } from './pdfSource.ts';
import type { FileData } from '../core/FormatHandler/FormatHandler.ts';
import { checkpoint } from './cancellation.ts';

// See src/tools/cancellation.ts - checked every Nth page/output so the yield
// cost stays negligible on a small document.
const CHECKPOINT_INTERVAL = 10;

/**
 * How many page numbers a combined output will spell out before it gives up and
 * counts them instead. Past this the name is longer than it is useful, and some
 * filesystems cap a component at 255 bytes.
 */
const MAX_LISTED_PAGES = 6;

/**
 * Reject a page that isn't in the document, before pdf-lib does.
 *
 * `copyPages` throws on an out-of-range index, but it throws from inside the
 * library about an internal lookup, so asking MCP for page 999 of a three-page
 * PDF produced a message about pdf-lib's object graph rather than about the
 * request. The schemas on the agent surfaces only check that the numbers are
 * positive integers - they cannot know the page count - so the check belongs
 * here, where the document is open and all three surfaces reach it.
 */
function assertPagesExist(pageNums: number[], pageCount: number): void {
    const bad = [...new Set(pageNums.filter(n => !Number.isInteger(n) || n < 1 || n > pageCount))];
    if (bad.length === 0) return;
    const plural = pageCount === 1 ? 'page' : 'pages';
    throw new Error(
        `${bad.length === 1 ? 'Page' : 'Pages'} ${bad.join(', ')} ` +
        `${bad.length === 1 ? 'does' : 'do'} not exist in this PDF, which has ${pageCount} ${plural}.`,
    );
}

/**
 * The part of a combined output's name that says which pages are in it.
 *
 * It used to be `_pages_${first}-${last}` over the array as given, which is a
 * range whether or not the selection is one: pages 1, 5 and 9 came back named
 * `_pages_1-9`, promising nine pages in a three-page file, and an unsorted
 * request produced the backwards `_pages_9-1`. A selection that happens to be
 * as long as the document also dropped the suffix entirely, so extracting
 * `[1, 1, 2]` from a three-page PDF was named as though it were the whole
 * thing.
 */
function pagesSuffix(pageNums: number[], pageCount: number): string {
    const unique = [...new Set(pageNums)].sort((a, b) => a - b);
    // Every page, so the name needs no qualifier. Safe to judge on length
    // alone: `assertPagesExist` has already confined them to 1..pageCount.
    if (unique.length === pageCount) return '';
    if (unique.length === 1) return `_page_${unique[0]}`;
    const isRange = unique[unique.length - 1] - unique[0] === unique.length - 1;
    if (isRange) return `_pages_${unique[0]}-${unique[unique.length - 1]}`;
    if (unique.length <= MAX_LISTED_PAGES) return `_pages_${unique.join('-')}`;
    return `_${unique.length}_pages`;
}

/**
 * Extract specific pages from a PDF.
 * @param bytes Source PDF bytes.
 * @param pageNums 1-indexed page numbers to extract.
 * @param baseName Base name for output files (without extension).
 * @param groupAsOne When true, all pages are combined into a single PDF.
 * @param rotations Optional extra clockwise rotation per entry of `pageNums`
 *   (0/90/180/270), added to each page's own. The PDF editor passes its
 *   Organize rotations; the agent surfaces have none to pass.
 */
export async function extract(
  bytes: Uint8Array,
  pageNums: number[],
  baseName: string,
  groupAsOne = false,
  signal?: AbortSignal,
  rotations?: number[],
): Promise<FileData[]> {
  const rotate = (page: PDFPage, i: number) => {
    const extra = rotations?.[i] ?? 0;
    if (extra) page.setRotation(degrees((page.getRotation().angle + extra) % 360));
  };
  const source = await loadEditablePdf(bytes);
  assertPagesExist(pageNums, source.getPageCount());

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
    copied.forEach((page, i) => { rotate(page, i); output.addPage(page); });
    const outputBytes = await output.save();
    const suffix = pagesSuffix(pageNums, source.getPageCount());
    return [{ name: `${baseName}${suffix}.pdf`, bytes: new Uint8Array(outputBytes) }];
  }

  const results: FileData[] = [];
  for (let i = 0; i < pageNums.length; i++) {
    if (i % CHECKPOINT_INTERVAL === 0) await checkpoint(signal);
    const pageNum = pageNums[i];
    const output = await PDFDocument.create();
    // copyPages uses 0-indexed
    const [copied] = await output.copyPages(source, [pageNum - 1]);
    rotate(copied, i);
    output.addPage(copied);
    const outputBytes = await output.save();
    results.push({
      name: `${baseName}_page_${pageNum}.pdf`,
      bytes: new Uint8Array(outputBytes),
    });
  }

  return results;
}
