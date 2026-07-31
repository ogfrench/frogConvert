import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleConvert } from './convert.ts';
import type { FormatHandler, FileFormat } from '../../core/FormatHandler/FormatHandler.ts';
import type { TraversionGraph } from '../../core/TraversionGraph/TraversionGraph.ts';

vi.mock('../../mcp/core/browserBridge.ts', () => ({
    convertViaBrowser: vi.fn(),
}));

import { convertViaBrowser } from '../../mcp/core/browserBridge.ts';

// ─── helpers ───────────────────────────────────────────────────────────────

const jpegFormat: FileFormat = { name: 'JPEG', mime: 'image/jpeg', extension: 'jpeg', from: true, to: true, format: 'jpeg', internal: 'jpeg' };
const pngFormat: FileFormat  = { name: 'PNG',  mime: 'image/png',  extension: 'png',  from: true, to: true, format: 'png', internal: 'png'  };

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

function makeJsonRequest(body: object): Request {
    return new Request('http://localhost/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

// ─── tests ─────────────────────────────────────────────────────────────────

describe('handleConvert (size limits)', () => {
    it('returns 413 for JSON body whose base64Bytes exceeds MAX_UPLOAD_MB', async () => {
        vi.resetModules();
        process.env.MAX_UPLOAD_MB = '0';
        const { handleConvert: handleConvertFresh } = await import('./convert.ts');

        const req = {
            headers: { get: (k: string) => k.toLowerCase() === 'content-length' ? '1000000' : null },
        } as unknown as Request;

        const res = await handleConvertFresh(req, [], makeGraph(null));
        expect(res.status).toBe(413);

        delete process.env.MAX_UPLOAD_MB;
        vi.resetModules();
    });

    it('returns 413 for multipart file whose size exceeds MAX_UPLOAD_MB', async () => {
        vi.resetModules();
        process.env.MAX_UPLOAD_MB = '0';
        const { handleConvert: handleConvertFresh } = await import('./convert.ts');

        const req = {
            headers: { get: (k: string) => k.toLowerCase() === 'content-type' ? 'multipart/form-data' : k.toLowerCase() === 'content-length' ? '1000000' : null },
        } as unknown as Request;

        const res = await handleConvertFresh(req, [], makeGraph(null));
        expect(res.status).toBe(413);

        delete process.env.MAX_UPLOAD_MB;
        vi.resetModules();
    });
});

describe('handleConvert (JSON mode)', () => {
    beforeEach(() => {
        vi.mocked(convertViaBrowser).mockReset();
    });

    it('returns converted files via native path when path exists', async () => {
        const handler = makeHandler('TestHandler', [jpegFormat, pngFormat]);
        const path = [
            { format: jpegFormat, handler },
            { format: pngFormat,  handler },
        ];

        const req = makeJsonRequest({
            fileName: 'test.jpg',
            base64Bytes: Buffer.from('hello').toString('base64'),
            inputMime: 'image/jpeg', inputExt: 'jpeg',
            outputMime: 'image/png', outputExt: 'png',
        });

        const res = await handleConvert(req, [handler], makeGraph(path));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(Array.isArray(body)).toBe(true);
        expect(body[0].fileName).toBe('output.png');
        expect(convertViaBrowser).not.toHaveBeenCalled();
    });

    it('falls back to browser bridge when no native path', async () => {
        const handler = makeHandler('TestHandler', [jpegFormat, pngFormat]);
        vi.mocked(convertViaBrowser).mockResolvedValue([{ fileName: 'bridge.png', base64Bytes: 'YWJj' }]);

        const req = makeJsonRequest({
            fileName: 'test.jpg',
            base64Bytes: 'aGVsbG8=',
            inputMime: 'image/jpeg', inputExt: 'jpeg',
            outputMime: 'image/png', outputExt: 'png',
        });

        const res = await handleConvert(req, [handler], makeGraph(null));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body[0].fileName).toBe('bridge.png');
        expect(convertViaBrowser).toHaveBeenCalledWith('test.jpg', 'aGVsbG8=', 'image/jpeg', 'jpeg', 'image/png', 'png', 'lossless');
    });

    it('falls back to bridge when input format is only browser-only (no native inputMatch)', async () => {
        vi.mocked(convertViaBrowser).mockResolvedValue([{ fileName: 'out.png', base64Bytes: 'eHl6' }]);

        const req = makeJsonRequest({
            fileName: 'exotic.bsor',
            base64Bytes: 'aGVsbG8=',
            inputMime: 'application/x-bsor', inputExt: 'bsor',
            outputMime: 'image/png', outputExt: 'png',
        });

        const res = await handleConvert(req, [], makeGraph(null));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body[0].fileName).toBe('out.png');
    });

    it('returns 422 when bridge fails for browser-only input format', async () => {
        vi.mocked(convertViaBrowser).mockRejectedValue(new Error('not found'));

        const req = makeJsonRequest({
            fileName: 'exotic.bsor',
            base64Bytes: 'aGVsbG8=',
            inputMime: 'application/x-bsor', inputExt: 'bsor',
            outputMime: 'image/png', outputExt: 'png',
        });

        const res = await handleConvert(req, [], makeGraph(null));
        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error).toContain("This conversion isn't available yet.");
        expect(body.error).toContain("francois.prevot@frog.co");
    });

    it('returns 422 when bridge fails for browser-only output format', async () => {
        const inputHandler = makeHandler('InputHandler', [jpegFormat]);
        vi.mocked(convertViaBrowser).mockRejectedValue(new Error('not found'));

        const req = makeJsonRequest({
            fileName: 'test.jpg',
            base64Bytes: 'aGVsbG8=',
            inputMime: 'image/jpeg', inputExt: 'jpeg',
            outputMime: 'model/gltf+json', outputExt: 'gltf',
        });

        const res = await handleConvert(req, [inputHandler], makeGraph(null));
        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error).toContain("This conversion isn't available yet.");
        expect(body.error).toContain("francois.prevot@frog.co");
    });

    it('returns 422 when both formats found natively but bridge also fails', async () => {
        const handler = makeHandler('TestHandler', [jpegFormat, pngFormat]);
        vi.mocked(convertViaBrowser).mockRejectedValue(new Error('No conversion path found between image/jpeg and image/png'));

        const req = makeJsonRequest({
            fileName: 'test.jpg',
            base64Bytes: 'aGVsbG8=',
            inputMime: 'image/jpeg', inputExt: 'jpeg',
            outputMime: 'image/png',  outputExt: 'png',
        });

        const res = await handleConvert(req, [handler], makeGraph(null));
        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error).toContain("This conversion isn't available yet.");
        expect(body.error).toContain("francois.prevot@frog.co");
    });

    it('returns 400 when required JSON fields are missing', async () => {
        const req = makeJsonRequest({ fileName: 'test.jpg' });
        const res = await handleConvert(req, [], makeGraph(null));
        expect(res.status).toBe(400);
    });

    it('returns 415 for unsupported content-type', async () => {
        const req = new Request('http://localhost/convert', {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: 'hello',
        });
        const res = await handleConvert(req, [], makeGraph(null));
        expect(res.status).toBe(415);
    });

    it('falls back to bridge when native handler throws during conversion', async () => {
        const handler = makeHandler('TestHandler', [jpegFormat, pngFormat]);
        vi.mocked(handler.doConvert as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('bad data'));
        vi.mocked(convertViaBrowser).mockResolvedValue([{ fileName: 'bridge.png', base64Bytes: 'YWJj' }]);
        const path = [
            { format: jpegFormat, handler },
            { format: pngFormat,  handler },
        ];

        const req = makeJsonRequest({
            fileName: 'test.jpg',
            base64Bytes: Buffer.from('hello').toString('base64'),
            inputMime: 'image/jpeg', inputExt: 'jpeg',
            outputMime: 'image/png',  outputExt: 'png',
        });

        const res = await handleConvert(req, [handler], makeGraph(path));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body[0].fileName).toBe('bridge.png');
        expect(convertViaBrowser).toHaveBeenCalled();
    });

    it('returns safe copy when native and bridge conversions both fail', async () => {
        const handler = makeHandler('TestHandler', [jpegFormat, pngFormat]);
        vi.mocked(handler.doConvert as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('bad data at file:///tmp/handler.ts:1:1'));
        vi.mocked(convertViaBrowser).mockRejectedValue(new Error('Browser bridge requires a production build. Run `bun run build` first.'));
        const path = [
            { format: jpegFormat, handler },
            { format: pngFormat,  handler },
        ];

        const req = makeJsonRequest({
            fileName: 'test.jpg',
            base64Bytes: Buffer.from('hello').toString('base64'),
            inputMime: 'image/jpeg', inputExt: 'jpeg',
            outputMime: 'image/png',  outputExt: 'png',
        });

        const res = await handleConvert(req, [handler], makeGraph(path));
        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error).toContain('Something went wrong while converting this file.');
        expect(body.error).toContain('francois.prevot@frog.co');
        expect(body.error).not.toContain('file:///');
        expect(body.error).not.toContain('bun run build');
    });
});
