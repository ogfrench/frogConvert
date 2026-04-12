import { PDFDocument, degrees } from 'pdf-lib';
import type { FileData } from '../core/FormatHandler/FormatHandler.ts';
import type { PageEntry, SourceFile } from './types.ts';

/**
 * Create a new PDF with pages arranged according to the given PageEntry order.
 * Deleted pages should be filtered out before calling this function.
 */
export async function organize(
  sourceFiles: SourceFile[],
  pages: PageEntry[]
): Promise<FileData> {
  // Load each source PDF once
  const loaded = new Map<number, PDFDocument>();
  for (const sf of sourceFiles) {
    if (!loaded.has(sf.id)) {
      loaded.set(sf.id, await PDFDocument.load(sf.bytes, { ignoreEncryption: true }));
    }
  }

  const output = await PDFDocument.create();

  for (const page of pages) {
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
  let name = 'organized.pdf';
  if (uniqueSources.size === 1) {
    const sf = sourceFiles.find(f => f.id === [...uniqueSources][0]);
    if (sf) {
      const dot = sf.name.lastIndexOf('.');
      const base = dot > 0 ? sf.name.slice(0, dot) : sf.name;
      name = `${base}_organized.pdf`;
    }
  }

  return { name, bytes: new Uint8Array(bytes) };
}
