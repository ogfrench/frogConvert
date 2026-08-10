import type { QualityPreset } from "../FormatHandler/FormatHandler.ts";
import { decideAutoQuality } from "./automatic.ts";
import normalizeMimeType from "../utils/normalizeMimeType.ts";

/**
 * Resolve the effective quality preset for an API/MCP conversion request.
 *
 * - Explicit `quality` is always respected.
 * - Cross-format requests with no `quality` run **lossless**: a conversion
 *   changes the format and nothing else.
 * - Same-format requests (same input/output mime, after canonicalisation)
 *   run the input probe and pick the next lower tier, matching the web UI's
 *   silent auto-pick.
 * - Returns `null` when the input is already at minimum useful quality,
 *   the caller should return the original bytes unchanged.
 *
 * ## Why cross-format is lossless
 *
 * This used to be {@link DEFAULT_PRESET} - `medium` - so an agent that asked
 * for a PNG as a JPG and said nothing about quality got q80 *and* a 2560 px
 * long-edge cap. An agent has less recourse than a person here, not more: it
 * cannot see the result, the caller may never learn the image was resized,
 * and the conversion is usually the only copy kept.
 *
 * The browser default moved to Original quality for the same reason, and
 * these two answering differently is worse than either answer - the same file
 * through the same app would come back at a different resolution depending on
 * which door it went in. `quality` is one field, and an agent that wants a
 * smaller file can say so.
 *
 * `DEFAULT_PRESET` still stands, and is deliberately untouched: it is the
 * fallback for a *handler* invoked with no preset at all, which is a
 * different question from what an omitted API field should mean.
 */
export async function resolveEffectiveQuality(
    quality: QualityPreset | undefined,
    bytes: Uint8Array,
    inputMime: string,
    outputMime: string,
): Promise<QualityPreset | null> {
    if (quality) return quality;
    const inMime = normalizeMimeType(inputMime.toLowerCase());
    const outMime = normalizeMimeType(outputMime.toLowerCase());
    if (inMime !== outMime) return "lossless";
    // See `automatic.ts`. This surface reports "already minimal" as null, so
    // the caller can hand back the original bytes rather than spend an engine
    // run producing a copy of them.
    const decision = await decideAutoQuality(bytes, inMime);
    return decision.kind === "already-minimal" ? null : decision.tier;
}
