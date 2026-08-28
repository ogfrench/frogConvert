import { describe, it, expect } from "vitest";
import { isCacheableAsset, rejectHtmlFallback } from "./cachePolicy";

function response(status: number, contentType?: string): Response {
  return new Response("", {
    status,
    headers: contentType ? { "Content-Type": contentType } : {},
  });
}

describe("isCacheableAsset", () => {
  it("accepts a real script response", () => {
    expect(isCacheableAsset(response(200, "text/javascript"))).toBe(true);
    expect(isCacheableAsset(response(200, "application/javascript"))).toBe(true);
  });

  it("rejects the SPA fallback served for a deleted chunk", () => {
    // This is the bug: a hashed chunk from a previous deploy is gone, the host
    // answers /* with 200 index.html, and the old strategy cached that HTML
    // under the .js URL - permanently, since the URL never changes.
    expect(isCacheableAsset(response(200, "text/html"))).toBe(false);
    expect(isCacheableAsset(response(200, "text/html; charset=utf-8"))).toBe(false);
  });

  it("is case-insensitive about the content type", () => {
    expect(isCacheableAsset(response(200, "TEXT/HTML"))).toBe(false);
  });

  it("rejects a genuine 404", () => {
    expect(isCacheableAsset(response(404, "text/html"))).toBe(false);
  });

  it("rejects an opaque response", () => {
    // Status 0. Nothing same-origin should be opaque, and caching one would
    // store a success we cannot introspect. The Response constructor refuses
    // to build one (status must be 200-599), so stand one in.
    const opaque = { status: 0, headers: new Headers() } as Response;
    expect(isCacheableAsset(opaque)).toBe(false);
  });

  it("accepts a 200 with no content type rather than guessing", () => {
    expect(isCacheableAsset(response(200))).toBe(true);
  });
});

describe("rejectHtmlFallback", () => {
  it("passes a cacheable response straight through", async () => {
    const ok = response(200, "text/javascript");
    await expect(rejectHtmlFallback.cacheWillUpdate({ response: ok })).resolves.toBe(ok);
  });

  it("returns null for an HTML fallback, which tells Workbox not to cache", async () => {
    const html = response(200, "text/html");
    await expect(rejectHtmlFallback.cacheWillUpdate({ response: html })).resolves.toBeNull();
  });
});
