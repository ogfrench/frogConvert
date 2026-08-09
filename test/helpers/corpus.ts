import fs from "node:fs";
import path from "node:path";

/**
 * Gate for the corpus-backed browser tests.
 *
 * Deliberately the mirror image of `optionalDeps.ts`, and the difference
 * matters. That file *throws* inside GitHub Actions, because CI installs those
 * dependencies and a skip there means the probe is broken. CI will genuinely
 * not have this corpus - it is ~49 MB of other people's files, fetched on
 * demand - so throwing would be wrong. These skip instead.
 *
 * But a suite that skips silently is how you get a green run that tested
 * nothing, so skipping here is loud: {@link reportCorpusSkips} prints exactly
 * what was not run and why. And the whole thing is behind `FROG_CORPUS=1`, so a
 * corpus run is always something someone chose rather than something that
 * happened to be possible.
 *
 *     bun run scripts/fetch-corpus.ts
 *     bun run scripts/make-adversarial.ts
 *     bun run build
 *     FROG_CORPUS=1 bun x vitest run test/e2e/corpus-compress.test.ts
 */

export const CORPUS_DIR = path.resolve(__dirname, "..", "corpus");

/** Opt-in. Absent means "not asked for", not "broken". */
export const corpusRequested = process.env.FROG_CORPUS === "1";

const missing = new Set<string>();

/** Absolute path to a corpus file, or null when it is not there. */
export function corpusFile(relative: string): string | null {
    const full = path.join(CORPUS_DIR, relative);
    if (fs.existsSync(full)) return full;
    missing.add(relative);
    return null;
}

/** True when every named file is present and the corpus was asked for. */
export function hasCorpus(...files: string[]): boolean {
    if (!corpusRequested) return false;
    // Resolve all of them rather than short-circuiting, so the skip message
    // names every missing file instead of only the first.
    return files.map(f => corpusFile(f) !== null).every(Boolean);
}

export const CORPUS_REASON =
    "needs the empirical corpus: run scripts/fetch-corpus.ts and " +
    "scripts/make-adversarial.ts, then set FROG_CORPUS=1";

/**
 * Print what was skipped. Call from an `afterAll` in any suite using this, so
 * a run that quietly did nothing still says so on the way out.
 */
export function reportCorpusSkips(): void {
    if (!corpusRequested) {
        console.info(`[corpus] skipped: FROG_CORPUS is not set. ${CORPUS_REASON}`);
        return;
    }
    if (missing.size) {
        console.warn(
            `[corpus] ${missing.size} file(s) missing, their cases did not run:\n  ` +
            [...missing].sort().join("\n  ") +
            `\n  regenerate with scripts/fetch-corpus.ts and scripts/make-adversarial.ts`,
        );
    }
}
