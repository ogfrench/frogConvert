import type { FormatHandler } from "../../core/FormatHandler/FormatHandler.ts";

import FFmpegHandler from "../../handlers/FFmpeg.ts";
import ImageMagickHandler from "../../handlers/ImageMagick.ts";
import pandocHandler from "../../handlers/pandoc.ts";
import jszipHandler from "../../handlers/jszip.ts";
import { fromJsonHandler, toJsonHandler } from "../../handlers/json.ts";
import fontHandler from "../../handlers/font.ts";
import textEncodingHandler from "../../handlers/textEncoding.ts";
import bsonHandler from "../../handlers/bson.ts";
import nbtHandler from "../../handlers/nbt.ts";
import LZHHandler from "../../handlers/lzh.ts";
import batchHandler from "../../handlers/batch.ts";
import alsHandler from "../../handlers/als.ts";
import mcSchematicHandler from "../../handlers/mcSchematicHandler.ts";
import wadHandler from "../../handlers/wad.ts";
import toonHandler from "../../handlers/toon.ts";
import htmlEmbedHandler from "../../handlers/htmlEmbed.ts";
import sqlite3Handler from "../../handlers/sqlite.ts";
import cgbiToPngHandler from "../../handlers/cgbi-to-png.ts";
import flptojsonHandler from "../../handlers/flptojson.ts";
import { renameZipHandler, renameTxtHandler } from "../../handlers/rename.ts";
import peToZipHandler from "../../handlers/petozip.ts";
import curaniHandler from "../../handlers/curani.ts";
import sb3ToHtmlHandler from "../../handlers/sb3tohtml.ts";
import txtToPyHandler from "../../handlers/textToPy.ts";
import textToGoHandler from "../../handlers/textToGo.ts";
import textToShellHandler from "../../handlers/texttoshell.ts";
import csharpHandler from "../../handlers/csharp.ts";
import txtToInfiniteCraftHandler from "../../handlers/txtToInfiniteCraft.ts";
import envelopeHandler from "../../handlers/envelope.ts";

export const loadMcpHandlers = async (): Promise<FormatHandler[]> => {
    const handlers: FormatHandler[] = [];

    try { handlers.push(new FFmpegHandler()); } catch (e: any) { console.warn("[MCP] Skipping FFmpeg:", e?.message || e); }
    try { handlers.push(new ImageMagickHandler()); } catch (e) { console.error("Failed to load ImageMagickHandler:", e); }
    try { handlers.push(new pandocHandler()); } catch (e) { console.error("Failed to load pandocHandler:", e); }
    try { handlers.push(new jszipHandler()); } catch (e) { console.error("Failed to load jszipHandler:", e); }
    try { handlers.push(new fromJsonHandler()); } catch (e) { console.error("Failed to load fromJsonHandler:", e); }
    try { handlers.push(new toJsonHandler()); } catch (e) { console.error("Failed to load toJsonHandler:", e); }
    try { handlers.push(new fontHandler()); } catch (e) { console.error("Failed to load fontHandler:", e); }
    try { handlers.push(new textEncodingHandler()); } catch (e) { console.error("Failed to load textEncodingHandler:", e); }
    try { handlers.push(new bsonHandler()); } catch (e) { console.error("Failed to load bsonHandler:", e); }
    try { handlers.push(new nbtHandler()); } catch (e) { console.error("Failed to load nbtHandler:", e); }
    try { handlers.push(new LZHHandler()); } catch (e) { console.error("Failed to load LZHHandler:", e); }
    try { handlers.push(new batchHandler()); } catch (e) { console.error("Failed to load batchHandler:", e); }
    try { handlers.push(new alsHandler()); } catch (e) { console.error("Failed to load alsHandler:", e); }
    try { handlers.push(new mcSchematicHandler()); } catch (e) { console.error("Failed to load mcSchematicHandler:", e); }
    try { handlers.push(new wadHandler()); } catch (e) { console.error("Failed to load wadHandler:", e); }
    try { handlers.push(new toonHandler()); } catch (e) { console.error("Failed to load toonHandler:", e); }
    try { handlers.push(new htmlEmbedHandler()); } catch (e) { console.error("Failed to load htmlEmbedHandler:", e); }
    try { handlers.push(new sqlite3Handler()); } catch (e) { console.error("Failed to load sqlite3Handler:", e); }
    try { handlers.push(new cgbiToPngHandler()); } catch (e) { console.error("Failed to load cgbiToPngHandler:", e); }
    try { handlers.push(new flptojsonHandler()); } catch (e) { console.error("Failed to load flptojsonHandler:", e); }
    try { handlers.push(renameZipHandler); } catch (e) { console.error("Failed to load renameZipHandler:", e); }
    try { handlers.push(renameTxtHandler); } catch (e) { console.error("Failed to load renameTxtHandler:", e); }
    try { handlers.push(new peToZipHandler()); } catch (e) { console.error("Failed to load peToZipHandler:", e); }
    try { handlers.push(new curaniHandler()); } catch (e) { console.error("Failed to load curaniHandler:", e); }
    try { handlers.push(new sb3ToHtmlHandler()); } catch (e) { console.error("Failed to load sb3ToHtmlHandler:", e); }
    try { handlers.push(new txtToPyHandler()); } catch (e) { console.error("Failed to load txtToPyHandler:", e); }
    try { handlers.push(new textToGoHandler()); } catch (e) { console.error("Failed to load textToGoHandler:", e); }
    try { handlers.push(new textToShellHandler()); } catch (e) { console.error("Failed to load textToShellHandler:", e); }
    try { handlers.push(new csharpHandler()); } catch (e) { console.error("Failed to load csharpHandler:", e); }
    try { handlers.push(new txtToInfiniteCraftHandler()); } catch (e) { console.error("Failed to load txtToInfiniteCraftHandler:", e); }
    try { handlers.push(new envelopeHandler()); } catch (e) { console.error("Failed to load envelopeHandler:", e); }

    // Initialize them
    for (const h of handlers) {
        if (h.init) {
            await h.init().catch(err => {
                console.error(`[MCP] Failed to init handler ${h.name}:`, err);
            });
        }
    }

    // Filter out those that failed to become ready
    return handlers.filter(h => h.ready);
};
