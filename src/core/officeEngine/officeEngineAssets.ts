/**
 * Where the browser Office engine lives, and the shape of its manifest.
 *
 * Shared by the build step that writes the files (scripts/office-engine.ts)
 * and the code that downloads them, so the two cannot drift apart.
 *
 * The engine is LibreOffice compiled to WebAssembly, from the MPL-2.0 package
 * @matbee/libreoffice-converter. Its two big files (a 147 MB .wasm and a
 * 100 MB .data) are served gzipped and split into parts: no public CDN will
 * host them (jsDelivr caps packages at 150 MB, unpkg errors on the file), and
 * the parts keep each response small whatever the host does with large files.
 */
export const OFFICE_ENGINE_VERSION = "2.7.2";

/** Versioned, so a new engine never mixes parts with a cached old one. */
export const OFFICE_ENGINE_BASE = `/office-engine/${OFFICE_ENGINE_VERSION}`;

export const OFFICE_ENGINE_MANIFEST_URL = `${OFFICE_ENGINE_BASE}/manifest.json`;

/** Cache Storage name. Not wasm-v1: its expiry plugin drops entries after a week. */
export const OFFICE_ENGINE_CACHE = "office-engine-v1";

export interface OfficeEngineFile {
    /** Final file name once reassembled, e.g. "soffice.wasm". */
    name: string;
    /** Size in bytes after decompression. */
    size: number;
    /** True when the parts are gzip and must be decompressed after joining. */
    gzip: boolean;
    /** Part file names, in order, relative to OFFICE_ENGINE_BASE. */
    parts: { name: string; size: number; sha256?: string }[];
}

export interface OfficeEngineManifest {
    version: string;
    /** Total bytes to download (sum of every part). */
    downloadSize: number;
    files: OfficeEngineFile[];
}

/** The files WorkerBrowserConverter needs, by the option name it takes them under. */
export const OFFICE_ENGINE_FILES = {
    sofficeJs: "soffice.js",
    sofficeWasm: "soffice.wasm",
    sofficeData: "soffice.data",
    sofficeWorkerJs: "soffice.worker.js",
    browserWorkerJs: "browser.worker.global.js",
} as const;

/** The converter's own module, loaded at runtime rather than bundled. */
export const OFFICE_ENGINE_API = "browser.js";
