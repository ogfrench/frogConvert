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

/** sessionStorage.getItem that swallows disabled-storage errors. */
export function safeSessionStorageGet(key: string): string | null {
    try { return sessionStorage.getItem(key); } catch { return null; }
}

/** sessionStorage.setItem that swallows QuotaExceededError / disabled-storage errors. */
export function safeSessionStorageSet(key: string, value: string): void {
    try { sessionStorage.setItem(key, value); } catch { /* quota or disabled */ }
}

/** sessionStorage.removeItem that swallows disabled-storage errors. */
export function safeSessionStorageRemove(key: string): void {
    try { sessionStorage.removeItem(key); } catch { /* disabled */ }
}

export const SUPPORT_CONTACT_EMAIL = "francois.prevot@frog.co";
export const SUPPORT_CONTACT_TEXT = `Still stuck, or want this format added? Email ${SUPPORT_CONTACT_EMAIL}.`;
export const FEEDBACK_CONTACT_TEXT = `Still stuck, or want to share feedback? Email ${SUPPORT_CONTACT_EMAIL}.`;

export const CONVERSION_NOT_AVAILABLE_TEXT = "This conversion isn't available yet.";
export const GENERIC_CONVERSION_ERROR_TEXT = "Something went wrong while converting this file.";

export type UserErrorKind =
    | "not_available"
    | "input_issue"
    | "runtime_failure"
    | "cancelled"
    /** The engine itself could not be downloaded. Nothing to do with the file. */
    | "engine_download"
    | "unknown";

export interface UserErrorInfo {
    message: string;
    kind: UserErrorKind;
}

function cleanErrorText(err: unknown): string {
    if (err == null) return "";
    let raw: string;
    if (err instanceof Error) raw = err.message;
    else if (typeof err === "string") raw = err;
    else {
        try { raw = String(err); } catch { raw = ""; }
    }

    if (!raw) return "";

    return raw
        .split(/\r?\n/)
        .filter(line => !/^\s*at\s/.test(line))
        .join(" ")
        .replace(/https?:\/\/\S+/g, "")
        .replace(/file:\/\/\/\S+/g, "")
        .replace(/^\s*\w*Error:\s*/i, "")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Normalises an arbitrary thrown value into a short, user-facing string
 * suitable for display in popups. Strips stack frames, file URLs, and the
 * "Error:" prefix; maps a few known error shapes to friendlier copy; and
 * truncates to ~200 chars. Returns "" if nothing meaningful remains.
 */
/**
 * Whether the browser is certain there is no network.
 *
 * `navigator.onLine === false` is trustworthy: the machine has no usable
 * interface. `true` is not - it means "there is an interface", which a captive
 * portal or a dead uplink also satisfies. So this is only ever asked in the
 * negative direction, to explain a failure that has already happened rather
 * than to predict one.
 *
 * It matters here because the app is offline-first in an unusual way: the
 * page itself is cached by the service worker, but the converters are not.
 * They are tens of megabytes of WebAssembly fetched the first time each one is
 * needed. So "the app opened" and "this conversion can run" are different
 * questions offline, and a failure that says nothing about the network sends
 * people looking for a problem with their file.
 */
/**
 * Said when the converter could not be fetched.
 *
 * This is not the offline case: the browser has a connection, it just did not
 * survive a 16 MB download. Diagnosed as "unknown" it produced "didn't
 * complete this time - try a different target format or another file", which
 * is advice that cannot possibly work, aimed at a file that was never the
 * problem. Reported on a real EPS to PDF over a weak connection.
 */
export const ENGINE_DOWNLOAD_FAILED_TEXT =
    "The converter for this format couldn't finish downloading. It's a one-time ~16 MB file and a weak connection will drop it. Your file is fine - try again, ideally on a steadier network.";

export function isOffline(): boolean {
    return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** The one sentence said whenever something failed and there is no network. */
export const OFFLINE_MESSAGE =
    "You're offline. frogConvert keeps working without a connection, but each converter downloads once the first time you use it, and this one hasn't been downloaded yet. Reconnect and try again.";

export function toUserErrorInfo(err: unknown): UserErrorInfo {
    let text = cleanErrorText(err);

    if (!text) return { message: "", kind: "unknown" };

    if (/^cancell?ed\b/i.test(text)) return { message: "Cancelled.", kind: "cancelled" };

    // A download that died, not a file that cannot be read. Checked before the
    // capability patterns below, because "Couldn't fetch the converter" also
    // matches the Ghostscript rule and would otherwise be reported as a format
    // we do not support.
    if (/failed to fetch|networkerror|network error|load failed|dynamically imported module|couldn'?t fetch the|err_(internet|network|connection)|net::/i.test(text)) {
        return { message: ENGINE_DOWNLOAD_FAILED_TEXT, kind: "engine_download" };
    }
    if (/password/i.test(text)) {
        return {
            message: "This file looks password-protected. Remove the password and upload it again.",
            kind: "input_issue",
        };
    }
    if (/^not found$/i.test(text)
        || /no conversion path|no path found|conversion isn'?t available|not found or not (readable|writable)|input format .+ not found|output format .+ not found|doesn'?t support/i.test(text)
        // WASM-handler delegate / missing-module errors are capability gaps, not
        // file-content issues. ImageMagick without Ghostscript on EPS/PS, policy
        // denials on PDF, etc. all surface here.
        || /no\s*decode\s*delegate|no\s*encode\s*delegate|delegate failed|missing delegate|failedtoexecutecommand|ghostscript|unable to load module|imagemagick is not configured|not authoriz(ed|ation)|policy denies|not allowed by .*polic|security polic/i.test(text)) {
        return { message: CONVERSION_NOT_AVAILABLE_TEXT, kind: "not_available" };
    }
    if (/not ready after init|headless not yet initialized|headless initialization failed|browser bridge requires/i.test(text)) {
        return {
            message: "The converter is still warming up. Try again in a moment.",
            kind: "runtime_failure",
        };
    }
    if (/worker crashed/i.test(text)) {
        return { message: "The converter crashed while processing this file.", kind: "runtime_failure" };
    }
    if (/tim(ed)?\s*out/i.test(text)) {
        return { message: "This one took too long to finish. A smaller file or another format might work.", kind: "runtime_failure" };
    }
    if (/output is empty/i.test(text)) {
        return { message: "The converter finished, but came back empty. Try another file or format.", kind: "input_issue" };
    }
    if (/invalid base64|could not be read|failed to parse|malformed|corrupt|damaged/i.test(text)) {
        return { message: "This file couldn't be read. Try re-exporting it or uploading a fresh copy.", kind: "input_issue" };
    }
    if (/too large|safety cap|decompress/i.test(text)) {
        return { message: text.length > 200 ? text.slice(0, 197).trimEnd() + "..." : text, kind: "input_issue" };
    }

    return { message: GENERIC_CONVERSION_ERROR_TEXT, kind: "unknown" };
}

export function toUserErrorText(err: unknown): string {
    return toUserErrorInfo(err).message;
}

export function appendSupportContact(message: string, contactText: string = SUPPORT_CONTACT_TEXT): string {
    if (!message) return contactText;
    if (message.includes(SUPPORT_CONTACT_EMAIL)) return message;
    return `${message} ${contactText}`;
}
