// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * The shipped format cache, checked against what the app claims to do.
 *
 * `public/cache.json` is a committed build artifact: the app reads it at
 * startup instead of initialising every WASM handler to ask what it supports.
 * Nothing verified it, and it drifted twice, silently, in ways that reached
 * users:
 *
 *  - It **predated v3 entirely**. Through the whole release cycle it carried no
 *    `Ghostscript`, `PdfCanvasCompress` or `imageToPdf` entries, so the app
 *    started up believing the release's headline engines did not exist.
 *  - It pinned a **wrong extension for `.webm`**. ffmpeg enumerates the
 *    matroska demuxer as `matroska,webm` and the app asked about only the first
 *    name, so the webm entry inherited `.mkv`. Nothing claimed `.webm` for
 *    reading, and `findMatchingFormat` refused every WebM file before any
 *    engine was consulted.
 *
 * Both were invisible to 1,150 passing tests, because the artifact was not
 * something any test looked at. Regenerate with:
 *
 *     bun run build && bun run cache:refresh
 */

const CACHE = path.resolve(__dirname, "../public/cache.json");

type Entry = {
    format: string;
    extension: string;
    mime: string;
    from?: boolean;
    to?: boolean;
};

const cache: [string, Entry[]][] = JSON.parse(fs.readFileSync(CACHE, "utf8"));
const all = cache.flatMap(([handler, formats]) => formats.map(f => ({ handler, ...f })));
const readable = all.filter(f => f.from);

describe("public/cache.json", () => {
    it("is a non-empty handler-to-formats mapping", () => {
        expect(Array.isArray(cache)).toBe(true);
        expect(cache.length).toBeGreaterThan(50);
        expect(all.length).toBeGreaterThan(500);
    });

    /**
     * The engines the compression resolver dispatches to by name. If one is
     * absent the app cannot route to it from a cold start, which is exactly
     * what happened to Ghostscript for the whole of v3.
     */
    it.each(["FFmpeg", "ImageMagick", "Ghostscript", "imageToPdf"])(
        "contains the %s handler",
        (name) => {
            const entry = cache.find(([h]) => h === name);
            expect(entry, `${name} missing from the cache - run: bun run build && bun run cache:refresh`)
                .toBeDefined();
            expect(entry![1].length).toBeGreaterThan(0);
        },
    );

    /**
     * A format the app advertises has to be *droppable*, and detection matches
     * an input by extension or mime against an entry flagged readable. An
     * advertised format with no readable entry is refused at the door with
     * "can't compress this", which is what WebM did.
     */
    it.each([
        ["webm", "video/webm"],
        ["mp4", "video/mp4"],
        ["mp3", "audio/mpeg"],
        ["wav", "audio/wav"],
        ["png", "image/png"],
        ["jpg", "image/jpeg"],
        ["gif", "image/gif"],
        ["pdf", "application/pdf"],
    ])("can read a .%s file", (extension) => {
        const byExt = readable.filter(f => f.extension?.toLowerCase() === extension);
        expect(
            byExt.length,
            `no readable entry claims .${extension}, so a dropped file is refused before ` +
            "any engine sees it. Run: bun run build && bun run cache:refresh",
        ).toBeGreaterThan(0);
    });

    /**
     * A readable entry with no extension cannot be matched by filename, and a
     * browser supplies no MIME for an obscure format, so such an entry is
     * unreachable however hard the user tries.
     *
     * `xcur` is the one known case and is allowed rather than ignored: ffmpeg
     * reports no extension for the xcursor demuxer, it is nobody's real use
     * case, and pinning it here means a *second* occurrence fails the build
     * instead of quietly joining it. Removing it from this list should mean
     * fixing the entry, not widening the rule.
     */
    const KNOWN_EXTENSIONLESS = new Set(["xcur"]);

    it("gives every readable entry a usable extension and mime", () => {
        const broken = readable
            .filter(f => !f.extension?.trim() || !f.mime?.includes("/"))
            .filter(f => !KNOWN_EXTENSIONLESS.has(f.format));
        expect(broken.map(f => `${f.handler}:${f.format}`)).toEqual([]);
    });
});
