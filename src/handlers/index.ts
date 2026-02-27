import type { FormatHandler } from "../FormatHandler.ts";

// --- Core handlers (statically imported, included in main bundle) ---
import canvasToBlobHandler from "./canvasToBlob.ts";
import FFmpegHandler from "./FFmpeg.ts";
import pdftoimgHandler from "./pdftoimg.ts";
import ImageMagickHandler from "./ImageMagick.ts";
import svgTraceHandler from "./svgTrace.ts";
import envelopeHandler from "./envelope.ts";
import pandocHandler from "./pandoc.ts";
import jszipHandler from "./jszip.ts";
import { fromJsonHandler, toJsonHandler } from "./json.ts";
import fontHandler from "./font.ts";
import textEncodingHandler from "./textEncoding.ts";

const handlers: FormatHandler[] = [];
try { handlers.push(new svgTraceHandler()) } catch (_) { };
try { handlers.push(new canvasToBlobHandler()) } catch (_) { };
try { handlers.push(new FFmpegHandler()) } catch (_) { };
try { handlers.push(new pdftoimgHandler()) } catch (_) { };
try { handlers.push(new ImageMagickHandler()) } catch (_) { };
try { handlers.push(new envelopeHandler()) } catch (_) { };
try { handlers.push(new pandocHandler()) } catch (_) { };
try { handlers.push(new jszipHandler()) } catch (_) { };
try { handlers.push(new fromJsonHandler()) } catch (_) { };
try { handlers.push(new toJsonHandler()) } catch (_) { };
try { handlers.push(new fontHandler()) } catch (_) { };
try { handlers.push(new textEncodingHandler()) } catch (_) { };

/** Dynamically load all non-core handlers. Appends to the handlers array. */
export async function loadBackgroundHandlers() {
  const loaders: Array<() => Promise<void>> = [
    async () => { const m = await import("./meyda.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./htmlEmbed.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./curani.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./bunburrows.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./rename.ts"); handlers.push(m.renameZipHandler, m.renameTxtHandler); },
    async () => { const m = await import("./svgForeignObject.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./qoi-fu.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./sppd.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./threejs.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./sqlite.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./vtf.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./mcmap.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./als.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./qoa-fu.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./pyTurtle.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./nbt.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./petozip.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./flptojson.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./flo.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./cgbi-to-png.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./batToExe.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./sb3tohtml.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./libopenmpt.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./midi.ts"); handlers.push(new m.midiCodecHandler(), new m.midiSynthHandler()); },
    async () => { const m = await import("./lzh.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./wad.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./textToGo.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./txtToInfiniteCraft.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./espeakng.js"); handlers.push(new m.default()); },
    async () => { const m = await import("./texttoshell.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./batch.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./bsor.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./textToPy.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./icns.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./mcSchematicHandler.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./bson.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./aseprite.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./csharp.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./n64rom.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./vexflow.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./toon.ts"); handlers.push(new m.default()); },
  ];

  for (const loader of loaders) {
    try { await loader(); } catch (_) { }
  }
}

export default handlers;
