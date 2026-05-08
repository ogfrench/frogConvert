import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

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

// Serialise all render calls. `renderPageThumbnail` uses a single shared
// canvas; parallel callers would race on its bitmap. Also helps on Safari
// where concurrent WebGL-backed canvases exceed the per-page context cap.
// Each call appends to the queue and awaits the previous.
let renderQueue: Promise<unknown> = Promise.resolve();

/**
 * Queue a render against a (potentially cached) page. Owns pdfjs init, the
 * doc-cache LRU, the global render queue, and `page.cleanup()`. Callers
 * supply only the per-page work (rasterise → return T). Returns null iff
 * pdfjs failed to load.
 */
async function withQueuedPage<T>(
  pdfBytes: Uint8Array,
  pageNum: number,
  fn: (page: PDFPageProxy) => Promise<T>
): Promise<T | null> {
  await ensurePdfjs();
  if (!pdfjsLib) return null;
  const lib = pdfjsLib;
  const run = async (): Promise<T> => {
    let pdf = docCache.get(pdfBytes);
    if (pdf) {
      // Re-insert to move to MRU position (Map iterates in insertion order).
      docCache.delete(pdfBytes);
      docCache.set(pdfBytes, pdf);
    } else {
      pdf = await lib.getDocument({
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
    try {
      return await fn(page);
    } finally {
      page.cleanup();
    }
  };
  // .then(run, run) so a prior rejection doesn't poison later callers.
  const pending = renderQueue.then(run, run);
  renderQueue = pending.catch(() => { /* swallow to unblock queue */ });
  return pending;
}

/**
 * Render a single page of a PDF as a thumbnail image.
 * @returns data:image/png URL, or '' if pdfjs failed to load
 */
export async function renderPageThumbnail(
  pdfBytes: Uint8Array,
  pageNum: number,
  maxWidth = 150
): Promise<string> {
  const result = await withQueuedPage(pdfBytes, pageNum, async (page) => {
    const unscaled = page.getViewport({ scale: 1 });
    const scale = maxWidth / unscaled.width;
    const viewport = page.getViewport({ scale });
    if (!sharedCanvas) sharedCanvas = document.createElement('canvas');
    sharedCanvas.width = viewport.width;
    sharedCanvas.height = viewport.height;
    await page.render({ canvas: sharedCanvas, viewport }).promise;
    return sharedCanvas.toDataURL('image/png');
  });
  return result ?? '';
}

/**
 * Render a page to an ImageBitmap plus its unscaled PDF dimensions. Used by
 * the watermark preview, which composites a Canvas 2D overlay on top of the
 * cached base bitmap and needs the PDF user-space dims to set its
 * canvas-to-PDF transform. Rendered at the page's display orientation so the
 * bitmap is upright; the engine draws watermarks in the same coord system at
 * /Rotate=0, which is the common case.
 */
export async function renderPageBitmap(
  pdfBytes: Uint8Array,
  pageNum: number,
  maxWidth: number
): Promise<{ bitmap: ImageBitmap; pdfWidth: number; pdfHeight: number } | null> {
  return withQueuedPage(pdfBytes, pageNum, async (page) => {
    const unscaled = page.getViewport({ scale: 1 });
    const scale = maxWidth / unscaled.width;
    const viewport = page.getViewport({ scale });
    const off = document.createElement('canvas');
    off.width = viewport.width;
    off.height = viewport.height;
    await page.render({ canvas: off, viewport }).promise;
    // Bitmap retains pixel data after the source canvas is GC'd.
    const bitmap = await createImageBitmap(off);
    return { bitmap, pdfWidth: unscaled.width, pdfHeight: unscaled.height };
  });
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

export function mockBlankPageThumb(): string {
  // Always white, both themes: a "blank page" represents a printed sheet,
  // which is white regardless of UI theme. Theme-tinting it would lie about
  // the export.
  return `data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="212" viewBox="0 0 150 212">' +
    '<rect width="150" height="212" fill="#ffffff"/>' +
    '</svg>'
  )}`;
}

/**
 * Generic fallback thumbnail used when pdfjs rendering fails.
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
