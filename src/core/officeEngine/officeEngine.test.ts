// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { gzipSync } from "node:zlib";
import { createHash, randomBytes } from "node:crypto";
import {
    OFFICE_ENGINE_BASE, OFFICE_ENGINE_CACHE, OFFICE_ENGINE_MANIFEST_URL, type OfficeEngineManifest,
    OFFICE_ENGINE_FILES, OFFICE_ENGINE_VERSION,
} from "./officeEngineAssets.ts";

/** A Cache Storage stand-in: one Map per cache name, keyed by URL. */
function fakeCaches() {
    const stores = new Map<string, Map<string, Response>>();
    const open = async (name: string) => {
        if (!stores.has(name)) stores.set(name, new Map());
        const store = stores.get(name)!;
        return {
            put: async (url: string, resp: Response) => {
                // Real CacheStorage.put consumes streaming response bodies before resolving.
                const bytes = await resp.arrayBuffer();
                store.set(url, new Response(bytes, { headers: resp.headers }));
            },
            match: async (url: string) => store.get(url)?.clone(),
            delete: async (url: string) => store.delete(url),
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
            parts.push({
                name: partName, size: Math.min(size, gz.byteLength - off),
                sha256: createHash("sha256").update(files[`${OFFICE_ENGINE_BASE}/${partName}`]).digest("hex"),
            });
        }
        return { name, size: bytes.byteLength, gzip: true, parts };
    };
    const manifest: OfficeEngineManifest = {
        version: OFFICE_ENGINE_VERSION,
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
        vi.stubGlobal("Worker", class {});
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

    it("reaches 100% after installing the binary parts, excluding startup scripts", async () => {
        const { manifest } = deployment();
        manifest.files.push({
            name: "soffice.js", size: 1024, gzip: false,
            parts: [{ name: "soffice.js", size: 1024 }],
        });
        manifest.downloadSize += 1024;
        served[OFFICE_ENGINE_MANIFEST_URL] = new TextEncoder().encode(JSON.stringify(manifest));
        const { downloadOfficeEngine, officeEngineDownloadSize } = await import("./officeEngine.ts");
        const totals: Array<{ loaded: number; total: number }> = [];
        await downloadOfficeEngine(p => totals.push(p));
        expect(totals.at(-1)?.loaded).toBe(totals.at(-1)?.total);
        expect(await officeEngineDownloadSize()).toBe(manifest.downloadSize - 1024);
    });

    it("leaves nothing behind when a part is missing", async () => {
        delete served[`${OFFICE_ENGINE_BASE}/soffice.data.gz.001`];
        const { downloadOfficeEngine, isOfficeEngineCached } = await import("./officeEngine.ts");
        await expect(downloadOfficeEngine()).rejects.toThrow(/404/);
        expect(caches.stores.has(OFFICE_ENGINE_CACHE)).toBe(false);
        expect(await isOfficeEngineCached()).toBe(false);
    });

    it("cleans the partial cache after an aborted download", async () => {
        const controller = new AbortController();
        vi.stubGlobal("fetch", async (url: string, init?: { signal?: AbortSignal }) => {
            if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
            const body = served[url];
            return body ? new Response(body.slice()) : new Response("not found", { status: 404 });
        });
        const { downloadOfficeEngine } = await import("./officeEngine.ts");
        await expect(downloadOfficeEngine(() => controller.abort(), controller.signal))
            .rejects.toThrow(/abort/i);
        expect(caches.stores.has(OFFICE_ENGINE_CACHE)).toBe(false);
    });

    it("rejects a file whose size does not match the manifest", async () => {
        const { manifest } = deployment();
        manifest.files[0].size += 1;
        served[OFFICE_ENGINE_MANIFEST_URL] = new TextEncoder().encode(JSON.stringify(manifest));
        const { downloadOfficeEngine } = await import("./officeEngine.ts");
        await expect(downloadOfficeEngine()).rejects.toThrow(/incomplete/);
        expect(caches.stores.has(OFFICE_ENGINE_CACHE)).toBe(false);
    });

    it("retries an interrupted 200 response for a bounded part", async () => {
        let attempts = 0;
        const url = `${OFFICE_ENGINE_BASE}/soffice.wasm.gz.000`;
        vi.stubGlobal("fetch", async (requested: string) => {
            const body = served[requested];
            if (!body) return new Response("not found", { status: 404 });
            if (requested === url && attempts++ === 0) return new Response(body.subarray(0, body.byteLength - 1));
            return new Response(body.slice());
        });
        const { downloadOfficeEngine, isOfficeEngineCached } = await import("./officeEngine.ts");
        await downloadOfficeEngine();
        expect(attempts).toBe(2);
        expect(await isOfficeEngineCached()).toBe(true);
    });

    it("rejects a corrupt part with HTTP 200 after limited retries", async () => {
        const url = `${OFFICE_ENGINE_BASE}/soffice.wasm.gz.000`;
        served[url] = served[url].slice();
        served[url][3] ^= 0xff;
        const { downloadOfficeEngine } = await import("./officeEngine.ts");
        await expect(downloadOfficeEngine()).rejects.toThrow(/integrity verification/);
        expect(caches.stores.has(OFFICE_ENGINE_CACHE)).toBe(false);
    });

    it("rejects storage that exposes CacheStorage but refuses writes", async () => {
        const cache = await caches.api.open(OFFICE_ENGINE_CACHE);
        cache.put = async () => { throw new DOMException("Quota exceeded", "QuotaExceededError"); };
        // Return a cache with the same failing writes from every open call.
        vi.stubGlobal("caches", { ...caches.api, open: async () => cache });
        const { downloadOfficeEngine } = await import("./officeEngine.ts");
        await expect(downloadOfficeEngine()).rejects.toThrow(/Not enough browser storage/);
        expect(caches.stores.has(OFFICE_ENGINE_CACHE)).toBe(false);
    });

    it("refuses a malformed manifest before downloading any binary", async () => {
        const manifest = deployment().manifest;
        manifest.files[0].parts[0].size = 100 * 1024 * 1024;
        served[OFFICE_ENGINE_MANIFEST_URL] = new TextEncoder().encode(JSON.stringify(manifest));
        const { downloadOfficeEngine } = await import("./officeEngine.ts");
        await expect(downloadOfficeEngine()).rejects.toThrow(/manifest is missing or invalid/);
    });

    it("retains the original part HTTP status if CacheStorage hides response-stream errors", async () => {
        const cache = await caches.api.open(OFFICE_ENGINE_CACHE);
        const originalPut = cache.put;
        cache.put = async (url, response) => {
            try {
                await originalPut(url, response);
            } catch {
                throw new TypeError("Cache.put could not consume stream");
            }
        };
        vi.stubGlobal("caches", { ...caches.api, open: async () => cache });
        delete served[`${OFFICE_ENGINE_BASE}/soffice.data.gz.001`];
        const { downloadOfficeEngine } = await import("./officeEngine.ts");
        await expect(downloadOfficeEngine()).rejects.toThrow(/HTTP 404/);
        expect(caches.stores.has(OFFICE_ENGINE_CACHE)).toBe(false);
    });

    it("passes an abort signal to Web Locks so a queued install can be cancelled", async () => {
        const controller = new AbortController();
        const request = vi.fn(async (_name: string, options: LockOptions) => {
            expect(options.mode).toBe("exclusive");
            expect(options.signal).toBe(controller.signal);
            controller.abort();
            throw new DOMException("Lock wait aborted", "AbortError");
        });
        vi.stubGlobal("navigator", { storage: { persist: async () => false }, locks: { request } });
        const { downloadOfficeEngine } = await import("./officeEngine.ts");
        await expect(downloadOfficeEngine(undefined, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
        expect(request).toHaveBeenCalledOnce();
    });

    it("offers the engine on touch devices when browser features are available", async () => {
        vi.stubGlobal("window", { crossOriginIsolated: true, matchMedia: () => ({ matches: true }) });
        const mod = await import("./officeEngine.ts");
        expect(await mod.officeEngineSupport()).toBe("available");
    });

    it("rejects missing browser capabilities, regardless of pointer type", async () => {
        vi.stubGlobal("window", { crossOriginIsolated: false, matchMedia: () => ({ matches: true }) });
        let mod = await import("./officeEngine.ts");
        expect(await mod.officeEngineSupport()).toBe("unsupported");

        vi.resetModules();
        vi.stubGlobal("window", { crossOriginIsolated: true });
        vi.stubGlobal("Worker", undefined);
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

    it("releases already opened binary URLs when the next cached binary is missing", async () => {
        const cache = await caches.api.open(OFFICE_ENGINE_CACHE);
        await cache.put(`${OFFICE_ENGINE_BASE}/${OFFICE_ENGINE_FILES.sofficeWasm}`, new Response(wasm));
        vi.stubGlobal("location", { href: "https://frogconvert.xyz/" });
        const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:office-test");
        const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
        try {
            const { openOfficeEngine } = await import("./officeEngine.ts");
            await expect(openOfficeEngine()).rejects.toThrow(/isn't downloaded/);
            expect(create).toHaveBeenCalledOnce();
            expect(revoke).toHaveBeenCalledWith("blob:office-test");
        } finally {
            create.mockRestore();
            revoke.mockRestore();
        }
    });
});
