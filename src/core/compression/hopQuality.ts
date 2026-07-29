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
 * Resolve an "automatic" request into a concrete preset for a conversion.
 *
 * The Compress surface can probe per file, but a conversion runs a whole batch
 * down one route, so the choice is made once from the inputs. Takes the
 * gentlest tier any file warrants, so a mixed batch never over-compresses its
 * best input.
 *
 * A source already at minimum useful quality resolves to "high": it has
 * nothing left to give, so the right move is to stop taking.
 */
export async function resolveAutoQuality<T extends string>(
    inputs: readonly { bytes: Uint8Array; mime: string }[],
    probe: (bytes: Uint8Array, mime: string) => Promise<{ inputTier: T }>,
    tierDown: (tier: T) => { kind: string; tier?: QualityPreset },
): Promise<QualityPreset> {
    const rank: Record<string, number> = { lossless: 0, high: 1, medium: 2, low: 3 };
    let gentlest: QualityPreset = "low";
    for (const input of inputs) {
        const next = tierDown((await probe(input.bytes, input.mime)).inputTier);
        const tier: QualityPreset = next.kind === "skip" ? "high" : (next.tier ?? "medium");
        if (rank[tier] < rank[gentlest]) gentlest = tier;
    }
    return inputs.length ? gentlest : "medium";
}
