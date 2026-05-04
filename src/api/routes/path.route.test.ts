import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handlePath } from './path.ts';
import type { FormatHandler, FileFormat } from '../../core/FormatHandler/FormatHandler.ts';
import type { TraversionGraph } from '../../core/TraversionGraph/TraversionGraph.ts';

vi.mock('../../mcp/core/browserBridge.ts', () => ({
    canConvertViaBrowser: vi.fn(),
}));

import { canConvertViaBrowser } from '../../mcp/core/browserBridge.ts';

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

function makeUrl(params: Record<string, string>): URL {
    const u = new URL('http://localhost/path');
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u;
}

const defaultParams = { inputMime: 'image/jpeg', inputExt: 'jpeg', outputMime: 'image/png', outputExt: 'png' };

// ─── tests ─────────────────────────────────────────────────────────────────

describe('handlePath', () => {
    beforeEach(() => {
        vi.mocked(canConvertViaBrowser).mockReset();
    });

    it('returns 400 when required query params are missing', async () => {
        const url = new URL('http://localhost/path');
        const res = await handlePath(url, [], makeGraph(null));
        expect(res.status).toBe(400);
    });

    it('returns native path array when path exists', async () => {
        const handler = makeHandler('TestHandler', [jpegFormat, pngFormat]);
        const path = [
            { format: jpegFormat, handler },
            { format: pngFormat,  handler },
        ];

        const res = await handlePath(makeUrl(defaultParams), [handler], makeGraph(path));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.path).toBeDefined();
        expect(body.path[0].handler).toBe('TestHandler');
        expect(canConvertViaBrowser).not.toHaveBeenCalled();
    });

    it('returns browserAssisted:true when no native path but bridge says yes', async () => {
        const handler = makeHandler('TestHandler', [jpegFormat, pngFormat]);
        vi.mocked(canConvertViaBrowser).mockResolvedValue(true);

        const res = await handlePath(makeUrl(defaultParams), [handler], makeGraph(null));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.browserAssisted).toBe(true);
        expect(body.message).toMatch(/browser bridge/);
    });

    it('returns 404 when no native path and bridge says no', async () => {
        const handler = makeHandler('TestHandler', [jpegFormat, pngFormat]);
        vi.mocked(canConvertViaBrowser).mockResolvedValue(false);

        const res = await handlePath(makeUrl(defaultParams), [handler], makeGraph(null));
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toContain("This conversion isn't available yet.");
        expect(body.error).toContain("francois.prevot@frog.co");
    });

    it('returns 404 when bridge check throws', async () => {
        const handler = makeHandler('TestHandler', [jpegFormat, pngFormat]);
        vi.mocked(canConvertViaBrowser).mockRejectedValue(new Error('bridge down'));

        const res = await handlePath(makeUrl(defaultParams), [handler], makeGraph(null));
        expect(res.status).toBe(404);
    });

    it('returns 404 when input format is not found in native handlers', async () => {
        // No handlers registered
        const res = await handlePath(makeUrl(defaultParams), [], makeGraph(null));
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toContain("This conversion isn't available yet.");
        expect(body.error).toContain("francois.prevot@frog.co");
        expect(canConvertViaBrowser).not.toHaveBeenCalled();
    });

    it('returns 404 when output format is not found in native handlers', async () => {
        const inputHandler = makeHandler('InputHandler', [jpegFormat]);
        const res = await handlePath(makeUrl(defaultParams), [inputHandler], makeGraph(null));
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toContain("This conversion isn't available yet.");
        expect(body.error).toContain("francois.prevot@frog.co");
        expect(canConvertViaBrowser).not.toHaveBeenCalled();
    });

    it('path response includes handler, mime, extension, format fields', async () => {
        const handler = makeHandler('TestHandler', [jpegFormat, pngFormat]);
        const path = [
            { format: jpegFormat, handler },
            { format: pngFormat,  handler },
        ];

        const res = await handlePath(makeUrl(defaultParams), [handler], makeGraph(path));
        const body = await res.json();

        expect(body.path[0]).toEqual({
            handler: 'TestHandler',
            mime: 'image/jpeg',
            extension: 'jpeg',
            format: 'jpeg',
        });
    });
});
