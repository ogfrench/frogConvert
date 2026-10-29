// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { planPptxBatches, MAX_PPTX_BATCH_SLIDES } from "./pptxBatches.ts";

const PPTX = new Uint8Array(fs.readFileSync(path.resolve(process.cwd(), "test/resources/deck.pptx")));
const NS = "http://schemas.openxmlformats.org/presentationml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

async function slideIds(bytes: Uint8Array): Promise<string[]> {
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file("ppt/presentation.xml")!.async("string");
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const slides = doc.getElementsByTagNameNS(NS, "sldId");
    return Array.from(slides).map(s => s.getAttributeNS(REL_NS, "id")!);
}

describe("PowerPoint browser batch planner", () => {
    it("preserves ordinary presentations byte-for-byte when no splitting is needed", async () => {
        const plan = await planPptxBatches(PPTX);
        expect(plan.totalSlides).toBe(4);
        expect(plan.batches).toEqual([{ start: 0, end: 4 }]);
        expect(await plan.bytesFor(plan.batches[0])).toBe(PPTX);
    });

    it("partitions slides without losing, reordering or duplicating a relationship", async () => {
        const original = await slideIds(PPTX);
        const plan = await planPptxBatches(PPTX, { maxSlides: 2 });
        expect(plan.batches).toEqual([{ start: 0, end: 2 }, { start: 2, end: 4 }]);
        const flattened: string[] = [];
        for (const range of plan.batches) {
            const part = await plan.bytesFor(range);
            flattened.push(...await slideIds(part));
            const zip = await JSZip.loadAsync(part);
            // Masters and slide content are not rewritten: only the active
            // presentation list is smaller. Other slides remain intact.
            expect(await zip.file("ppt/slides/slide1.xml")!.async("uint8array"))
                .toEqual(await (await JSZip.loadAsync(PPTX)).file("ppt/slides/slide1.xml")!.async("uint8array"));
        }
        expect(flattened).toEqual(original);
        expect(await slideIds(PPTX)).toEqual(original);
    });

    it("always makes forward progress, even when one slide exceeds the batch budget", async () => {
        const plan = await planPptxBatches(PPTX, { maxSlides: 3, maxXmlBytes: 1 });
        expect(plan.batches).toHaveLength(4);
        expect(plan.batches.every(b => b.end - b.start === 1)).toBe(true);
        expect(plan.batches.at(-1)?.end).toBe(plan.totalSlides);
    });

    it("never accepts forged batch ranges or invalid settings", async () => {
        const plan = await planPptxBatches(PPTX, { maxSlides: MAX_PPTX_BATCH_SLIDES });
        await expect(plan.bytesFor({ start: 2, end: 5 })).rejects.toThrow(/Invalid/);
        await expect(planPptxBatches(PPTX, { maxSlides: 0 })).rejects.toThrow(/Invalid/);
        await expect(planPptxBatches(PPTX, { maxXmlBytes: -1 })).rejects.toThrow(/Invalid/);
    });

    it("rejects missing slide relationships instead of silently omitting pages", async () => {
        const zip = await JSZip.loadAsync(PPTX);
        zip.remove("ppt/_rels/presentation.xml.rels");
        const malformed = await zip.generateAsync({ type: "uint8array" });
        await expect(planPptxBatches(malformed)).rejects.toThrow(/missing/);
    });
});
