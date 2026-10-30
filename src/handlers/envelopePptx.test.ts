// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import envelopeHandler from "./envelope.ts";

describe("Envelope PPTX to HTML fallback", () => {
    it("converts a real slide deck without relying on Pandoc", async () => {
        const handler = new envelopeHandler();
        const from = handler.supportedFormats.find(f => f.internal === "pptx" && f.from);
        const to = handler.supportedFormats.find(f => f.internal === "html" && f.to);
        expect(from).toBeDefined();
        expect(to).toBeDefined();
        const bytes = new Uint8Array(readFileSync(resolve(process.cwd(), "test/resources/deck.pptx")));
        const result = await handler.doConvert([{ name: "deck.pptx", bytes }], from!, to!);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("deck.html");
        const html = new TextDecoder().decode(result[0].bytes);
        expect(html).toContain('__page');
        expect(html).toContain("default-src 'none'");
        expect(html).toContain("img-src data:");
        expect(html).not.toContain("script-src 'unsafe-inline'");
        expect(html.replace(/<[^>]+>/g, "").trim().length).toBeGreaterThan(20);
    });
});
