export function escapeHTML(str: string): string {
    return str.replace(/[&<>'"]/g,
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}

export function formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024 * 1024) return `~${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    if (bytes >= 1024 * 1024) return `~${(bytes / (1024 * 1024)).toFixed(0)} MB`;
    return `~${(bytes / 1024).toFixed(0)} KB`;
}

export function shortenFileName(name: string, maxLength: number = 24): string {
    if (name.length <= maxLength) return name;
    const ellipsisLen = 3;
    const charsToShow = maxLength - ellipsisLen;
    const frontChars = Math.ceil(charsToShow / 2);
    const backChars = Math.floor(charsToShow / 2);
    return name.substring(0, frontChars) + "..." + name.substring(name.length - backChars);
}

/** Waits until at least `minMs` have elapsed since `startTime`, preventing UI flicker. */
export async function ensureMinDuration(startTime: number, minMs: number = 600): Promise<void> {
    const elapsed = performance.now() - startTime;
    if (elapsed < minMs) {
        await new Promise<void>(resolve => setTimeout(resolve, minMs - elapsed));
    }
}
