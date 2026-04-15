import { readFile } from "fs/promises";
import { basename } from "path";
import type { CoreSourceFile } from "../../tools/types.ts";

export interface FileInputRef {
    filePath?: string;
    base64Bytes?: string;
    fileName?: string;
}

export function enforceSize(byteLength: number) {
    const maxMb = Number(process.env.MAX_UPLOAD_MB ?? 4096);
    if (byteLength > maxMb * 1024 * 1024) {
        throw new Error(`File too large (max ${maxMb} MB)`);
    }
}

export async function resolveBytes(input: FileInputRef): Promise<{ bytes: Uint8Array; name: string }> {
    if (input.filePath) {
        const buf = await readFile(input.filePath);
        enforceSize(buf.byteLength);
        const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        return { bytes, name: input.fileName ?? basename(input.filePath) };
    }
    if (!input.base64Bytes) throw new Error("Input must have filePath or base64Bytes");
    if (!input.fileName) throw new Error("fileName required when using base64Bytes");
    // Approximate decoded size from base64 length (4 b64 chars → 3 bytes)
    enforceSize(Math.floor(input.base64Bytes.length * 0.75));
    const buf = Buffer.from(input.base64Bytes, "base64");
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
