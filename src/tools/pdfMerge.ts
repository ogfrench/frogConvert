import { PDFDocument } from 'pdf-lib';
import type { FileData } from '../core/FormatHandler/FormatHandler.ts';
import type { CoreSourceFile } from './types.ts';
import { checkpoint } from './cancellation.ts';
import { timestampForFilename } from '../conversion/download.ts';

/**
 * Merge multiple PDFs into a single PDF, concatenating pages in array order.
 */
export async function merge(files: CoreSourceFile[], signal?: AbortSignal): Promise<FileData> {
  const output = await PDFDocument.create();

  for (const file of files) {
    await checkpoint(signal);
    const source = await PDFDocument.load(file.bytes, { ignoreEncryption: true });
    const indices = source.getPageIndices();
    const copied = await output.copyPages(source, indices);
    for (const page of copied) {
      output.addPage(page);
    }
  }

  const bytes = await output.save();
  // Timestamped, like every zip this app produces. Without it a second merge
  // hands back the identical filename and the browser silently appends "(1)" -
  // so a folder ends up holding merged_pdfs.pdf, merged_pdfs_1.pdf and no way
  // to tell which is which. The zip outputs have carried a stamp for a while;
  // the single-document outputs were simply missed.
  const stamp = timestampForFilename();
  const name = files.length === 2
    ? `${stripExt(files[0].name)}_merged_pdfs-${stamp}.pdf`
    : `merged_pdfs-${stamp}.pdf`;

  return { name, bytes: new Uint8Array(bytes) };
}

function stripExt(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(0, dot) : filename;
}
