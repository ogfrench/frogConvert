import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PDFDocument } from 'pdf-lib';

vi.mock('fs/promises', () => {
    const mocked = { readFile: vi.fn(), writeFile: vi.fn() };
    return { ...mocked, default: mocked };
});

import { readFile, writeFile } from 'fs/promises';
import { handlePdfMerge, handlePdfOrganize, handlePdfExtract, handlePdfWatermark } from './pdf.ts';

async function makePdf(pageCount: number): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    for (let i = 0; i < pageCount; i++) doc.addPage([100, 100]);
    return new Uint8Array(await doc.save());
}

function b64(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64');
}

function jsonRequest(url: string, body: unknown): Request {
    return new Request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
}

describe('POST /pdf/merge', () => {
    beforeEach(() => {
        vi.mocked(readFile).mockReset();
        vi.mocked(writeFile).mockReset();
    });

    it('returns 400 when inputs has fewer than 2 items', async () => {
        const res = await handlePdfMerge(jsonRequest('http://x/pdf/merge', { inputs: [] }));
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/at least 2/);
    });

    it('merges and returns files array by default', async () => {
        const a = await makePdf(2);
        const b = await makePdf(1);
        const res = await handlePdfMerge(jsonRequest('http://x/pdf/merge', {
            inputs: [
                { base64Bytes: b64(a), fileName: 'a.pdf' },
                { base64Bytes: b64(b), fileName: 'b.pdf' },
            ],
        }));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.files).toHaveLength(1);
        const out = await PDFDocument.load(new Uint8Array(Buffer.from(body.files[0].base64Bytes, 'base64')));
        expect(out.getPageCount()).toBe(3);
    });

    it('writes to outputFilePath and returns savedTo', async () => {
        const pdf = await makePdf(1);
        vi.mocked(writeFile).mockResolvedValue(undefined);
        const res = await handlePdfMerge(jsonRequest('http://x/pdf/merge', {
            inputs: [
                { base64Bytes: b64(pdf), fileName: 'a.pdf' },
                { base64Bytes: b64(pdf), fileName: 'b.pdf' },
            ],
            outputFilePath: '/tmp/m.pdf',
        }));
        const body = await res.json();
        expect(body.savedTo).toEqual(['/tmp/m.pdf']);
        expect(writeFile).toHaveBeenCalled();
    });
});

describe('POST /pdf/organize', () => {
    beforeEach(() => {
        vi.mocked(readFile).mockReset();
        vi.mocked(writeFile).mockReset();
    });

    it('returns 400 when pages is empty', async () => {
        const pdf = await makePdf(1);
        const res = await handlePdfOrganize(jsonRequest('http://x/pdf/organize', {
            inputs: [{ base64Bytes: b64(pdf), fileName: 'a.pdf' }],
            pages: [],
        }));
        expect(res.status).toBe(400);
    });

    it('returns 400 for out-of-range sourceIndex', async () => {
        const pdf = await makePdf(1);
        const res = await handlePdfOrganize(jsonRequest('http://x/pdf/organize', {
            inputs: [{ base64Bytes: b64(pdf), fileName: 'a.pdf' }],
            pages: [{ sourceIndex: 99, pageNum: 1 }],
        }));
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/out of range/);
    });

    it('handles blank page insertion', async () => {
        const pdf = await makePdf(1);
        const res = await handlePdfOrganize(jsonRequest('http://x/pdf/organize', {
            inputs: [{ base64Bytes: b64(pdf), fileName: 'a.pdf' }],
            pages: [
                { sourceIndex: 0, pageNum: 1 },
                { sourceIndex: -1, pageNum: 0, blank: true },
            ],
        }));
        expect(res.status).toBe(200);
        const body = await res.json();
        const out = await PDFDocument.load(new Uint8Array(Buffer.from(body.files[0].base64Bytes, 'base64')));
        expect(out.getPageCount()).toBe(2);
    });
});

describe('POST /pdf/extract', () => {
    beforeEach(() => {
        vi.mocked(readFile).mockReset();
        vi.mocked(writeFile).mockReset();
    });

    it('returns 400 when pageNums is empty', async () => {
        const pdf = await makePdf(1);
        const res = await handlePdfExtract(jsonRequest('http://x/pdf/extract', {
            input: { base64Bytes: b64(pdf), fileName: 'a.pdf' },
            pageNums: [],
        }));
        expect(res.status).toBe(400);
    });

    it('returns 400 when input is missing', async () => {
        const res = await handlePdfExtract(jsonRequest('http://x/pdf/extract', {
            pageNums: [1],
        }));
        expect(res.status).toBe(400);
    });

    it('extracts pages and returns files array', async () => {
        const pdf = await makePdf(5);
        const res = await handlePdfExtract(jsonRequest('http://x/pdf/extract', {
            input: { base64Bytes: b64(pdf), fileName: 'doc.pdf' },
            pageNums: [1, 3],
            groupAsOne: false,
        }));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.files).toHaveLength(2);
        expect(body.files[0].name).toBe('doc_page_1.pdf');
    });

    it('writes to outputDir and returns savedTo paths', async () => {
        const pdf = await makePdf(3);
        vi.mocked(writeFile).mockResolvedValue(undefined);
        const res = await handlePdfExtract(jsonRequest('http://x/pdf/extract', {
            input: { base64Bytes: b64(pdf), fileName: 'doc.pdf' },
            pageNums: [1, 2],
            groupAsOne: false,
            outputDir: '/tmp/out',
        }));
        const body = await res.json();
        expect(body.savedTo).toHaveLength(2);
        expect(writeFile).toHaveBeenCalledTimes(2);
    });
});

describe('POST /pdf/watermark', () => {
    beforeEach(() => {
        vi.mocked(readFile).mockReset();
        vi.mocked(writeFile).mockReset();
    });

    it('returns 400 when input is missing', async () => {
        const res = await handlePdfWatermark(jsonRequest('http://x/pdf/watermark', {
            text: 'X',
        }));
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/input required/);
    });

    it('returns 400 when text is missing', async () => {
        const pdf = await makePdf(1);
        const res = await handlePdfWatermark(jsonRequest('http://x/pdf/watermark', {
            input: { base64Bytes: b64(pdf), fileName: 'doc.pdf' },
        }));
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/text/);
    });

    it('text watermark on all pages by default returns files array', async () => {
        const pdf = await makePdf(3);
        const res = await handlePdfWatermark(jsonRequest('http://x/pdf/watermark', {
            input: { base64Bytes: b64(pdf), fileName: 'doc.pdf' },
            text: 'CONFIDENTIAL',
            fontSize: 64,
            colorHex: '#808080',
            opacity: 0.2,
            rotationDegrees: -45,
        }));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.files).toHaveLength(1);
        // Timestamped so repeated runs never collide; see pdfWatermark.ts.
        expect(body.files[0].name).toMatch(/^doc_watermarked-\d{8}-\d{6}\.pdf$/);
        const out = await PDFDocument.load(new Uint8Array(Buffer.from(body.files[0].base64Bytes, 'base64')));
        expect(out.getPageCount()).toBe(3);
    });

    it('text watermark with explicit pageNums', async () => {
        const pdf = await makePdf(5);
        const res = await handlePdfWatermark(jsonRequest('http://x/pdf/watermark', {
            input: { base64Bytes: b64(pdf), fileName: 'doc.pdf' },
            text: 'DRAFT',
            colorHex: '#FF0000',
            pageNums: [1, 3, 5],
        }));
        expect(res.status).toBe(200);
        const body = await res.json();
        const out = await PDFDocument.load(new Uint8Array(Buffer.from(body.files[0].base64Bytes, 'base64')));
        expect(out.getPageCount()).toBe(5);
    });

    it('repeat: true tiles the watermark', async () => {
        const pdf = await makePdf(1);
        const res = await handlePdfWatermark(jsonRequest('http://x/pdf/watermark', {
            input: { base64Bytes: b64(pdf), fileName: 'doc.pdf' },
            text: 'CONFIDENTIAL',
            repeat: true,
        }));
        expect(res.status).toBe(200);
    });

    it('returns 400 on non-boolean repeat', async () => {
        const pdf = await makePdf(1);
        const res = await handlePdfWatermark(jsonRequest('http://x/pdf/watermark', {
            input: { base64Bytes: b64(pdf), fileName: 'doc.pdf' },
            text: 'X',
            repeat: 'yes',
        }));
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/repeat/);
    });

    it('writes to outputFilePath and returns savedTo', async () => {
        const pdf = await makePdf(1);
        vi.mocked(writeFile).mockResolvedValue(undefined);
        const res = await handlePdfWatermark(jsonRequest('http://x/pdf/watermark', {
            input: { base64Bytes: b64(pdf), fileName: 'doc.pdf' },
            text: 'X',
            outputFilePath: '/tmp/wm.pdf',
        }));
        const body = await res.json();
        expect(body.savedTo).toEqual(['/tmp/wm.pdf']);
        expect(writeFile).toHaveBeenCalled();
    });

    it('returns 400 on out-of-range pageNum', async () => {
        const pdf = await makePdf(3);
        const res = await handlePdfWatermark(jsonRequest('http://x/pdf/watermark', {
            input: { base64Bytes: b64(pdf), fileName: 'doc.pdf' },
            text: 'X',
            pageNums: [99],
        }));
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/page 99/);
    });

    it('returns 400 on bad colorHex', async () => {
        const pdf = await makePdf(1);
        const res = await handlePdfWatermark(jsonRequest('http://x/pdf/watermark', {
            input: { base64Bytes: b64(pdf), fileName: 'doc.pdf' },
            text: 'X',
            colorHex: 'red',
        }));
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/colorHex/);
    });

    it('returns 400 on opacity outside [0, 1]', async () => {
        const pdf = await makePdf(1);
        const res = await handlePdfWatermark(jsonRequest('http://x/pdf/watermark', {
            input: { base64Bytes: b64(pdf), fileName: 'doc.pdf' },
            text: 'X',
            opacity: 1.5,
        }));
        expect(res.status).toBe(400);
    });
});
