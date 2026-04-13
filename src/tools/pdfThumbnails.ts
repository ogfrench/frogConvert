import type { PDFDocumentProxy } from 'pdfjs-dist';

const _isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

// Lazy-load pdfjs-dist only on non-Safari browsers
let pdfjsLib: typeof import('pdfjs-dist') | null = null;
const pdfjsReady: Promise<void> = _isSafari
  ? Promise.resolve()
  : import('pdfjs-dist').then(async (lib) => {
      pdfjsLib = lib;
      const { default: workerSrc } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      lib.GlobalWorkerOptions.workerSrc = workerSrc;
    });

// Cache loaded PDF documents so we don't reload the same PDF for every page.
const docCache = new Map<Uint8Array, PDFDocumentProxy>();
// Reuse a single canvas for all thumbnail renders to avoid repeated allocation/GC.
let sharedCanvas: HTMLCanvasElement | null = null;

/**
 * Render a single page of a PDF as a thumbnail image.
 * On Safari, returns an empty string (thumbnails unsupported).
 * @returns data:image/png URL, or '' on Safari
 */
export async function renderPageThumbnail(
  pdfBytes: Uint8Array,
  pageNum: number,
  maxWidth = 150
): Promise<string> {
  await pdfjsReady;
  if (!pdfjsLib) return '';

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

  if (!sharedCanvas) sharedCanvas = document.createElement('canvas');
  sharedCanvas.width = viewport.width;
  sharedCanvas.height = viewport.height;

  await page.render({ canvas: sharedCanvas, viewport }).promise;
  const url = sharedCanvas.toDataURL('image/png');

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
  return _isSafari;
}
