import { describe, it, expect, vi, afterEach } from "vitest";
import { createWebGLRenderer } from "./_webgl.ts";

describe("createWebGLRenderer", () => {
    afterEach(() => vi.restoreAllMocks());

    it("throws a clear error when the canvas cannot return a WebGL context", () => {
        // Simulate a CI / WARP environment where neither webgl2 nor webgl1 is available.
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null as any);
        expect(() => createWebGLRenderer({} as any)).toThrowError(
            /WebGL is not available/i
        );
    });

    it("wraps a thrown WebGLRenderer constructor in our actionable message", () => {
        // Probe succeeds (return a stub object), then constructor itself throws.
        const stubGL = {} as WebGL2RenderingContext;
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(stubGL as any);
        const THREE = {
            WebGLRenderer: class { constructor() { throw new Error("BindToCurrentSequence failed"); } }
        };
        expect(() => createWebGLRenderer(THREE)).toThrowError(
            /Could not create a WebGL context.*BindToCurrentSequence failed/
        );
    });

    it("returns the renderer instance on success", () => {
        const stubGL = {} as WebGL2RenderingContext;
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(stubGL as any);
        const sentinel = { ok: true };
        const THREE = {
            WebGLRenderer: class { constructor(_p?: unknown) { return sentinel as any; } }
        };
        expect(createWebGLRenderer(THREE, { antialias: false })).toBe(sentinel);
    });
});
