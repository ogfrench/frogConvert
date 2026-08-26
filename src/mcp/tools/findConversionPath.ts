import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpContext } from "../core/types.ts";

import { findFirstPath, libreofficeHint } from "../core/utils.ts";
import { canConvertViaBrowser } from "../core/browserBridge.ts";
import { appendSupportContact, CONVERSION_NOT_AVAILABLE_TEXT } from "../../components/utils/index.ts";

export function registerFindConversionPathTool(server: McpServer, initPromise: Promise<McpContext>) {
    server.tool(
        "find_conversion_path",
        "Find the step-by-step conversion path between two formats.",
        {
            inputMime: z.string().describe("Input MIME type (e.g. image/jpeg)"),
            inputExtension: z.string().describe("Input file extension (e.g. jpeg)"),
            outputMime: z.string().describe("Output MIME type (e.g. image/png)"),
            outputExtension: z.string().describe("Output file extension (e.g. png)")
        },
        async ({ inputMime, inputExtension, outputMime, outputExtension }) => {
            const { handlers, allHandlers, graph } = await initPromise;

            // findFirstPath returns null for an unroutable pair and for a token
            // no native handler claims at all. Both used to be separate branches
            // here, and the unknown-format one skipped the bridge check on the
            // reasoning that the bridge could not help - which is backwards.
            // The bridge is the side that has the browser-only handlers, so a
            // format Node has never heard of is exactly the case it can answer.
            // simpleMode=true so this reports the same route convert_file will
            // actually run. See the note there for why the handler-constrained
            // mode returned longer, worse paths.
            const path = await findFirstPath(graph, handlers, inputMime, inputExtension, outputMime, outputExtension, true);
            if (!path) {
                const browserAvailable = await canConvertViaBrowser(
                    inputMime, inputExtension, outputMime, outputExtension
                ).catch(() => false);
                if (browserAvailable) {
                    return {
                        content: [{ type: "text", text: `No native path found. A browser-assisted path is available - use convert_file to convert via the browser bridge.` }]
                    };
                }
                let msg = CONVERSION_NOT_AVAILABLE_TEXT;
                const hint = allHandlers && libreofficeHint(allHandlers, inputExtension, outputExtension);
                if (hint) msg += `\n${hint}`;
                return { content: [{ type: "text", text: appendSupportContact(msg) }], isError: true };
            }

            const pathText = path.map((p) => `${p.handler.name} (${p.format.mime})`).join(" -> ");

            return {
                content: [{ type: "text", text: `Path: ${pathText}` }]
            };
        }
    );
}
