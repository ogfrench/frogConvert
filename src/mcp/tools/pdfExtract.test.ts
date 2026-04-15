import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { registerPdfExtractTool } from './pdfExtract.ts';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

vi.mock('fs/promises', () => {
    const mocked = { readFile: vi.fn(), writeFile: vi.fn() };
    return { ...mocked, default: mocked };
});

import { readFile, writeFile } from 'fs/promises';

async function makePdf(pageCount: number): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    for (let i = 0; i < pageCount; i++) doc.addPage();
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

describe('registerPdfExtractTool', () => {
    beforeEach(() => {
        vi.mocked(readFile).mockReset();
        vi.mocked(writeFile).mockReset();
        delete process.env.MAX_UPLOAD_MB;
    });

    it('registers a tool named pdf_extract', () => {
        const server = makeMockServer();
        registerPdfExtractTool(server);
        expect(server.tool).toHaveBeenCalledWith('pdf_extract', expect.any(String), expect.any(Object), expect.any(Function));
    });

    it('extracts one PDF per page when groupAsOne is false', async () => {
        const pdf = await makePdf(5);
        const server = makeMockServer();
        registerPdfExtractTool(server);
        const cb = getCallback(server);

        const result = await cb({
            input: { base64Bytes: b64(pdf), fileName: 'doc.pdf' },
            pageNums: [2, 4],
            groupAsOne: false,
        });

        expect(result.isError).toBeFalsy();
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed).toHaveLength(2);
        expect(parsed[0].fileName).toBe('doc_page_2.pdf');
        expect(parsed[1].fileName).toBe('doc_page_4.pdf');
    });

    it('combines pages into a single PDF when groupAsOne is true', async () => {
        const pdf = await makePdf(5);
        const server = makeMockServer();
        registerPdfExtractTool(server);
        const cb = getCallback(server);

        const result = await cb({
            input: { base64Bytes: b64(pdf), fileName: 'doc.pdf' },
            pageNums: [2, 3, 4],
            groupAsOne: true,
        });

        const parsed = JSON.parse(result.content[0].text);
        expect(parsed).toHaveLength(1);
        const out = await PDFDocument.load(new Uint8Array(Buffer.from(parsed[0].base64Bytes, 'base64')));
        expect(out.getPageCount()).toBe(3);
    });

    it('defaults baseName to input filename stem', async () => {
        const pdf = await makePdf(2);
        const server = makeMockServer();
        registerPdfExtractTool(server);
        const cb = getCallback(server);

        const result = await cb({
            input: { base64Bytes: b64(pdf), fileName: 'report.pdf' },
            pageNums: [1],
            groupAsOne: false,
        });

        const parsed = JSON.parse(result.content[0].text);
        expect(parsed[0].fileName).toBe('report_page_1.pdf');
    });

    it('errors when base64Bytes is provided without fileName', async () => {
        const pdf = await makePdf(1);
        const server = makeMockServer();
        registerPdfExtractTool(server);
        const cb = getCallback(server);

        const result = await cb({
            input: { base64Bytes: b64(pdf) },
            pageNums: [1],
            groupAsOne: false,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/fileName required/);
    });

    it('enforces MAX_UPLOAD_MB', async () => {
        process.env.MAX_UPLOAD_MB = '0';
        const pdf = await makePdf(1);
        const server = makeMockServer();
        registerPdfExtractTool(server);
        const cb = getCallback(server);

        const result = await cb({
            input: { base64Bytes: b64(pdf), fileName: 'a.pdf' },
            pageNums: [1],
            groupAsOne: false,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/too large/i);
    });

    it('writes to outputDir and returns savedTo paths', async () => {
        const pdf = await makePdf(3);
        vi.mocked(writeFile).mockResolvedValue(undefined);
        const server = makeMockServer();
        registerPdfExtractTool(server);
        const cb = getCallback(server);

        const result = await cb({
            input: { base64Bytes: b64(pdf), fileName: 'doc.pdf' },
            pageNums: [1, 2],
            groupAsOne: false,
            outputDir: '/tmp/out',
        });

        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.savedTo).toHaveLength(2);
        expect(writeFile).toHaveBeenCalledTimes(2);
    });
});
