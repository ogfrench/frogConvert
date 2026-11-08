import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, symlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { enforceSandboxedPath, resolveBytes, writeOutput } from "./fileInput.ts";

describe("Essentials filesystem restrictions", () => {
    it("rejects invalid upload limits and enforces limits before file reads", async () => {
        const dir = await mkdtemp(join(tmpdir(), "frogconvert-input-limit-"));
        const source = join(dir, "input.bin");
        const previous = process.env.MAX_UPLOAD_MB;
        try {
            await import("fs/promises").then(fs => fs.writeFile(source, new Uint8Array(1024)));
            process.env.MAX_UPLOAD_MB = "not-a-number";
            await expect(resolveBytes({ filePath: source })).rejects.toThrow(/Invalid MAX_UPLOAD_MB/);
            process.env.MAX_UPLOAD_MB = "0.0001";
            await expect(resolveBytes({ filePath: source })).rejects.toThrow(/File too large/);
            await expect(resolveBytes({ fileName: "large.bin", base64Bytes: Buffer.alloc(1024).toString("base64") })).rejects.toThrow(/File too large/);
        } finally {
            if (previous === undefined) delete process.env.MAX_UPLOAD_MB;
            else process.env.MAX_UPLOAD_MB = previous;
            await rm(dir, { recursive: true, force: true });
        }
    });

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
