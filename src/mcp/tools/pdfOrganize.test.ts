import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { registerPdfOrganizeTool } from './pdfOrganize.ts';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

vi.mock('fs/promises', () => {
    const mocked = { readFile: vi.fn(), writeFile: vi.fn() };
    return { ...mocked, default: mocked };
});

import { readFile, writeFile } from 'fs/promises';

async function makePdf(pageCount: number): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    for (let i = 0; i < pageCount; i++) doc.addPage([100, 100]);
    return new Uint8Array(await doc.save());
}

function makeMockServer(): McpServer {
    return { tool: vi.fn() } as unknown as McpServer;
}

function getCallback(server: McpServer): (args: any) => Promise<any> {
    const call = (server.tool as ReturnType<typeof vi.fn>).mock.calls[0];
    return call[3];
}

function b64(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64');
}

describe('registerPdfOrganizeTool', () => {
    beforeEach(() => {
        vi.mocked(readFile).mockReset();
        vi.mocked(writeFile).mockReset();
    });

    it('registers a tool named pdf_organize', () => {
        const server = makeMockServer();
        registerPdfOrganizeTool(server);
        expect(server.tool).toHaveBeenCalledWith('pdf_organize', expect.any(String), expect.any(Object), expect.any(Function));
    });

    it('maps blank: true to a blank PageEntry and inserts a blank page', async () => {
        const pdf = await makePdf(1);
        const server = makeMockServer();
        registerPdfOrganizeTool(server);
        const cb = getCallback(server);

        const result = await cb({
            inputs: [{ base64Bytes: b64(pdf), fileName: 'a.pdf' }],
            pages: [
                { sourceIndex: 0, pageNum: 1 },
                { sourceIndex: -1, pageNum: 0, blank: true, blankSize: { width: 200, height: 300 } },
            ],
        });

        expect(result.isError).toBeFalsy();
        const parsed = JSON.parse(result.content[0].text);
        const out = await PDFDocument.load(new Uint8Array(Buffer.from(parsed[0].base64Bytes, 'base64')));
        expect(out.getPageCount()).toBe(2);
        const blank = out.getPage(1);
        expect(blank.getWidth()).toBe(200);
        expect(blank.getHeight()).toBe(300);
    });

    it('treats sourceIndex: -1 without blank flag as blank', async () => {
        const pdf = await makePdf(1);
        const server = makeMockServer();
        registerPdfOrganizeTool(server);
        const cb = getCallback(server);

        const result = await cb({
            inputs: [{ base64Bytes: b64(pdf), fileName: 'a.pdf' }],
            pages: [
                { sourceIndex: -1, pageNum: 0 },
                { sourceIndex: 0, pageNum: 1 },
            ],
        });

        expect(result.isError).toBeFalsy();
        const parsed = JSON.parse(result.content[0].text);
        const out = await PDFDocument.load(new Uint8Array(Buffer.from(parsed[0].base64Bytes, 'base64')));
        expect(out.getPageCount()).toBe(2);
    });

    it('applies rotation from DTO', async () => {
        const pdf = await makePdf(1);
        const server = makeMockServer();
        registerPdfOrganizeTool(server);
        const cb = getCallback(server);

        const result = await cb({
            inputs: [{ base64Bytes: b64(pdf), fileName: 'a.pdf' }],
            pages: [{ sourceIndex: 0, pageNum: 1, rotation: 90 }],
        });

        const parsed = JSON.parse(result.content[0].text);
        const out = await PDFDocument.load(new Uint8Array(Buffer.from(parsed[0].base64Bytes, 'base64')));
        expect(out.getPage(0).getRotation().angle).toBe(90);
    });

    it('rejects out-of-range sourceIndex with a descriptive error', async () => {
        const pdf = await makePdf(1);
        const server = makeMockServer();
        registerPdfOrganizeTool(server);
        const cb = getCallback(server);

        const result = await cb({
            inputs: [{ base64Bytes: b64(pdf), fileName: 'a.pdf' }],
            pages: [{ sourceIndex: 5, pageNum: 1 }],
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/sourceIndex 5 out of range/);
    });

    it('rejects negative sourceIndex below -1', async () => {
        const pdf = await makePdf(1);
        const server = makeMockServer();
        registerPdfOrganizeTool(server);
        const cb = getCallback(server);

        const result = await cb({
            inputs: [{ base64Bytes: b64(pdf), fileName: 'a.pdf' }],
            pages: [{ sourceIndex: -2, pageNum: 1 }],
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/out of range/);
    });

    it('writes to outputFilePath and returns savedTo', async () => {
        const pdf = await makePdf(2);
        vi.mocked(writeFile).mockResolvedValue(undefined);
        const server = makeMockServer();
        registerPdfOrganizeTool(server);
        const cb = getCallback(server);

        const result = await cb({
            inputs: [{ base64Bytes: b64(pdf), fileName: 'a.pdf' }],
            pages: [{ sourceIndex: 0, pageNum: 2 }, { sourceIndex: 0, pageNum: 1 }],
            outputFilePath: '/tmp/out.pdf',
        });

        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.savedTo).toEqual(['/tmp/out.pdf']);
        expect(writeFile).toHaveBeenCalledWith('/tmp/out.pdf', expect.any(Uint8Array));
    });
});
