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
        expect(result.content[0].text).toContain("This conversion isn't available yet.");
        expect(result.content[0].text).toContain("francois.prevot@frog.co");
    });

    it('treats bridge check errors as "no bridge" and returns isError', async () => {
        const handler = makeHandler('TestHandler', [jpegFormat, pngFormat]);
        vi.mocked(canConvertViaBrowser).mockRejectedValue(new Error('bridge down'));

        const server = makeMockServer();
        registerFindConversionPathTool(server, Promise.resolve({ handlers: [handler], graph: makeGraph(null) }));
        const cb = getCallback(server);

        const result = await cb({ inputMime: 'image/jpeg', inputExtension: 'jpeg', outputMime: 'image/png', outputExtension: 'png' });

        // .catch(() => false) means bridge error -> isError with unavailable copy.
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("This conversion isn't available yet.");
        expect(result.content[0].text).toContain("francois.prevot@frog.co");
    });

    // A format the Node handler set has never heard of used to return here
    // without asking the bridge, on the reasoning that the bridge could not
    // resolve it either. That is backwards: the bridge is the side that loads
    // the browser-only handlers, so an unknown format is exactly the case it
    // can answer. png -> svg is the live one - svgTrace is browser-only, so
    // "svg" has no native writer and the answer was "not available" while the
    // landing page for it advertised the conversion.
    it('asks the bridge when the input format is unknown natively', async () => {
        vi.mocked(canConvertViaBrowser).mockResolvedValue(true);

        const server = makeMockServer();
        registerFindConversionPathTool(server, Promise.resolve({ handlers: [], graph: makeGraph(null) }));
        const cb = getCallback(server);

        const result = await cb({ inputMime: 'image/jpeg', inputExtension: 'jpeg', outputMime: 'image/png', outputExtension: 'png' });

        expect(canConvertViaBrowser).toHaveBeenCalled();
        expect(result.isError).toBeUndefined();
        expect(result.content[0].text).toContain('browser-assisted path is available');
    });

    it('reports unavailable when the output format is unknown and the bridge cannot help either', async () => {
        vi.mocked(canConvertViaBrowser).mockResolvedValue(false);
        const inputHandler = makeHandler('InputHandler', [jpegFormat]);

        const server = makeMockServer();
        registerFindConversionPathTool(server, Promise.resolve({ handlers: [inputHandler], graph: makeGraph(null) }));
        const cb = getCallback(server);

        const result = await cb({ inputMime: 'image/jpeg', inputExtension: 'jpeg', outputMime: 'model/gltf+json', outputExtension: 'gltf' });

        expect(canConvertViaBrowser).toHaveBeenCalled();
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("This conversion isn't available yet.");
        expect(result.content[0].text).toContain("francois.prevot@frog.co");
    });
});
