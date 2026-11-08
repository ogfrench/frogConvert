import { describe, expect, it } from "vitest";
import { localRequestAllowed } from "./localRequest.ts";

describe("local REST origin boundary", () => {
    it("keeps CLI access without Origin while requiring a local Host", () => {
        expect(localRequestAllowed(null, "127.0.0.1:3000", null)).toBe(true);
        expect(localRequestAllowed(null, "localhost:3000", "none")).toBe(true);
        expect(localRequestAllowed(null, "evil.example", null)).toBe(false);
        expect(localRequestAllowed(null, "localhost.evil.example:3000", null)).toBe(false);
    });

    it("refuses sandboxed iframes and cross-site requests", () => {
        expect(localRequestAllowed("null", "127.0.0.1:3000", null)).toBe(false);
        expect(localRequestAllowed(null, "127.0.0.1:3000", "cross-site")).toBe(false);
        expect(localRequestAllowed("http://127.0.0.1:3000", "127.0.0.1:3000", "same-site")).toBe(false);
        expect(localRequestAllowed("https://evil.example", "localhost:3000", "cross-site")).toBe(false);
    });

    it("allows only same-origin local browser calls", () => {
        expect(localRequestAllowed("http://localhost:3000", "localhost:3000", "same-origin")).toBe(true);
        expect(localRequestAllowed("http://127.0.0.1:3000", "127.0.0.1:3000", "same-origin")).toBe(true);
        expect(localRequestAllowed("http://localhost:5173", "localhost:3000", "same-site")).toBe(false);
        expect(localRequestAllowed("https://localhost:3000", "localhost:3000", "same-origin")).toBe(true);
    });
});
