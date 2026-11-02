import JSZip from "jszip";

/**
 * Divide large OOXML presentations into bounded slide ranges before handing
 * them to the memory-hungry browser LibreOffice engine.
 *
 * Only the presentation's ordered slide list is changed in each temporary
 * copy. Slide XML, relationships, masters, media and styles stay untouched.
 * This preserves the source's visible/hidden slide rules and theme references.
 * No copy is persisted or uploaded.
 */
const PRESENTATION_NS = "http://schemas.openxmlformats.org/presentationml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const PRESENTATION_PATH = "ppt/presentation.xml";
const RELATIONS_PATH = "ppt/_rels/presentation.xml.rels";

/** Sized for phones: many ordinary slides per batch, oversized vector slides alone. */
export const MAX_PPTX_BATCH_SLIDES = 16;
const MAX_PPTX_BATCH_XML_BYTES = 2_000_000;
const MAX_PRESENTATION_XML_BYTES = 2_000_000;
const MAX_SLIDE_XML_BYTES = 32_000_000;
const MAX_ALL_SLIDE_XML_BYTES = 96_000_000;

export class PptxLimitError extends Error {
    constructor() {
        super("This PowerPoint is too complex to prepare safely in the browser.");
        this.name = "PptxLimitError";
    }
}

// JSZip documents this streaming API, but omits it from JSZipObject's types.
type StreamingEntry = JSZip.JSZipObject & {
    internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>;
};

function readBounded(entry: JSZip.JSZipObject, limit: number, keepText = false): Promise<{ size: number; text: string }> {
    return new Promise((resolve, reject) => {
        const stream = (entry as StreamingEntry).internalStream("uint8array");
        const decoder = new TextDecoder();
        let size = 0;
        let text = "";
        let stopped = false;
        stream.on("data", chunk => {
            if (stopped) return;
            size += chunk.byteLength;
            if (size > limit) {
                stopped = true;
                stream.pause();
                text = "";
                reject(new PptxLimitError());
                return;
            }
            if (keepText) text += decoder.decode(chunk, { stream: true });
        }).on("error", reject).on("end", () => {
            if (!stopped) resolve({ size, text: keepText ? text + decoder.decode() : "" });
        }).resume();
    });
}

type PptxBatchRange = { start: number; end: number };
export type PptxBatchPlan = {
    totalSlides: number;
    batches: PptxBatchRange[];
    bytesFor: (range: PptxBatchRange) => Promise<Uint8Array>;
};

function parseXml(text: string): Document {
    const xml = new DOMParser().parseFromString(text, "application/xml");
    if (xml.getElementsByTagName("parsererror").length) throw new Error("Invalid PowerPoint XML.");
    return xml;
}

function slideElements(xml: Document): Element[] {
    const list = xml.getElementsByTagNameNS(PRESENTATION_NS, "sldIdLst").item(0);
    if (!list) throw new Error("The PowerPoint slide list is missing.");
    return Array.from(list.childNodes).filter((node): node is Element => {
        if (node.nodeType !== 1) return false;
        const el = node as Element;
        return el.namespaceURI === PRESENTATION_NS && el.localName === "sldId";
    });
}

/** Plans are lazy: zip copies and PDF output exist only for the active batch. */
export async function planPptxBatches(
    bytes: Uint8Array,
    limits: { maxSlides?: number; maxXmlBytes?: number } = {},
): Promise<PptxBatchPlan> {
    const maxSlides = limits.maxSlides ?? MAX_PPTX_BATCH_SLIDES;
    const maxXmlBytes = limits.maxXmlBytes ?? MAX_PPTX_BATCH_XML_BYTES;
    if (!Number.isInteger(maxSlides) || maxSlides < 1 || !Number.isFinite(maxXmlBytes) || maxXmlBytes < 1) {
        throw new Error("Invalid PowerPoint batch limits.");
    }
    const zip = await JSZip.loadAsync(bytes);
    const presentation = zip.file(PRESENTATION_PATH);
    const relations = zip.file(RELATIONS_PATH);
    if (!presentation || !relations) throw new Error("The PowerPoint slide information is missing.");
    const { text: presentationText } = await readBounded(presentation, MAX_PRESENTATION_XML_BYTES, true);
    const original = parseXml(presentationText);
    const ids = slideElements(original);
    if (!ids.length) throw new Error("The PowerPoint presentation contains no slides.");

    const relationships = parseXml((await readBounded(relations, MAX_PRESENTATION_XML_BYTES, true)).text);
    const slidePaths = new Map<string, string>();
    for (const rel of Array.from(relationships.getElementsByTagNameNS(PACKAGE_REL_NS, "Relationship"))) {
        if (!rel.getAttribute("Type")?.endsWith("/slide")) continue;
        const id = rel.getAttribute("Id");
        const target = rel.getAttribute("Target") ?? "";
        // Standard relationships are relative to ppt/presentation.xml.
        // Reject unexpected paths rather than guessing or fetching remote content.
        const normalized = target.replace(/^\.\//, "").replace(/^\/ppt\//, "");
        if (!id || !/^slides\/[a-zA-Z0-9_.-]+\.xml$/.test(normalized)) {
            throw new Error("Unsupported PowerPoint slide relationship.");
        }
        slidePaths.set(id, `ppt/${normalized}`);
    }

    const sizes: number[] = [];
    let totalXmlBytes = 0;
    for (const slide of ids) {
        const relation = slide.getAttributeNS(REL_NS, "id");
        const entry = relation ? zip.file(slidePaths.get(relation) ?? "") : null;
        if (!entry) throw new Error("A PowerPoint slide is missing from its package.");
        const { size } = await readBounded(entry, Math.min(MAX_SLIDE_XML_BYTES, MAX_ALL_SLIDE_XML_BYTES - totalXmlBytes));
        totalXmlBytes += size;
        sizes.push(size);
    }

    const batches: PptxBatchRange[] = [];
    let start = 0;
    let bytesInBatch = 0;
    for (let i = 0; i < sizes.length; i++) {
        if (i > start && (i - start >= maxSlides || bytesInBatch + sizes[i] > maxXmlBytes)) {
            batches.push({ start, end: i });
            start = i;
            bytesInBatch = 0;
        }
        bytesInBatch += sizes[i];
    }
    batches.push({ start, end: ids.length });

    return {
        totalSlides: ids.length,
        batches,
        bytesFor: async (range) => {
            if (!batches.some(b => b.start === range.start && b.end === range.end)) {
                throw new Error("Invalid PowerPoint batch range.");
            }
            if (batches.length === 1) return bytes;
            const xml = parseXml(presentationText);
            const slides = slideElements(xml);
            for (let i = slides.length - 1; i >= 0; i--) {
                if (i < range.start || i >= range.end) slides[i].parentNode?.removeChild(slides[i]);
            }
            zip.file(PRESENTATION_PATH, new XMLSerializer().serializeToString(xml));
            return zip.generateAsync({
                type: "uint8array",
                compression: "DEFLATE",
                compressionOptions: { level: 3 },
            });
        },
    };
}
