import { describe, it, expect } from "vitest";
import { isCacheableAsset, rejectHtmlFallback, expectsHtml } from "./cachePolicy";

function response(status: number, contentType?: string): Response {
  return new Response("", {
    status,
    headers: contentType ? { "Content-Type": contentType } : {},
  });
}

const CHUNK = "https://frogconvert.xyz/assets/main-A1b2C3d4.js";
const DOC = "https://frogconvert.xyz/index.html";

describe("expectsHtml", () => {
  it.each([
    "https://frogconvert.xyz/index.html",
    "https://frogconvert.xyz/docs/index.html",
    "https://frogconvert.xyz/convert/png-to-jpg/index.html",
    "https://frogconvert.xyz/",
    "https://frogconvert.xyz/convert/png-to-jpg/",
  ])("%s names a document", (url) => expect(expectsHtml(url)).toBe(true));

  it.each([
    "https://frogconvert.xyz/assets/main-A1b2C3d4.js",
    "https://frogconvert.xyz/assets/index-A1b2C3d4.css",
    "https://frogconvert.xyz/docs/ARCHITECTURE.md",
    "https://frogconvert.xyz/wasm/ffmpeg-core.wasm",
    "https://frogconvert.xyz/js/espeakng.worker.js",
  ])("%s does not", (url) => expect(expectsHtml(url)).toBe(false));

  it("ignores the query string, which never makes a URL a document", () => {
    expect(expectsHtml("https://frogconvert.xyz/assets/x-A1b2C3d4.js?v=2")).toBe(false);
    expect(expectsHtml("https://frogconvert.xyz/index.html?share-target=ready")).toBe(true);
  });

  it("treats an unparseable URL as a non-document", () => {
    expect(expectsHtml("::::")).toBe(false);
  });
});

describe("isCacheableAsset", () => {
  it("accepts a real script response", () => {
    expect(isCacheableAsset(response(200, "text/javascript"), CHUNK)).toBe(true);
    expect(isCacheableAsset(response(200, "application/javascript"), CHUNK)).toBe(true);
  });

  it("rejects the SPA fallback served for a deleted chunk", () => {
    // This is the bug: a hashed chunk from a previous deploy is gone, the host
    // answers /* with 200 index.html, and the old strategy cached that HTML
    // under the .js URL - permanently, since the URL never changes.
    expect(isCacheableAsset(response(200, "text/html"), CHUNK)).toBe(false);
    expect(isCacheableAsset(response(200, "text/html; charset=utf-8"), CHUNK)).toBe(false);
  });

  it("ACCEPTS an HTML body under an HTML URL", () => {
    // Regression guard. This plugin also guards the precache, and 125 of its
    // ~165 entries are HTML documents. Rejecting them on content type alone
    // made precacheAndRoute reject its install promise with
    // bad-precaching-response, so the service worker went straight to
    // `redundant` and never activated - which silently leaves every returning
    // user on the worker they already had, i.e. ships no fix at all.
    expect(isCacheableAsset(response(200, "text/html"), DOC)).toBe(true);
    expect(isCacheableAsset(response(200, "text/html; charset=utf-8"), DOC)).toBe(true);
    expect(isCacheableAsset(response(200, "text/html"), "https://frogconvert.xyz/convert/png-to-jpg/index.html")).toBe(true);
  });

  it("is case-insensitive about the content type", () => {
    expect(isCacheableAsset(response(200, "TEXT/HTML"), CHUNK)).toBe(false);
    expect(isCacheableAsset(response(200, "TEXT/HTML"), DOC)).toBe(true);
  });

  it("rejects a genuine 404", () => {
    expect(isCacheableAsset(response(404, "text/html"), CHUNK)).toBe(false);
    expect(isCacheableAsset(response(404, "text/html"), DOC)).toBe(false);
  });

  it("rejects an opaque response", () => {
    // Status 0. Nothing same-origin should be opaque, and caching one would
    // store a success we cannot introspect. The Response constructor refuses
    // to build one (status must be 200-599), so stand one in.
    const opaque = { status: 0, headers: new Headers() } as Response;
    expect(isCacheableAsset(opaque, CHUNK)).toBe(false);
  });

  it("accepts a 200 with no content type rather than guessing", () => {
    expect(isCacheableAsset(response(200), CHUNK)).toBe(true);
  });

  it("refuses HTML when no URL is available, the safe direction", () => {
    // Only ever declines a cache write; it cannot poison anything.
    expect(isCacheableAsset(response(200, "text/html"))).toBe(false);
    expect(isCacheableAsset(response(200, "text/javascript"))).toBe(true);
  });
});

describe("rejectHtmlFallback", () => {
  it("passes a cacheable response straight through", async () => {
    const ok = response(200, "text/javascript");
    await expect(
      rejectHtmlFallback.cacheWillUpdate({ request: new Request(CHUNK), response: ok })
    ).resolves.toBe(ok);
  });

  it("returns null for an HTML fallback under a chunk URL", async () => {
    const html = response(200, "text/html");
    await expect(
      rejectHtmlFallback.cacheWillUpdate({ request: new Request(CHUNK), response: html })
    ).resolves.toBeNull();
  });

  it("passes a precached HTML document through", async () => {
    // The precache path: without this the SW cannot install.
    const html = response(200, "text/html");
    await expect(
      rejectHtmlFallback.cacheWillUpdate({ request: new Request(DOC), response: html })
    ).resolves.toBe(html);
  });

  it("falls back to response.url when no request is supplied", async () => {
    const html = new Response("", { status: 200, headers: { "Content-Type": "text/html" } });
    Object.defineProperty(html, "url", { value: DOC });
    await expect(rejectHtmlFallback.cacheWillUpdate({ response: html })).resolves.toBe(html);
  });
});
