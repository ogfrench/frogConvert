import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

// Cache loaded PDF documents so we don't reload the same PDF for every page.
const docCache = new Map<Uint8Array, PDFDocumentProxy>();

/**
 * Render a single page of a PDF as a thumbnail image.
 * Caches the PDF document so subsequent pages render from memory.
 * Must run on the main thread (uses canvas).
 * @returns data:image/png URL
 */
export async function renderPageThumbnail(
  pdfBytes: Uint8Array,
  pageNum: number,
  maxWidth = 150
): Promise<string> {
  let pdf = docCache.get(pdfBytes);
  if (!pdf) {
    pdf = await pdfjsLib.getDocument({
      data: pdfBytes.slice(),
      isEvalSupported: false,
      isOffscreenCanvasSupported: false,
    }).promise;
    docCache.set(pdfBytes, pdf);
  }

  const page = await pdf.getPage(pageNum);
  const unscaled = page.getViewport({ scale: 1 });
  const scale = maxWidth / unscaled.width;
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  await page.render({ canvas, viewport }).promise;
  const url = canvas.toDataURL('image/png');

  page.cleanup();
  return url;
}

/**
 * Clear all cached PDF documents. Call on workspace reset.
 */
export function clearThumbnailCache() {
  for (const pdf of docCache.values()) {
    pdf.destroy();
  }
  docCache.clear();
}

/**
 * Check if the current browser is Safari (where pdfjs-dist doesn't work).
 */
export function isSafari(): boolean {
  return /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
}
