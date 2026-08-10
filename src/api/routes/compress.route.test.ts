// @vitest-environment node
//
// Node, not jsdom: this is server code, and jsdom's FormData does not preserve
// a File's name or contents through a Request body - it arrives as a nameless
// 9-byte blob. Testing multipart against that would be testing jsdom.
import { describe, it, expect, vi, beforeEach } from "vitest";

// No real browser, ever.
//
// The route falls back to `compressInBrowser` when a handler declines a file,
// and that launches Chromium. These tests hand it deliberately-declining fake
// handlers, so the fallback fired on almost every case: fine alone, but under
// a full parallel suite the launch contended for CPU and blew the 20s timeout,
// giving two tests that passed 10/10 in isolation and failed at random in CI.
// The fallback has its own coverage in compressForAgents.browserFallback.test;
// what is under test here is the route's shape.
vi.mock("../compressInBrowser.ts", () => ({
    compressInBrowser: vi.fn(async () => null),
}));

import { handleCompress } from "./compress.ts";
import type { FormatHandler, FileFormat } from "../../core/FormatHandler/FormatHandler.ts";

/**
 * `POST /compress` exists because `POST /convert` with the same format twice
 * silently did nothing: a same-format request is a zero-hop path and the
 * conversion runner skips paths with no steps. Measured before this endpoint,
 * a 10 MB PDF came back byte-identical at every preset.
 *
 * These tests pin the contract an agent depends on: it gets the bytes, and it
 * gets told whether anything actually happened.
 */

const JPEG: FileFormat = {
    name: "JPEG", mime: "image/jpeg", extension: "jpg", format: "jpeg",
    internal: "jpeg", from: true, to: true, lossless: false,
};

/** Halves the input, so "did it shrink" has an unambiguous answer. */
function makeHandler(): FormatHandler {
    return {
        name: "ImageMagick",
        ready: true,
        supportedFormats: [JPEG],
        init: vi.fn().mockResolvedValue(undefined),
        doConvert: vi.fn(async (files: any[]) => [{
            name: files[0].name,
            bytes: new Uint8Array(Math.floor(files[0].bytes.byteLength / 2)),
        }]),
    } as unknown as FormatHandler;
}

const bytes = (n: number) => new Uint8Array(n);
const b64 = (n: number) => Buffer.from(bytes(n)).toString("base64");

function multipart(name: string, size: number, level?: string): Request {
    const form = new FormData();
    form.append("file", new File([bytes(size)], name, { type: "image/jpeg" }));
    if (level !== undefined) form.append("level", level);
    return new Request("http://x/compress", { method: "POST", body: form });
}

function json(body: unknown): Request {
    return new Request("http://x/compress", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
}

let handlers: FormatHandler[];
beforeEach(() => { handlers = [makeHandler()]; });

describe("POST /compress", () => {
    it("returns the compressed bytes with a report of what happened", async () => {
        const res = await handleCompress(multipart("photo.jpg", 4000), handlers);
        expect(res.status).toBe(200);

        const report = JSON.parse(res.headers.get("X-Compress-Report")!);
        expect(report).toMatchObject({
            name: "photo.jpg", originalSize: 4000, compressedSize: 2000,
            savedBytes: 2000, savedPercent: 50, shrunk: true,
        });
        expect((await res.arrayBuffer()).byteLength).toBe(2000);
    });

    it("defaults to the level the web UI defaults to", async () => {
        // No `level` field at all. Automatic is what someone who expressed no
        // preference gets in the browser, and the API should not differ.
        const res = await handleCompress(json({ fileName: "a.jpg", base64Bytes: b64(4000) }), handlers);
        expect((await res.json()).level).toBe("auto");
    });

    it("rejects a level it cannot honour rather than quietly substituting one", async () => {
        // `lossless` is a real preset elsewhere in the app, so it is the one an
        // agent is most likely to try. As a *compression* level it can only
        // mean "do nothing", and silently treating it as something else would
        // be worse than saying no.
        const res = await handleCompress(multipart("a.jpg", 100, "lossless"), handlers);
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/auto.*high.*medium.*low/);
    });

    it("compresses a batch in one request and reports each file separately", async () => {
        const res = await handleCompress(json({
            level: "low",
            files: [
                { fileName: "a.jpg", base64Bytes: b64(4000) },
                { fileName: "b.jpg", base64Bytes: b64(2000) },
            ],
        }), handlers);

        const body = await res.json();
        expect(body.level).toBe("low");
        expect(body.files.map((f: any) => f.name)).toEqual(["a.jpg", "b.jpg"]);
        expect(body.files.map((f: any) => f.compressedSize)).toEqual([2000, 1000]);
        // Bytes come back too, or the report would be all the caller received.
        for (const f of body.files) expect(typeof f.base64Bytes).toBe("string");
    });

    it("says why a file did not shrink instead of implying it did", async () => {
        // A handler that returns the input unchanged: the keep-threshold
        // discards that result and the original is what the caller gets. The
        // useful part is `shrunk: false` with a reason, not a silent no-op.
        const passthrough = {
            ...makeHandler(),
            doConvert: vi.fn(async (files: any[]) => [{ name: files[0].name, bytes: files[0].bytes }]),
        } as unknown as FormatHandler;

        const res = await handleCompress(json({ fileName: "a.jpg", base64Bytes: b64(4000) }), [passthrough]);
        const [file] = (await res.json()).files;
        expect(file.shrunk).toBe(false);
        expect(file.reason).toBeTruthy();
        expect(file.compressedSize).toBe(4000);
    });

    it("reports a format it has no compressor for, rather than failing the request", async () => {
        // One unsupported file in a batch must not cost the caller the others.
        const res = await handleCompress(json({
            files: [{ fileName: "notes.xyz", base64Bytes: b64(4000) }, { fileName: "a.jpg", base64Bytes: b64(4000) }],
        }), handlers);

        expect(res.status).toBe(200);
        const { files } = await res.json();
        expect(files[0].shrunk).toBe(false);
        expect(files[0].reason).toBeTruthy();
        expect(files[1].shrunk).toBe(true);
    });

    it("returns the original bytes for a file it could not compress", async () => {
        // The defect this pins: `compressBatch` skips the read when it can
        // decide from the format alone, so an unsupported file came back with
        // *zero* bytes - reported as `savedPercent: 100`. Over the API that is
        // a 0-byte download; through `compress_file` with an output path it is
        // a 0-byte file written to disk. "Could not compress" has to mean the
        // caller still gets their file.
        const res = await handleCompress(json({
            files: [{ fileName: "notes.xyz", base64Bytes: b64(4000) }],
        }), handlers);

        const [file] = (await res.json()).files;
        expect(file.shrunk).toBe(false);
        expect(file.compressedSize).toBe(4000);
        expect(file.savedBytes).toBe(0);
        expect(file.savedPercent).toBe(0);
        expect(Buffer.from(file.base64Bytes, "base64").byteLength).toBe(4000);
    });

    it("sends back a real file, not an empty one, when multipart hits an unsupported format", async () => {
        // The multipart branch is where an empty body is least recoverable:
        // the bytes *are* the response, so a 0-byte download is all the caller
        // gets and nothing in the payload says so.
        const res = await handleCompress(multipart("notes.xyz", 4000), handlers);

        expect(res.status).toBe(200);
        expect((await res.arrayBuffer()).byteLength).toBe(4000);
        expect(JSON.parse(res.headers.get("X-Compress-Report")!)).toMatchObject({
            shrunk: false, compressedSize: 4000, savedPercent: 0,
        });
    });

    it("returns the original bytes for a file too small to be worth compressing", async () => {
        // Same empty-bytes path, reached a different way: under
        // MIN_COMPRESSIBLE_BYTES the size alone decides and the read is
        // skipped. A 100-byte icon is a far more ordinary thing to hand an
        // agent than an unknown extension.
        const res = await handleCompress(json({
            files: [{ fileName: "icon.jpg", base64Bytes: b64(100) }],
        }), handlers);

        const [file] = (await res.json()).files;
        expect(file.shrunk).toBe(false);
        expect(file.compressedSize).toBe(100);
        expect(Buffer.from(file.base64Bytes, "base64").byteLength).toBe(100);
    });

    it("refuses a body it cannot read", async () => {
        expect((await handleCompress(json({ level: "low" }), handlers)).status).toBe(400);
        const wrongType = new Request("http://x/compress", {
            method: "POST", headers: { "content-type": "text/plain" }, body: "hi",
        });
        expect((await handleCompress(wrongType, handlers)).status).toBe(415);
    });
});
