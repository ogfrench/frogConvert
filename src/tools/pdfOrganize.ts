import { PDFDocument, degrees } from 'pdf-lib';
import { loadEditablePdf } from './pdfSource.ts';
import type { FileData } from '../core/FormatHandler/FormatHandler.ts';
import type { CorePageEntry, CoreSourceFile } from './types.ts';
import { checkpoint } from './cancellation.ts';
import { timestampForFilename } from '../conversion/download.ts';

// Yield cadence for the page loop below - checked every Nth page so the yield
// cost stays negligible on a small document (see src/tools/cancellation.ts).
const CHECKPOINT_INTERVAL = 10;

/**
 * Create a new PDF with pages arranged according to the given PageEntry order.
 * Deleted pages should be filtered out before calling this function.
 */
export async function organize(
  sourceFiles: CoreSourceFile[],
  pages: CorePageEntry[],
  signal?: AbortSignal
): Promise<FileData> {
  // Load each source PDF once. Checkpointed per file because for a many-file
  // organize the loads *are* the slow phase - without this, Cancel does
  // nothing until every source has been parsed.
  const loaded = new Map<number, PDFDocument>();
  for (const sf of sourceFiles) {
    if (!loaded.has(sf.id)) {
      await checkpoint(signal);
      loaded.set(sf.id, await loadEditablePdf(sf.bytes, sf.name));
    }
  }

  const output = await PDFDocument.create();

  for (let i = 0; i < pages.length; i++) {
    if (i % CHECKPOINT_INTERVAL === 0) await checkpoint(signal);
    const page = pages[i];
    if (page.type === 'blank') {
      const w = page.blankPageSize?.width ?? 595.28;
      const h = page.blankPageSize?.height ?? 841.89;
      const blankPage = output.addPage([w, h]);
      if (page.rotation) blankPage.setRotation(degrees(page.rotation));
      continue;
    }
    const sourcePdf = loaded.get(page.sourceFileId);
    if (!sourcePdf) continue;
    // copyPages uses 0-indexed
    const [copied] = await output.copyPages(sourcePdf, [page.sourcePageNum - 1]);
    if (page.rotation) {
      const existing = copied.getRotation().angle;
      copied.setRotation(degrees((existing + page.rotation) % 360));
    }
    output.addPage(copied);
  }

  const bytes = await output.save();

  // Name based on number of real sources (exclude blank pages)
  const uniqueSources = new Set(pages.filter(p => p.type !== 'blank').map(p => p.sourceFileId));
  // Timestamped so a second organise does not collide with the first.
  const stamp = timestampForFilename();
  let name = `organized_pdfs-${stamp}.pdf`;
  if (uniqueSources.size === 1) {
    const sf = sourceFiles.find(f => f.id === [...uniqueSources][0]);
    if (sf) {
      const dot = sf.name.lastIndexOf('.');
      const base = dot > 0 ? sf.name.slice(0, dot) : sf.name;
      name = `${base}_organized_pdfs-${stamp}.pdf`;
    }
  }

  return { name, bytes: new Uint8Array(bytes) };
}
