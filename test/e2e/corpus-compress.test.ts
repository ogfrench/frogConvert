// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Browser } from "puppeteer";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { corpusFile, hasCorpus, reportCorpusSkips, CORPUS_REASON } from "../helpers/corpus.ts";
import {
    distBuilt, serveDist, launchBrowser, runCompress, type DistServer,
} from "../helpers/corpusBrowser.ts";

/**
 * Compression, driven through the built app, against real files.
 *
 * These are the checks that found every defect worth finding in v3, and until
 * now they existed only as throwaway scripts in somebody's scratch directory -
 * which meant the most valuable tests in the project were the ones nobody could
 * re-run. The findings they encode:
 *
 *  - a password-protected PDF was emptied and reported as an 83% saving
 *  - Automatic refused a 5.1 MB thesis it could take to 1.8 MB
 *  - a truncated PDF came back as a blank page called a 99% win
 *  - a .webm was not recognised as input at all
 *
 * Each of those was invisible to a green unit suite, because each lived in a
 * seam between mocked units.
 */

const LONG_NAME = "long".repeat(50) + ".pdf";

const NEEDED = [
    "pdf/paper.pdf",
    "pdf/large-text.pdf",
    "pdf/password.pdf",
    "image/photo-mobile.jpg",
    "adversarial/truncated.pdf",
    "adversarial/zero.pdf",
    "adversarial/UPPERCASE.PDF",
    "adversarial/🐸 emoji ✅ name.pdf",
    "adversarial/spaces and (parens) [brackets].pdf",
    `adversarial/${LONG_NAME}`,
    "av/video.webm",
];

const ready = hasCorpus(...NEEDED) && distBuilt();
const TMP = path.join(os.tmpdir(), "frog-corpus-compress");

describe.skipIf(!ready)(`Compress against the real corpus [${CORPUS_REASON}]`, () => {
    let server: DistServer;
    let browser: Browser;
    let violations: string[] = [];

    beforeAll(async () => {
        server = await serveDist();
        browser = await launchBrowser();
    }, 180_000);

    afterAll(async () => {
        try { await browser?.close(); } catch { /* slow teardown */ }
        await server?.close();
        fs.rmSync(TMP, { recursive: true, force: true });
        reportCorpusSkips();
    }, 60_000);

    const run = async (files: string[], level: string) => {
        const r = await runCompress(browser, server.base, files, level);
        violations = r.csp;
        return r;
    };

    it("empties nothing: a password-protected PDF is refused, not reported as a saving", async () => {
        const r = await run([corpusFile("pdf/password.pdf")!, corpusFile("pdf/paper.pdf")!], "auto");
        const pw = r.row("password.pdf");
        expect(pw, "password.pdf missing from the results").toBeDefined();
        expect(pw!.shrunk, "an encrypted PDF must never report a saving").toBe(false);
        expect(pw!.note).toMatch(/failed/i);
        // The ordinary file in the same batch still works.
        expect(r.row("paper.pdf")!.shrunk).toBe(true);
    }, 900_000);

    it("does not refuse a long text PDF at Automatic", async () => {
        const r = await run([corpusFile("pdf/large-text.pdf")!], "auto");
        const doc = r.row("large-text.pdf");
        expect(doc!.shrunk, "Automatic used to hand this back as 'already compressed'").toBe(true);
        // Measured -65%; assert the shape, not the exact figure, so a Ghostscript
        // bump does not fail a test about behaviour.
        expect(parseInt(doc!.pct.replace(/\D/g, ""), 10)).toBeGreaterThan(40);
    }, 900_000);

    it("refuses damaged and empty files instead of inventing a win", async () => {
        const r = await run(
            [corpusFile("adversarial/truncated.pdf")!, corpusFile("adversarial/zero.pdf")!], "auto");
        expect(r.row("truncated.pdf")!.shrunk).toBe(false);
        expect(r.row("truncated.pdf")!.note).toMatch(/failed/i);
        const zero = r.row("zero.pdf")!;
        expect(zero.shrunk).toBe(false);
        // An empty file is not "already compressed" - there is nothing in it.
        expect(zero.note).not.toMatch(/already/i);
    }, 900_000);

    it("compresses a real photo substantially", async () => {
        const r = await run([corpusFile("image/photo-mobile.jpg")!], "auto");
        const img = r.row("photo-mobile.jpg")!;
        expect(img.shrunk).toBe(true);
        expect(parseInt(img.pct.replace(/\D/g, ""), 10)).toBeGreaterThan(50);
    }, 900_000);

    it("recognises a .webm as input and compresses it", async () => {
        // The bug this replaces was not in any engine: ffmpeg enumerates the
        // matroska demuxer as "matroska,webm", the app asked about only the
        // first name, and the shipped format cache inherited `.mkv` for the
        // webm entry. Nothing claimed `.webm` for reading, so `findMatchingFormat`
        // refused every WebM before an engine was consulted. `formatCache.test.ts`
        // guards the artifact; this guards the journey, which is what the user
        // actually reported.
        const r = await run([corpusFile("av/video.webm")!], "auto");
        const clip = r.row("video.webm");
        expect(clip, "a .webm was not recognised as input at all").toBeDefined();
        expect(clip!.note).not.toMatch(/can't compress|not supported/i);
        expect(clip!.shrunk, "measured -34% on this clip").toBe(true);
    }, 900_000);

    it("never returns a larger file, at any level", async () => {
        // The promise is absolute and stated that way in the docs, so it is
        // worth one test that actually weighs the output rather than reading
        // the percentage the app printed. A level that inflates is the single
        // worst outcome this surface has: the user asked for smaller and the
        // app's own report is the only thing that would tell them otherwise.
        const source = corpusFile("image/photo-mobile.jpg")!;
        const input = fs.statSync(source).size;

        for (const level of ["auto", "high", "medium", "low"]) {
            const dir = path.join(TMP, `never-worse-${level}`);
            const r = await runCompress(browser, server.base, [source], level, dir);
            expect(r.download, `${level}: no download offered`).not.toBeNull();
            const out = r.download!.reduce((n, f) => n + f.size, 0);
            expect(out, `${level} returned ${out} B for a ${input} B input`)
                .toBeLessThanOrEqual(input);
        }
    }, 900_000);

    it("handles awkward file names without mangling or losing them", async () => {
        // Four shapes that have each broken a file pipeline somewhere: an
        // uppercase extension, emoji outside the BMP, shell-significant
        // punctuation, and a 200-character name. The result rows are keyed by
        // name, so a mangled one shows up as a missing row rather than as a
        // wrong string - which is why this asserts presence first.
        //
        // Built in the page rather than uploaded by path, because Puppeteer
        // silently drops a path containing an astral-plane character and the
        // 🐸 is U+1F438. That cost a round: three of four files arrived, which
        // looked exactly like the app rejecting one. It does not - the same
        // document with the same name, constructed in-page, is accepted.
        const names = [
            "adversarial/UPPERCASE.PDF",
            "adversarial/🐸 emoji ✅ name.pdf",
            "adversarial/spaces and (parens) [brackets].pdf",
            `adversarial/${LONG_NAME}`,
        ];
        const r = await runCompress(
            browser, server.base, names.map(n => corpusFile(n)!), "auto", undefined, true);
        violations = r.csp;
        // Under the 8-row cap, so every file has its own row.
        expect(r.rows.length).toBe(names.length);
        for (const n of names) {
            const base = n.split("/")[1];
            const found = r.row(base);
            expect(found, `${base} has no result row`).toBeDefined();
            expect(found!.note, `${base} was refused`).not.toMatch(/failed/i);
        }
    }, 900_000);

    it("raises no CSP violations, which would hang rather than error", () => {
        expect(violations).toEqual([]);
    });
});
