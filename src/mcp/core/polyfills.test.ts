import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";

// Keep a reference to the original globals before the polyfill runs
const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;

// Import the polyfill to test it
import "./polyfills.ts";

describe("MCP Polyfills", () => {
    let mockReadFileSync: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        // Mock fs.readFileSync so we don't need real WASM files
        mockReadFileSync = vi.spyOn(fs, 'readFileSync').mockImplementation((reqPath) => {
            const strPath = reqPath.toString();
            if (strPath.includes("magick.wasm") || strPath.includes("ffmpeg-core") || strPath.includes("pandoc")) {
                return Buffer.from("mock-wasm-data");
            }
            throw new Error(`Testing missing file ${strPath}`);
        });
    });

    afterEach(() => {
        mockReadFileSync.mockRestore();
    });

    it("should polyfill window and self", () => {
        expect(globalThis.self).toBeDefined();
        expect(globalThis.window).toBeDefined();
    });

    it("should polyfill location to localhost domain", () => {
        const location = (globalThis as any).location;
        expect(location).toBeDefined();
    });

    it("should polyfill URL.createObjectURL and URL.revokeObjectURL", () => {
        expect(URL.createObjectURL).toBeDefined();
        expect(URL.revokeObjectURL).toBeDefined();

        const blob = new Blob(["test"]);
        const id = URL.createObjectURL(blob as any);
        expect(typeof id).toBe("string");
    });

    it("fetch to a localhost WASM URL is intercepted and returns 200 with content", async () => {
        const response = await fetch("http://localhost/convert/wasm/magick.wasm");
        expect(response.status).toBe(200);
        const buffer = await response.arrayBuffer();
        expect(buffer.byteLength).toBeGreaterThan(0);
    });

    it("fetch to an unrecognised WASM filename returns 404", async () => {
        const response = await fetch("http://localhost/convert/wasm/unknown.wasm");
        expect(response.status).toBe(404);
    });

    it("fetch to a blob: URL returns an empty 200 response", async () => {
        const response = await fetch("blob:http://localhost/some-uuid");
        expect(response.status).toBe(200);
    });

});
