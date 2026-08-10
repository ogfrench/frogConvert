import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./inputQuality.ts", () => ({ probeInputQuality: vi.fn() }));

const { decideAutoQuality, decideAutoQualityForBatch } = await import("./automatic.ts");
import { probeInputQuality } from "./inputQuality.ts";

const probe = vi.mocked(probeInputQuality);
const bytes = new Uint8Array(2_000_000);
const asTier = (inputTier: string) => probe.mockResolvedValue({ inputTier, detail: {} } as never);

beforeEach(() => vi.clearAllMocks());

/**
 * `tierDown` is deliberately NOT mocked here. This module exists to be the one
 * place that knows what Automatic means, so the tests assert the real end-to-end
 * decision - including the per-format rules - rather than that two mocks were
 * wired together.
 */
describe("decideAutoQuality", () => {
    it("aims an ordinary file at the balanced preset", async () => {
        asTier("hq");
        expect(await decideAutoQuality(bytes, "image/jpeg")).toEqual({ kind: "compress", tier: "medium" });
    });

    it("leaves a file at the bottom tier alone", async () => {
        asTier("minimal");
        expect(await decideAutoQuality(bytes, "image/jpeg")).toEqual({ kind: "already-minimal" });
    });

    it("applies the format's own rule, not just the ladder", async () => {
        // Same input tier, two different answers: the plain ladder says
        // "medium", but for PDFs a lower preset can produce a *bigger* file, so
        // the format rule lifts them to the conservative target instead.
        asTier("medium");
        expect(await decideAutoQuality(bytes, "image/jpeg")).toEqual({ kind: "compress", tier: "medium" });
        expect(await decideAutoQuality(bytes, "application/pdf")).toEqual({ kind: "compress", tier: "high" });
    });

    /**
     * The mirror of the tierDown change, and this assertion was wrong too.
     *
     * A PDF reaches the `minimal` tier on bytes per page, which for a PDF is
     * close to meaningless: a long document is thin per page however heavy its
     * images are. Measured on a 5.1 MB, 100+ page LaTeX thesis, Automatic
     * reported "already compressed" and saved nothing, while /printer took it
     * to 1.8 MB. Automatic is the default, so this was withheld from the users
     * least equipped to go looking for another level.
     *
     * The keep-threshold still discards a result gaining under 2%, so a truly
     * minimal PDF comes back untouched either way - by measurement now, not by
     * a prediction that was reliably wrong.
     */
    it("tries a minimal-tier PDF anyway, because bytes-per-page cannot tell", async () => {
        asTier("minimal");
        expect(await decideAutoQuality(bytes, "application/pdf")).toEqual({ kind: "compress", tier: "high" });
    });

    it("still leaves a genuinely minimal file of any other type alone", async () => {
        asTier("minimal");
        expect(await decideAutoQuality(bytes, "image/jpeg")).toEqual({ kind: "already-minimal" });
    });
});

describe("decideAutoQualityForBatch", () => {
    it("takes the gentlest answer so one raw file can't drag the others down", async () => {
        // One file warrants "medium", the other only "high". Gentlest wins.
        probe.mockResolvedValueOnce({ inputTier: "medium", detail: {} } as never)
             .mockResolvedValueOnce({ inputTier: "low", detail: {} } as never);
        const tier = await decideAutoQualityForBatch([
            { bytes, mime: "image/jpeg" },
            { bytes, mime: "image/jpeg" },
        ]);
        // "low" input tier resolves to the gentlest preset, and gentlest wins.
        expect(tier).toBe("high");
    });

    it("counts an already-minimal file as a reason to be gentle, not to drop out", async () => {
        // A conversion still has to produce output, so "nothing left to give"
        // becomes "stop taking" rather than "skip the file".
        probe.mockResolvedValueOnce({ inputTier: "minimal", detail: {} } as never)
             .mockResolvedValueOnce({ inputTier: "medium", detail: {} } as never);
        expect(await decideAutoQualityForBatch([
            { bytes, mime: "image/jpeg" },
            { bytes, mime: "image/jpeg" },
        ])).toBe("high");
    });

    it("falls back to medium with nothing to look at", async () => {
        expect(await decideAutoQualityForBatch([])).toBe("medium");
        expect(probe).not.toHaveBeenCalled();
    });

    it("carries the format rule into the batch answer too", async () => {
        asTier("medium");
        expect(await decideAutoQualityForBatch([{ bytes, mime: "application/pdf" }])).toBe("high");
    });
});
