import { PDFDocument } from 'pdf-lib';
import type { FileData } from '../core/FormatHandler/FormatHandler.ts';
import type { CoreSourceFile } from './types.ts';

/**
 * Merge multiple PDFs into a single PDF, concatenating pages in array order.
 */
export async function merge(files: CoreSourceFile[]): Promise<FileData> {
  const output = await PDFDocument.create();

  for (const file of files) {
    const source = await PDFDocument.load(file.bytes, { ignoreEncryption: true });
    const indices = source.getPageIndices();
    const copied = await output.copyPages(source, indices);
    for (const page of copied) {
      output.addPage(page);
    }
  }

  const bytes = await output.save();
  const name = files.length === 2
    ? `${stripExt(files[0].name)}_merged.pdf`
    : 'merged.pdf';

  return { name, bytes: new Uint8Array(bytes) };
}

function stripExt(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(0, dot) : filename;
}
