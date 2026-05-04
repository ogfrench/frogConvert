import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerConvertFileTool } from './convertFile.ts';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FormatHandler, FileFormat } from '../../core/FormatHandler/FormatHandler.ts';
import type { TraversionGraph } from '../../core/TraversionGraph/TraversionGraph.ts';

vi.mock('../core/browserBridge.ts', () => ({
    convertViaBrowser: vi.fn(),
}));

vi.mock('fs/promises', () => {
    const mocked = {
        readFile: vi.fn(),
        writeFile: vi.fn(),
    };
    return {
        ...mocked,
        default: mocked,
    };
});

import { convertViaBrowser } from '../core/browserBridge.ts';
import { readFile, writeFile } from 'fs/promises';

// ─── helpers ───────────────────────────────────────────────────────────────

const jpegFormat: FileFormat = { name: 'JPEG', mime: 'image/jpeg', extension: 'jpeg', from: true, to: true, format: 'jpeg', internal: 'jpeg' };
const pngFormat: FileFormat  = { name: 'PNG',  mime: 'image/png',  extension: 'png',  from: true, to: true, format: 'png', internal: 'png' };

function makeHandler(name: string, formats: FileFormat[]): FormatHandler {
    return {
        name,
        ready: true,
        supportedFormats: formats,
        doConvert: vi.fn().mockResolvedValue([{ name: 'output.png', bytes: new Uint8Array([1, 2, 3]) }]),
        init: vi.fn().mockResolvedValue(undefined),
    };
}

function makeGraph(pathNodes: any[] | null): TraversionGraph {
    const gen = (async function* () {
        if (pathNodes) yield pathNodes;
    })();
    return { searchPath: vi.fn().mockReturnValue(gen) } as unknown as TraversionGraph;
}

function getCallback(server: McpServer): (args: any) => Promise<any> {
    const call = (server.tool as ReturnType<typeof vi.fn>).mock.calls[0];
    return call[3]; // 4th arg is the handler callback
}

function makeMockServer(): McpServer {
    return { tool: vi.fn() } as unknown as McpServer;
}

// ─── tests ─────────────────────────────────────────────────────────────────

describe('registerConvertFileTool', () => {
    beforeEach(() => {
        vi.mocked(convertViaBrowser).mockReset();
        vi.mocked(readFile).mockReset();
        vi.mocked(writeFile).mockReset();
    });

    it('registers a tool named convert_file', () => {
        const server = makeMockServer();
        registerConvertFileTool(server, Promise.resolve({ handlers: [], graph: makeGraph(null) }));
        expect(server.tool).toHaveBeenCalledWith('convert_file', expect.any(String), expect.any(Object), expect.any(Function));
    });

    it('runs native path when both formats are found and path exists', async () => {
        const handler = makeHandler('TestHandler', [jpegFormat, pngFormat]);
        const path = [
            { format: jpegFormat, handler },
            { format: pngFormat, handler },
        ];
        const server = makeMockServer();
        registerConvertFileTool(server, Promise.resolve({ handlers: [handler], graph: makeGraph(path) }));
        const cb = getCallback(server);

        const result = await cb({
            fileName: 'test.jpg',
            base64Bytes: Buffer.from('hello').toString('base64'),
            inputMime: 'image/jpeg', inputExtension: 'jpeg',
            outputMime: 'image/png',  outputExtension: 'png',
        });

        expect(result.isError).toBeFalsy();
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed[0].fileName).toBe('output.png');
        expect(convertViaBrowser).not.toHaveBeenCalled();
    });

    it('falls back to browser bridge when no native path exists', async () => {
        const handler = makeHandler('TestHandler', [jpegFormat, pngFormat]);
        vi.mocked(convertViaBrowser).mockResolvedValue([{ fileName: 'bridge.png', base64Bytes: 'YWJj' }]);

        const server = makeMockServer();
        // Graph yields nothing → no native path
        registerConvertFileTool(server, Promise.resolve({ handlers: [handler], graph: makeGraph(null) }));
        const cb = getCallback(server);

        const result = await cb({
            fileName: 'test.jpg',
            base64Bytes: 'aGVsbG8=',
            inputMime: 'image/jpeg', inputExtension: 'jpeg',
            outputMime: 'image/png',  outputExtension: 'png',
        });

        expect(result.isError).toBeFalsy();
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed[0].fileName).toBe('bridge.png');
        expect(convertViaBrowser).toHaveBeenCalledWith(
            'test.jpg', 'aGVsbG8=', 'image/jpeg', 'jpeg', 'image/png', 'png', 'medium'
        );
    });

    it('falls back to bridge when input format is only in browser-only handlers (native inputMatch=null)', async () => {
        // No native handlers — inputMatch will be null
        vi.mocked(convertViaBrowser).mockResolvedValue([{ fileName: 'out.png', base64Bytes: 'eHl6' }]);

        const server = makeMockServer();
        registerConvertFileTool(server, Promise.resolve({ handlers: [], graph: makeGraph(null) }));
        const cb = getCallback(server);

        const result = await cb({
            fileName: 'exotic.bsor',
            base64Bytes: 'aGVsbG8=',
            inputMime: 'application/x-bsor', inputExtension: 'bsor',
            outputMime: 'image/png',          outputExtension: 'png',
        });

        expect(result.isError).toBeFalsy();
        expect(convertViaBrowser).toHaveBeenCalledWith(
            'exotic.bsor', 'aGVsbG8=', 'application/x-bsor', 'bsor', 'image/png', 'png', 'medium'
        );
    });

    it('returns bridge error when bridge fails for browser-only input format', async () => {
        vi.mocked(convertViaBrowser).mockRejectedValue(new Error('Input format application/x-bsor (bsor) not found'));

        const server = makeMockServer();
        registerConvertFileTool(server, Promise.resolve({ handlers: [], graph: makeGraph(null) }));
        const cb = getCallback(server);

        const result = await cb({
            fileName: 'exotic.bsor',
            base64Bytes: 'aGVsbG8=',
            inputMime: 'application/x-bsor', inputExtension: 'bsor',
            outputMime: 'image/png',          outputExtension: 'png',
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("This conversion isn't available yet.");
    });

    it('returns bridge error when bridge fails for browser-only output format', async () => {
        const inputHandler = makeHandler('InputHandler', [jpegFormat]);
        vi.mocked(convertViaBrowser).mockRejectedValue(new Error('Output format model/gltf+json (gltf) not found or not writable'));

        const server = makeMockServer();
        registerConvertFileTool(server, Promise.resolve({ handlers: [inputHandler], graph: makeGraph(null) }));
        const cb = getCallback(server);

        const result = await cb({
            fileName: 'test.jpg',
            base64Bytes: 'aGVsbG8=',
            inputMime: 'image/jpeg', inputExtension: 'jpeg',
            outputMime: 'model/gltf+json', outputExtension: 'gltf',
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("This conversion isn't available yet.");
    });

    it('returns bridge error when both formats exist natively but bridge also fails', async () => {
        const handler = makeHandler('TestHandler', [jpegFormat, pngFormat]);
        vi.mocked(convertViaBrowser).mockRejectedValue(new Error('No conversion path found between image/jpeg and image/png'));

        const server = makeMockServer();
        registerConvertFileTool(server, Promise.resolve({ handlers: [handler], graph: makeGraph(null) }));
        const cb = getCallback(server);

        const result = await cb({
            fileName: 'test.jpg',
            base64Bytes: 'aGVsbG8=',
            inputMime: 'image/jpeg', inputExtension: 'jpeg',
            outputMime: 'image/png',  outputExtension: 'png',
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("This conversion isn't available yet.");
        expect(result.content[0].text).toContain("francois.prevot@frog.co");
    });

    it('returns error when neither base64Bytes nor filePath is provided', async () => {
        const server = makeMockServer();
        registerConvertFileTool(server, Promise.resolve({ handlers: [], graph: makeGraph(null) }));
        const cb = getCallback(server);

        const result = await cb({
            inputMime: 'image/jpeg', inputExtension: 'jpeg',
            outputMime: 'image/png',  outputExtension: 'png',
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/filePath or base64Bytes/);
    });

    it('returns error when base64Bytes provided without fileName', async () => {
        const server = makeMockServer();
        registerConvertFileTool(server, Promise.resolve({ handlers: [], graph: makeGraph(null) }));
        const cb = getCallback(server);

        const result = await cb({
            base64Bytes: 'aGVsbG8=',
            inputMime: 'image/jpeg', inputExtension: 'jpeg',
            outputMime: 'image/png',  outputExtension: 'png',
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/fileName/);
    });

    it('reads file from disk when filePath is provided', async () => {
        const diskBytes = Buffer.from('hello');
        vi.mocked(readFile).mockResolvedValue(diskBytes as any);

        const handler = makeHandler('TestHandler', [jpegFormat, pngFormat]);
        const path = [
            { format: jpegFormat, handler },
            { format: pngFormat,  handler },
        ];
        const server = makeMockServer();
        registerConvertFileTool(server, Promise.resolve({ handlers: [handler], graph: makeGraph(path) }));
        const cb = getCallback(server);

        const result = await cb({
            filePath: '/tmp/test.jpg',
            inputMime: 'image/jpeg', inputExtension: 'jpeg',
            outputMime: 'image/png',  outputExtension: 'png',
        });

        expect(readFile).toHaveBeenCalledWith('/tmp/test.jpg');
        expect(result.isError).toBeFalsy();
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed[0].fileName).toBe('output.png');
    });

    it('infers fileName from filePath basename', async () => {
        vi.mocked(readFile).mockResolvedValue(Buffer.from('hello') as any);
        vi.mocked(convertViaBrowser).mockResolvedValue([{ fileName: 'out.png', base64Bytes: 'YWJj' }]);

        const server = makeMockServer();
        registerConvertFileTool(server, Promise.resolve({ handlers: [], graph: makeGraph(null) }));
        const cb = getCallback(server);

        await cb({
            filePath: '/some/path/photo.jpg',
            inputMime: 'image/jpeg', inputExtension: 'jpeg',
            outputMime: 'image/png',  outputExtension: 'png',
        });

        expect(convertViaBrowser).toHaveBeenCalledWith(
            'photo.jpg', expect.any(String), 'image/jpeg', 'jpeg', 'image/png', 'png', 'medium'
        );
    });

    it('returns error when filePath cannot be read', async () => {
        vi.mocked(readFile).mockRejectedValue(new Error('ENOENT: no such file or directory'));

        const server = makeMockServer();
        registerConvertFileTool(server, Promise.resolve({ handlers: [], graph: makeGraph(null) }));
        const cb = getCallback(server);

        const result = await cb({
            filePath: '/nonexistent/file.jpg',
            inputMime: 'image/jpeg', inputExtension: 'jpeg',
            outputMime: 'image/png',  outputExtension: 'png',
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/ENOENT/);
    });

    it('writes output to disk when outputFilePath is provided (native path)', async () => {
        vi.mocked(writeFile).mockResolvedValue(undefined);

        const handler = makeHandler('TestHandler', [jpegFormat, pngFormat]);
        const path = [
            { format: jpegFormat, handler },
            { format: pngFormat,  handler },
        ];
        const server = makeMockServer();
        registerConvertFileTool(server, Promise.resolve({ handlers: [handler], graph: makeGraph(path) }));
        const cb = getCallback(server);

        const result = await cb({
            fileName: 'test.jpg',
            base64Bytes: Buffer.from('hello').toString('base64'),
            inputMime: 'image/jpeg', inputExtension: 'jpeg',
            outputMime: 'image/png',  outputExtension: 'png',
            outputFilePath: '/tmp/output.png',
        });

        expect(writeFile).toHaveBeenCalledWith('/tmp/output.png', expect.any(Uint8Array));
        expect(result.isError).toBeFalsy();
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.savedTo).toContain('/tmp/output.png');
    });

    it('writes output to disk when outputFilePath is provided (bridge path)', async () => {
        vi.mocked(writeFile).mockResolvedValue(undefined);
        vi.mocked(convertViaBrowser).mockResolvedValue([{ fileName: 'bridge.png', base64Bytes: 'YWJj' }]);

        const server = makeMockServer();
        registerConvertFileTool(server, Promise.resolve({ handlers: [], graph: makeGraph(null) }));
        const cb = getCallback(server);

        const result = await cb({
            fileName: 'test.jpg',
            base64Bytes: 'aGVsbG8=',
            inputMime: 'image/jpeg', inputExtension: 'jpeg',
            outputMime: 'image/png',  outputExtension: 'png',
            outputFilePath: '/tmp/output.png',
        });

        expect(writeFile).toHaveBeenCalledWith('/tmp/output.png', expect.any(Uint8Array));
        expect(result.isError).toBeFalsy();
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.savedTo).toContain('/tmp/output.png');
    });

    it('falls back to bridge when native handler throws', async () => {
        const handler = makeHandler('TestHandler', [jpegFormat, pngFormat]);
        vi.mocked(handler.doConvert as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('bad data'));
        vi.mocked(convertViaBrowser).mockResolvedValue([{ fileName: 'bridge.png', base64Bytes: 'YWJj' }]);
        const path = [
            { format: jpegFormat, handler },
            { format: pngFormat,  handler },
        ];

        const server = makeMockServer();
        registerConvertFileTool(server, Promise.resolve({ handlers: [handler], graph: makeGraph(path) }));
        const cb = getCallback(server);

        const result = await cb({
            fileName: 'test.jpg',
            base64Bytes: Buffer.from('hello').toString('base64'),
            inputMime: 'image/jpeg', inputExtension: 'jpeg',
            outputMime: 'image/png',  outputExtension: 'png',
        });

        expect(result.isError).toBeFalsy();
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed[0].fileName).toBe('bridge.png');
        expect(convertViaBrowser).toHaveBeenCalled();
    });

    it('returns safe copy when native and bridge both fail', async () => {
        const handler = makeHandler('TestHandler', [jpegFormat, pngFormat]);
        vi.mocked(handler.doConvert as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('bad data at file:///tmp/handler.ts:1:1'));
        vi.mocked(convertViaBrowser).mockRejectedValue(new Error('Browser bridge requires a production build. Run `bun run build` first.'));
        const path = [
            { format: jpegFormat, handler },
            { format: pngFormat,  handler },
        ];

        const server = makeMockServer();
        registerConvertFileTool(server, Promise.resolve({ handlers: [handler], graph: makeGraph(path) }));
        const cb = getCallback(server);

        const result = await cb({
            fileName: 'test.jpg',
            base64Bytes: Buffer.from('hello').toString('base64'),
            inputMime: 'image/jpeg', inputExtension: 'jpeg',
            outputMime: 'image/png',  outputExtension: 'png',
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Something went wrong while converting this file.');
        expect(result.content[0].text).toContain('francois.prevot@frog.co');
        expect(result.content[0].text).not.toContain('file:///');
        expect(result.content[0].text).not.toContain('bun run build');
    });
});
