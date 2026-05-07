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

function sanitizeHTML(html: string): string {
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
            el.setAttribute("style", style.replace(/url\(\s*["']?\s*(https?:)?\/\/[^)]*\)/gi, "none"));
        }

        if (tag === "style") {
            const css = el.textContent ?? "";
            if (/@import\s+(url\()?\s*["']?\s*(https?:)?\/\//i.test(css) || STYLE_EXTERNAL_RE.test(css)) {
                el.remove();
            }
        }
    }

    return doc.body.innerHTML;
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
    const style = document.createElement("style");
    style.textContent = ":host>div{display:flow-root;}";
    shadow.appendChild(style);

    // Create a div within the shadow DOM to act as
    // a container for our HTML payload.
    const container = document.createElement("div");
    container.innerHTML = sanitizeHTML(html);
    shadow.appendChild(container);

    // Wait for all images to finish loading. This is required for layout
    // changes, not because we actually care about the image contents.
    const images = container.querySelectorAll("img, video");
    const promises = Array.from(images).map(image => new Promise(resolve => {
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
