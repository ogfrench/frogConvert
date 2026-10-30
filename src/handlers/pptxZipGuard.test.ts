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

  it("rejects encrypted entries", () => {
    const bytes = tamperEntry(0, (view, central) => view.setUint16(central + 8, 1, true));
    expect(() => assertPptxSafeForEnvelope(bytes)).toThrow(/too large or complex/);
  });
});
