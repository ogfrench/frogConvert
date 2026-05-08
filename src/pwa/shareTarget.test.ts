import { describe, it, expect } from "vitest";
import { isShareTargetReady, extractSharedFilesFromCache } from "./shareTarget";

describe("isShareTargetReady", () => {
  it("returns true when share-target=ready", () => {
    expect(isShareTargetReady("?share-target=ready")).toBe(true);
    expect(isShareTargetReady("?other=1&share-target=ready")).toBe(true);
  });

  it("returns false when share-target is absent", () => {
    expect(isShareTargetReady("")).toBe(false);
    expect(isShareTargetReady("?other=1")).toBe(false);
  });

  it("returns false when share-target has a different value", () => {
    expect(isShareTargetReady("?share-target=1")).toBe(false);
    expect(isShareTargetReady("?share-target=pending")).toBe(false);
  });
});

class FakeCache {
  store = new Map<string, Response>();
  deleted: string[] = [];

  async match(key: string): Promise<Response | undefined> {
    return this.store.get(key);
  }
  async delete(key: string): Promise<boolean> {
    this.deleted.push(key);
    return this.store.delete(key);
  }
}

describe("extractSharedFilesFromCache", () => {
  it("returns [] when no payload is in the cache", async () => {
    const cache = new FakeCache();
    expect(await extractSharedFilesFromCache(cache)).toEqual([]);
  });

  it("extracts files in order, applying X-Filename header", async () => {
    const cache = new FakeCache();
    cache.store.set(
      "__share-payload",
      new Response(JSON.stringify({ count: 2, ts: 0 }), {
        headers: { "Content-Type": "application/json" },
      })
    );
    cache.store.set(
      "__share-file-0",
      new Response(new Blob(["alpha"], { type: "text/plain" }), {
        headers: { "X-Filename": encodeURIComponent("alpha.txt") },
      })
    );
    cache.store.set(
      "__share-file-1",
      new Response(new Blob(["bravo"]), {
        headers: {
          "X-Filename": encodeURIComponent("bravo.png"),
          "Content-Type": "image/png",
        },
      })
    );

    const files = await extractSharedFilesFromCache(cache);
    expect(files).toHaveLength(2);
    expect(files[0]!.name).toBe("alpha.txt");
    expect(files[1]!.name).toBe("bravo.png");
    expect(files[1]!.type).toBe("image/png");
  });

  it("clears cached entries after extraction", async () => {
    const cache = new FakeCache();
    cache.store.set(
      "__share-payload",
      new Response(JSON.stringify({ count: 1, ts: 0 }))
    );
    cache.store.set(
      "__share-file-0",
      new Response(new Blob(["x"]))
    );

    await extractSharedFilesFromCache(cache);
    expect(cache.deleted).toContain("__share-payload");
    expect(cache.deleted).toContain("__share-file-0");
  });

  it("decodes percent-encoded filenames", async () => {
    const cache = new FakeCache();
    cache.store.set(
      "__share-payload",
      new Response(JSON.stringify({ count: 1, ts: 0 }))
    );
    cache.store.set(
      "__share-file-0",
      new Response(new Blob(["x"]), {
        headers: { "X-Filename": encodeURIComponent("ünïcødé file.pdf") },
      })
    );

    const files = await extractSharedFilesFromCache(cache);
    expect(files[0]!.name).toBe("ünïcødé file.pdf");
  });
});
