import type { FormatHandler } from "../../core/FormatHandler/FormatHandler.ts";

import FFmpegHandler from "../../handlers/FFmpeg.ts";
import ImageMagickHandler from "../../handlers/ImageMagick.ts";
import pandocHandler from "../../handlers/pandoc.ts";
import jszipHandler from "../../handlers/jszip.ts";
import { fromJsonHandler, toJsonHandler } from "../../handlers/json.ts";
import fontHandler from "../../handlers/font.ts";
import textEncodingHandler from "../../handlers/textEncoding.ts";
import bsonHandler from "../../handlers/bson.ts";

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
