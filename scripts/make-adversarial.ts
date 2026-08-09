#!/usr/bin/env bun
/**
 * Generate the hostile half of the empirical corpus.
 *
 * Nobody publishes a repository of deliberately broken files, and the failure
 * modes worth reproducing here are specific to this app's history: the damaged
 * PDF that came back as a blank page called a 99% win, the out-of-spec page
 * sizes from #24, and the filenames a UI has to render without breaking.
 *
 * Generated rather than committed so every case is readable as code. Needs the
 * downloaded corpus first, since several cases are built by damaging a real
 * file:
 *
 *   bun run scripts/fetch-corpus.ts
 *   bun run scripts/make-adversarial.ts
 */
import { PDFDocument, StandardFonts } from "pdf-lib";
import fs from "node:fs";
import path from "node:path";

const CORPUS = path.resolve(import.meta.dir, "..", "test", "corpus");
const OUT = path.join(CORPUS, "adversarial");

function write(name: string, bytes: Uint8Array): void {
    fs.writeFileSync(path.join(OUT, name), bytes);
    console.log(`${String(bytes.length).padStart(9)}  ${name}`);
}

async function main(): Promise<void> {
    const paper = path.join(CORPUS, "pdf", "paper.pdf");
    if (!fs.existsSync(paper)) {
        console.error("Run scripts/fetch-corpus.ts first: several cases damage a real file.");
        process.exit(1);
    }
    fs.mkdirSync(OUT, { recursive: true });

    // Ghostscript "recovers" a truncated PDF into one blank page and exits 0.
    const real = fs.readFileSync(paper);
    write("truncated.pdf", real.subarray(0, Math.floor(real.length * 0.6)));

    // Valid magic, no body. Parsers disagree about this one.
    write("header-only.pdf", Buffer.from("%PDF-1.7\n"));

    // Nothing at all. The keep-threshold divides by input size somewhere.
    write("zero.pdf", Buffer.alloc(0));

    // Right extension, wrong magic: sniffing versus trusting the name.
    write("not-really.pdf", fs.readFileSync(path.join(CORPUS, "image", "photo-mobile.jpg")).subarray(0, 40_000));

    // The #24 monster: 1080 x 2400 *inches*, because the producing tool had no
    // density and assumed 1 DPI. The spec caps a page at 14400 units, so this
    // is 5x and 12x out of spec and anything built from it inherits that.
    {
        const doc = await PDFDocument.create();
        for (let i = 0; i < 3; i++) doc.addPage([77_760, 172_800]);
        write("giant-pages.pdf", await doc.save());
    }

    // Many pages, few bytes: thumbnail and memory pressure with no download.
    // Each page names itself so page ORDER can be asserted after a merge or an
    // organize by extracting text, rather than by eyeballing thumbnails.
    {
        const doc = await PDFDocument.create();
        const font = await doc.embedFont(StandardFonts.Helvetica);
        for (let i = 1; i <= 250; i++) {
            doc.addPage([595, 842]).drawText(`PAGE ${i}`, { x: 60, y: 780, size: 36, font });
        }
        write("250-pages.pdf", await doc.save());
    }

    // Mixed orientation with rotation, for organize and merge correctness
    // beyond a stack of identical A4 portrait pages.
    {
        const doc = await PDFDocument.create();
        const font = await doc.embedFont(StandardFonts.Helvetica);
        const sizes: [number, number][] = [[595, 842], [842, 595], [595, 842], [1224, 792]];
        sizes.forEach(([w, h], i) => {
            const page = doc.addPage([w, h]);
            page.drawText(`MIXED ${i + 1}`, { x: 40, y: h - 60, size: 28, font });
            if (i % 2 === 1) page.setRotation({ type: "degrees", angle: 90 } as never);
        });
        write("mixed-orientation.pdf", await doc.save());
    }

    // Names the UI has to survive rendering. Content is a known-good PDF; only
    // the name is hostile.
    const good = fs.readFileSync(path.join(CORPUS, "pdf", "4pages.pdf"));
    write("\u{1F438} emoji ✅ name.pdf", good);
    write(`${"long".repeat(50)}.pdf`, good);
    write("UPPERCASE.PDF", good);
    write("no-extension", good);
    write("spaces and (parens) [brackets].pdf", good);

    console.log(`\nadversarial corpus written to ${OUT}`);
}

await main();
