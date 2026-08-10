import type { FileFormat, QualityPreset } from "../FormatHandler/FormatHandler.ts";

/**
 * Which quality a single hop of a conversion route should run at.
 *
 * Every surface (browser Converter, MCP, REST, CLI) walks a multi-hop path and
 * used to decide this for itself, in two different wrong ways: the browser
 * passed nothing to intermediate hops so handlers fell back to a hard-coded
 * "medium", while the agent surfaces applied the *target* quality to every hop.
 * Both compound generation loss - a HEIC->PNG->WebP route re-encodes lossily at
 * each step, and quality thrown away early can't be recovered by a gentler
 * final hop.
 *
 * The rule: reduce quality once, on the artifact the caller actually keeps.
 * Intermediates run as gently as is practical.
 */
export function qualityForHop(opts: {
    /** The format this hop produces. */
    target: FileFormat;
    /** True for the hop that produces the file the caller receives. */
    isLastHop: boolean;
    /** The quality the caller asked for, already resolved (never "auto"). */
    requested: QualityPreset;
}): QualityPreset {
    const { target, isLastHop, requested } = opts;

    // A lossless target can't be shrunk by a quality knob, so it opts out
    // wherever it appears in the route.
    if (target.lossless) return "lossless";

    // The one deliberate reduction, on the output that is kept.
    if (isLastHop) return requested;

    // "No compression" has to mean it end to end, or the promise is a lie.
    if (requested === "lossless") return "lossless";

    // Otherwise the gentlest bounded setting. Deliberately not "lossless": a
    // lossless intermediate for video would be enormous in a browser tab, and
    // "high" captures nearly all of the benefit.
    return "high";
}

/**
 * The same thing as {@link qualityForHop}, packaged as the argv every caller
 * actually wants. Four surfaces walk a route and every one of them was
 * hand-writing the identical `["--quality", qualityForHop({...})]`.
 */
export function hopQualityArgs(opts: Parameters<typeof qualityForHop>[0]): string[] {
    return ["--quality", qualityForHop(opts)];
}

/**
 * Resolve an "automatic" request into a concrete preset for a conversion.
 *
 * Kept as a named export because callers read better for it, but the decision
 * itself lives in `automatic.ts` alongside every other surface's. It used to
 * take `probe` and `tierDown` as parameters so this module could stay free of
 * them; the cost was that each caller wired the pieces together itself, and
 * when PDFs needed their own rule only the callers that happened to pass the
 * mime through got it.
 */
export { decideAutoQualityForBatch as resolveAutoQuality } from "./automatic.ts";
