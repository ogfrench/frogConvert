import { describe, it, expect, vi } from 'vitest';
import { registerListFormatsTool } from './listFormats.ts';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FormatHandler, FileFormat } from '../../core/FormatHandler/FormatHandler.ts';

describe('listFormats', () => {
    it('should register tool and return correct format list', async () => {
        // Mock McpServer
        const mockServer = {
            tool: vi.fn()
        } as unknown as McpServer;

        const mockFormat: FileFormat = { name: 'Text File', mime: 'text/plain', extension: 'txt', from: true, to: true };
        const mockHandler: FormatHandler = {
            name: 'MockTextHandler',
            ready: true,
            supportedFormats: [mockFormat],
            doConvert: async () => []
        };

        registerListFormatsTool(mockServer, [mockHandler]);

        // Verify the tool was registered
        expect(mockServer.tool).toHaveBeenCalled();
        const callArgs = (mockServer.tool as any).mock.calls[0];
        expect(callArgs[0]).toBe('list_formats');

        // Execute the registered callback
        const callback = callArgs[3];
        const result = await callback();

        // Verify the result is formatted as JSON containing the mock format
        expect(result.content).toBeDefined();
        expect(result.content.length).toBe(1);
        expect(result.content[0].type).toBe('text');

        const parsedFormats = JSON.parse(result.content[0].text);
        expect(parsedFormats.length).toBe(1);
        expect(parsedFormats[0]).toEqual({
            name: mockFormat.name,
            mime: mockFormat.mime,
            extension: mockFormat.extension,
            handler: mockHandler.name,
            canRead: true,
            canWrite: true
        });
    });
});
