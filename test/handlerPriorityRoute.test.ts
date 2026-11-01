// @vitest-environment node
import { expect, it } from "vitest";
import CommonFormats from "../src/core/CommonFormats/CommonFormats.ts";
import { ConvertPathNode } from "../src/core/FormatHandler/FormatHandler.ts";
import { TraversionGraph } from "../src/core/TraversionGraph/TraversionGraph.ts";
import { appendHandlersInPriorityOrder } from "../src/handlers/handlerPriority.ts";
import { MockedHandler } from "./MockedHandler.ts";

it("keeps the same preferred conversion route when imports finish in reverse order", async () => {
  const png = CommonFormats.PNG.supported("png", true, false, true);
  const jpeg = CommonFormats.JPEG.supported("jpeg", false, true, true);
  const ffmpeg = new MockedHandler("FFmpeg", [png, jpeg], false);
  const magick = new MockedHandler("ImageMagick", [png, jpeg], false);
  let finishFirst!: (h: MockedHandler[]) => void;
  const first = new Promise<MockedHandler[]>(resolve => { finishFirst = resolve; });
  const handlers: MockedHandler[] = [];
  const loading = appendHandlersInPriorityOrder(handlers, [() => first, async () => [magick]]);
  await Promise.resolve();
  finishFirst([ffmpeg]);
  await loading;
  const graph = new TraversionGraph();
  graph.init(new Map(handlers.map(h => [h.name, h.supportedFormats!])), handlers);
  const generator = graph.searchPath(new ConvertPathNode(ffmpeg, png), new ConvertPathNode(magick, jpeg), true);
  const result = await generator.next();
  expect(result.value?.at(-1)?.handler.name).toBe("FFmpeg");
});
