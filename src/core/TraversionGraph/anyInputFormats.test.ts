import { describe, it, expect } from "vitest";
import { TraversionGraph } from "./TraversionGraph.ts";
import type { FileData, FileFormat, FormatHandler } from "../FormatHandler/FormatHandler.ts";

const fmt = (internal: string, from: boolean, to: boolean): FileFormat => ({
  name: internal, format: internal, extension: internal,
  mime: `application/${internal}`, from, to, internal, category: "archive",
});

/** Mirrors lzh: packs anything into .arc, but only reads .arc to make .listing. */
class Packer implements FormatHandler {
  name = "packer";
  ready = true;
  supportAnyInput = true;
  anyInputFormats?: string[] = ["arc"];
  supportedFormats = [fmt("arc", true, true), fmt("listing", false, true)];
  async init() {}
  async doConvert(f: FileData[], i: FileFormat, o: FileFormat) {
    if (o.internal === "arc" || i.internal === "arc") return f;
    throw new Error(`Unsupported conversion: ${i.format} to ${o.format}`);
  }
}

class Source implements FormatHandler {
  name = "source";
  ready = true;
  supportedFormats = [fmt("doc", true, true)];
  async init() {}
  async doConvert(f: FileData[]) { return f; }
}

function build(anyInputFormats?: string[]) {
  const packer = new Packer();
  packer.anyInputFormats = anyInputFormats;
  const handlers: FormatHandler[] = [new Source(), packer];
  const cache = new Map(handlers.map(h => [h.name, h.supportedFormats!]));
  const graph = new TraversionGraph();
  graph.init(cache, handlers, false);
  return { graph, handlers };
}

/** Mirrors scripts/verify-conversions.ts: a path node is {handler, format}. */
const entry = (handlers: FormatHandler[], internal: string) => {
  for (const handler of handlers) {
    const format = handler.supportedFormats!.find(f => f.internal === internal);
    if (format) return { handler, format };
  }
  throw new Error(`no handler declares ${internal}`);
};

const route = async (anyInputFormats: string[] | undefined, from: string, to: string) => {
  const { graph, handlers } = build(anyInputFormats);
  const step = await graph.searchPath(
    entry(handlers, from) as never, entry(handlers, to) as never, false
  ).next();
  return step.done ? undefined : step.value;
};

/** Walk the returned path exactly as the converter does, hop by hop. */
async function walk(path: Array<{ handler: FormatHandler; format: FileFormat }>) {
  let files: FileData[] = [{ name: "sample.doc", bytes: new Uint8Array([1, 2, 3]) }];
  for (let i = 1; i < path.length; i++) {
    files = await path[i].handler.doConvert(files, path[i - 1].format, path[i].format);
  }
  return files;
}

describe("supportAnyInput edge targets", () => {
  it("returns a path whose every hop the handler can actually run", async () => {
    // The graph used to emit a direct doc->listing edge because `listing` is a
    // `to` format of a supportAnyInput handler. Packing a doc produces an arc,
    // not a listing, so that hop threw. The honest route is doc -> arc -> listing.
    const path = await route(["arc"], "doc", "listing");
    expect(path).toBeTruthy();
    await expect(walk(path as never)).resolves.toBeTruthy();
    expect((path as never as Array<{ format: FileFormat }>).map(n => n.format.internal))
      .toEqual(["doc", "arc", "listing"]);
  });

  it("without the declaration, the graph hands back an unwalkable direct hop", async () => {
    const path = await route(undefined, "doc", "listing");
    expect((path as never as Array<{ format: FileFormat }>).map(n => n.format.internal))
      .toEqual(["doc", "listing"]);
    await expect(walk(path as never)).rejects.toThrow(/Unsupported conversion/);
  });

  it("still routes an arbitrary input into the packed format", async () => {
    expect(await route(["arc"], "doc", "arc")).toBeTruthy();
  });

});
