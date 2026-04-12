import type { FormatHandler } from "../core/FormatHandler/FormatHandler.ts";

// --- Core handlers (statically imported, included in main bundle) ---
import canvasToBlobHandler from "./canvasToBlob.ts";
import svgTraceHandler from "./svgTrace.ts";
import envelopeHandler from "./envelope.ts";
import jszipHandler from "./jszip.ts";
import { fromJsonHandler, toJsonHandler } from "./json.ts";
import textEncodingHandler from "./textEncoding.ts";

const handlers: FormatHandler[] = [];
try { handlers.push(new svgTraceHandler()) } catch (e) { console.warn('[handlers] Failed to load svgTrace:', e); }
try { handlers.push(new canvasToBlobHandler()) } catch (e) { console.warn('[handlers] Failed to load canvasToBlob:', e); }
try { handlers.push(new envelopeHandler()) } catch (e) { console.warn('[handlers] Failed to load envelope:', e); }
try { handlers.push(new jszipHandler()) } catch (e) { console.warn('[handlers] Failed to load jszip:', e); }
try { handlers.push(new fromJsonHandler()) } catch (e) { console.warn('[handlers] Failed to load fromJson:', e); }
try { handlers.push(new toJsonHandler()) } catch (e) { console.warn('[handlers] Failed to load toJson:', e); }
try { handlers.push(new textEncodingHandler()) } catch (e) { console.warn('[handlers] Failed to load textEncoding:', e); }

/** Dynamically load all non-core handlers. Appends to the handlers array. */
export async function loadBackgroundHandlers() {
  const loaders: Array<() => Promise<void>> = [
    async () => { const m = await import("./pdftoimg.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./pdftotxt.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./font.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./FFmpeg.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./ImageMagick.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./libreoffice.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./pandoc.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./meyda.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./htmlEmbed.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./curani.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./bunburrows.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./rename.ts"); handlers.push(m.renameZipHandler, m.renameTxtHandler, m.renameJsonHandler); },
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
    async () => { const m = await import("./tar.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./wad.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./txtToInfiniteCraft.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./espeakng.js"); handlers.push(new m.default()); },
    async () => { const m = await import("./bsor.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./icns.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./mcSchematicHandler.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./bson.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./aseprite.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./n64rom.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./vexflow.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./toon.ts"); handlers.push(new m.default()); },
    // --- Handlers added from upstream ---
    async () => { const m = await import("./sevenZip.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./json5.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./jsonToC.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./turbowarp.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./exeToBat.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./rpgmvp.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./ota.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./comics.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./terrariawld.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./opusMagnum.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./aperturePicture.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./xcf.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./pdfparse.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./minecraftLangfileHandler.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./celariaMap.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./cybergrindHandler.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./textToSource.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./chessjs.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./fenToJson.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./piskel.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./xcursor.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./rgba.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./har.ts"); handlers.push(new m.default()); },
    async () => { const m = await import("./tmx.ts"); handlers.push(new m.default()); },
  ];

  await Promise.all(loaders.map(loader => loader().catch(e => {
    console.warn('[handlers] Failed to load handler:', e);
  })));
}

export default handlers;
