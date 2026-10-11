// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { gzipSync } from "node:zlib";
import { randomBytes } from "node:crypto";
import {
    OFFICE_ENGINE_BASE, OFFICE_ENGINE_CACHE, OFFICE_ENGINE_MANIFEST_URL, type OfficeEngineManifest,
} from "./officeEngineAssets.ts";

/** A Cache Storage stand-in: one Map per cache name, keyed by URL. */
function fakeCaches() {
    const stores = new Map<string, Map<string, Response>>();
    const open = async (name: string) => {
        if (!stores.has(name)) stores.set(name, new Map());
        const store = stores.get(name)!;
        return {
            put: async (url: string, resp: Response) => { store.set(url, resp.clone()); },
            match: async (url: string) => store.get(url)?.clone(),
        };
    };
    return { stores, api: { open, delete: async (name: string) => stores.delete(name) } };
}

// Random, so gzip cannot shrink them below one part.
const wasm = new Uint8Array(randomBytes(3000));
const data = new Uint8Array(randomBytes(1500));

/** The engine as scripts/office-engine.ts would lay it out, with tiny parts. */
function deployment() {
    const files: Record<string, Uint8Array> = {};
    const split = (name: string, bytes: Uint8Array, size: number) => {
        const gz = new Uint8Array(gzipSync(bytes));
        const parts = [];
        for (let off = 0, i = 0; off < gz.byteLength; off += size, i++) {
            const partName = `${name}.gz.${String(i).padStart(3, "0")}`;
            files[`${OFFICE_ENGINE_BASE}/${partName}`] = gz.subarray(off, off + size);
            parts.push({ name: partName, size: Math.min(size, gz.byteLength - off) });
        }
        return { name, size: bytes.byteLength, gzip: true, parts };
    };
    const manifest: OfficeEngineManifest = {
        version: "test",
        downloadSize: 0,
        files: [split("soffice.wasm", wasm, 500), split("soffice.data", data, 400)],
    };
    manifest.downloadSize = manifest.files.reduce((n, f) => n + f.parts.reduce((m, p) => m + p.size, 0), 0);
    files[OFFICE_ENGINE_MANIFEST_URL] = new TextEncoder().encode(JSON.stringify(manifest));
    return { files, manifest };
}

describe("office engine download", () => {
    let caches: ReturnType<typeof fakeCaches>;
    let served: Record<string, Uint8Array>;

    beforeEach(() => {
        vi.resetModules();
        caches = fakeCaches();
        served = deployment().files;
        vi.stubGlobal("caches", caches.api);
        vi.stubGlobal("window", { crossOriginIsolated: true, matchMedia: () => ({ matches: false }) });
        vi.stubGlobal("navigator", { storage: { persist: async () => true } });
        vi.stubGlobal("fetch", async (url: string) => {
            const body = served[url];
            return body ? new Response(body.slice()) : new Response("not found", { status: 404 });
        });
    });
    afterEach(() => vi.unstubAllGlobals());

    it("joins and decompresses the parts, and stores each file at its own URL", async () => {
        const { downloadOfficeEngine, isOfficeEngineCached } = await import("./officeEngine.ts");
        expect(await isOfficeEngineCached()).toBe(false);
        const progress: number[] = [];
        await downloadOfficeEngine(p => progress.push(p.loaded / p.total));

        const store = caches.stores.get(OFFICE_ENGINE_CACHE)!;
        expect(new Uint8Array(await store.get(`${OFFICE_ENGINE_BASE}/soffice.wasm`)!.clone().arrayBuffer())).toEqual(wasm);
        expect(new Uint8Array(await store.get(`${OFFICE_ENGINE_BASE}/soffice.data`)!.clone().arrayBuffer())).toEqual(data);
        expect(store.get(`${OFFICE_ENGINE_BASE}/soffice.wasm`)!.headers.get("content-type")).toBe("application/wasm");
        expect(progress.at(-1)).toBe(1);
        expect(await isOfficeEngineCached()).toBe(true);
    });

    it("leaves nothing behind when a part is missing", async () => {
        delete served[`${OFFICE_ENGINE_BASE}/soffice.data.gz.001`];
        const { downloadOfficeEngine, isOfficeEngineCached } = await import("./officeEngine.ts");
        await expect(downloadOfficeEngine()).rejects.toThrow(/404/);
        expect(caches.stores.has(OFFICE_ENGINE_CACHE)).toBe(false);
        expect(await isOfficeEngineCached()).toBe(false);
    });

    it("rejects a file whose size does not match the manifest", async () => {
        const { manifest } = deployment();
        manifest.files[0].size += 1;
        served[OFFICE_ENGINE_MANIFEST_URL] = new TextEncoder().encode(JSON.stringify(manifest));
        const { downloadOfficeEngine } = await import("./officeEngine.ts");
        await expect(downloadOfficeEngine()).rejects.toThrow(/incomplete/);
        expect(caches.stores.has(OFFICE_ENGINE_CACHE)).toBe(false);
    });

    it("is never offered on a touch device, or without cross-origin isolation", async () => {
        vi.stubGlobal("window", { crossOriginIsolated: true, matchMedia: () => ({ matches: true }) });
        let mod = await import("./officeEngine.ts");
        expect(await mod.officeEngineSupport()).toBe("unsupported");

        vi.resetModules();
        vi.stubGlobal("window", { crossOriginIsolated: false, matchMedia: () => ({ matches: false }) });
        mod = await import("./officeEngine.ts");
        expect(await mod.officeEngineSupport()).toBe("unsupported");
    });

    it("is offered when deployed, and reported cached once downloaded", async () => {
        const mod = await import("./officeEngine.ts");
        expect(await mod.officeEngineSupport()).toBe("available");
        await mod.downloadOfficeEngine();
        expect(await mod.officeEngineSupport()).toBe("cached");
    });

    it("treats a site without the engine as unsupported", async () => {
        served = {};
        const mod = await import("./officeEngine.ts");
        expect(await mod.officeEngineSupport()).toBe("unsupported");
    });
});
