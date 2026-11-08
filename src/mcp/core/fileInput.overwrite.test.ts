import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, symlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { enforceSandboxedPath, writeOutput } from "./fileInput.ts";

describe("Essentials filesystem restrictions", () => {
    it("does not overwrite existing outputs", async () => {
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

    it.skipIf(process.platform === "win32")("rejects symlinks escaping the configured root", async () => {
        const dir = await mkdtemp(join(tmpdir(), "frogconvert-sandbox-"));
        const root = join(dir, "allowed");
        const outside = join(dir, "outside");
        const previous = process.env.FROGCONVERT_SANDBOX_ROOT;
        await import("fs/promises").then(fs => Promise.all([
            fs.mkdir(root), fs.mkdir(outside)
        ]));
        process.env.FROGCONVERT_SANDBOX_ROOT = root;
        try {
            await symlink(outside, join(root, "escape"));
            const dangling = join(root, "dangling.pdf");
            const escapedFile = join(outside, "missing.pdf");
            await symlink(escapedFile, dangling);
            expect(() => enforceSandboxedPath(dangling)).toThrow(/symlink/);
            await expect(writeOutput(dangling, new Uint8Array([1]))).rejects.toThrow(/symlink/);
            await expect(readFile(escapedFile)).rejects.toThrow();
            expect(() => enforceSandboxedPath(join(root, "escape", "file.pdf"))).toThrow(/symlink/);
            await expect(writeOutput(join(root, "escape", "file.pdf"), new Uint8Array([1]))).rejects.toThrow(/symlink/);
            expect(() => enforceSandboxedPath(join(dir, "outside", "file.pdf"))).toThrow(/escapes/);
            expect(enforceSandboxedPath(join(root, "valid", "file.pdf"))).toBe(join(root, "valid", "file.pdf"));
        } finally {
            if (previous === undefined) delete process.env.FROGCONVERT_SANDBOX_ROOT;
            else process.env.FROGCONVERT_SANDBOX_ROOT = previous;
            await rm(dir, { recursive: true, force: true });
        }
    });
});
