import { readFile } from "fs/promises";
import { basename, resolve as resolvePath, relative as relativePath, isAbsolute } from "path";
import type { CoreSourceFile } from "../../tools/types.ts";

export interface FileInputRef {
    filePath?: string;
    base64Bytes?: string;
    fileName?: string;
}

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

export function enforceSize(byteLength: number) {
    const maxMb = Number(process.env.MAX_UPLOAD_MB ?? 4096);
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
 * clients reaching the local API — combined with the Origin/Host check in
 * src/api/index.ts.
 *
 * When FROGCONVERT_SANDBOX_ROOT is unset the check is a no-op so existing
 * workflows (e.g. agents passing absolute paths outside cwd) keep working.
 */
export function enforceSandboxedPath(inputPath: string): string {
    const root = process.env.FROGCONVERT_SANDBOX_ROOT;
    if (!root) return inputPath;
    if (!isAbsolute(inputPath)) {
        // Relative paths are resolved against the sandbox root itself.
        const resolved = resolvePath(root, inputPath);
        const rel = relativePath(root, resolved);
        if (rel.startsWith("..") || isAbsolute(rel)) {
            throw new ValidationError("Path escapes FROGCONVERT_SANDBOX_ROOT");
        }
        return resolved;
    }
    const resolved = resolvePath(inputPath);
    const rootResolved = resolvePath(root);
    const rel = relativePath(rootResolved, resolved);
    if (rel.startsWith("..") || isAbsolute(rel)) {
        throw new Error("Path escapes FROGCONVERT_SANDBOX_ROOT");
    }
    return resolved;
}

export async function resolveBytes(input: FileInputRef): Promise<{ bytes: Uint8Array; name: string }> {
    if (input.filePath) {
        const safePath = enforceSandboxedPath(input.filePath);
        const buf = await readFile(safePath);
        enforceSize(buf.byteLength);
        const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        return { bytes, name: input.fileName ?? basename(safePath) };
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
