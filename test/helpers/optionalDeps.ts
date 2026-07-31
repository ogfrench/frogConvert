/**
 * Two dependencies cannot be installed behind a restrictive network policy,
 * and neither is fetchable from npm:
 *
 *   - `xlsx` installs from cdn.sheetjs.com; SheetJS does not publish to npm.
 *   - `src/handlers/image-to-txt` is a git submodule hosted on git.sr.ht.
 *
 * A sandbox with an allowlist proxy answers 403 to both, so `bun install` and
 * `git submodule update` leave them absent. Tests that need them should skip
 * with a reason rather than fail, so a red suite always means a real defect.
 * CI has unrestricted network and runs all of it.
 *
 * Probed by resolution, not by guessing at paths, so this stays honest if the
 * install layout ever changes.
 */

async function canResolve(specifier: string): Promise<boolean> {
    try {
        // The specifier must reach the bundler as a variable: a literal is
        // resolved by vite's import analysis at transform time, which fails
        // the importing file outright instead of rejecting catchably here.
        await import(/* @vite-ignore */ specifier);
        return true;
    } catch {
        return false;
    }
}

/** SheetJS, needed by the TMX handler and anything that loads the full registry. */
export const hasXlsx = await canResolve("xlsx");

/** The image-to-txt submodule, imported by the canvasToBlob handler. */
export const hasImageToTxt = await canResolve("../../src/handlers/image-to-txt/src/convert.ts");

/** True when the whole handler registry can load, which the app itself needs. */
export const hasFullRegistry = hasXlsx && hasImageToTxt;

/** Message shown next to a skip so the reason is never a mystery. */
export const MISSING_DEPS_REASON =
    "needs xlsx (cdn.sheetjs.com) and/or the image-to-txt submodule (git.sr.ht); " +
    "both are blocked by this environment's network policy";
