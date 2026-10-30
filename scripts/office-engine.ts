#!/usr/bin/env bun
/**
 * Put the browser Office engine into dist/office-engine/<version>/.
 *
 *   bun run build && bun run build:office-engine
 *
 * The engine is LibreOffice compiled to WebAssembly, from the npm package
 * @matbee/libreoffice-converter (MPL-2.0). It is fetched here rather than
 * installed as a dependency: it unpacks to 254 MB, and only the deployed web
 * build needs it, not node_modules, the tests or the desktop app.
 *
 * The tarball is pinned by its registry integrity hash and cached under
 * node_modules/.cache, so a rebuild does not download 80 MB again. The two big
 * files are gzipped and split into parts of at most PART_SIZE bytes; the
 * browser downloads the parts, joins and decompresses them, and keeps the
 * result in Cache Storage (src/core/officeEngine/officeEngine.ts).
 *
 * Without this step the site works as before: the manifest 404s, and the
 * Converter never offers the engine.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { parseTarGzip } from "nanotar";
import {
    OFFICE_ENGINE_VERSION, OFFICE_ENGINE_BASE, OFFICE_ENGINE_FILES, OFFICE_ENGINE_API,
    type OfficeEngineFile, type OfficeEngineManifest,
} from "../src/core/officeEngine/officeEngineAssets.ts";

const TARBALL = `https://registry.npmjs.org/@matbee/libreoffice-converter/-/libreoffice-converter-${OFFICE_ENGINE_VERSION}.tgz`;
const INTEGRITY = "sha512-62S8uLiFvwbXiCu3IfkO1cDjTyZWUy5nlMsTrmj3l+G5zf5fQcgpvzfRDR9wId+bduarrv11ZDb8Olz5zj4zJA==";
const SOURCE = "https://github.com/matbeedotcom/libreoffice-document-converter";
const PART_SIZE = 20 * 1024 * 1024;

const ROOT = path.resolve(import.meta.dir, "..");
const CACHE_DIR = path.join(ROOT, "node_modules", ".cache", "office-engine");
const TGZ = path.join(CACHE_DIR, `libreoffice-converter-${OFFICE_ENGINE_VERSION}.tgz`);
const OUT = path.join(ROOT, "dist", OFFICE_ENGINE_BASE.replace(/^\//, ""));

/** Where each served file comes from inside the package. */
const SOURCES: Record<string, string> = {
    [OFFICE_ENGINE_FILES.sofficeJs]: "package/wasm/soffice.js",
    [OFFICE_ENGINE_FILES.sofficeWasm]: "package/wasm/soffice.wasm",
    [OFFICE_ENGINE_FILES.sofficeData]: "package/wasm/soffice.data",
    [OFFICE_ENGINE_FILES.sofficeWorkerJs]: "package/wasm/soffice.worker.js",
    [OFFICE_ENGINE_FILES.browserWorkerJs]: "package/dist/browser.worker.global.js",
    [OFFICE_ENGINE_API]: "package/dist/browser.js",
};
const SPLIT = new Set<string>([OFFICE_ENGINE_FILES.sofficeWasm, OFFICE_ENGINE_FILES.sofficeData]);

/**
 * The engine starts 4 thread workers up front. Its PDF export hangs
 * intermittently, and less often with a larger pool (measured in the app:
 * 3 hangs in 5 runs with 4, 1 in 6 with 16), so the served soffice.js starts
 * 16. This is the one change made to the MPL-2.0 package; NOTICE.txt says so.
 */
const POOL_FROM = "var pthreadPoolSize=4;";
const POOL_TO = "var pthreadPoolSize=16;";

function withLargerThreadPool(js: Uint8Array): Uint8Array {
    const text = new TextDecoder().decode(js);
    if (text.split(POOL_FROM).length !== 2) {
        throw new Error(`[office-engine] expected exactly one "${POOL_FROM}" in soffice.js; the package changed`);
    }
    return new TextEncoder().encode(text.replace(POOL_FROM, POOL_TO));
}

function integrityOf(bytes: Uint8Array): string {
    return "sha512-" + crypto.createHash("sha512").update(bytes).digest("base64");
}

async function tarball(): Promise<Uint8Array> {
    if (fs.existsSync(TGZ)) {
        const cached = new Uint8Array(fs.readFileSync(TGZ));
        if (integrityOf(cached) === INTEGRITY) return cached;
        console.warn("[office-engine] cached tarball failed its integrity check; downloading again");
    }
    console.log(`[office-engine] downloading ${TARBALL}`);
    const resp = await fetch(TARBALL);
    if (!resp.ok) throw new Error(`[office-engine] ${TARBALL} answered ${resp.status}`);
    const bytes = new Uint8Array(await resp.arrayBuffer());
    if (integrityOf(bytes) !== INTEGRITY) {
        throw new Error(`[office-engine] integrity mismatch for ${TARBALL}: expected ${INTEGRITY}`);
    }
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(TGZ, bytes);
    return bytes;
}

async function main() {
    if (!fs.existsSync(path.join(ROOT, "dist", "index.html"))) {
        throw new Error("[office-engine] dist/ has no index.html; run `bun run build` first");
    }
    const manifestPath = path.join(OUT, "manifest.json");
    if (fs.existsSync(manifestPath)) {
        const prior = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as OfficeEngineManifest;
        const complete = prior.version === OFFICE_ENGINE_VERSION
            && [...SPLIT].every(name => prior.files.some(f => f.name === name))
            && prior.files.every(f => f.parts.every(p => {
                const partPath = path.join(OUT, p.name);
                if (!fs.existsSync(partPath)) return false;
                if (!SPLIT.has(f.name)) return true;
                // A stale pre-integrity build must not bypass SHA-256 validation.
                return !!p.sha256
                    && crypto.createHash("sha256").update(fs.readFileSync(partPath)).digest("hex") === p.sha256;
            }));
        if (complete) {
            console.log(`[office-engine] ${OFFICE_ENGINE_BASE} already built`);
            return;
        }
    }

    const entries = await parseTarGzip(await tarball());
    const byName = new Map(entries.map(e => [e.name, e]));
    fs.rmSync(OUT, { recursive: true, force: true });
    fs.mkdirSync(OUT, { recursive: true });

    const files: OfficeEngineFile[] = [];
    for (const [name, source] of Object.entries(SOURCES)) {
        const data = byName.get(source)?.data;
        if (!data) throw new Error(`[office-engine] ${source} is missing from the package`);
        if (!SPLIT.has(name)) {
            const served = name === OFFICE_ENGINE_FILES.sofficeJs ? withLargerThreadPool(data) : data;
            fs.writeFileSync(path.join(OUT, name), served);
            files.push({ name, size: served.byteLength, gzip: false, parts: [{ name, size: served.byteLength }] });
            continue;
        }
        const gz = zlib.gzipSync(data, { level: 9 });
        const parts: OfficeEngineFile["parts"] = [];
        for (let off = 0, i = 0; off < gz.byteLength; off += PART_SIZE, i++) {
            const part = gz.subarray(off, off + PART_SIZE);
            const partName = `${name}.gz.${String(i).padStart(3, "0")}`;
            fs.writeFileSync(path.join(OUT, partName), part);
            parts.push({
                name: partName,
                size: part.byteLength,
                sha256: crypto.createHash("sha256").update(part).digest("hex"),
            });
        }
        files.push({ name, size: data.byteLength, gzip: true, parts });
        console.log(`[office-engine] ${name}: ${(data.byteLength / 1e6).toFixed(1)} MB -> ${parts.length} gzip parts, ${(gz.byteLength / 1e6).toFixed(1)} MB`);
    }

    const manifest: OfficeEngineManifest = {
        version: OFFICE_ENGINE_VERSION,
        downloadSize: files.reduce((n, f) => n + f.parts.reduce((m, p) => m + p.size, 0), 0),
        files,
    };
    fs.writeFileSync(path.join(OUT, "NOTICE.txt"),
        `LibreOffice compiled to WebAssembly, from @matbee/libreoffice-converter ${OFFICE_ENGINE_VERSION}.\n` +
        `Licensed under the Mozilla Public License 2.0: https://mozilla.org/MPL/2.0/\n` +
        `Source: ${SOURCE}\nLibreOffice source: https://www.libreoffice.org/about-us/source-code/\n` +
        `Modified: soffice.js starts 16 thread workers instead of 4 ("${POOL_FROM}" -> "${POOL_TO}"), ` +
        `by scripts/office-engine.ts in https://github.com/ogfrench/frogConvert.\n`);
    // Written last: its presence is what marks the directory complete.
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`[office-engine] wrote ${OFFICE_ENGINE_BASE}: ${(manifest.downloadSize / 1e6).toFixed(1)} MB to download`);
}

await main();
