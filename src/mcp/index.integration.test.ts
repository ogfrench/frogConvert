import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "fs";
import os from "os";
import path from "path";
import pkg from "../../package.json" with { type: "json" };
import { hasFullRegistry, MISSING_DEPS_REASON } from "../../test/helpers/optionalDeps.ts";
import { imageHeavyPdf } from "../../test/fixtures/imageHeavyPdf.ts";

// The server loads the whole handler registry on boot, so a single
// unresolvable handler import kills the child process and every assertion
// here reports as "Connection closed" - a misleading symptom for a missing
// package. Skip with the real reason instead.
describe.skipIf(!hasFullRegistry)(`MCP Server Integration [${MISSING_DEPS_REASON}]`, () => {
    let client: Client;

    beforeAll(async () => {
        const proc = (globalThis as any).process;
        const transport = new StdioClientTransport({
            command: "bun",
            args: ["src/mcp/index.ts"],
            env: { ...proc?.env }
        });

        client = new Client(
            { name: "test-client", version: "1.0.0" },
            { capabilities: {} }
        );

        await client.connect(transport);
    }, 30000);

    afterAll(async () => {
        if (client) {
            await client.close();
        }
    });

    it('should expose the expected tools', async () => {
        const { tools } = await client.listTools();

        const toolNames = tools.map(t => t.name);
        expect(toolNames).toContain('list_formats');
        expect(toolNames).toContain('find_conversion_path');
        expect(toolNames).toContain('convert_file');
        expect(toolNames).toContain('compress_file');
    }, 20000);

    // The version was hardcoded to "2.0.0" and sat there through the whole v3
    // cycle, so every client was told the wrong thing. Only a real handshake
    // catches that - a unit test would assert against the same constant.
    it('reports the package version over the handshake, not a stale literal', async () => {
        const info = client.getServerVersion();
        expect(info?.version).toBe(pkg.version);
    }, 20000);

    // `compress_file` was only ever checked for being *listed*. Calling it over
    // the real transport is what proves the whole chain - argument decoding,
    // the shared compressBatch, and writing bytes back out to disk.
    it('compresses a real file end to end over stdio', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frog-mcp-"));
        const input = path.join(dir, "report.pdf");
        const output = path.join(dir, "report.small.pdf");
        fs.writeFileSync(input, await imageHeavyPdf());
        const before = fs.statSync(input).size;

        const res = await client.callTool({
            name: "compress_file",
            arguments: { filePath: input, outputFilePath: output, level: "medium" },
        });

        expect(res.isError ?? false).toBe(false);
        const text = (res.content as { text?: string }[]).map(c => c.text ?? "").join("");
        const report = JSON.parse(text);
        expect(report.files).toHaveLength(1);

        const file = report.files[0];
        expect(file.fileName).toBe("report.pdf");
        expect(file.originalSize).toBe(before);
        expect(file.shrunk).toBe(true);
        // The keep-threshold guarantee: never bigger, and never a zero-byte
        // "100% saving" - the defect that would have emptied an agent's folder.
        expect(file.compressedSize).toBeGreaterThan(0);
        expect(file.compressedSize).toBeLessThan(before);

        expect(fs.existsSync(output)).toBe(true);
        const written = fs.readFileSync(output);
        expect(written.byteLength).toBe(file.compressedSize);
        expect(written.subarray(0, 5).toString()).toBe("%PDF-");

        fs.rmSync(dir, { recursive: true, force: true });
    }, 600000);

    // A format with no compressor must come back whole. Getting this wrong
    // returned 0 bytes and reported it as a 100% saving.
    it('returns an uncompressable file unchanged rather than empty', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frog-mcp-"));
        const input = path.join(dir, "notes.xyz");
        const body = Buffer.from("x".repeat(4096));
        fs.writeFileSync(input, body);

        const res = await client.callTool({
            name: "compress_file",
            arguments: { filePath: input, level: "medium" },
        });

        const text = (res.content as { text?: string }[]).map(c => c.text ?? "").join("");
        const file = JSON.parse(text).files[0];
        expect(file.shrunk).toBe(false);
        expect(file.compressedSize).toBe(body.byteLength);
        expect(file.savedPercent).toBe(0);

        fs.rmSync(dir, { recursive: true, force: true });
    }, 120000);
});
