// @vitest-environment node
import { describe, expect, it } from "vitest";
import { compareFormatCaches } from "../scripts/compareFormatCaches.mjs";

describe("format cache comparison", () => {
  const expected = [["one", [{ format: "a", from: true, to: false }, { format: "b", from: false, to: true }]], ["two", []]];
  it("ignores object key order only", () => {
    expect(compareFormatCaches(expected, [["one", [{ to: false, from: true, format: "a" }, { to: true, from: false, format: "b" }]], ["two", []]])).toEqual([]);
  });
  it("rejects changes to capabilities, format order and handler priority", () => {
    const changed = [["two", []], ["one", [{ format: "b", from: false, to: true }, { format: "a", from: true, to: true }]]];
    const errors = compareFormatCaches(expected, changed);
    expect(errors.some((x: string) => x.includes("priority"))).toBe(true);
    expect(errors.some((x: string) => x.includes("one format"))).toBe(true);
  });
  it("rejects missing handlers and duplicate handler names", () => {
    expect(compareFormatCaches(expected, [["two", []]]).join(" ")).toContain("Missing handler: one");
    expect(() => compareFormatCaches(expected, [["two", []], ["two", []]])).toThrow(/duplicate handler/);
  });
});
