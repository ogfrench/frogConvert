import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { writeOutput } from "./fileInput.ts";

describe("writeOutput no-overwrite mode", () => {
    it("preserves the existing output and reports a collision", async () => {
        const dir = await mkdtemp(join(tmpdir(), "frogconvert-no-overwrite-"));
        const path = join(dir, "output.pdf");
        const previous = process.env.FROGCONVERT_DENY_OVERWRITE;
        process.env.FROGCONVERT_DENY_OVERWRITE = "1";
        try {
            await writeOutput(path, new Uint8Array([1, 2, 3]));
            await expect(writeOutput(path, new Uint8Array([4, 5]))).rejects.toThrow();
            expect(Array.from(await readFile(path))).toEqual([1, 2, 3]);
        } finally {
            if (previous === undefined) delete process.env.FROGCONVERT_DENY_OVERWRITE;
            else process.env.FROGCONVERT_DENY_OVERWRITE = previous;
            await rm(dir, { recursive: true, force: true });
        }
    });
});
