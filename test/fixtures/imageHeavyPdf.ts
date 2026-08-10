import { PDFDocument, rgb } from "pdf-lib";

/**
 * A generated PDF that genuinely benefits from image resampling.
 *
 * Generated rather than committed so there is no binary in the tree and no
 * "where did this come from" fixture. Shared by the node integration test and
 * the browser end-to-end test so both assert against the same document.
 */

const PAGES = 6;
const IMG = 800;

/**
 * A PDF carrying enough photo-like raster that downsampling genuinely helps.
 *
 * The content matters. Pure noise is incompressible, so Ghostscript reports
 * no-gain and the test proves nothing; a flat gradient deflates so well as PNG
 * that re-encoding it makes the file *bigger*. Mid-frequency detail is what
 * real documents contain and what resampling actually wins on.
 */
async function makeImageHeavyPdf(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    let seed = 12345;
    const noise = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

    for (let p = 0; p < PAGES; p++) {
        const page = doc.addPage([420, 420]);
        const rgbBytes = new Uint8Array(IMG * IMG * 3);
        for (let y = 0; y < IMG; y++) {
            for (let x = 0; x < IMG; x++) {
                const v = 128 + 110 * Math.sin((x + p * 40) / 23) * Math.cos(y / 31);
                const jitter = (noise() - 0.5) * 28;
                const i = (y * IMG + x) * 3;
                rgbBytes[i] = Math.max(0, Math.min(255, v + jitter));
                rgbBytes[i + 1] = Math.max(0, Math.min(255, v * 0.7 + jitter));
                rgbBytes[i + 2] = Math.max(0, Math.min(255, 255 - v + jitter));
            }
        }
        const img = await doc.embedPng(await rawToPng(rgbBytes, IMG, IMG));
        // Drawn far smaller than its pixel dimensions, so a 72 dpi target has
        // something real to throw away.
        page.drawImage(img, { x: 20, y: 60, width: 380, height: 340 });
        page.drawText(`page ${p + 1}`, { x: 20, y: 24, size: 12, color: rgb(0, 0, 0) });
    }
    return doc.save();
}

/** Minimal PNG encoder, so the fixture is generated rather than committed. */
async function rawToPng(rgbBytes: Uint8Array, w: number, h: number): Promise<Uint8Array> {
    const { deflate } = await import("pako");
    const raw = new Uint8Array((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) {
        raw[y * (w * 3 + 1)] = 0;
        raw.set(rgbBytes.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
    }
    const idat = deflate(raw);

    const chunk = (type: string, data: Uint8Array) => {
        const out = new Uint8Array(12 + data.length);
        const view = new DataView(out.buffer);
        view.setUint32(0, data.length);
        for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
        out.set(data, 8);
        view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
        return out;
    };
    const ihdr = new Uint8Array(13);
    const iv = new DataView(ihdr.buffer);
    iv.setUint32(0, w); iv.setUint32(4, h);
    ihdr[8] = 8; ihdr[9] = 2;
    const parts = [
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0)),
    ];
    const out = new Uint8Array(parts.reduce((n, c) => n + c.length, 0));
    let off = 0;
    for (const c of parts) { out.set(c, off); off += c.length; }
    return out;
}

let CRC_TABLE: number[] | null = null;
function crc32(buf: Uint8Array): number {
    if (!CRC_TABLE) {
        CRC_TABLE = [];
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            CRC_TABLE[n] = c >>> 0;
        }
    }
    let crc = 0xffffffff;
    for (const b of buf) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}
/** The shared fixture. */
export async function imageHeavyPdf(): Promise<Uint8Array> {
    return makeImageHeavyPdf();
}
