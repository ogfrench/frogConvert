#!/usr/bin/env bun
/**
 * Fetch the empirical test corpus.
 *
 * The suite's unit tests build their own fixtures, which is right for them: a
 * generated PDF is deterministic and reviewable. But a generated file only ever
 * exercises the shapes we thought of, and every serious defect in v3 was found
 * by a real file doing something we had not imagined - a research paper whose
 * bytes-per-page reads as already-lean, a LibreOffice document carrying an
 * `/Encrypt` dict, a phone photo with an EXIF block.
 *
 * So the corpus is real files from public repositories, fetched rather than
 * committed: they are large (~49 MB), they belong to their upstreams, and
 * pinning them into this repo's history would be both rude and expensive.
 *
 *   bun run scripts/fetch-corpus.ts
 *   FROG_CORPUS=1 bun x vitest run
 *
 * Everything lands in test/corpus/, which is gitignored. Tests that need it
 * skip cleanly when it is absent (test/helpers/corpus.ts), and say so.
 *
 * Note: codeload.github.com tarballs are blocked by some egress proxies, and
 * raw.githubusercontent.com is not - but `git clone --depth 1` works through
 * both, so cloning is the portable choice even where a tarball would be smaller.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const CORPUS = path.join(ROOT, "test", "corpus");
const CACHE = path.join(CORPUS, ".sources");

/** Shallow clones, reused across runs. */
const REPOS: Record<string, string> = {
    "sample-files": "https://github.com/py-pdf/sample-files",
    "exif-samples": "https://github.com/ianare/exif-samples",
    "mediaelement-files": "https://github.com/mediaelement/mediaelement-files",
    "python-docx": "https://github.com/python-openxml/python-docx",
    "python-pptx": "https://github.com/scanny/python-pptx",
};

/** `destination in the corpus` <- `path inside a clone`. */
const FILES: Record<string, string> = {
    // PDFs. Chosen for what each one breaks, not for variety's sake.
    "pdf/large-text.pdf": "sample-files/009-pdflatex-geotopo/GeoTopo.pdf",
    "pdf/image-heavy.pdf": "sample-files/018-base64-image/base64image.pdf",
    "pdf/forms.pdf": "sample-files/010-pdflatex-forms/pdflatex-forms.pdf",
    "pdf/forms-lo.pdf": "sample-files/012-libreoffice-form/libreoffice-form.pdf",
    "pdf/password.pdf": "sample-files/005-libreoffice-writer-password/libreoffice-writer-password.pdf",
    "pdf/arabic.pdf": "sample-files/015-arabic/habibi.pdf",
    "pdf/arabic-rotated.pdf": "sample-files/015-arabic/habibi-rotated.pdf",
    "pdf/cropped-rotated.pdf": "sample-files/027-cropped-rotated-scaled/cropped-rotated-scaled.pdf",
    "pdf/pdfa.pdf": "sample-files/021-pdfa/crazyones-pdfa.pdf",
    "pdf/cmyk.pdf": "sample-files/023-cmyk-image/cmyk-image.pdf",
    "pdf/annotated.pdf": "sample-files/024-annotations/annotated_pdf.pdf",
    "pdf/attachment.pdf": "sample-files/025-attachment/with-attachment.pdf",
    "pdf/scanned-images.pdf": "sample-files/007-imagemagick-images/imagemagick-images.pdf",
    "pdf/4pages.pdf": "sample-files/004-pdflatex-4-pages/pdflatex-4-pages.pdf",
    "pdf/minimal.pdf": "sample-files/001-trivial/minimal-document.pdf",
    // Real camera output, EXIF intact.
    "image/photo-10mp.jpg": "exif-samples/jpg/tests/46_UnicodeEncodeError.jpg",
    "image/photo-mobile.jpg": "exif-samples/jpg/mobile/HMD_Nokia_8.3_5G.jpg",
    "image/iphone.heic": "exif-samples/heic/mobile/iphone_13_pro_max.HEIC",
    // Video and audio. `audio-dominant` is the documented WebM inflation risk.
    "av/video.mp4": "mediaelement-files/big_buck_bunny.mp4",
    "av/video.webm": "mediaelement-files/big_buck_bunny.webm",
    "av/audio-dominant.mp4": "mediaelement-files/echo-hereweare.mp4",
    "av/audio-dominant.webm": "mediaelement-files/echo-hereweare.webm",
    "av/music.mp3": "mediaelement-files/AirReview-Landmarks-02-ChasingCorporate.mp3",
    // Formats Compress must decline rather than mangle.
    "office/report.docx": "python-docx/tests/test_files/having-images.docx",
    "office/deck.pptx": "python-pptx/features/steps/test_files/cht-chart-type.pptx",
    "office/book.xlsx": "python-pptx/features/steps/test_files/shp-embedded-xlsx.xlsx",
};

/** Single files, where cloning the whole repository is not worth it. */
const RAW: Record<string, string> = {
    "pdf/paper.pdf": "https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/tracemonkey.pdf",
    "ps/tiger.eps": "https://raw.githubusercontent.com/ArtifexSoftware/ghostpdl/master/examples/tiger.eps",
    "ps/golfer.eps": "https://raw.githubusercontent.com/ArtifexSoftware/ghostpdl/master/examples/golfer.eps",
    "ps/alphabet.ps": "https://raw.githubusercontent.com/ArtifexSoftware/ghostpdl/master/examples/alphabet.ps",
    "ps/escher.ps": "https://raw.githubusercontent.com/ArtifexSoftware/ghostpdl/master/examples/escher.ps",
};

function clone(name: string, url: string): void {
    const dir = path.join(CACHE, name);
    if (fs.existsSync(dir)) return console.log(`  cached  ${name}`);
    console.log(`  clone   ${name}`);
    execFileSync("git", ["clone", "--depth", "1", "--quiet", url, dir], { stdio: "inherit" });
}

async function main(): Promise<void> {
    fs.mkdirSync(CACHE, { recursive: true });
    console.log("Sources:");
    for (const [name, url] of Object.entries(REPOS)) clone(name, url);

    console.log("\nCopying:");
    let copied = 0;
    for (const [dest, from] of Object.entries(FILES)) {
        const src = path.join(CACHE, from);
        if (!fs.existsSync(src)) { console.warn(`  MISSING ${from}`); continue; }
        const out = path.join(CORPUS, dest);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.copyFileSync(src, out);
        copied++;
    }

    console.log("\nDownloading:");
    for (const [dest, url] of Object.entries(RAW)) {
        const out = path.join(CORPUS, dest);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        const res = await fetch(url);
        if (!res.ok) { console.warn(`  ${res.status}  ${url}`); continue; }
        fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
        console.log(`  ok      ${dest}`);
        copied++;
    }

    console.log(`\n${copied} files in ${CORPUS}`);
    console.log("Adversarial cases are generated separately: bun run scripts/make-adversarial.ts");
}

await main();
