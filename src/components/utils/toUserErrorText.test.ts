import { describe, it, expect } from "vitest";
import { appendSupportContact, SUPPORT_CONTACT_EMAIL, toUserErrorInfo, toUserErrorText } from "./index.ts";

describe("toUserErrorText", () => {
    it("maps unknown Error objects to generic copy without stack details", () => {
        const e = new Error("boom");
        e.stack = "Error: boom\n    at foo (file:///app/x.ts:1:1)\n    at bar";
        expect(toUserErrorText(e)).toBe("Something went wrong while converting this file.");
    });

    it("passes through plain string throws", () => {
        expect(toUserErrorText("Output is empty.")).toBe("The converter finished, but came back empty. Try another file or format.");
    });

    it("maps unknown prefixed errors to generic copy", () => {
        expect(toUserErrorText("TypeError: bad input value")).toBe("Something went wrong while converting this file.");
    });

    it("maps unknown stack strings to generic copy", () => {
        const raw = "something broke\n    at Worker.onMessage (file:///app/x.ts:42:11)\n    at EventTarget.dispatch (http://x/y.js:1:1)";
        expect(toUserErrorText(raw)).toBe("Something went wrong while converting this file.");
    });

    it("maps password errors to friendly copy", () => {
        expect(toUserErrorText(new Error(`"doc.pdf" is password-protected. Decrypt it with Adobe Acrobat or similar, then upload again.`)))
            .toBe("This file looks password-protected. Remove the password and upload it again.");
    });

    it("maps worker-crash errors", () => {
        expect(toUserErrorText(new Error("Conversion worker crashed: undefined is not a function at file:///app/worker.js:12:3")))
            .toBe("The converter crashed while processing this file.");
    });

    it("maps timeout errors", () => {
        expect(toUserErrorText(new Error("Conversion timed out after 5 minutes."))).toBe("This one took too long to finish. A smaller file or another format might work.");
    });

    it("maps cancellation", () => {
        expect(toUserErrorText(new Error("Cancelled"))).toBe("Cancelled.");
        expect(toUserErrorText(new Error("Cancelled (forced)"))).toBe("Cancelled.");
    });

    it("maps handler-not-ready errors", () => {
        expect(toUserErrorText(`Handler "ffmpeg" not ready after init.`))
            .toBe("The converter is still warming up. Try again in a moment.");
    });

    it("maps unsupported-format errors", () => {
        expect(toUserErrorText(`Handler "magick" doesn't support input format "xyz" (image/xyz).`))
            .toBe("This conversion isn't available yet.");
    });

    it("maps no-path errors to unavailable copy", () => {
        expect(toUserErrorInfo("No conversion path found between image/jpeg and application/pdf"))
            .toEqual({ message: "This conversion isn't available yet.", kind: "not_available" });
    });

    it("maps ImageMagick delegate/ghostscript errors to unavailable (not file-blaming) copy", () => {
        // EPS without Ghostscript: ImageMagick throws a delegate error. Before
        // this rule, it fell into the catch-all generic and rendered as
        // "the file may be corrupted..." in the popup. Now classified as
        // not_available so the popup says "X to Y isn't available yet."
        // Note: cleanErrorText strips `<word>Error:` prefixes, so test strings
        // here mirror the post-clean form (no leading "MagickError:").
        expect(toUserErrorInfo("NoDecodeDelegateForThisImageFormat 'EPS'").kind).toBe("not_available");
        expect(toUserErrorInfo("ghostscript required for PostScript").kind).toBe("not_available");
        expect(toUserErrorInfo("unable to load module file: lib.so").kind).toBe("not_available");
        // ImageMagick policy.xml denies (e.g. PDF read disabled)
        expect(toUserErrorInfo("attempt to perform an operation not allowed by the security policy").kind).toBe("not_available");
        // Realistic full error string from ImageMagick after the Error: prefix strip
        expect(toUserErrorInfo("MagickError: NoDecodeDelegateForThisImageFormat 'EPS' @ error/constitute.c").kind).toBe("not_available");
    });

    it("appends support contact once", () => {
        const withContact = appendSupportContact("Something failed.");
        expect(withContact).toContain(SUPPORT_CONTACT_EMAIL);
        expect(appendSupportContact(withContact)).toBe(withContact);
    });

    it("maps long unknown messages to generic copy", () => {
        const long = "x".repeat(500);
        const out = toUserErrorText(long);
        expect(out.length).toBeLessThanOrEqual(200);
        expect(out).toBe("Something went wrong while converting this file.");
    });

    it("returns empty string for null/undefined/empty", () => {
        expect(toUserErrorText(null)).toBe("");
        expect(toUserErrorText(undefined)).toBe("");
        expect(toUserErrorText("")).toBe("");
    });

    it("maps raw objects to generic copy", () => {
        expect(toUserErrorText({ foo: "bar" })).toBe("Something went wrong while converting this file.");
    });
});
