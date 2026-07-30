import { describe, it, expect } from "vitest";
import { resolveEffectiveQuality } from "./resolveEffectiveQuality.ts";

// Tiny buffer, below the probe-skip threshold, so probeInputQuality returns
// UNKNOWN ("medium") without trying to decode bytes.
const tiny = new Uint8Array(500);

describe("resolveEffectiveQuality", () => {
    it("respects explicit quality regardless of mime pair", async () => {
        expect(await resolveEffectiveQuality("high", tiny, "image/png", "image/png")).toBe("high");
        expect(await resolveEffectiveQuality("medium", tiny, "image/png", "image/jpeg")).toBe("medium");
        expect(await resolveEffectiveQuality("lossless", tiny, "audio/wav", "audio/flac")).toBe("lossless");
    });

    it("cross-format + no explicit quality → DEFAULT_PRESET (medium)", async () => {
        expect(await resolveEffectiveQuality(undefined, tiny, "image/png", "image/jpeg")).toBe("medium");
    });

    it("same-format + no explicit quality → runs tier-down via probe", async () => {
        // Tiny buffer below skip threshold → probe returns UNKNOWN (medium) →
        // tierDown maps medium → medium: Automatic stays the safe answer, and the
        // aggressive preset is only ever reached by asking for it.
        expect(await resolveEffectiveQuality(undefined, tiny, "image/png", "image/png")).toBe("medium");
    });

    it("canonicalises mime synonyms so image/jpg === image/jpeg", async () => {
        // Same-format intent despite the alias; tier-down still applies.
        const result = await resolveEffectiveQuality(undefined, tiny, "image/jpg", "image/jpeg");
        expect(result).toBe("medium");
    });

    it("uppercase vs lowercase mime still matches (same-format)", async () => {
        const result = await resolveEffectiveQuality(undefined, tiny, "IMAGE/PNG", "image/png");
        expect(result).toBe("medium");
    });

    it("audio/x-wav (non-canonical) folds to audio/wav for the match", async () => {
        const result = await resolveEffectiveQuality(undefined, tiny, "audio/x-wav", "audio/wav");
        expect(result).toBe("medium");
    });
});
