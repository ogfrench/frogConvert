import { describe, it, expect, vi } from "vitest";
import { runGhostscriptConversion, type GsInstance } from "./convert.ts";

/**
 * A stand-in for the Emscripten module. The real engine is exercised
 * end-to-end by scripts/gs-handler-e2e.mjs — 16 MB of WASM per case is too
 * slow for the unit suite. What is worth testing here is everything *around*
 * the call: how many files get collected, what they are named, and what
 * happens when Ghostscript reports success while writing rubbish.
 */
function fakeGs(opts: {
    rc?: number;
    /** Files the run "produces", keyed by MEMFS path. */
    outputs?: Record<string, Uint8Array>;
    onArgs?: (args: string[]) => void;
}): () => Promise<GsInstance> {
    const { rc = 0, outputs = {}, onArgs } = opts;
    return async () => ({
        FS: {
            writeFile: () => {},
            readFile: (path: string) => {
                const found = outputs[path];
                // MEMFS throws for a missing path; the per-page loop relies on it.
                if (!found) throw new Error(`ENOENT: ${path}`);
                return found;
            },
        },
        callMain: (args: string[]) => { onArgs?.(args); return rc; },
    });
}

const text = (s: string) => Uint8Array.from(s.padEnd(16, " "), c => c.charCodeAt(0));
const PDF_OUT = text("%PDF-1.4\n%...");
const PS_OUT = text("%!PS-Adobe-3.0\n");

const req = (over: Partial<Parameters<typeof runGhostscriptConversion>[0]> = {}) => ({
    createInstance: fakeGs({ outputs: { "/out.pdf": PDF_OUT } }),
    file: { name: "report.pdf", bytes: text("%PDF-1.4") },
    inputExtension: "pdf",
    route: "pdf" as const,
    outputExtension: "pdf",
    quality: "medium" as const,
    ...over,
});

describe("runGhostscriptConversion", () => {
    it("returns one file named after the input", async () => {
        const out = await runGhostscriptConversion(req());
        expect(out).toHaveLength(1);
        expect(out[0].name).toBe("report.pdf");
    });

    it("renames to the output extension, not the input's", async () => {
        const out = await runGhostscriptConversion(req({
            route: "ps", outputExtension: "ps",
            createInstance: fakeGs({ outputs: { "/out.ps": PS_OUT } }),
        }));
        expect(out[0].name).toBe("report.ps");
    });

    it("collects every page EPS wrote, stopping at the first gap", async () => {
        const out = await runGhostscriptConversion(req({
            route: "eps", outputExtension: "eps",
            createInstance: fakeGs({
                outputs: {
                    "/out-1.eps": PS_OUT,
                    "/out-2.eps": PS_OUT,
                    "/out-3.eps": PS_OUT,
                },
            }),
        }));
        expect(out.map(o => o.name)).toEqual([
            "report_page_1.eps", "report_page_2.eps", "report_page_3.eps",
        ]);
    });

    it("drops the page suffix when a source had only one page", async () => {
        const out = await runGhostscriptConversion(req({
            route: "eps", outputExtension: "eps",
            file: { name: "logo.eps", bytes: text("%!PS-Adobe") },
            inputExtension: "eps",
            createInstance: fakeGs({ outputs: { "/out-1.eps": PS_OUT } }),
        }));
        expect(out.map(o => o.name)).toEqual(["logo.eps"]);
    });

    it("asks Ghostscript for per-page output whenever the route is EPS", async () => {
        const seen: string[][] = [];
        await runGhostscriptConversion(req({
            route: "eps", outputExtension: "eps",
            createInstance: fakeGs({
                outputs: { "/out-1.eps": PS_OUT },
                onArgs: (a) => seen.push(a),
            }),
        }));
        expect(seen[0]).toContain("-sOutputFile=/out-%d.eps");
    });

    it("passes -dEPSCrop for an EPS input but not a PDF one", async () => {
        const forInput = async (inputExtension: string, bytes: Uint8Array) => {
            let args: string[] = [];
            await runGhostscriptConversion(req({
                inputExtension,
                file: { name: `art.${inputExtension}`, bytes },
                createInstance: fakeGs({ outputs: { "/out.pdf": PDF_OUT }, onArgs: (a) => { args = a; } }),
            }));
            return args;
        };
        expect(await forInput("eps", text("%!PS-Adobe"))).toContain("-dEPSCrop");
        expect(await forInput("pdf", text("%PDF-1.4"))).not.toContain("-dEPSCrop");
        // A modern .ai is a PDF inside, so it takes the PDF treatment.
        expect(await forInput("ai", text("%PDF-1.4"))).not.toContain("-dEPSCrop");
        // An Illustrator-8-era .ai is an EPS inside, so it takes the EPS treatment.
        expect(await forInput("ai", text("%!PS-Adobe"))).toContain("-dEPSCrop");
    });

    it("reports a non-zero exit as an error", async () => {
        await expect(runGhostscriptConversion(req({
            createInstance: fakeGs({ rc: 1, outputs: { "/out.pdf": PDF_OUT } }),
        }))).rejects.toThrow(/Couldn't convert report\.pdf/);
    });

    it("rejects output that exited 0 but is not the format it claims", async () => {
        // Ghostscript writing an empty or wrong-device file at rc=0 is the
        // failure the compression path already had to learn about. Handing that
        // back means the user downloads something that will not open.
        await expect(runGhostscriptConversion(req({
            createInstance: fakeGs({ outputs: { "/out.pdf": text("<html>oops") } }),
        }))).rejects.toThrow(/wasn't a readable PDF/);
    });

    it("rejects a truncated output", async () => {
        await expect(runGhostscriptConversion(req({
            createInstance: fakeGs({ outputs: { "/out.pdf": Uint8Array.from([0x25]) } }),
        }))).rejects.toThrow(/wasn't a readable PDF/);
    });

    it("errors rather than returning nothing when no file appeared", async () => {
        await expect(runGhostscriptConversion(req({
            createInstance: fakeGs({ outputs: {} }),
        }))).rejects.toThrow(/produced no output/);
        await expect(runGhostscriptConversion(req({
            route: "eps", outputExtension: "eps",
            createInstance: fakeGs({ outputs: {} }),
        }))).rejects.toThrow(/produced no output/);
    });

    it("accepts either TIFF byte order", async () => {
        for (const magic of ["II*\0", "MM\0*"]) {
            const out = await runGhostscriptConversion(req({
                route: "tiff", outputExtension: "tiff",
                createInstance: fakeGs({ outputs: { "/out.tiff": text(magic) } }),
            }));
            expect(out[0].name).toBe("report.tiff");
        }
    });

    it("creates exactly one engine instance per file", async () => {
        // callMain is not re-entrant, so reusing an instance across files is a
        // correctness bug rather than an optimisation.
        const create = vi.fn(fakeGs({ outputs: { "/out.pdf": PDF_OUT } }));
        await runGhostscriptConversion(req({ createInstance: create }));
        expect(create).toHaveBeenCalledTimes(1);
    });
});
