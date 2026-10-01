import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { registerPdfMergeTool } from './pdfMerge.ts';
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

describe('registerPdfMergeTool', () => {
    beforeEach(() => {
        vi.mocked(readFile).mockReset();
        vi.mocked(writeFile).mockReset();
        delete process.env.MAX_UPLOAD_MB;
    });

    it('registers a tool named pdf_merge', () => {
        const server = makeMockServer();
        registerPdfMergeTool(server);
        expect(server.tool).toHaveBeenCalledWith('pdf_merge', expect.any(String), expect.any(Object), expect.any(Function));
    });

    it('merges base64 inputs and returns combined page count', async () => {
        const a = await makePdf(2);
        const b = await makePdf(3);
        const server = makeMockServer();
        registerPdfMergeTool(server);
        const cb = getCallback(server);

        const result = await cb({
            inputs: [
                { base64Bytes: b64(a), fileName: 'a.pdf' },
                { base64Bytes: b64(b), fileName: 'b.pdf' },
            ],
        });

        expect(result.isError).toBeFalsy();
        const parsed = JSON.parse(result.content[0].text);
        const out = await PDFDocument.load(new Uint8Array(Buffer.from(parsed[0].base64Bytes, 'base64')));
        expect(out.getPageCount()).toBe(5);
    });

    it('resolves filePath inputs via readFile', async () => {
        const pdf = await makePdf(1);
        vi.mocked(readFile).mockResolvedValue(Buffer.from(pdf) as any);

        const server = makeMockServer();
        registerPdfMergeTool(server);
        const cb = getCallback(server);

        const result = await cb({
            inputs: [
                { filePath: '/tmp/a.pdf' },
                { filePath: '/tmp/b.pdf' },
            ],
        });

        expect(result.isError).toBeFalsy();
        expect(readFile).toHaveBeenCalledTimes(2);
    });

    it('errors when base64Bytes is provided without fileName', async () => {
        const pdf = await makePdf(1);
        const server = makeMockServer();
        registerPdfMergeTool(server);
        const cb = getCallback(server);

        const result = await cb({
            inputs: [
                { base64Bytes: b64(pdf) },
                { base64Bytes: b64(pdf), fileName: 'b.pdf' },
            ],
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/fileName required/);
    });

    it('errors when neither filePath nor base64Bytes is provided', async () => {
        const pdf = await makePdf(1);
        const server = makeMockServer();
        registerPdfMergeTool(server);
        const cb = getCallback(server);

        const result = await cb({
            inputs: [
                { fileName: 'a.pdf' },
                { base64Bytes: b64(pdf), fileName: 'b.pdf' },
            ],
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/filePath or base64Bytes/);
    });

    it('enforces MAX_UPLOAD_MB', async () => {
        process.env.MAX_UPLOAD_MB = '0';
        const pdf = await makePdf(1);
        const server = makeMockServer();
        registerPdfMergeTool(server);
        const cb = getCallback(server);

        const result = await cb({
            inputs: [
                { base64Bytes: b64(pdf), fileName: 'a.pdf' },
                { base64Bytes: b64(pdf), fileName: 'b.pdf' },
            ],
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/too large/i);
    });

    it('writes to outputFilePath and returns savedTo', async () => {
        const pdf = await makePdf(1);
        vi.mocked(writeFile).mockResolvedValue(undefined);
        const server = makeMockServer();
        registerPdfMergeTool(server);
        const cb = getCallback(server);

        const result = await cb({
            inputs: [
                { base64Bytes: b64(pdf), fileName: 'a.pdf' },
                { base64Bytes: b64(pdf), fileName: 'b.pdf' },
            ],
            outputFilePath: '/tmp/merged.pdf',
        });

        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.savedTo).toEqual(['/tmp/merged.pdf']);
        expect(writeFile).toHaveBeenCalledWith('/tmp/merged.pdf', expect.any(Uint8Array));
    });
});

describe('pdf_merge and the sandbox root', () => {
    // SECURITY.md says FROGCONVERT_SANDBOX_ROOT "pins those paths to one root"
    // for "the REST API and MCP". It was true of the REST routes and of exactly
    // one MCP tool, so the claim did not hold for this one.
    beforeEach(() => {
        vi.mocked(writeFile).mockReset();
        delete process.env.FROGCONVERT_SANDBOX_ROOT;
    });

    const mergeTo = async (outputFilePath: string) => {
        const a = await makePdf(1);
        const server = makeMockServer();
        registerPdfMergeTool(server);
        return getCallback(server)({
            inputs: [{ base64Bytes: b64(a), fileName: 'a.pdf' }],
            outputFilePath,
        });
    };

    it('refuses a write outside the root, and writes nothing', async () => {
        process.env.FROGCONVERT_SANDBOX_ROOT = '/srv/frog';
        const result = await mergeTo('/etc/cron.d/payload');
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/escapes FROGCONVERT_SANDBOX_ROOT/);
        expect(writeFile).not.toHaveBeenCalled();
    });

    it('refuses a traversal dressed up as a path inside the root', async () => {
        process.env.FROGCONVERT_SANDBOX_ROOT = '/srv/frog';
        const result = await mergeTo('/srv/frog/../../etc/cron.d/payload');
        expect(result.isError).toBe(true);
        expect(writeFile).not.toHaveBeenCalled();
    });

    it('allows a write inside the root', async () => {
        process.env.FROGCONVERT_SANDBOX_ROOT = '/srv/frog';
        const result = await mergeTo('/srv/frog/out/merged.pdf');
        expect(result.isError).toBeFalsy();
        expect(writeFile).toHaveBeenCalledOnce();
        expect(JSON.parse(result.content[0].text).savedTo).toEqual(['/srv/frog/out/merged.pdf']);
    });

    it('leaves any path alone when no root is configured', async () => {
        const result = await mergeTo('/tmp/merged.pdf');
        expect(result.isError).toBeFalsy();
        expect(writeFile).toHaveBeenCalledOnce();
    });
});
