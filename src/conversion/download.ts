import JSZip from "jszip";
import { saveAs } from "file-saver";

/**
 * Make a filename safe for Windows (and NTFS) download writes:
 *   - strip control characters and NUL bytes
 *   - replace the nine reserved characters  `< > : " / \ | ? *`
 *   - avoid reserved device names (CON, PRN, NUL, AUX, COM1-9, LPT1-9)
 *     including when suffixed (e.g. CON.pdf → _CON.pdf)
 *   - trim trailing dots / spaces (Explorer strips these silently)
 *   - cap length at 200 chars while preserving the extension
 *
 * Browsers generally sanitize the `download` attribute, but their behaviour
 * is uneven, Firefox accepts reserved names, Safari keeps trailing dots,
 * and ZIP entries bypass the browser entirely. Apply at every write boundary
 * to guarantee the same output everywhere.
 */
const WIN_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;
export function sanitizeDownloadName(name: string): string {
    let out = name.replace(/[\x00-\x1f<>:"/\\|?*]/g, "_");
    out = out.replace(/[. ]+$/g, "");
    if (!out) out = "file";
    if (WIN_RESERVED.test(out)) out = "_" + out;
    if (out.length > 200) {
        const dot = out.lastIndexOf(".");
        if (dot > 0 && out.length - dot <= 10) {
            const ext = out.slice(dot);
            out = out.slice(0, 200 - ext.length) + ext;
        } else {
            out = out.slice(0, 200);
        }
    }
    return out;
}

export function downloadFile(bytes: Uint8Array, name: string) {
    const blob = new Blob([bytes as BlobPart], { type: "application/octet-stream" });
    const link = document.createElement("a");
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = sanitizeDownloadName(name);
    link.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
}

export async function downloadAsZip(files: { name: string; bytes: Uint8Array }[], zipName: string) {
    const zip = new JSZip();
    const seen = new Set<string>();
    for (const file of files) {
        let safe = sanitizeDownloadName(file.name);
        // Dedupe colliding sanitized names within the same archive.
        if (seen.has(safe)) {
            const dot = safe.lastIndexOf(".");
            const [base, ext] = dot > 0 ? [safe.slice(0, dot), safe.slice(dot)] : [safe, ""];
            let n = 1;
            while (seen.has(`${base}_${n}${ext}`)) n++;
            safe = `${base}_${n}${ext}`;
        }
        seen.add(safe);
        zip.file(safe, file.bytes);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    saveAs(blob, sanitizeDownloadName(zipName));
}

/**
 * Compact ISO-8601 basic-format timestamp for filenames: `YYYYMMDD-HHMMSS`
 * (local time). This is the de-facto standard for machine-generated exports
 * (Google Takeout, `IMG_YYYYMMDD_HHMMSS` camera files, log rotation): sortable,
 * filesystem-safe (no colons), unique to the second, and readable without the
 * separator noise of a full `YYYY-MM-DD_HH-MM-SS` form. Use it to disambiguate
 * download names so repeated exports don't collide (browser overwrite / `(1)`).
 */
export function timestampForFilename(d: Date = new Date()): string {
    const p = (n: number) => String(n).padStart(2, "0");
    return (
        `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
        `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
    );
}
