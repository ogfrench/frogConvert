import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpContext } from "../core/types.ts";

export function registerListFormatsTool(server: McpServer, initPromise: Promise<McpContext>) {
    server.tool(
        "list_formats",
        "List all supported conversion formats in frogConvert MCP.",
        {},
        async () => {
            const { handlers } = await initPromise;
            const formats = [];
            for (const handler of handlers) {
                if (!handler.supportedFormats) continue;
                for (const format of handler.supportedFormats) {
                    formats.push({
                        name: format.name,
                        mime: format.mime,
                        extension: format.extension,
                        handler: handler.name,
                        canRead: format.from,
                        canWrite: format.to
                    });
                }
            }
            return {
                content: [{ type: "text", text: JSON.stringify(formats, null, 2) }]
            };
        }
    );
}
