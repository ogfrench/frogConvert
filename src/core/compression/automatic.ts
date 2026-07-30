import type { QualityPreset } from "../FormatHandler/FormatHandler.ts";
import { probeInputQuality } from "./inputQuality.ts";
import { tierDown } from "./tierDown.ts";

/**
 * What "Automatic" means. One definition, for every surface that offers it.
 *
 * The system behind the word, in three steps:
 *
 *  1. **Probe** the file's own container metadata - bytes per megapixel for
 *     images, bytes per page for PDFs, kbps for audio and video - and place it
 *     in a quality tier from `uncompressed` down to `minimal`. This is a
 *     measurement of how densely the file is already compressed, not of how it
 *     looks; it is cheap, and it never decodes the whole file.
 *  2. **Step down one tier**, so a file that is already lean is asked to give
 *     up less than a raw one. A file at the bottom tier is left alone: there is
 *     nothing left to take that a viewer would not notice.
 *  3. **Apply the format's own rule**, because "one tier down" is not
 *     universally safe. PDFs are the standing example - a lower Ghostscript
 *     preset can make one *bigger* - so they resolve to a conservative target
 *     instead. That rule lives in {@link tierDown}.
 *
 * Automatic therefore aims at a *reliable* win rather than the largest possible
 * one. Someone who wants to push harder can say so; someone who has expressed
 * no preference should never get a surprise.
 *
 * ## Why this module exists
 *
 * Three call sites offered "Automatic" and each re-implemented these steps: the
 * Converter's batch resolver, the Compress orchestrator, and the MCP/REST
 * entry point. They drifted - when PDFs needed their own rule it had to be
 * threaded into each by hand, and a fourth caller would have inherited none of
 * it. The steps live here now; callers keep only the part that is genuinely
 * theirs, which is what to do when the answer is "leave it alone".
 */

export type AutoDecision =
    /** Compress this file, at this preset. */
    | { kind: "compress"; tier: QualityPreset }
    /** Already at minimum useful quality. What that means is the caller's call:
     *  a compress passes the file through untouched, a conversion still has to
     *  produce output and so picks its gentlest setting. */
    | { kind: "already-minimal" };

/** The decision for a single file. */
export async function decideAutoQuality(
    bytes: Uint8Array,
    mime: string,
): Promise<AutoDecision> {
    const probe = await probeInputQuality(bytes, mime);
    const next = tierDown(probe.inputTier, mime);
    return next.kind === "skip"
        ? { kind: "already-minimal" }
        : { kind: "compress", tier: next.tier };
}

/** Rank from gentlest to most aggressive, for resolving a batch to one answer. */
const GENTLENESS: Record<QualityPreset, number> = { lossless: 0, high: 1, medium: 2, low: 3 };

/**
 * The decision for a whole batch that must run at a single preset, as a
 * conversion route does: every file is examined and the **gentlest** answer
 * wins, so one raw input cannot drag an already-lean sibling down with it.
 *
 * A file with nothing left to give counts as "high" rather than dropping out:
 * the conversion has to produce something, and the right move on a file that
 * is already minimal is to stop taking from it.
 */
export async function decideAutoQualityForBatch(
    inputs: readonly { bytes: Uint8Array; mime: string }[],
): Promise<QualityPreset> {
    if (!inputs.length) return "medium";
    let gentlest: QualityPreset = "low";
    for (const input of inputs) {
        const decision = await decideAutoQuality(input.bytes, input.mime);
        const tier = decision.kind === "already-minimal" ? "high" : decision.tier;
        if (GENTLENESS[tier] < GENTLENESS[gentlest]) gentlest = tier;
    }
    return gentlest;
}
