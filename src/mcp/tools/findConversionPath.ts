import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpContext } from "../core/types.ts";

import { findFormatAndHandler, libreofficeHint } from "../core/utils.ts";
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

            const inputMatch = findFormatAndHandler(handlers, inputMime, inputExtension, 'from');
            const outputMatch = findFormatAndHandler(handlers, outputMime, outputExtension, 'to');

            // Unknown formats can't be resolved via the bridge, but callers
            // still get the same public no-conversion copy as other no-paths.
            if (!inputMatch || !outputMatch) {
                return { content: [{ type: "text", text: appendSupportContact(CONVERSION_NOT_AVAILABLE_TEXT) }], isError: true };
            }

            const { format: fromFormat, handler: fromHandler } = inputMatch;
            const { format: toFormat, handler: toHandler } = outputMatch;

            const pathsGenerator = graph.searchPath(
                { format: fromFormat, handler: fromHandler },
                { format: toFormat, handler: toHandler },
                false
            );

            const pathResult = await pathsGenerator.next();
            if (pathResult.done || !pathResult.value) {
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

            const pathText = pathResult.value.map((p: any) => `${p.handler.name} (${p.format.mime})`).join(" -> ");

            return {
                content: [{ type: "text", text: `Path: ${pathText}` }]
            };
        }
    );
}
