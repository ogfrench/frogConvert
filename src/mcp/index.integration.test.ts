import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

describe('MCP Server Integration', () => {
    let client: Client;

    beforeAll(async () => {
        const proc = (globalThis as any).process;
        const transport = new StdioClientTransport({
            command: proc?.platform === 'win32' ? "npx.cmd" : "npx",
            args: ["tsx", "src/mcp/index.ts"],
            env: { ...proc?.env }
        });

        client = new Client(
            { name: "test-client", version: "1.0.0" },
            { capabilities: {} }
        );

        await client.connect(transport);
    });

    afterAll(async () => {
        if (client) {
            await client.close();
        }
    });

    it('should expose the expected tools', async () => {
        const { tools } = await client.listTools();

        const toolNames = tools.map(t => t.name);
        expect(toolNames).toContain('list_formats');
        expect(toolNames).toContain('find_conversion_path');
        expect(toolNames).toContain('convert_file');
    });
});
