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
  it("allows the existing deck fixture", () => {
    expect(() => assertPptxSafeForEnvelope(original)).not.toThrow();
  });

  it("rejects invalid and excessively large inputs before allocating ZIP outputs", () => {
    expect(() => assertPptxSafeForEnvelope(new Uint8Array([1, 2, 3]))).toThrow(/too large or complex/);
    const bytes = tamperEntry(0, (view, central) => view.setUint32(central + 24, 0xffffffff, true));
    expect(() => assertPptxSafeForEnvelope(bytes)).toThrow(/too large or complex/);
  });

  it("rejects a forged local-header offset in the central directory", () => {
    const bytes = tamperEntry(0, (view, central) =>
      view.setUint32(central + 42, view.getUint32(central + 42, true) + 1, true));
    expect(() => assertPptxSafeForEnvelope(bytes)).toThrow(/too large or complex/);
  });

  it("rejects a compressed range that would overlap the directory", () => {
    const bytes = tamperEntry(0, (view, central) => {
      view.setUint32(central + 20, view.getUint32(central + 20, true) + 65536, true);
    });
    expect(() => assertPptxSafeForEnvelope(bytes)).toThrow(/too large or complex/);
  });

  it("rejects a mismatched local filename", () => {
    const bytes = tamperEntry(0, (view, central) => {
      const local = view.getUint32(central + 42, true);
      view.setUint8(local + 30, view.getUint8(local + 30) ^ 1);
    });
    expect(() => assertPptxSafeForEnvelope(bytes)).toThrow(/too large or complex/);
  });

  it("rejects a forged ZIP64 offset and trailing payload", () => {
    const zip64 = tamperEntry(0, (view, central) => view.setUint32(central + 42, 0xffffffff, true));
    expect(() => assertPptxSafeForEnvelope(zip64)).toThrow(/too large or complex/);
    const trailing = new Uint8Array(original.length + 1);
    trailing.set(original);
    expect(() => assertPptxSafeForEnvelope(trailing)).toThrow(/too large or complex/);
  });

  it("rejects encrypted entries", () => {
    const bytes = tamperEntry(0, (view, central) => view.setUint16(central + 8, 1, true));
    expect(() => assertPptxSafeForEnvelope(bytes)).toThrow(/too large or complex/);
  });
});
