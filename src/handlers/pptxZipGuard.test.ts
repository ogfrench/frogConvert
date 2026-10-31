// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertPptxSafeForEnvelope } from "./pptxZipGuard.ts";

const original = new Uint8Array(readFileSync(resolve(process.cwd(), "test/resources/deck.pptx")));

function tamperEntry(offset: number, modify: (view: DataView, central: number) => void) {
  const bytes = original.slice();
  const view = new DataView(bytes.buffer);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error("Test fixture has no ZIP footer");
  const central = view.getUint32(end + 16, true);
  modify(view, central + offset);
  return bytes;
}

describe("PPTX HTML fallback preflight", () => {
  it("allows the existing deck fixture", async () => {
    await expect(assertPptxSafeForEnvelope(original)).resolves.toBeUndefined();
  });

  it("rejects invalid and excessively large inputs before allocating ZIP outputs", async () => {
    await expect(assertPptxSafeForEnvelope(new Uint8Array([1, 2, 3]))).rejects.toThrow(/too large or complex/);
    const bytes = tamperEntry(0, (view, central) => view.setUint32(central + 24, 0xffffffff, true));
    await expect(assertPptxSafeForEnvelope(bytes)).rejects.toThrow(/too large or complex/);
  });

  it("rejects a forged local-header offset in the central directory", async () => {
    const bytes = tamperEntry(0, (view, central) =>
      view.setUint32(central + 42, view.getUint32(central + 42, true) + 1, true));
    await expect(assertPptxSafeForEnvelope(bytes)).rejects.toThrow(/too large or complex/);
  });

  it("rejects a compressed range that would overlap the directory", async () => {
    const bytes = tamperEntry(0, (view, central) => {
      view.setUint32(central + 20, view.getUint32(central + 20, true) + 65536, true);
    });
    await expect(assertPptxSafeForEnvelope(bytes)).rejects.toThrow(/too large or complex/);
  });

  it("rejects a mismatched local filename", async () => {
    const bytes = tamperEntry(0, (view, central) => {
      const local = view.getUint32(central + 42, true);
      view.setUint8(local + 30, view.getUint8(local + 30) ^ 1);
    });
    await expect(assertPptxSafeForEnvelope(bytes)).rejects.toThrow(/too large or complex/);
  });

  it("rejects a forged ZIP64 offset and trailing payload", async () => {
    const zip64 = tamperEntry(0, (view, central) => view.setUint32(central + 42, 0xffffffff, true));
    await expect(assertPptxSafeForEnvelope(zip64)).rejects.toThrow(/too large or complex/);
    const trailing = new Uint8Array(original.length + 1);
    trailing.set(original);
    await expect(assertPptxSafeForEnvelope(trailing)).rejects.toThrow(/too large or complex/);
  });

  it("rejects encrypted entries", async () => {
    const bytes = tamperEntry(0, (view, central) => view.setUint16(central + 8, 1, true));
    await expect(assertPptxSafeForEnvelope(bytes)).rejects.toThrow(/too large or complex/);
  });

  it("rejects a member whose DEFLATE data is zero-filled (Envelope looped forever on it)", async () => {
    const bytes = original.slice();
    const view = new DataView(bytes.buffer);
    const central = centralOf(view);
    const local = view.getUint32(central + 42, true);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    expect(view.getUint16(central + 10, true)).toBe(8);
    bytes.fill(0, start, start + view.getUint32(central + 20, true));
    await expect(assertPptxSafeForEnvelope(bytes)).rejects.toThrow(/too large or complex/);
  });

  it("rejects a member that inflates past its declared size", async () => {
    const bytes = original.slice();
    const view = new DataView(bytes.buffer);
    const central = centralOf(view);
    const local = view.getUint32(central + 42, true);
    const declared = view.getUint32(central + 24, true) - 1;
    // Consistent headers, understated size: only inflating the data can tell.
    view.setUint32(central + 24, declared, true);
    view.setUint32(local + 22, declared, true);
    await expect(assertPptxSafeForEnvelope(bytes)).rejects.toThrow(/too large or complex/);
  });
});

function centralOf(view: DataView): number {
  let end = view.byteLength - 22;
  while (view.getUint32(end, true) !== 0x06054b50) end--;
  return view.getUint32(end + 16, true);
}
