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
    if (bytes < 1024) return `${bytes} B`;
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(1)} KB`;
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
export async function ensureMinDuration(startTime: number, minMs: number = 1200): Promise<void> {
    const elapsed = performance.now() - startTime;
    if (elapsed < minMs) {
        await new Promise<void>(resolve => setTimeout(resolve, minMs - elapsed));
    }
}

/** localStorage.setItem that swallows QuotaExceededError / disabled-storage errors. */
export function safeLocalStorageSet(key: string, value: string): void {
    try { localStorage.setItem(key, value); } catch { /* quota or disabled */ }
}

/**
 * Normalises an arbitrary thrown value into a short, user-facing string
 * suitable for display in popups. Strips stack frames, file URLs, and the
 * "Error:" prefix; maps a few known error shapes to friendlier copy; and
 * truncates to ~200 chars. Returns "" if nothing meaningful remains.
 */
export function toUserErrorText(err: unknown): string {
    if (err == null) return "";
    let raw: string;
    if (err instanceof Error) raw = err.message;
    else if (typeof err === "string") raw = err;
    else {
        try { raw = String(err); } catch { raw = ""; }
    }

    if (!raw) return "";

    let text = raw
        .split(/\r?\n/)
        .filter(line => !/^\s*at\s/.test(line))
        .join(" ")
        .replace(/https?:\/\/\S+/g, "")
        .replace(/file:\/\/\/\S+/g, "")
        .replace(/^\s*\w*Error:\s*/i, "")
        .replace(/\s+/g, " ")
        .trim();

    if (!text) return "";

    if (/password/i.test(text)) return "Looks password-protected.";
    if (/worker crashed/i.test(text)) return "The converter crashed midway.";
    if (/tim(ed)?\s*out/i.test(text)) return "Conversion timed out.";
    if (/^cancell?ed\b/i.test(text)) return "Cancelled.";
    if (/not ready after init|doesn'?t support|no conversion path/i.test(text)) return "Unsupported file shape for this converter.";
    if (/output is empty/i.test(text)) return "Converter produced an empty result.";

    if (text.length > 200) text = text.slice(0, 197).trimEnd() + "...";
    return text;
}
