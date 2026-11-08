import { open, mkdir } from "fs/promises";
import { constants, lstatSync, realpathSync } from "fs";
import { basename, dirname, resolve as resolvePath, relative as relativePath, isAbsolute, sep } from "path";
import { z } from "zod";
import type { CoreSourceFile } from "../../tools/types.ts";

export interface FileInputRef {
    filePath?: string;
    base64Bytes?: string;
    fileName?: string;
}

/** Shared zod schema for the FileInputRef shape used by every PDF MCP tool. */
export const fileInputSchema = z.object({
    filePath: z.string().optional(),
    base64Bytes: z.string().optional(),
    fileName: z.string().optional(),
});

/**
 * Thrown for caller-supplied input that fails validation. Catch-alls in API
 * routes and MCP tools surface its message verbatim instead of normalising it,
 * because validation strings (e.g. "fileName required", "sourceIndex N out of
 * range") are part of the developer-facing contract.
 */
export class ValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ValidationError";
    }
}

function enforceSize(byteLength: number) {
    const maxMb = Number(process.env.MAX_UPLOAD_MB ?? 4096);
    if (!Number.isFinite(maxMb) || maxMb < 0) throw new ValidationError("Invalid MAX_UPLOAD_MB configuration");
    if (byteLength > maxMb * 1024 * 1024) {
        throw new ValidationError(`File too large (max ${maxMb} MB)`);
    }
}

/**
 * Containment check for caller-supplied absolute paths.
 *
 * When FROGCONVERT_SANDBOX_ROOT is set, every filePath / outputFilePath /
 * outputDir passed into an API route must resolve to a location inside that
 * root. This is defense-in-depth against DNS-rebinding or otherwise-untrusted
 * clients reaching the local API, combined with the Origin/Host check in
 * src/api/index.ts.
 *
 * When FROGCONVERT_SANDBOX_ROOT is unset the check is a no-op so existing
 * workflows (e.g. agents passing absolute paths outside cwd) keep working.
 */
function isWithinRoot(root: string, candidate: string): boolean {
    const rel = relativePath(root, candidate);
    return rel === "" || (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel));
}

export function enforceSandboxedPath(inputPath: string): string {
    const root = process.env.FROGCONVERT_SANDBOX_ROOT;
    if (!root) return inputPath;

    const lexicalRoot = resolvePath(root);
    let realRoot: string;
    try {
        realRoot = realpathSync(lexicalRoot);
    } catch {
        throw new ValidationError("FROGCONVERT_SANDBOX_ROOT does not exist");
    }
    const requested = isAbsolute(inputPath)
        ? resolvePath(inputPath)
        : resolvePath(lexicalRoot, inputPath);

    if (!isWithinRoot(lexicalRoot, requested)) {
        throw new ValidationError("Path escapes FROGCONVERT_SANDBOX_ROOT");
    }

    // Validate the nearest existing ancestor, not only the lexical path:
    // an existing symlinked directory or file must not cross the root.
    // New output folders do not yet exist, so walk upward to the first one.
    let existing = requested;
    while (true) {
        try {
            lstatSync(existing);
            break;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            const parent = dirname(existing);
            if (parent === existing) {
                throw new ValidationError("Path escapes FROGCONVERT_SANDBOX_ROOT");
            }
            existing = parent;
        }
    }
    let realExisting: string;
    try {
        realExisting = realpathSync(existing);
    } catch {
        throw new ValidationError("Path escapes FROGCONVERT_SANDBOX_ROOT through a symlink");
    }
    if (!isWithinRoot(realRoot, realExisting)) {
        throw new ValidationError("Path escapes FROGCONVERT_SANDBOX_ROOT through a symlink");
    }
    return requested;
}

/**
 * Write a caller-supplied output path, creating its folder first. A missing
 * folder otherwise surfaced as ENOENT, which the tools reported as the generic
 * "Something went wrong while converting" (HTTP 400 on REST) - after the
 * conversion had already succeeded.
 */
export async function writeOutput(path: string, bytes: Uint8Array): Promise<void> {
    const safePath = enforceSandboxedPath(path);
    await mkdir(dirname(safePath), { recursive: true });
    // Re-check after directory creation, which can expose an existing symlink
    // parent that did not exist when the caller validated its output path.
    enforceSandboxedPath(safePath);
    // With sandboxing enabled, O_NOFOLLOW rejects a final-component symlink swap
    // on POSIX. Parent-directory races still require filesystem/OS isolation.
    const noFollow = process.env.FROGCONVERT_SANDBOX_ROOT && process.platform !== "win32"
        ? (constants.O_NOFOLLOW ?? 0) : 0;
    const flags = constants.O_WRONLY | constants.O_CREAT | noFollow |
        (process.env.FROGCONVERT_DENY_OVERWRITE === "1" ? constants.O_EXCL : constants.O_TRUNC);
    const handle = await open(safePath, flags, 0o600);
    try {
        await handle.writeFile(bytes);
    } finally {
        await handle.close();
    }
}

export async function resolveBytes(input: FileInputRef): Promise<{ bytes: Uint8Array; name: string }> {
    if (input.filePath) {
        const safePath = enforceSandboxedPath(input.filePath);
        const noFollow = process.env.FROGCONVERT_SANDBOX_ROOT && process.platform !== "win32"
        ? (constants.O_NOFOLLOW ?? 0) : 0;
        const handle = await open(safePath, constants.O_RDONLY | noFollow);
        try {
            enforceSize((await handle.stat()).size);
            const buf = await handle.readFile();
            enforceSize(buf.byteLength);
            const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
            return { bytes, name: input.fileName ?? basename(safePath) };
        } finally {
            await handle.close();
        }
    }
    if (!input.base64Bytes) throw new ValidationError("Input must have filePath or base64Bytes");
    if (!input.fileName) throw new ValidationError("fileName required when using base64Bytes");
    // Compute decoded size from base64 length. Whitespace is legal in base64
    // strings and must be excluded from the count; padding (`=` chars) maps
    // to zero output bytes. Without this an attacker could pad a string with
    // whitespace and bypass MAX_UPLOAD_MB by a small constant.
    const cleaned = input.base64Bytes.replace(/\s+/g, "");
    const padding = cleaned.endsWith("==") ? 2 : cleaned.endsWith("=") ? 1 : 0;
    enforceSize(Math.floor((cleaned.length * 3) / 4) - padding);
    const buf = Buffer.from(cleaned, "base64");
    enforceSize(buf.byteLength);
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    return { bytes, name: input.fileName };
}

export async function buildSourceFiles(inputs: FileInputRef[]): Promise<CoreSourceFile[]> {
    const resolved = await Promise.all(inputs.map(resolveBytes));
    return resolved.map((r, id) => ({ id, name: r.name, bytes: r.bytes }));
}

export function stripExt(name: string): string {
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(0, dot) : name;
}
