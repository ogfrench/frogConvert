/**
 * Shared decompression-bomb guard for archive handlers.
 *
 * Caps: 2 GB absolute (WASM heap ceiling) AND 100× input size (min 100 MB).
 * Both must be satisfied; a small legitimate archive is never rejected.
 */
const BOMB_ABSOLUTE_CAP_BYTES = 2 * 1024 * 1024 * 1024;

export function assertDecompressedSizeSafe(
    inputBytes: Uint8Array,
    expandedSize: number,
    archiveKind: string,
): void {
    const ratioCap = Math.max(inputBytes.length * 100, 100 * 1024 * 1024);
    const limit = Math.min(BOMB_ABSOLUTE_CAP_BYTES, ratioCap);
    if (expandedSize > limit) {
        const mb = (expandedSize / (1024 * 1024)).toFixed(0);
        const limitMb = (limit / (1024 * 1024)).toFixed(0);
        throw new Error(
            `${archiveKind} archive would decompress to ~${mb} MB — exceeds the ${limitMb} MB safety cap. Try a smaller archive.`,
        );
    }
}
