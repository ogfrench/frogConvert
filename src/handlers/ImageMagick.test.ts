
describe("formats ImageMagick only reaches through an external binary", () => {
    // Driven in the real app first: dropping a valid EPS and asking for PDF
    // produced
    //   FailedToExecuteCommand `'gs' ... -sDEVICE=pngalpha ... -dEPSCrop'
    // because the route search preferred ImageMagick, which services the
    // PostScript family by shelling out to Ghostscript - and there is no
    // binary to shell out to in a browser. The retry then picked another dead
    // ImageMagick route (eps -> pdb) and the user was told to try a different
    // format, about a conversion the app can do.
    it("declares none of them, so the route search reaches Ghostscript", async () => {
        const handler = new (await import("./ImageMagick.ts")).default();
        // `init()` needs the wasm; the list under test is the filter itself.
        const { DELEGATES_TO_GHOSTSCRIPT } = await import("./ImageMagick.ts") as any;
        for (const f of ["eps", "ps", "ai", "pdf"]) {
            expect(DELEGATES_TO_GHOSTSCRIPT.has(f)).toBe(true);
        }
        expect(handler.supportedFormats.some(f => DELEGATES_TO_GHOSTSCRIPT.has(f.format))).toBe(false);
    });

    it("is not advertising them in the shipped format cache either", async () => {
        // The graph is built from the cache before any handler initialises, so
        // a stale entry there recreates the dead route on a cold start. This is
        // exactly how the bug survived the handler fix.
        const cache = JSON.parse(
            await (await import("fs")).promises.readFile("public/cache.json", "utf8"),
        ) as [string, { format: string }[]][];
        const im = cache.find(([name]) => name === "ImageMagick");
        expect(im).toBeDefined();
        // Exact matches only - `psd` and `psb` are Photoshop, genuinely
        // ImageMagick's, and a prefix match would strip them.
        const { DELEGATES_TO_GHOSTSCRIPT } = await import("./ImageMagick.ts") as any;
        const offenders = im![1].filter(f => DELEGATES_TO_GHOSTSCRIPT.has(f.format.toLowerCase()));
        expect(offenders.map(f => f.format)).toEqual([]);
    });
});
