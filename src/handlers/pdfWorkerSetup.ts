import * as pdfjsLib from 'pdfjs-dist';

let worker: pdfjsLib.PDFWorker | null = null;

/**
 * Returns a cached PDFWorker instance initialized with a module worker.
 * This bypasses Safari's issues with auto-detecting GlobalWorkerOptions.workerSrc.
 */
export function getPDFWorker(): pdfjsLib.PDFWorker {
  if (!worker) {
    const nativeWorker = new Worker(
      new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url),
      { type: 'module' }
    );
    worker = new pdfjsLib.PDFWorker({
      port: nativeWorker as any
    });
  }
  return worker;
}
