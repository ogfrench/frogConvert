import { DEFAULT_PRESET } from "../FormatHandler/qualityPresets.ts";
import type { QualityPreset } from "../FormatHandler/FormatHandler.ts";
import { decideAutoQuality } from "./automatic.ts";
import normalizeMimeType from "../utils/normalizeMimeType.ts";

/**
 * Resolve the effective quality preset for an API/MCP conversion request.
 *
 * - Explicit `quality` is always respected.
 * - Cross-format requests fall back to {@link DEFAULT_PRESET}.
 * - Same-format requests (same input/output mime, after canonicalisation)
 *   run the input probe and pick the next lower tier, matching the web UI's
 *   silent auto-pick.
 * - Returns `null` when the input is already at minimum useful quality,
 *   the caller should return the original bytes unchanged.
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
    if (inMime !== outMime) return DEFAULT_PRESET;
    // See `automatic.ts`. This surface reports "already minimal" as null, so
    // the caller can hand back the original bytes rather than spend an engine
    // run producing a copy of them.
    const decision = await decideAutoQuality(bytes, inMime);
    return decision.kind === "already-minimal" ? null : decision.tier;
}
