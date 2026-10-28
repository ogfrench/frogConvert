import type { Notice } from "../core/FormatHandler/FormatHandler.ts";

/** Formats whose value is layout and editable text, not just pixels. */
const DOCUMENT_FORMATS = new Set([
  "pdf", "docx", "doc", "pptx", "ppt", "xlsx", "odt", "odp", "ods", "rtf", "epub", "md", "markdown", "html",
  // Pandoc's ids for the markup it reads: a .md file is "commonmark", not "md",
  // and was never labelled when it came out as a picture.
  "commonmark", "commonmark_x", "gfm", "markdown_strict", "markdown_mmd", "markdown_phpextra",
  "rst", "latex", "org", "textile", "mediawiki", "ipynb", "asciidoc", "djot", "typst",
  "docbook", "jats", "fb2", "muse", "creole", "dokuwiki", "tikiwiki", "twiki", "vimwiki", "t2t",
]);
/** The result-card button that prints the page (actions.ts). */
export const PRINT_ACTION_LABEL = "Print as PDF";

/** Formats the Office engine can turn into a real PDF. */
const OFFICE_FORMATS = new Set(["docx", "doc", "pptx", "ppt", "xlsx", "odt", "odp", "ods", "rtf"]);
const RASTER_FORMATS = new Set(["png", "jpeg", "jpg", "webp", "bmp", "gif", "tiff", "avif"]);
const TEXT_FORMATS = new Set(["text", "txt"]);

export type RouteQuality = "faithful" | "image-only" | "text-only";

/**
 * What a route does to a document, judged from the formats it passes through.
 *
 * The router minimises cost, not loss: with no Office engine in the browser,
 * pptx -> pdf goes pptx -> html -> svg -> png -> pdf, and the result is one
 * tall picture with no selectable text. Reporting that as a plain success is
 * what made the app read as flaky. Only intermediate hops count: png -> pdf is
 * an image-only PDF because the user asked for one.
 */
export function classifyRoute(formats: string[], drawnAsImage = false): RouteQuality {
  if (formats.length < 2) return "faithful";
  const from = formats[0].toLowerCase();
  const to = formats[formats.length - 1].toLowerCase();
  if (!DOCUMENT_FORMATS.has(from) || !DOCUMENT_FORMATS.has(to)) return "faithful";
  if (drawnAsImage) return "image-only";
  const middle = formats.slice(1, -1).map(f => f.toLowerCase());
  if (middle.some(f => RASTER_FORMATS.has(f))) return "image-only";
  if (middle.some(f => TEXT_FORMATS.has(f))) return "text-only";
  return "faithful";
}

/**
 * The success-modal notice for a lossy route, or null when the route keeps
 * the document. `printable`: the web UI offers to print the page itself
 * (printPage.ts), so the notice points at that button.
 */
export function routeQualityNotice(formats: string[], drawnAsImage = false, printable = false): Notice | null {
  const quality = classifyRoute(formats, drawnAsImage);
  const to = formats[formats.length - 1]?.toUpperCase() ?? "";
  if (quality === "image-only") {
    const from = formats[0].toLowerCase();
    let body = `Each page came across as a picture, so the text in this ${to} can't be edited.`;
    if (to === "PDF" && OFFICE_FORMATS.has(from)) {
      body = "With no Office engine on this device, the document was drawn as an image: its text can't be selected, and layout may be lost. For a higher-quality PDF, enable the Office engine on a supported browser or export from the app that made the file.";
    } else if (to === "PDF" && printable) {
      body = `The ${from === "html" ? "page" : "document"} was drawn as an image, so its text can't be selected. For a PDF with selectable text, press ${PRINT_ACTION_LABEL} and choose Save as PDF.`;
    } else if (to === "PDF" && from === "html") {
      body = "The page was drawn as an image, so its text can't be selected. For a PDF with selectable text, open the file in your browser and use Print, then Save as PDF, or use the desktop app.";
    } else if (to === "PDF") {
      body = "The document was drawn as an image, so its text can't be selected. For a PDF with selectable text, use the desktop app.";
    }
    return { title: `This ${to} is made of pictures`, body };
  }
  if (quality === "text-only") {
    return {
      title: "Only the text came across",
      body: `Layout, images and formatting were dropped on the way to ${to}. The words are all there and editable.`,
    };
  }
  return null;
}
