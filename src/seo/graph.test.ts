import { describe, it, expect } from "vitest";
import { FormatGraph, type FormatCache } from "./graph.ts";

// Handler order matters: it is the app's priority order (see handlerRank).
const cache: FormatCache = [
  ["fast", [
    { name: "Portable Network Graphics", format: "png", extension: "png", mime: "image/png", category: "image", internal: "png", from: true, to: true },
    { name: "JPEG", format: "jpeg", extension: "jpg", mime: "image/jpeg", category: "image", internal: "jpg", from: true, to: true },
  ]],
  ["slow", [
    { name: "Portable Network Graphics (long name)", format: "png", extension: "png", mime: "image/png", category: "image", internal: "png", from: true, to: true },
    { name: "JPEG", format: "jpeg", extension: "jpg", mime: "image/jpeg", category: "image", internal: "jpg", from: true, to: true },
  ]],
  ["reader", [
    { name: "High Efficiency Image Format", format: "heic", extension: "heic", mime: "image/heic", category: "image", internal: "HEIC", from: true, to: false },
    { name: "JPEG", format: "jpeg", extension: "jpg", mime: "image/jpeg", category: "image", internal: "jpg", from: false, to: true },
  ]],
  ["bridge", [
    { name: "JPEG", format: "jpeg", extension: "jpg", mime: "image/jpeg", category: "image", internal: "jpg", from: true, to: false },
    { name: "PDF", format: "pdf", extension: "pdf", mime: "application/pdf", category: "document", internal: "pdf", from: false, to: true },
  ]],
];

const g = FormatGraph.fromCache(cache);

describe("route", () => {
  it("finds a single-hop route and names the engines", () => {
    const r = g.route("png", "jpg");
    expect(r).toMatchObject({ hops: 1 });
    expect(r!.engines).toContain("fast");
  });

  it("orders engines by the app's handler priority, not alphabetically", () => {
    // "fast" is registered first, so it is what the app would reach for.
    expect(g.directEngines("png", "jpg")[0]).toBe("fast");
  });

  it("chains through an intermediate format", () => {
    // heic is only readable; pdf is only writable; the hop goes via jpg.
    expect(g.route("heic", "pdf")).toMatchObject({ hops: 2, engines: [] });
  });

  it("returns null when the target has no writer", () => {
    // The exact trap this module exists to catch: heic is read-only, so
    // /convert/jpg-to-heic must never be generated.
    expect(g.route("jpg", "heic")).toBeNull();
  });

  it("returns null for an unknown format", () => {
    expect(g.route("png", "nope")).toBeNull();
    expect(g.route("nope", "png")).toBeNull();
  });

  it("respects the hop cap", () => {
    expect(g.route("heic", "pdf", 1)).toBeNull();
  });
});

describe("format info", () => {
  it("resolves by extension and by format name", () => {
    expect(g.format("jpg")?.token).toBe("jpg");
    expect(g.format("jpeg")?.token).toBe("jpeg");
  });

  it("is case insensitive", () => {
    expect(g.format("PNG")?.token).toBe("png");
  });

  it("keeps the most specific display name across handlers", () => {
    expect(g.format("png")?.displayName).toBe("Portable Network Graphics (long name)");
  });

  it("records which handlers read and write it", () => {
    const heic = g.format("heic")!;
    expect(heic.readableBy).toEqual(["reader"]);
    expect(heic.writableBy).toEqual([]);
  });

  it("reports read/write capability", () => {
    expect(g.canRead("heic")).toBe(true);
    expect(g.canWrite("heic")).toBe(false);
    expect(g.canWrite("jpg")).toBe(true);
  });
});
