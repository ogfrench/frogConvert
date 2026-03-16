import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerFindConversionPathTool } from './findConversionPath.ts';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FormatHandler, FileFormat } from '../../core/FormatHandler/FormatHandler.ts';
import type { TraversionGraph } from '../../core/TraversionGraph/TraversionGraph.ts';

vi.mock('../core/browserBridge.ts', () => ({
    canConvertViaBrowser: vi.fn(),
}));

import { canConvertViaBrowser } from '../core/browserBridge.ts';

// ─── helpers ───────────────────────────────────────────────────────────────

const jpegFormat: FileFormat = { name: 'JPEG', mime: 'image/jpeg', extension: 'jpeg', from: true, to: true, format: 'jpeg' };
const pngFormat: FileFormat  = { name: 'PNG',  mime: 'image/png',  extension: 'png',  from: true, to: true, format: 'png'  };

function makeHandler(name: string, formats: FileFormat[]): FormatHandler {
    return { name, ready: true, supportedFormats: formats, doConvert: vi.fn() };
}

function makeGraph(pathNodes: any[] | null): TraversionGraph {
    const gen = (async function* () {
        if (pathNodes) yield pathNodes;
    })();
    return { searchPath: vi.fn().mockReturnValue(gen) } as unknown as TraversionGraph;
}

function getCallback(server: McpServer): (args: any) => Promise<any> {
    return (server.tool as ReturnType<typeof vi.fn>).mock.calls[0][3];
}

function makeMockServer(): McpServer {
    return { tool: vi.fn() } as unknown as McpServer;
}

// ─── tests ─────────────────────────────────────────────────────────────────

describe('registerFindConversionPathTool', () => {
    beforeEach(() => {
        vi.mocked(canConvertViaBrowser).mockReset();
    });

    it('registers a tool named find_conversion_path', () => {
        const server = makeMockServer();
        registerFindConversionPathTool(server, Promise.resolve({ handlers: [], graph: makeGraph(null) }));
        expect(server.tool).toHaveBeenCalledWith('find_conversion_path', expect.any(String), expect.any(Object), expect.any(Function));
    });

    it('returns native path string when a native path exists', async () => {
        const handler = makeHandler('TestHandler', [jpegFormat, pngFormat]);
        const path = [
            { format: jpegFormat, handler },
            { format: pngFormat,  handler },
        ];

        const server = makeMockServer();
        registerFindConversionPathTool(server, Promise.resolve({ handlers: [handler], graph: makeGraph(path) }));
        const cb = getCallback(server);

        const result = await cb({ inputMime: 'image/jpeg', inputExtension: 'jpeg', outputMime: 'image/png', outputExtension: 'png' });

        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toMatch(/^Path:/);
        expect(result.content[0].text).toContain('TestHandler');
        // Bridge was not consulted
        expect(canConvertViaBrowser).not.toHaveBeenCalled();
    });

    it('reports browser-assisted path when both formats known natively but no native path and bridge says yes', async () => {
        const handler = makeHandler('TestHandler', [jpegFormat, pngFormat]);
        vi.mocked(canConvertViaBrowser).mockResolvedValue(true);

        const server = makeMockServer();
        registerFindConversionPathTool(server, Promise.resolve({ handlers: [handler], graph: makeGraph(null) }));
        const cb = getCallback(server);

        const result = await cb({ inputMime: 'image/jpeg', inputExtension: 'jpeg', outputMime: 'image/png', outputExtension: 'png' });

        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain('browser-assisted');
        expect(result.content[0].text).toContain('convert_file');
    });

    it('returns isError when both formats known natively but no native path and bridge says no', async () => {
        const handler = makeHandler('TestHandler', [jpegFormat, pngFormat]);
        vi.mocked(canConvertViaBrowser).mockResolvedValue(false);

        const server = makeMockServer();
        registerFindConversionPathTool(server, Promise.resolve({ handlers: [handler], graph: makeGraph(null) }));
        const cb = getCallback(server);

        const result = await cb({ inputMime: 'image/jpeg', inputExtension: 'jpeg', outputMime: 'image/png', outputExtension: 'png' });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/No path found/);
    });

    it('treats bridge check errors as "no bridge" and returns isError', async () => {
        const handler = makeHandler('TestHandler', [jpegFormat, pngFormat]);
        vi.mocked(canConvertViaBrowser).mockRejectedValue(new Error('bridge down'));

        const server = makeMockServer();
        registerFindConversionPathTool(server, Promise.resolve({ handlers: [handler], graph: makeGraph(null) }));
        const cb = getCallback(server);

        const result = await cb({ inputMime: 'image/jpeg', inputExtension: 'jpeg', outputMime: 'image/png', outputExtension: 'png' });

        // .catch(() => false) means bridge error → isError with "No path found"
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/No path found/);
    });

    it('returns input-not-found error immediately (no bridge check) when input format is unknown', async () => {
        // No handlers → inputMatch will be null
        const server = makeMockServer();
        registerFindConversionPathTool(server, Promise.resolve({ handlers: [], graph: makeGraph(null) }));
        const cb = getCallback(server);

        const result = await cb({ inputMime: 'image/jpeg', inputExtension: 'jpeg', outputMime: 'image/png', outputExtension: 'png' });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/Input format/);
        expect(result.content[0].text).toMatch(/not found or supported/);
        // Path queries don't spin up the browser for unknown formats
        expect(canConvertViaBrowser).not.toHaveBeenCalled();
    });

    it('returns output-not-found error immediately when output format is unknown', async () => {
        const inputHandler = makeHandler('InputHandler', [jpegFormat]);

        const server = makeMockServer();
        registerFindConversionPathTool(server, Promise.resolve({ handlers: [inputHandler], graph: makeGraph(null) }));
        const cb = getCallback(server);

        const result = await cb({ inputMime: 'image/jpeg', inputExtension: 'jpeg', outputMime: 'model/gltf+json', outputExtension: 'gltf' });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/Output format/);
        expect(result.content[0].text).toMatch(/not found or supported/);
        expect(canConvertViaBrowser).not.toHaveBeenCalled();
    });
});
