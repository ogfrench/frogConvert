// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import envelopeHandler from "./envelope.ts";
import CommonFormats from "../core/CommonFormats/CommonFormats.ts";

const deck = new Uint8Array(readFileSync(resolve(process.cwd(), "test/resources/deck.pptx")));

async function toHtml(bytes: Uint8Array): Promise<string> {
    const handler = new envelopeHandler();
    // Not offered (see envelope.ts), so the format is built here: these tests
    // keep the guarded parser path working for when a fallback ranking exists.
    const from = CommonFormats.PPTX.builder("pptx").allowFrom();
    const to = handler.supportedFormats.find(f => f.internal === "html" && f.to)!;
    const result = await handler.doConvert([{ name: "deck.pptx", bytes }], from, to);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("deck.html");
    return new TextDecoder().decode(result[0].bytes);
}

const visibleText = (html: string) => html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("Envelope PPTX to HTML fallback", () => {
    it("is not offered: the route finder would rank it above Pandoc and drop tables", () => {
        expect(new envelopeHandler().supportedFormats.some(f => f.internal === "pptx")).toBe(false);
    });

    it("converts a real deck without Pandoc: every slide's text, in slide order", async () => {
        const html = await toHtml(deck);
        expect(html.match(/class="__page"/g)).toHaveLength(4);
        expect(html).toContain("default-src 'none'");
        expect(html).toContain("img-src data:");
        expect(html).not.toContain("script-src");
        // Characterises the fallback's limits, so a change to them is noticed:
        // slide tables (p:graphicFrame) and pictures are dropped. Pandoc, the
        // preferred route, keeps both (see scripts/verify-conversions.ts).
        expect(visibleText(html)).toBe(
            "Quarterly Review Frog Industries, Q3 Highlights Revenue up 12% New pond opened Lily pad supply stable "
            + "Numbers Picture slide",
        );
    });

    it("parses the bytes it was given when they are a view into a larger buffer", async () => {
        // Envelope reads `bytes.buffer` from offset 0. Without an exact copy
        // it parsed the junk prefix, not the archive the guard checked.
        const padded = new Uint8Array(deck.length + 7);
        padded.set(deck, 7);
        expect(await toHtml(padded.subarray(7))).toBe(await toHtml(deck));
    });
});
