/**
 * Dependencies that a restrictive network policy can leave absent:
 *
 *   - `xlsx` was installed from cdn.sheetjs.com, which an allowlist proxy
 *     permitting only the npm registry answers 403 - and `bun install`
 *     completed without it, silently. Since 2026-08-29 it is an alias for
 *     `@e965/xlsx`, a republish of the same release on npm, so it now
 *     installs anywhere. Kept as a probe because a working tree can still
 *     be missing node_modules.
 *   - `src/handlers/image-to-txt` is a git submodule. It is on GitHub as of
 *     2026-08-29 (it was on git.sr.ht, which no sandbox here can reach), so it
 *     is now normally present - but a working tree where nobody ran
 *     `git submodule update --init` still has an empty directory.
 *
 * Tests that need either should skip with a reason rather than fail, so a red
 * suite always means a real defect. CI has unrestricted network, checks out
 * submodules recursively, and runs all of it.
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

/**
 * The image-to-txt submodule, imported by the canvasToBlob handler. Not
 * exported: nothing needs it alone, only as part of `hasFullRegistry`.
 */
const hasImageToTxt = await canResolve("../../src/handlers/image-to-txt/src/convert.ts");

/** True when the whole handler registry can load, which the app itself needs. */
export const hasFullRegistry = hasXlsx && hasImageToTxt;

/**
 * A skip guard that silently skips *everywhere* is worse than the failure it
 * replaced: the suite goes green having tested nothing, and nobody finds out.
 *
 * CI installs both dependencies (`bun i --frozen-lockfile` plus
 * `submodules: recursive`), so a false probe there means this file is broken,
 * not that the environment is limited. Fail loudly instead of skipping.
 */
const inGitHubActions =
    typeof process !== "undefined" && process.env?.GITHUB_ACTIONS === "true";

if (inGitHubActions && !hasFullRegistry) {
    throw new Error(
        "optionalDeps probe reported a missing dependency inside GitHub Actions " +
        `(xlsx=${hasXlsx}, image-to-txt=${hasImageToTxt}). CI installs both, so the ` +
        "probe itself is wrong and is hiding real test coverage. Fix the probe " +
        "rather than the skip.",
    );
}

/** Message shown next to a skip so the reason is never a mystery. */
export const MISSING_DEPS_REASON =
    `needs xlsx${hasXlsx ? "" : " (missing: run bun install)"}` +
    ` and the image-to-txt submodule${hasImageToTxt ? "" : " (missing: run git submodule update --init --recursive)"}`;
