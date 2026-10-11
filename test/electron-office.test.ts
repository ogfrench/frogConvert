// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { handleOfficeApi, findSoffice } = require("../src/electron-office.cjs") as {
    handleOfficeApi(req: Request, urlPath: string): Promise<Response | null>;
    findSoffice(): Promise<string | null>;
};
const hasSoffice = !!(await findSoffice());

const post = (body: unknown) => new Request("app://-/api/convert", { method: "POST", body: JSON.stringify(body) });

describe("desktop LibreOffice bridge (app://-/api/*)", () => {
    it("leaves every other path to the file handler", async () => {
        expect(await handleOfficeApi(new Request("app://-/index.html"), "index.html")).toBeNull();
    });

    it("reports libreoffice in health exactly when soffice is installed", async () => {
        const res = (await handleOfficeApi(new Request("app://-/api/health"), "api/health"))!;
        expect(res.status).toBe(200);
        expect((await res.json()).handlers).toEqual(hasSoffice ? ["libreoffice"] : []);
    });

    it("rejects a request without a file, and anything but PDF output", async () => {
        expect((await handleOfficeApi(post({}), "api/convert"))!.status).toBe(400);
        expect((await handleOfficeApi(post({ fileName: "a.docx", base64Bytes: "", outputExt: "docx" }), "api/convert"))!.status).toBe(400);
        expect((await handleOfficeApi(new Request("app://-/api/convert"), "api/convert"))!.status).toBe(405);
    });

    it.skipIf(!hasSoffice)("converts a deck to a PDF with one page per slide", async () => {
        const bytes = fs.readFileSync(path.resolve(__dirname, "resources/deck.pptx"));
        const res = (await handleOfficeApi(post({ fileName: "deck.pptx", base64Bytes: bytes.toString("base64"), outputExt: "pdf" }), "api/convert"))!;
        expect(res.status).toBe(200);
        const [out] = await res.json();
        expect(out.fileName).toBe("deck.pdf");
        const pdf = Buffer.from(out.base64Bytes, "base64");
        expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
        const { PDFDocument } = await import("pdf-lib");
        expect((await PDFDocument.load(pdf)).getPageCount()).toBe(4);
    }, 180_000);
});
