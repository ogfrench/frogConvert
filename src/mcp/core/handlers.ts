import type { FormatHandler } from "../../core/FormatHandler/FormatHandler.ts";

/**
 * Handlers loaded in the MCP server (Node/Bun environment).
 *
 * WHY a manual list?
 * Loading all browser handlers blindly crashes the MCP process — some
 * handlers (e.g. flo, batToExe) fail in ways that are not safely catchable
 * in a stdio JSON-RPC server. Only handlers that run cleanly in Node/Bun
 * (pure JS, WASM with file-system fetch polyfill, or DOMParser-based) belong here.
 *
 * WHEN TO UPDATE:
 * Add a handler here whenever you add one to loadBackgroundHandlers() in
 * src/handlers/index.ts AND it does not require browser-only APIs
 * (canvas, WebGL, AudioContext, blob: URLs, etc.).
 */

import FFmpegHandler from "../../handlers/FFmpeg.ts";
import ImageMagickHandler from "../../handlers/ImageMagick.ts";
import libreofficeHandler from "../../handlers/libreoffice.ts";
import pandocHandler from "../../handlers/pandoc.ts";
import jszipHandler from "../../handlers/jszip.ts";
import { fromJsonHandler, toJsonHandler } from "../../handlers/json.ts";
import fontHandler from "../../handlers/font.ts";
import textEncodingHandler from "../../handlers/textEncoding.ts";
import bsonHandler from "../../handlers/bson.ts";
import nbtHandler from "../../handlers/nbt.ts";
import LZHHandler from "../../handlers/lzh.ts";
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
import textToSourceHandler from "../../handlers/textToSource.ts";
import txtToInfiniteCraftHandler from "../../handlers/txtToInfiniteCraft.ts";
import envelopeHandler from "../../handlers/envelope.ts";
import TMXHandler from "../../handlers/tmx.ts";
import sevenZipHandler from "../../handlers/sevenZip.ts";
import json5Handler from "../../handlers/json5.ts";
import jsonToCHandler from "../../handlers/jsonToC.ts";
import exeToBatHandler from "../../handlers/exeToBat.ts";
import comicsHandler from "../../handlers/comics.ts";
import aperturePictureHandler from "../../handlers/aperturePicture.ts";
import pdfparseHandler from "../../handlers/pdfparse.ts";
import minecraftLangfileHandler from "../../handlers/minecraftLangfileHandler.ts";
import celariaMapHandler from "../../handlers/celariaMap.ts";
import chessjsHandler from "../../handlers/chessjs.ts";
import fenToJsonHandler from "../../handlers/fenToJson.ts";
import harHandler from "../../handlers/har.ts";

export const loadMcpHandlers = async (): Promise<{ ready: FormatHandler[]; all: FormatHandler[] }> => {
    const handlers: FormatHandler[] = [];

    try { handlers.push(new FFmpegHandler()); } catch (e: any) { console.error("[MCP] Failed to load FFmpeg:", e?.message || e); }
    try { handlers.push(new ImageMagickHandler()); } catch (e) { console.error("[MCP] Failed to load ImageMagick:", e); }
    try { handlers.push(new libreofficeHandler()); } catch (e: any) { console.error("[MCP] Failed to load libreoffice:", e?.message || e); }
    try { handlers.push(new pandocHandler()); } catch (e) { console.error("[MCP] Failed to load pandoc:", e); }
    try { handlers.push(new jszipHandler()); } catch (e) { console.error("[MCP] Failed to load jszip:", e); }
    try { handlers.push(new fromJsonHandler()); } catch (e) { console.error("[MCP] Failed to load fromJson:", e); }
    try { handlers.push(new toJsonHandler()); } catch (e) { console.error("[MCP] Failed to load toJson:", e); }
    try { handlers.push(new fontHandler()); } catch (e) { console.error("[MCP] Failed to load font:", e); }
    try { handlers.push(new textEncodingHandler()); } catch (e) { console.error("[MCP] Failed to load textEncoding:", e); }
    try { handlers.push(new bsonHandler()); } catch (e) { console.error("[MCP] Failed to load bson:", e); }
    try { handlers.push(new nbtHandler()); } catch (e) { console.error("[MCP] Failed to load nbt:", e); }
    try { handlers.push(new LZHHandler()); } catch (e) { console.error("[MCP] Failed to load LZH:", e); }
    try { handlers.push(new alsHandler()); } catch (e) { console.error("[MCP] Failed to load als:", e); }
    try { handlers.push(new mcSchematicHandler()); } catch (e) { console.error("[MCP] Failed to load mcSchematic:", e); }
    try { handlers.push(new wadHandler()); } catch (e) { console.error("[MCP] Failed to load wad:", e); }
    try { handlers.push(new toonHandler()); } catch (e) { console.error("[MCP] Failed to load toon:", e); }
    try { handlers.push(new htmlEmbedHandler()); } catch (e) { console.error("[MCP] Failed to load htmlEmbed:", e); }
    try { handlers.push(new sqlite3Handler()); } catch (e) { console.error("[MCP] Failed to load sqlite3:", e); }
    try { handlers.push(new cgbiToPngHandler()); } catch (e) { console.error("[MCP] Failed to load cgbi-to-png:", e); }
    try { handlers.push(new flptojsonHandler()); } catch (e) { console.error("[MCP] Failed to load flptojson:", e); }
    try { handlers.push(renameZipHandler); } catch (e) { console.error("[MCP] Failed to load renameZip:", e); }
    try { handlers.push(renameTxtHandler); } catch (e) { console.error("[MCP] Failed to load renameTxt:", e); }
    try { handlers.push(new peToZipHandler()); } catch (e) { console.error("[MCP] Failed to load peToZip:", e); }
    try { handlers.push(new curaniHandler()); } catch (e) { console.error("[MCP] Failed to load curani:", e); }
    try { handlers.push(new sb3ToHtmlHandler()); } catch (e) { console.error("[MCP] Failed to load sb3ToHtml:", e); }
    try { handlers.push(new textToSourceHandler()); } catch (e) { console.error("[MCP] Failed to load textToSource:", e); }
    try { handlers.push(new txtToInfiniteCraftHandler()); } catch (e) { console.error("[MCP] Failed to load txtToInfiniteCraft:", e); }
    try { handlers.push(new envelopeHandler()); } catch (e) { console.error("[MCP] Failed to load envelope:", e); }
    try { handlers.push(new TMXHandler()); } catch (e) { console.error("[MCP] Failed to load TMX:", e); }
    try { handlers.push(new sevenZipHandler()); } catch (e) { console.error("[MCP] Failed to load sevenZip:", e); }
    try { handlers.push(new json5Handler()); } catch (e) { console.error("[MCP] Failed to load json5:", e); }
    try { handlers.push(new jsonToCHandler()); } catch (e) { console.error("[MCP] Failed to load jsonToC:", e); }
    try { handlers.push(new exeToBatHandler()); } catch (e) { console.error("[MCP] Failed to load exeToBat:", e); }
    try { handlers.push(new comicsHandler()); } catch (e) { console.error("[MCP] Failed to load comics:", e); }
    try { handlers.push(new aperturePictureHandler()); } catch (e) { console.error("[MCP] Failed to load aperturePicture:", e); }
    try { handlers.push(new pdfparseHandler()); } catch (e) { console.error("[MCP] Failed to load pdfparse:", e); }
    try { handlers.push(new minecraftLangfileHandler()); } catch (e) { console.error("[MCP] Failed to load minecraftLangfile:", e); }
    try { handlers.push(new celariaMapHandler()); } catch (e) { console.error("[MCP] Failed to load celariaMap:", e); }
    try { handlers.push(new chessjsHandler()); } catch (e) { console.error("[MCP] Failed to load chessjs:", e); }
    try { handlers.push(new fenToJsonHandler()); } catch (e) { console.error("[MCP] Failed to load fenToJson:", e); }
    try { handlers.push(new harHandler()); } catch (e) { console.error("[MCP] Failed to load har:", e); }

    // Initialize all handlers in parallel — Pandoc WASM is 55 MB and takes 30s–3min
    // to compile; sequential init blocks everything behind the slowest handler.
    await Promise.all(handlers.map(h =>
        h.init
            ? h.init().catch(err => console.error(`[MCP] Failed to init handler ${h.name}:`, err))
            : Promise.resolve()
    ));

    return {
        ready: handlers.filter(h => h.ready),
        all: handlers,
    };
};
