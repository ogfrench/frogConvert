import * as pdfjsLib from 'pdfjs-dist';

// @ts-ignore - Vite handled worker
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';

let isSetup = false;

/**
 * Initializes the PDF.js worker globally.
 * This is more robust for Safari than passing explicit worker instances.
 */
export function setupPDFWorker(): void {
  if (isSetup) return;

  const nativeWorker = new PdfWorker();
  
  // Set both workerPort and workerSrc to satisfy PDF.js's internal checks in Safari
  pdfjsLib.GlobalWorkerOptions.workerPort = nativeWorker;
  
  // High-performance module workers are preferred
  isSetup = true;
}
