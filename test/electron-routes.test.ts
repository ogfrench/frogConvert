// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * The desktop shell serves the SPA over a custom `app://` protocol, so it has
 * to do its own fallback: a path with no file extension is a route, not a file,
 * and must be answered with index.html. That list lived only as a regex literal
 * in electron.cjs, and when v3 added the Compress surface to `MODE_PATHS` in
 * src/router.ts nobody added it here - `app://-/compress` answered 404.
 *
 * Rather than restate the routes a third time, this reads both files and checks
 * the regex actually covers every mode the router knows about.
 */
const ROOT = path.resolve(__dirname, "..");
const electronSrc = fs.readFileSync(path.join(ROOT, "src/electron.cjs"), "utf8");
const routerSrc = fs.readFileSync(path.join(ROOT, "src/router.ts"), "utf8");

/** The paths the router will hand to the address bar, e.g. ["convert","pdf","compress"]. */
function routerModePaths(): string[] {
    const block = routerSrc.match(/const MODE_PATHS[^=]*=\s*\{([\s\S]*?)\}/);
    if (!block) throw new Error("MODE_PATHS not found in src/router.ts");
    return [...block[1].matchAll(/['"]\/([^'"]+)['"]/g)].map(m => m[1]);
}

/** The SPA-fallback test used by the app:// protocol handler. */
function electronFallback(): RegExp {
    // The one regex literal that is `.test(urlPath)`-ed in the protocol handler.
    const m = electronSrc.match(/\/\^\(([a-z|]+)\)\\\/\?\[\^\.\]\*\)\?\$\/|\/\^\(([a-z|]+)\)\(\\\/\[\^\.\]\*\)\?\$\//);
    const alternation = m?.[1] ?? m?.[2];
    if (!alternation) throw new Error("SPA fallback regex not found in src/electron.cjs");
    return new RegExp(`^(${alternation})(/[^.]*)?$`);
}

describe("Electron app:// SPA fallback", () => {
    it("knows every route the router can produce", () => {
        const fallback = electronFallback();
        const missing = routerModePaths().filter(p => !fallback.test(p));
        expect(missing, `routes in src/router.ts with no app:// fallback: ${missing.join(", ")}`).toEqual([]);
    });

    it("covers nested routes under each mode", () => {
        const fallback = electronFallback();
        for (const p of routerModePaths()) {
            expect(fallback.test(`${p}/anything`), `${p}/anything should fall back`).toBe(true);
        }
    });

    it("still lets real asset paths through to disk", () => {
        const fallback = electronFallback();
        for (const asset of ["index.html", "cache.json", "assets/app-abc123.js", "icon-512.png"]) {
            expect(fallback.test(asset), `${asset} must not be rewritten to index.html`).toBe(false);
        }
    });

    it("finds more than one route, so the extraction itself is not vacuous", () => {
        expect(routerModePaths().length).toBeGreaterThan(1);
        expect(routerModePaths()).toContain("compress");
    });
});
