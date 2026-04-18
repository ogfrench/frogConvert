import { describe, it, expect } from "vitest";
import { toUserErrorText } from "./index.ts";

describe("toUserErrorText", () => {
    it("unwraps Error.message and drops name/stack", () => {
        const e = new Error("boom");
        e.stack = "Error: boom\n    at foo (file:///app/x.ts:1:1)\n    at bar";
        expect(toUserErrorText(e)).toBe("boom");
    });

    it("passes through plain string throws", () => {
        expect(toUserErrorText("Output is empty.")).toBe("Converter produced an empty result.");
    });

    it("strips leading Error: prefix", () => {
        expect(toUserErrorText("TypeError: bad input value")).toBe("bad input value");
    });

    it("strips stack-frame lines", () => {
        const raw = "something broke\n    at Worker.onMessage (file:///app/x.ts:42:11)\n    at EventTarget.dispatch (http://x/y.js:1:1)";
        expect(toUserErrorText(raw)).toBe("something broke");
    });

    it("maps password errors to friendly copy", () => {
        expect(toUserErrorText(new Error(`"doc.pdf" is password-protected. Decrypt it with Adobe Acrobat or similar, then upload again.`)))
            .toBe("Looks password-protected.");
    });

    it("maps worker-crash errors", () => {
        expect(toUserErrorText(new Error("Conversion worker crashed: undefined is not a function at file:///app/worker.js:12:3")))
            .toBe("The converter crashed midway.");
    });

    it("maps timeout errors", () => {
        expect(toUserErrorText(new Error("Conversion timed out after 5 minutes."))).toBe("Conversion timed out.");
    });

    it("maps cancellation", () => {
        expect(toUserErrorText(new Error("Cancelled"))).toBe("Cancelled.");
        expect(toUserErrorText(new Error("Cancelled (forced)"))).toBe("Cancelled.");
    });

    it("maps handler-not-ready errors", () => {
        expect(toUserErrorText(`Handler "ffmpeg" not ready after init.`))
            .toBe("Unsupported file shape for this converter.");
    });

    it("maps unsupported-format errors", () => {
        expect(toUserErrorText(`Handler "magick" doesn't support input format "xyz" (image/xyz).`))
            .toBe("Unsupported file shape for this converter.");
    });

    it("truncates long unknown messages", () => {
        const long = "x".repeat(500);
        const out = toUserErrorText(long);
        expect(out.length).toBeLessThanOrEqual(200);
        expect(out.endsWith("...")).toBe(true);
    });

    it("returns empty string for null/undefined/empty", () => {
        expect(toUserErrorText(null)).toBe("");
        expect(toUserErrorText(undefined)).toBe("");
        expect(toUserErrorText("")).toBe("");
    });

    it("stringifies raw objects", () => {
        expect(toUserErrorText({ foo: "bar" })).toBe("[object Object]");
    });
});
