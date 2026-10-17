import CommonFormats from '../core/CommonFormats/CommonFormats.ts';
import type { FileData, FileFormat, FormatHandler } from "../core/FormatHandler/FormatHandler.ts";
import { PDFDocument, rgb } from "pdf-lib";

/**
 * Strip on* event handlers AND rewrite external-resource URLs.
 *
 * The renderer injects this HTML into a hidden DOM element to measure its
 * bounding box. If we leave `<img src="https://attacker.example/px.gif">` in
 * place, the browser dispatches that request during measurement, the user's
 * act of converting untrusted HTML leaks a network signal to any URL the
 * input chose. Strip or neutralise anything that could trigger a fetch.
 *
 * Keep: `data:`, `blob:`, fragment refs, relative paths.
 * Replace: `http:` / `https:` / `//` (protocol-relative) with a 1×1 inline
 *   transparent PNG so layout measurement still succeeds.
 * Also strip: `<link rel="stylesheet">` with external href, `<iframe>` and
 *   `<script>` entirely (script tags inserted via innerHTML don't execute,
 *   but iframes DO load their src).
 */
const INLINE_TRANSPARENT_PX =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

function isExternalUrl(url: string): boolean {
    const trimmed = url.trim();
    return /^(https?:)?\/\//i.test(trimmed) || /^file:/i.test(trimmed);
}

const DROP_TAGS = new Set(["script", "iframe", "object", "embed"]);
const EXTERNAL_URL_RE = /(^|,)\s*(https?:)?\/\//i;
const STYLE_EXTERNAL_RE = /url\(\s*["']?\s*(https?:)?\/\//i;
const EXTERNAL_IMPORT_RE = /@import\s+(url\()?\s*["']?\s*(https?:|file:)?\/\/[^;]*;?/gi;
const EXTERNAL_CSS_URL_RE = /url\(\s*["']?\s*((https?:)?\/\/|file:)[^)]*\)/gi;

/**
 * Neutralise a stylesheet's external fetches but keep its rules. Dropping the
 * whole <style> because one web font was @imported from a CDN lost every rule
 * in it. `:root` would match the app's own document, not the converted one.
 */
function sanitizeCSS(css: string): string {
    return css
        .replace(EXTERNAL_IMPORT_RE, "")
        .replace(EXTERNAL_CSS_URL_RE, "none")
        .replace(/:root\b/g, "html");
}

function sanitizeHTML(html: string): Document {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    // Array.from so removals during iteration don't skip siblings.
    for (const el of Array.from(doc.querySelectorAll("*"))) {
        const tag = el.tagName.toLowerCase();
        if (DROP_TAGS.has(tag)) { el.remove(); continue; }

        for (const attr of [...el.attributes]) {
            if (attr.name.startsWith("on")) el.removeAttribute(attr.name);
        }

        const src = el.getAttribute("src");
        if (src && isExternalUrl(src)) el.setAttribute("src", INLINE_TRANSPARENT_PX);

        const href = el.getAttribute("href");
        if (href && isExternalUrl(href)) {
            if (tag === "link") { el.remove(); continue; }
            el.removeAttribute("href");
        }

        const srcset = el.getAttribute("srcset");
        if (srcset && EXTERNAL_URL_RE.test(srcset)) {
            el.setAttribute("srcset", INLINE_TRANSPARENT_PX);
        }

        const style = el.getAttribute("style");
        if (style && STYLE_EXTERNAL_RE.test(style)) {
            el.setAttribute("style", style.replace(EXTERNAL_CSS_URL_RE, "none"));
        }

        if (tag === "style") el.textContent = sanitizeCSS(el.textContent ?? "");
    }

    return doc;
}

/**
 * The page as real <html>, <head> and <body> elements, so `body { ... }` and
 * `html { ... }` rules match the way they do in a browser tab. This used to
 * keep only body.innerHTML, which threw away every <style> in <head> and the
 * body's own class and style: the output was the bare text (#65).
 */
function importDocument(doc: Document, into: Document): HTMLElement {
    const root = into.importNode(doc.documentElement, true) as HTMLElement;
    root.querySelectorAll("link, meta, title, base").forEach(el => el.remove());
    return root;
}

/**
 * Instructions a browser follows when the page is printed: A4 with Chrome's
 * default margins, and backgrounds printed, which browsers otherwise drop
 * unless the user ticks "Background graphics". The empty margin boxes keep
 * Chrome from stamping the date, title and app URL on every page when its
 * "Headers and footers" box is ticked (measured: it is by default). First in
 * <head>, so a page's own print styles still win.
 */
const PRINT_CSS = "@page { size: A4; margin: 10mm; "
    + ["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"]
        .map(box => `@${box} { content: ""; }`).join(" ")
    + " } html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }";

/**
 * The page, sanitized, as a whole document ready to print: what the desktop
 * app sends to Chromium's PDF printer and what the web UI prints. `title`
 * becomes the file name the print dialog suggests.
 */
export function printableDocument(html: string, title?: string): string {
    const doc = sanitizeHTML(html);
    doc.querySelectorAll("link, base, meta[http-equiv]").forEach(el => el.remove());
    if (title) doc.title = title;
    const style = doc.createElement("style");
    style.textContent = PRINT_CSS;
    doc.head.prepend(style);
    return "<!doctype html>\n" + doc.documentElement.outerHTML;
}

/** The width an HTML page is laid out at for an image: a desktop window, whatever the app's. */
const IMAGE_WIDTH = 1024;
/** The window height `vh` units and height media queries see. */
const VIEWPORT_HEIGHT = 768;
/** Rendered at twice its CSS size, like a screenshot on a high-density screen. */
const RENDER_SCALE = 2;
/** Chromium refuses canvases taller or wider than this, and above ~268M pixels. */
const CANVAS_MAX_SIDE = 32_000;
const CANVAS_MAX_AREA = 120_000_000;

/** A4 in points, with Chrome's default print margins (10 mm). */
const A4_WIDTH_PT = 595.28;
const A4_HEIGHT_PT = 841.89;
const PAGE_MARGIN_PT = 28.35;
const PT_PER_CSS_PX = 0.75;
/** The CSS width of A4 inside its margins, the width a browser prints at. */
const PDF_LAYOUT_WIDTH = Math.floor((A4_WIDTH_PT - 2 * PAGE_MARGIN_PT) / PT_PER_CSS_PX);
const PDF_PAGE_HEIGHT = Math.floor((A4_HEIGHT_PT - 2 * PAGE_MARGIN_PT) / PT_PER_CSS_PX);

/** "rgb(16, 32, 48)" or "rgba(...)" to 0..1 channels; null when transparent. */
function parseCssColor(color: string): [number, number, number] | null {
  const m = color.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/);
  if (!m || (m[4] !== undefined && Number(m[4]) === 0)) return null;
  return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255];
}

function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  const image = new Image();
  return new Promise((resolve, reject) => {
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () => reject(new Error("The page could not be drawn.")));
    // A data URL, not a blob URL: a blob-URL SVG taints the canvas in some browsers.
    image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (!blob) return reject(new Error("The page could not be encoded as PNG."));
    blob.arrayBuffer().then(b => resolve(new Uint8Array(b)), reject);
  }, "image/png"));
}

/**
 * The lowest row in the bottom quarter of the canvas that is one flat colour,
 * so a page break falls between lines of text rather than through them.
 * Returns the canvas height when there is none.
 */
export function findPageBreak(pixels: Uint8ClampedArray, width: number, height: number): number {
  const TOLERANCE = 6;
  for (let y = height - 1; y >= Math.floor(height * 0.75); y--) {
    const row = y * width * 4;
    let flat = true;
    for (let x = 1; x < width && flat; x++) {
      const i = row + x * 4;
      for (let c = 0; c < 4; c++) {
        if (Math.abs(pixels[i + c] - pixels[row + c]) > TOLERANCE) { flat = false; break; }
      }
    }
    if (flat) return y + 1;
  }
  return height;
}

class svgForeignObjectHandler implements FormatHandler {

  public name: string = "svgForeignObject";

  public supportedFormats: FileFormat[] = [
    CommonFormats.HTML.supported("html", true, false),
    // Identical to the input HTML, just wrapped in an SVG foreignObject, so it's lossless
    CommonFormats.SVG.supported("svg", false, true, true),
    CommonFormats.PNG.supported("png", false, true, true),
    // A picture of the page, unless the desktop app prints it for real
    CommonFormats.PDF.supported("pdf", false, true, false),
  ];

  public ready: boolean = true;
  public requiresMainThread: boolean = true;

  async init() {
    this.ready = true;
  }

  /**
   * Lay the page out at `width` CSS pixels and serialize it for the SVG.
   *
   * In a hidden iframe of exactly that width, not in the app's own document:
   * the SVG evaluates `@media` and `vw` against its own width, so measuring
   * against the app window gave a different layout from the one drawn (a
   * page's phone styles applied in the picture but not in the measurement),
   * and the picture depended on the size of the window it was made in.
   */
  static async normalizeHTML(html: string, width: number = IMAGE_WIDTH) {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${VIEWPORT_HEIGHT}px;border:0;visibility:hidden;pointer-events:none;`;
    document.body.appendChild(frame);
    try {
      const doc = frame.contentDocument!;
      // A blank frame is in quirks mode, where <html> stretches to the window
      // height: every picture came out at least VIEWPORT_HEIGHT tall.
      doc.open();
      doc.write("<!doctype html><html></html>");
      doc.close();
      const container = importDocument(sanitizeHTML(html), doc);
      doc.replaceChild(container, doc.documentElement);

      // Inline, so the SVG lays out the same way: flow-root keeps the body's
      // margins inside the measured box.
      container.style.display = "flow-root";

      // A browser paints the body's background over the whole canvas. Inside
      // the SVG there is no canvas, so give it to <html> when <html> has none.
      const view = doc.defaultView!;
      const body = container.querySelector("body");
      if (body) {
        const rootStyle = view.getComputedStyle(container);
        const bodyStyle = view.getComputedStyle(body);
        if (parseCssColor(rootStyle.backgroundColor) === null && rootStyle.backgroundImage === "none") {
          container.style.backgroundColor = bodyStyle.backgroundColor;
          container.style.backgroundImage = bodyStyle.backgroundImage;
        }
      }

      // Wait for all images to finish loading. This is required for layout
      // changes, not because we actually care about the image contents.
      const images = Array.from(container.querySelectorAll("img, video"))
        .filter(el => !(el.tagName === "IMG" && (el as HTMLImageElement).complete));
      await Promise.all(images.map(image => new Promise(resolve => {
        image.addEventListener("load", resolve);
        image.addEventListener("loadeddata", resolve);
        image.addEventListener("error", resolve);
      })));
      await doc.fonts?.ready;

      // Make sure the browser has had time to render.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      const bbox = { width, height: Math.max(1, Math.ceil(container.getBoundingClientRect().height)) };
      const background = view.getComputedStyle(container).backgroundColor;
      const xml = new XMLSerializer().serializeToString(container);
      return { xml, bbox, background };
    } finally {
      frame.remove();
    }
  }

  static toSvg(xml: string, bbox: { width: number; height: number }): string {
    return `<svg width="${bbox.width}" height="${bbox.height}" xmlns="http://www.w3.org/2000/svg">
        <foreignObject x="0" y="0" width="${bbox.width}" height="${bbox.height}">
        ${xml}
        </foreignObject>
        </svg>`;
  }

  static async toPng(html: string): Promise<Uint8Array> {
    const { xml, bbox } = await svgForeignObjectHandler.normalizeHTML(html);
    const image = await loadSvgImage(svgForeignObjectHandler.toSvg(xml, bbox));
    const scale = Math.max(Math.min(
      RENDER_SCALE,
      CANVAS_MAX_SIDE / bbox.width,
      CANVAS_MAX_SIDE / bbox.height,
      Math.sqrt(CANVAS_MAX_AREA / (bbox.width * bbox.height)),
    ), 0.1);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bbox.width * scale);
    canvas.height = Math.round(bbox.height * scale);
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvasToPng(canvas);
  }

  /**
   * The page laid out at A4 width and cut into A4 pages, each drawn at twice
   * its size. Still pictures: a browser has no API that turns HTML into a PDF
   * with text in it short of its print dialog.
   */
  static async toImagePdf(html: string): Promise<Uint8Array> {
    const { xml, bbox, background } = await svgForeignObjectHandler.normalizeHTML(html, PDF_LAYOUT_WIDTH);
    const image = await loadSvgImage(svgForeignObjectHandler.toSvg(xml, bbox));
    const fill = parseCssColor(background);
    const doc = await PDFDocument.create();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const slice = document.createElement("canvas");
    const sliceCtx = slice.getContext("2d")!;
    const width = bbox.width;
    canvas.width = slice.width = width * RENDER_SCALE;

    // Less than a pixel left over would be a zero-height canvas, which can't be encoded.
    for (let top = 0; bbox.height - top >= 1;) {
      const remaining = bbox.height - top;
      let height = Math.min(PDF_PAGE_HEIGHT, remaining);
      canvas.height = height * RENDER_SCALE;
      ctx.drawImage(image, 0, top, width, height, 0, 0, canvas.width, canvas.height);
      let rows = canvas.height;
      if (remaining > PDF_PAGE_HEIGHT) {
        rows = findPageBreak(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
        height = rows / RENDER_SCALE;
      }
      slice.height = rows;
      sliceCtx.drawImage(canvas, 0, 0);

      const page = doc.addPage([A4_WIDTH_PT, A4_HEIGHT_PT]);
      if (fill) page.drawRectangle({ x: 0, y: 0, width: A4_WIDTH_PT, height: A4_HEIGHT_PT, color: rgb(...fill) });
      const png = await doc.embedPng(await canvasToPng(slice));
      const drawHeight = height * PT_PER_CSS_PX;
      page.drawImage(png, {
        x: PAGE_MARGIN_PT,
        y: A4_HEIGHT_PT - PAGE_MARGIN_PT - drawHeight,
        width: width * PT_PER_CSS_PX,
        height: drawHeight,
      });
      top += height;
    }
    return new Uint8Array(await doc.save());
  }

  /**
   * The desktop app prints the page with Chromium's own PDF printer, the same
   * as Print, then Save as PDF: real text, real pages. Null anywhere else, or
   * when that fails, and the caller draws the page instead.
   */
  static async printToPdf(html: string, title: string): Promise<Uint8Array | null> {
    if (typeof location === "undefined" || location.protocol !== "app:") return null;
    try {
      const resp = await fetch("/api/html-to-pdf", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ html: printableDocument(html, title) }),
      });
      if (!resp.ok) return null;
      const { base64Bytes } = await resp.json() as { base64Bytes?: string };
      if (!base64Bytes) return null;
      return Uint8Array.from(atob(base64Bytes), c => c.charCodeAt(0));
    } catch {
      return null;
    }
  }

  async doConvert(
    inputFiles: FileData[],
    inputFormat: FileFormat,
    outputFormat: FileFormat
  ): Promise<FileData[]> {

    if (inputFormat.internal !== "html") throw "Invalid input format.";
    const target = outputFormat.internal;
    if (target !== "svg" && target !== "png" && target !== "pdf") throw "Invalid output format.";

    const outputFiles: FileData[] = [];

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    for (const inputFile of inputFiles) {
      const { name, bytes } = inputFile;
      const html = decoder.decode(bytes);
      const newName = (name.replace(/\.html?$/i, "") || name) + "." + outputFormat.extension;
      if (target === "svg") {
        const { xml, bbox } = await svgForeignObjectHandler.normalizeHTML(html);
        outputFiles.push({ name: newName, bytes: encoder.encode(svgForeignObjectHandler.toSvg(xml, bbox)) });
      } else if (target === "png") {
        outputFiles.push({ name: newName, bytes: await svgForeignObjectHandler.toPng(html) });
      } else {
        const title = newName.replace(/\.pdf$/i, "");
        const printed = await svgForeignObjectHandler.printToPdf(html, title);
        outputFiles.push(printed
          ? { name: newName, bytes: printed }
          : {
            name: newName,
            bytes: await svgForeignObjectHandler.toImagePdf(html),
            drawnAsImage: true,
            printableHtml: printableDocument(html, title),
          });
      }
    }

    return outputFiles;

  }

}

export default svgForeignObjectHandler;
