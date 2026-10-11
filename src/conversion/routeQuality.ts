import type { Notice } from "../core/FormatHandler/FormatHandler.ts";

/** Formats whose value is layout and editable text, not just pixels. */
const DOCUMENT_FORMATS = new Set([
  "pdf", "docx", "doc", "pptx", "ppt", "xlsx", "odt", "odp", "ods", "rtf", "epub", "md", "markdown", "html",
]);
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
export function classifyRoute(formats: string[]): RouteQuality {
  if (formats.length < 3) return "faithful";
  const from = formats[0].toLowerCase();
  const to = formats[formats.length - 1].toLowerCase();
  if (!DOCUMENT_FORMATS.has(from) || !DOCUMENT_FORMATS.has(to)) return "faithful";
  const middle = formats.slice(1, -1).map(f => f.toLowerCase());
  if (middle.some(f => RASTER_FORMATS.has(f))) return "image-only";
  if (middle.some(f => TEXT_FORMATS.has(f))) return "text-only";
  return "faithful";
}

/** The success-modal notice for a lossy route, or null when the route keeps the document. */
export function routeQualityNotice(formats: string[]): Notice | null {
  const quality = classifyRoute(formats);
  const to = formats[formats.length - 1]?.toUpperCase() ?? "";
  if (quality === "image-only") {
    return {
      title: `This ${to} is made of pictures`,
      body: to === "PDF"
        ? "There is no Office engine in the browser, so the document was drawn as an image: its text can't be selected or searched, and layout and images may be missing. For an exact PDF, export it from the app that made the file."
        : `Each page came across as a picture, so the text in this ${to} can't be edited.`,
    };
  }
  if (quality === "text-only") {
    return {
      title: "Only the text came across",
      body: `Layout, images and formatting were dropped on the way to ${to}. The words are all there and editable.`,
    };
  }
  return null;
}
