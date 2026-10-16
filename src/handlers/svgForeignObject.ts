import CommonFormats from '../core/CommonFormats/CommonFormats.ts';
import type { FileData, FileFormat, FormatHandler } from "../core/FormatHandler/FormatHandler.ts";

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
function importDocument(doc: Document): HTMLElement {
    const root = document.importNode(doc.documentElement, true) as HTMLElement;
    root.querySelectorAll("link, meta, title, base").forEach(el => el.remove());
    return root;
}

class svgForeignObjectHandler implements FormatHandler {

  public name: string = "svgForeignObject";

  public supportedFormats: FileFormat[] = [
    CommonFormats.HTML.supported("html", true, false),
    // Identical to the input HTML, just wrapped in an SVG foreignObject, so it's lossless
    CommonFormats.SVG.supported("svg", false, true, true)
  ];

  public ready: boolean = true;
  public requiresMainThread: boolean = true;

  async init() {
    this.ready = true;
  }

  static async normalizeHTML(html: string) {
    // To get the size of the input document, we need the
    // browser to actually render it.
    // Create a hidden "dummy" element on the DOM.
    const dummy = document.createElement("div");
    dummy.style.all = "initial";
    dummy.style.visibility = "hidden";
    dummy.style.position = "fixed";
    document.body.appendChild(dummy);

    // Add a DOM shadow to the dummy to "sterilize" it.
    const shadow = dummy.attachShadow({ mode: "closed" });

    // Inline, not a shadow stylesheet, so the SVG lays out the same way:
    // flow-root keeps the body's margins inside the measured box.
    const container = importDocument(sanitizeHTML(html));
    container.style.display = "flow-root";
    shadow.appendChild(container);

    // A browser paints the body's background over the whole canvas. Inside
    // the SVG there is no canvas, so give it to <html> when <html> has none.
    const body = container.querySelector("body");
    if (body) {
      const rootStyle = getComputedStyle(container);
      const bodyStyle = getComputedStyle(body);
      if (rootStyle.backgroundColor === "rgba(0, 0, 0, 0)" && rootStyle.backgroundImage === "none") {
        container.style.backgroundColor = bodyStyle.backgroundColor;
        container.style.backgroundImage = bodyStyle.backgroundImage;
      }
    }

    // Wait for all images to finish loading. This is required for layout
    // changes, not because we actually care about the image contents.
    const images = Array.from(container.querySelectorAll("img, video"))
      .filter(el => !(el instanceof HTMLImageElement && el.complete));
    const promises = images.map(image => new Promise(resolve => {
      image.addEventListener("load", resolve);
      image.addEventListener("loadeddata", resolve);
      image.addEventListener("error", resolve);
    }));
    await Promise.all(promises);

    // Make sure the browser has had time to render.
    // This is probably redundant due to the async calls above.
    await new Promise(resolve => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    });

    // Finally, get the bounding box of the input and serialize it to XML.
    const bbox = container.getBoundingClientRect();
    const serializer = new XMLSerializer();
    const xml = serializer.serializeToString(container);

    container.remove();
    dummy.remove();

    return { xml, bbox };
  }

  async doConvert(
    inputFiles: FileData[],
    inputFormat: FileFormat,
    outputFormat: FileFormat
  ): Promise<FileData[]> {

    if (inputFormat.internal !== "html") throw "Invalid input format.";
    if (outputFormat.internal !== "svg") throw "Invalid output format.";

    const outputFiles: FileData[] = [];

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    for (const inputFile of inputFiles) {
      const { name, bytes } = inputFile;
      const html = decoder.decode(bytes);
      const { xml, bbox } = await svgForeignObjectHandler.normalizeHTML(html);
      const svg = (
        `<svg width="${bbox.width}" height="${bbox.height}" xmlns="http://www.w3.org/2000/svg">
        <foreignObject x="0" y="0" width="${bbox.width}" height="${bbox.height}">
        ${xml}
        </foreignObject>
        </svg>`);
      const outputBytes = encoder.encode(svg);
      const newName = (name.endsWith(".html") ? name.slice(0, -5) : name) + ".svg";
      outputFiles.push({ name: newName, bytes: outputBytes });
    }

    return outputFiles;

  }

}

export default svgForeignObjectHandler;
