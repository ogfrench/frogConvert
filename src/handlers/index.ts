import type { FormatHandler } from "../core/FormatHandler/FormatHandler.ts";

// --- Core handlers (statically imported, included in main bundle) ---
import canvasToBlobHandler from "./canvasToBlob.ts";
import svgTraceHandler from "./svgTrace.ts";
import envelopeHandler from "./envelope.ts";
import jszipHandler from "./jszip.ts";
import { fromJsonHandler, toJsonHandler } from "./json.ts";
import textEncodingHandler from "./textEncoding.ts";

const handlers: FormatHandler[] = [];

const pushSafe = (name: string, make: () => FormatHandler | FormatHandler[]) => {
  try {
    const result = make();
    if (Array.isArray(result)) handlers.push(...result);
    else handlers.push(result);
  } catch (e) {
    console.warn(`[handlers] Failed to load ${name}:`, e);
  }
};

pushSafe('svgTrace', () => new svgTraceHandler());
pushSafe('canvasToBlob', () => new canvasToBlobHandler());
pushSafe('envelope', () => new envelopeHandler());
pushSafe('jszip', () => new jszipHandler());
pushSafe('fromJson', () => new fromJsonHandler());
pushSafe('toJson', () => new toJsonHandler());
pushSafe('textEncoding', () => new textEncodingHandler());

// Keeps import("./x") as a static string so Vite can code-split per handler.
const lazy = (name: string, importer: () => Promise<{ default: new () => FormatHandler }>) =>
  async () => {
    try { handlers.push(new (await importer()).default()); }
    catch (e) { console.warn(`[handlers] Failed to load ${name}:`, e); }
  };

/** Dynamically load all non-core handlers. Appends to the handlers array. */
export async function loadBackgroundHandlers() {
  const loaders: Array<() => Promise<void>> = [
    lazy('pdftoimg', () => import("./pdftoimg.ts")),
    lazy('ghostscript', () => import("./ghostscript.ts")),
    lazy('pdfCanvasCompress', () => import("./pdfCanvasCompress.ts")),
    lazy('pdftotxt', () => import("./pdftotxt.ts")),
    lazy('font', () => import("./font.ts")),
    lazy('FFmpeg', () => import("./FFmpeg.ts")),
    lazy('ImageMagick', () => import("./ImageMagick.ts")),
    lazy('imageToPdf', () => import("./imageToPdf.ts")),
    lazy('libreoffice', () => import("./libreoffice.ts")),
    lazy('pandoc', () => import("./pandoc.ts")),
    lazy('meyda', () => import("./meyda.ts")),
    lazy('htmlEmbed', () => import("./htmlEmbed.ts")),
    lazy('curani', () => import("./curani.ts")),
    lazy('bunburrows', () => import("./bunburrows.ts")),
    async () => {
      try { const m = await import("./rename.ts"); handlers.push(m.renameZipHandler, m.renameTxtHandler, m.renameJsonHandler); }
      catch (e) { console.warn('[handlers] Failed to load rename:', e); }
    },
    lazy('svgForeignObject', () => import("./svgForeignObject.ts")),
    lazy('qoi-fu', () => import("./qoi-fu.ts")),
    lazy('sppd', () => import("./sppd.ts")),
    lazy('threejs', () => import("./threejs.ts")),
    lazy('sqlite', () => import("./sqlite.ts")),
    lazy('vtf', () => import("./vtf.ts")),
    lazy('mcmap', () => import("./mcmap.ts")),
    lazy('als', () => import("./als.ts")),
    lazy('qoa-fu', () => import("./qoa-fu.ts")),
    lazy('pyTurtle', () => import("./pyTurtle.ts")),
    lazy('nbt', () => import("./nbt.ts")),
    lazy('petozip', () => import("./petozip.ts")),
    lazy('flptojson', () => import("./flptojson.ts")),
    lazy('flo', () => import("./flo.ts")),
    lazy('cgbi-to-png', () => import("./cgbi-to-png.ts")),
    lazy('batToExe', () => import("./batToExe.ts")),
    lazy('sb3tohtml', () => import("./sb3tohtml.ts")),
    lazy('libopenmpt', () => import("./libopenmpt.ts")),
    async () => {
      try { const m = await import("./midi.ts"); handlers.push(new m.midiCodecHandler(), new m.midiSynthHandler()); }
      catch (e) { console.warn('[handlers] Failed to load midi:', e); }
    },
    lazy('lzh', () => import("./lzh.ts")),
    lazy('tar', () => import("./tar.ts")),
    lazy('wad', () => import("./wad.ts")),
    lazy('txtToInfiniteCraft', () => import("./txtToInfiniteCraft.ts")),
    lazy('espeakng', () => import("./espeakng.js")),
    lazy('bsor', () => import("./bsor.ts")),
    lazy('icns', () => import("./icns.ts")),
    lazy('mcSchematic', () => import("./mcSchematicHandler.ts")),
    lazy('bson', () => import("./bson.ts")),
    lazy('aseprite', () => import("./aseprite.ts")),
    lazy('n64rom', () => import("./n64rom.ts")),
    lazy('vexflow', () => import("./vexflow.ts")),
    lazy('toon', () => import("./toon.ts")),
    // --- Handlers added from upstream ---
    lazy('sevenZip', () => import("./sevenZip.ts")),
    lazy('json5', () => import("./json5.ts")),
    lazy('jsonToC', () => import("./jsonToC.ts")),
    lazy('turbowarp', () => import("./turbowarp.ts")),
    lazy('exeToBat', () => import("./exeToBat.ts")),
    lazy('rpgmvp', () => import("./rpgmvp.ts")),
    lazy('ota', () => import("./ota.ts")),
    lazy('comics', () => import("./comics.ts")),
    lazy('terrariawld', () => import("./terrariawld.ts")),
    lazy('opusMagnum', () => import("./opusMagnum.ts")),
    lazy('aperturePicture', () => import("./aperturePicture.ts")),
    lazy('xcf', () => import("./xcf.ts")),
    lazy('pdfparse', () => import("./pdfparse.ts")),
    lazy('minecraftLangfile', () => import("./minecraftLangfileHandler.ts")),
    lazy('celariaMap', () => import("./celariaMap.ts")),
    lazy('cybergrind', () => import("./cybergrindHandler.ts")),
    lazy('textToSource', () => import("./textToSource.ts")),
    lazy('chessjs', () => import("./chessjs.ts")),
    lazy('fenToJson', () => import("./fenToJson.ts")),
    lazy('piskel', () => import("./piskel.ts")),
    lazy('xcursor', () => import("./xcursor.ts")),
    lazy('rgba', () => import("./rgba.ts")),
    lazy('har', () => import("./har.ts")),
    lazy('tmx', () => import("./tmx.ts")),
  ];

  await Promise.all(loaders.map(loader => loader()));
}

export default handlers;
