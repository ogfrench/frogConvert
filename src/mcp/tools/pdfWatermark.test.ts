import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { registerPdfWatermarkTool } from './pdfWatermark.ts';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

vi.mock('fs/promises', () => {
  const mocked = { readFile: vi.fn(), writeFile: vi.fn() };
  return { ...mocked, default: mocked };
});

import { writeFile } from 'fs/promises';

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

describe('registerPdfWatermarkTool', () => {
  beforeEach(() => {
    vi.mocked(writeFile).mockReset();
    delete process.env.MAX_UPLOAD_MB;
  });

  it('registers a tool named pdf_watermark', () => {
    const server = makeMockServer();
    registerPdfWatermarkTool(server);
    expect(server.tool).toHaveBeenCalledWith(
      'pdf_watermark',
      expect.any(String),
      expect.any(Object),
      expect.any(Function)
    );
  });

  it('text watermark on all pages by default', async () => {
    const pdf = await makePdf(3);
    const server = makeMockServer();
    registerPdfWatermarkTool(server);
    const cb = getCallback(server);

    const result = await cb({
      input: { base64Bytes: b64(pdf), fileName: 'doc.pdf' },
      text: 'CONFIDENTIAL',
      fontSize: 64,
      colorHex: '#808080',
      opacity: 0.2,
      rotationDegrees: -45,
      repeat: false,
    });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed[0].fileName).toBe('doc_watermarked.pdf');
    const out = await PDFDocument.load(new Uint8Array(Buffer.from(parsed[0].base64Bytes, 'base64')));
    expect(out.getPageCount()).toBe(3);
  });

  it('text watermark on specified pages only', async () => {
    const pdf = await makePdf(5);
    const server = makeMockServer();
    registerPdfWatermarkTool(server);
    const cb = getCallback(server);

    const result = await cb({
      input: { base64Bytes: b64(pdf), fileName: 'doc.pdf' },
      text: 'DRAFT',
      fontSize: 48,
      colorHex: '#FF0000',
      opacity: 0.3,
      rotationDegrees: 0,
      repeat: false,
      pageNums: [1, 3],
    });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    const out = await PDFDocument.load(new Uint8Array(Buffer.from(parsed[0].base64Bytes, 'base64')));
    expect(out.getPageCount()).toBe(5);
  });

  it('repeat: true tiles the watermark', async () => {
    const pdf = await makePdf(1);
    const server = makeMockServer();
    registerPdfWatermarkTool(server);
    const cb = getCallback(server);

    const result = await cb({
      input: { base64Bytes: b64(pdf), fileName: 'doc.pdf' },
      text: 'CONFIDENTIAL',
      fontSize: 64,
      colorHex: '#808080',
      opacity: 0.2,
      rotationDegrees: -45,
      repeat: true,
    });

    expect(result.isError).toBeFalsy();
  });

  it('writes to outputFilePath and returns savedTo', async () => {
    const pdf = await makePdf(1);
    vi.mocked(writeFile).mockResolvedValue(undefined);
    const server = makeMockServer();
    registerPdfWatermarkTool(server);
    const cb = getCallback(server);

    const result = await cb({
      input: { base64Bytes: b64(pdf), fileName: 'doc.pdf' },
      text: 'X',
      fontSize: 32,
      colorHex: '#000000',
      opacity: 0.5,
      rotationDegrees: 0,
      repeat: false,
      outputFilePath: '/tmp/wm.pdf',
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.savedTo).toEqual(['/tmp/wm.pdf']);
    expect(writeFile).toHaveBeenCalledWith('/tmp/wm.pdf', expect.any(Uint8Array));
  });

  it('errors on bad colorHex', async () => {
    const pdf = await makePdf(1);
    const server = makeMockServer();
    registerPdfWatermarkTool(server);
    const cb = getCallback(server);

    const result = await cb({
      input: { base64Bytes: b64(pdf), fileName: 'doc.pdf' },
      text: 'X',
      fontSize: 32,
      colorHex: 'red',
      opacity: 0.5,
      rotationDegrees: 0,
      repeat: false,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/color/i);
  });

  it('errors on out-of-range page', async () => {
    const pdf = await makePdf(3);
    const server = makeMockServer();
    registerPdfWatermarkTool(server);
    const cb = getCallback(server);

    const result = await cb({
      input: { base64Bytes: b64(pdf), fileName: 'doc.pdf' },
      text: 'X',
      fontSize: 32,
      colorHex: '#000000',
      opacity: 0.5,
      rotationDegrees: 0,
      repeat: false,
      pageNums: [99],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/page 99/);
  });

  it('errors when input is missing both filePath and base64Bytes', async () => {
    const server = makeMockServer();
    registerPdfWatermarkTool(server);
    const cb = getCallback(server);

    const result = await cb({
      input: { fileName: 'doc.pdf' },
      text: 'X',
      fontSize: 32,
      colorHex: '#000000',
      opacity: 0.5,
      rotationDegrees: 0,
      repeat: false,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/filePath or base64Bytes/);
  });
});
