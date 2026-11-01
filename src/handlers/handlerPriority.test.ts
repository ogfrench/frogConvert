// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { appendHandlersInPriorityOrder, compareHandlerPriority } from "./handlerPriority.ts";

describe("browser handler priority", () => {
  it("keeps the existing shipped cache priority", () => {
    const entries = JSON.parse(readFileSync("public/cache.json", "utf8")) as [string, unknown][];
    const names = entries.map(([name]) => ({ name }));
    expect([...names].sort(compareHandlerPriority)).toEqual(names);
  });

  it("loads concurrently but publishes in the same priority regardless of completion order", async () => {
    let finishFirst!: (v: { name: string }[]) => void;
    let finishSecond!: (v: { name: string }[]) => void;
    const first = new Promise<{ name: string }[]>(resolve => { finishFirst = resolve; });
    const second = new Promise<{ name: string }[]>(resolve => { finishSecond = resolve; });
    const target = [{ name: "svgTrace" }];
    const pending = appendHandlersInPriorityOrder(target, [() => first, () => second]);
    finishSecond([{ name: "ImageMagick" }, { name: "unknown-z" }]);
    await Promise.resolve();
    expect(target.map(x => x.name)).toEqual(["svgTrace"]);
    finishFirst([{ name: "FFmpeg" }, { name: "unknown-a" }]);
    await pending;
    expect(target.map(x => x.name)).toEqual(["svgTrace", "FFmpeg", "ImageMagick", "unknown-a", "unknown-z"]);
  });
});
