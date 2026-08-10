import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Surface alignment, read from the source rather than by loading handlers.
 *
 * `loadMcpHandlers` carries a manual list, and its own comment says to add a
 * handler there whenever one is added to `loadBackgroundHandlers()` unless it
 * needs browser-only APIs. That instruction was missed once: `imageToPdf` is
 * pure pdf-lib, went into the browser list only, and image-to-PDF answered
 * "isn't available yet" over REST and MCP while working in the tab.
 *
 * Reading the two files keeps this cheap and free of side effects - importing
 * the MCP list constructs every handler, several of which reach for engines.
 */
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("MCP handler list keeps pace with the browser list", () => {
    it("registers imageToPdf on both sides", () => {
        expect(read("../../handlers/index.ts")).toMatch(/lazy\('imageToPdf'/);
        const mcp = read("./handlers.ts");
        expect(mcp).toMatch(/import ImageToPdfHandler from "\.\.\/\.\.\/handlers\/imageToPdf\.ts"/);
        expect(mcp).toMatch(/handlers\.push\(new ImageToPdfHandler\(\)\)/);
    });

    it("keeps imageToPdf free of browser-only APIs, which is what lets it be shared", () => {
        // If this ever fails, the handler has grown a dependency that cannot
        // run under Node and the MCP registration above has to be reconsidered
        // rather than the test loosened.
        expect(read("../../handlers/imageToPdf.ts"))
            .not.toMatch(/\bdocument\.|createElement|OffscreenCanvas|getContext|AudioContext|createObjectURL/);
    });
});
