import type { PDFDocumentProxy } from 'pdfjs-dist';

const _isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

let pdfjsLib: typeof import('pdfjs-dist') | null = null;
let pdfjsReady: Promise<void> | null = null;
function ensurePdfjs(): Promise<void> {
  if (!pdfjsReady) {
    pdfjsReady = import('pdfjs-dist').then(async (lib) => {
      pdfjsLib = lib;
      const { default: workerSrc } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      lib.GlobalWorkerOptions.workerSrc = workerSrc;
    });
  }
  return pdfjsReady;
}

const DOC_CACHE_MAX = 5;
const docCache = new Map<Uint8Array, PDFDocumentProxy>();
let sharedCanvas: HTMLCanvasElement | null = null;

/**
 * Render a single page of a PDF as a thumbnail image.
 * @returns data:image/png URL, or '' if pdfjs failed to load
 */
export async function renderPageThumbnail(
  pdfBytes: Uint8Array,
  pageNum: number,
  maxWidth = 150
): Promise<string> {
  await ensurePdfjs();
  if (!pdfjsLib) return '';

  let pdf = docCache.get(pdfBytes);
  if (pdf) {
    // Re-insert to move to MRU position (Map iterates in insertion order).
    docCache.delete(pdfBytes);
    docCache.set(pdfBytes, pdf);
  } else {
    pdf = await pdfjsLib.getDocument({
      data: pdfBytes.slice(),
      isEvalSupported: false,
      isOffscreenCanvasSupported: false,
    }).promise;
    docCache.set(pdfBytes, pdf);
    if (docCache.size > DOC_CACHE_MAX) {
      const oldestKey = docCache.keys().next().value as Uint8Array;
      docCache.get(oldestKey)?.destroy();
      docCache.delete(oldestKey);
    }
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
  if (sharedCanvas) {
    sharedCanvas.width = 0;
    sharedCanvas.height = 0;
  }
}

/**
 * Fallback thumbnail when real rendering fails.
 * Reads the current theme to pick appropriate stroke colors.
 */
export function mockPageThumb(): string {
  const dark = document.documentElement.classList.contains('dark');
  const stroke = dark ? '#555' : '#bbb';
  const line = dark ? '#444' : '#ccc';
  return `data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="212" viewBox="0 0 150 212">' +
    `<path d="M45 46h40l20 20v100H45z" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linejoin="round"/>` +
    `<path d="M85 46v20h20" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<line x1="58" y1="90" x2="92" y2="90" stroke="${line}" stroke-width="1"/>` +
    `<line x1="58" y1="102" x2="88" y2="102" stroke="${line}" stroke-width="1"/>` +
    `<line x1="58" y1="114" x2="82" y2="114" stroke="${line}" stroke-width="1"/>` +
    '</svg>'
  )}`;
}

/**
 * Check if the current browser is Safari.
 */
export function isSafari(): boolean {
  return _isSafari;
}
