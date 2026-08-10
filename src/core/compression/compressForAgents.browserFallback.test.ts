import { describe, it, expect, vi } from "vitest";
import { compressForAgents, type AgentCompressInput, type AgentCompressResult } from "./compressForAgents.ts";

/**
 * `ffmpeg.wasm` throws on construction under Node, so video and audio came back
 * `unsupported` over REST and MCP - a true statement about the process, not
 * about the file. These pin when the browser gets a second go and when it
 * deliberately does not.
 */
const input = (name: string, mime: string, extension: string): AgentCompressInput =>
    ({ name, mime, extension, bytes: new Uint8Array(1000) });

const shrunkByBrowser: AgentCompressResult = {
    name: "clip.mp4", bytes: new Uint8Array(200), originalSize: 1000, shrunk: true,
};

// Note: the "engine absent" vs "engine decided" split (`unsupported`/`failed`
// retry, `no-gain`/`too-small`/`cancelled` do not) is enforced by
// WORTH_RETRYING_IN_A_BROWSER. Reaching a genuine `no-gain` here needs a fully
// working fake engine, so that half is covered by the code rather than a test.
describe("the browser fallback", () => {
    it("is not called at all when no fallback is supplied", async () => {
        const [out] = await compressForAgents([input("clip.mp4", "video/mp4", "mp4")], {
            handlers: [], level: "auto",
        });
        expect(out.shrunk).toBe(false);
        expect(out.reason).toBe("unsupported");
        // The caller's bytes come back, never an empty array.
        expect(out.bytes.byteLength).toBe(1000);
    });

    it("retries a format this process has no engine for", async () => {
        const browserFallback = vi.fn(async () => shrunkByBrowser);
        const [out] = await compressForAgents([input("clip.mp4", "video/mp4", "mp4")], {
            handlers: [], level: "medium", browserFallback,
        });
        expect(browserFallback).toHaveBeenCalledTimes(1);
        expect(browserFallback.mock.calls[0][1]).toBe("medium"); // the level travels
        expect(out.shrunk).toBe(true);
        expect(out.bytes.byteLength).toBe(200);
    });

    it("keeps the native answer when the browser also declines", async () => {
        const browserFallback = vi.fn(async () => ({
            name: "clip.mp4", bytes: new Uint8Array(0), originalSize: 1000,
            shrunk: false, reason: "unsupported",
        }));
        const [out] = await compressForAgents([input("clip.mp4", "video/mp4", "mp4")], {
            handlers: [], level: "auto", browserFallback,
        });
        expect(out.shrunk).toBe(false);
        expect(out.bytes.byteLength).toBe(1000); // still the caller's bytes
    });

    it("survives a bridge that cannot be reached", async () => {
        // The fallback is a bonus on top of an answer we already have; failing
        // to reach a browser must not lose the batch.
        const browserFallback = vi.fn(async () => { throw new Error("no browser here"); });
        const [out] = await compressForAgents([input("clip.mp4", "video/mp4", "mp4")], {
            handlers: [], level: "auto", browserFallback,
        });
        expect(out.reason).toBe("unsupported");
        expect(out.bytes.byteLength).toBe(1000);
    });

    it("says so when the bridge was unreachable, rather than reporting a bare 'unsupported'", async () => {
        // Otherwise a broken deployment and a browser that genuinely declined
        // are the same string to the caller. Diagnosed exactly this confusion
        // by hand against a real MCP server before splitting the two apart.
        const browserFallback = vi.fn(async () => { throw new Error("no browser here"); });
        const [out] = await compressForAgents([input("clip.mp4", "video/mp4", "mp4")], {
            handlers: [], level: "auto", browserFallback,
        });
        expect(out.warning).toMatch(/could not reach a browser/i);
        expect(out.warning).toContain("no browser here");
    });

    it("stays quiet when a browser was reached and simply declined", async () => {
        const browserFallback = vi.fn(async (i: any) => ({
            name: i.name, bytes: i.bytes, originalSize: i.bytes.byteLength,
            shrunk: false, reason: "unsupported" as const,
        }));
        const [out] = await compressForAgents([input("clip.mp4", "video/mp4", "mp4")], {
            handlers: [], level: "auto", browserFallback,
        });
        expect(out.warning ?? "").not.toMatch(/could not reach a browser/i);
    });

});
