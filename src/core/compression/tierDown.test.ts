import { describe, it, expect } from "vitest";
import { tierDown } from "./tierDown.ts";

describe("tierDown", () => {
    it("uncompressed → high", () => {
        expect(tierDown("uncompressed")).toEqual({ kind: "compress", tier: "high" });
    });

    it("hq → medium", () => {
        expect(tierDown("hq")).toEqual({ kind: "compress", tier: "medium" });
    });

    it("medium → low", () => {
        expect(tierDown("medium")).toEqual({ kind: "compress", tier: "low" });
    });

    it("low stays at low (cannot step down further without going minimal)", () => {
        expect(tierDown("low")).toEqual({ kind: "compress", tier: "low" });
    });

    it("minimal skips (return original)", () => {
        expect(tierDown("minimal")).toEqual({ kind: "skip", reason: "already-minimal" });
    });
});
