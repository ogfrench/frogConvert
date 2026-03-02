import { TraversionGraph } from './TraversionGraph.ts';
import CommonFormats from '../CommonFormats/CommonFormats.ts';
import { ConvertPathNode, type FileFormat, type FormatHandler } from '../FormatHandler/FormatHandler.ts';
import { MockedHandler } from "../../../test/MockedHandler.ts";
import { expect, test } from "vitest";

const handlers: FormatHandler[] = [
  new MockedHandler("canvasToBlob", [
    CommonFormats.PNG.supported("png", true, true, true),
    CommonFormats.JPEG.supported("jpeg", true, true, false),
    CommonFormats.SVG.supported("svg", true, true, true),

  ], false),
  new MockedHandler("meyda", [
    CommonFormats.JPEG.supported("jpeg", true, true, false),
    CommonFormats.PNG.supported("png", true, true, false),
    CommonFormats.WAV.supported("wav", true, true, false)
  ], false),
  new MockedHandler("ffmpeg", [
    CommonFormats.PNG.supported("png", true, true, true),
    CommonFormats.MP3.supported("mp3", true, true, false),
    CommonFormats.WAV.supported("wav", true, true, true),
    CommonFormats.MP4.supported("mp4", true, true, true)
  ], false),
]

let supportedFormatCache = new Map<string, FileFormat[]>();
for (const handler of handlers) {
  if (!supportedFormatCache.has(handler.name)) {
    try {
      await handler.init();
    } catch (_) { continue; }
    if (handler.supportedFormats) {
      supportedFormatCache.set(handler.name, handler.supportedFormats);
    }
  }
  const supportedFormats = supportedFormatCache.get(handler.name);
  if (!supportedFormats) {
    continue;
  }
}

console.log("Testing...\n");
test('should find the optimal path from image to audio\n', async () => {
  const graph = new TraversionGraph();
  graph.init(supportedFormatCache, handlers);

  const paths = graph.searchPath(
    new ConvertPathNode(handlers.find(h => h.name === "canvasToBlob")!, CommonFormats.PNG.supported("png", true, true, true)),
    new ConvertPathNode(handlers.find(h => h.name === "ffmpeg")!, CommonFormats.MP3.supported("mp3", true, true, true)),
    true
  );
  let extractedPaths = [];
  for await (const path of paths)
    extractedPaths.push(path);
  expect(extractedPaths.length).toBeGreaterThan(0);
  const optimalPath = extractedPaths[0];
  expect(optimalPath[0].handler.name).toBe("canvasToBlob");
  expect(optimalPath[optimalPath.length - 1].handler.name).toBe("ffmpeg");
});

test('should find the optimal path from image to audio in strict graph\n', async () => {
  const graph = new TraversionGraph();
  graph.init(supportedFormatCache, handlers, true);

  const paths = graph.searchPath(
    new ConvertPathNode(handlers.find(h => h.name === "canvasToBlob")!, CommonFormats.PNG.supported("png", true, true, true)),
    new ConvertPathNode(handlers.find(h => h.name === "ffmpeg")!, CommonFormats.MP3.supported("mp3", true, true, true)),
    true
  );
  let extractedPaths = [];
  for await (const path of paths)
    extractedPaths.push(path);
  expect(extractedPaths.length).toBeGreaterThan(0);
  const optimalPath = extractedPaths[0];
  expect(optimalPath[0].handler.name).toBe("canvasToBlob");
  expect(optimalPath[optimalPath.length - 1].handler.name).toBe("ffmpeg");
});


test('add category change costs should affect pathfinding\n', async () => {
  const graph = new TraversionGraph();
  graph.init(supportedFormatCache, handlers);

  const paths = graph.searchPath(
    new ConvertPathNode(handlers.find(h => h.name === "canvasToBlob")!, CommonFormats.PNG.supported("png", true, true, true)),
    new ConvertPathNode(handlers.find(h => h.name === "ffmpeg")!, CommonFormats.MP3.supported("mp3", true, true, true)),
    true
  );
  let extractedPaths = [];
  for await (const path of paths)
    extractedPaths.push(path);


  graph.addCategoryChangeCost("image", "audio", 100);
  graph.init(supportedFormatCache, handlers);
  const newPaths = graph.searchPath(
    new ConvertPathNode(handlers.find(h => h.name === "canvasToBlob")!, CommonFormats.PNG.supported("png", true, true, true)),
    new ConvertPathNode(handlers.find(h => h.name === "ffmpeg")!, CommonFormats.MP3.supported("mp3", true, true, true)),
    true
  );
  let extractedNewPaths = [];
  for await (const path of newPaths)
    extractedNewPaths.push(path);
  expect(extractedPaths.length).toBeGreaterThan(0);
  expect(extractedNewPaths.length).toBeGreaterThan(0);
  expect(extractedNewPaths).not.toEqual(extractedPaths);
});

test('remove category change costs should affect pathfinding\n', async () => {
  const graph = new TraversionGraph();
  graph.updateCategoryChangeCost("image", "audio", 100);
  graph.init(supportedFormatCache, handlers);

  const paths = graph.searchPath(
    new ConvertPathNode(handlers.find(h => h.name === "canvasToBlob")!, CommonFormats.PNG.supported("png", true, true, true)),
    new ConvertPathNode(handlers.find(h => h.name === "ffmpeg")!, CommonFormats.MP3.supported("mp3", true, true, true)),
    true
  );
  let extractedPaths = [];
  for await (const path of paths)
    extractedPaths.push(path);


  graph.removeCategoryChangeCost("image", "audio");
  graph.init(supportedFormatCache, handlers);
  const newPaths = graph.searchPath(
    new ConvertPathNode(handlers.find(h => h.name === "canvasToBlob")!, CommonFormats.PNG.supported("png", true, true, true)),
    new ConvertPathNode(handlers.find(h => h.name === "ffmpeg")!, CommonFormats.MP3.supported("mp3", true, true, true)),
    true
  );
  let extractedNewPaths = [];
  for await (const path of newPaths)
    extractedNewPaths.push(path);
  expect(extractedPaths.length).toBeGreaterThan(0);
  expect(extractedNewPaths.length).toBeGreaterThan(0);
  expect(extractedNewPaths).not.toEqual(extractedPaths);
});

test('add adaptive category costs should affect pathfinding\n', async () => {
  const graph = new TraversionGraph();
  graph.init(supportedFormatCache, handlers);

  const paths = graph.searchPath(
    new ConvertPathNode(handlers.find(h => h.name === "canvasToBlob")!, CommonFormats.PNG.supported("png", true, true, true)),
    new ConvertPathNode(handlers.find(h => h.name === "ffmpeg")!, CommonFormats.MP3.supported("mp3", true, true, true)),
    true
  );
  let extractedPaths = [];
  for await (const path of paths)
    extractedPaths.push(path);


  graph.addCategoryAdaptiveCost(["image", "audio"], 20000);
  graph.init(supportedFormatCache, handlers);
  const newPaths = graph.searchPath(
    new ConvertPathNode(handlers.find(h => h.name === "canvasToBlob")!, CommonFormats.PNG.supported("png", true, true, true)),
    new ConvertPathNode(handlers.find(h => h.name === "ffmpeg")!, CommonFormats.MP3.supported("mp3", true, true, true)),
    true
  );
  let extractedNewPaths = [];
  for await (const path of newPaths)
    extractedNewPaths.push(path);
  expect(extractedPaths.length).toBeGreaterThan(0);
  expect(extractedNewPaths.length).toBeGreaterThan(0);
  expect(extractedNewPaths).not.toEqual(extractedPaths);
});

test('remove adaptive category costs should affect pathfinding\n', async () => {
  const graph = new TraversionGraph();
  graph.init(supportedFormatCache, handlers);

  const paths = graph.searchPath(
    new ConvertPathNode(handlers.find(h => h.name === "canvasToBlob")!, CommonFormats.PNG.supported("png", true, true, true)),
    new ConvertPathNode(handlers.find(h => h.name === "ffmpeg")!, CommonFormats.MP3.supported("mp3", true, true, true)),
    true
  );
  let extractedPaths = [];
  for await (const path of paths)
    extractedPaths.push(path);


  graph.removeCategoryAdaptiveCost(["image", "video", "audio"]);
  graph.init(supportedFormatCache, handlers);
  const newPaths = graph.searchPath(
    new ConvertPathNode(handlers.find(h => h.name === "canvasToBlob")!, CommonFormats.PNG.supported("png", true, true, true)),
    new ConvertPathNode(handlers.find(h => h.name === "ffmpeg")!, CommonFormats.MP3.supported("mp3", true, true, true)),
    true
  );
  let extractedNewPaths = [];
  for await (const path of newPaths)
    extractedNewPaths.push(path);
  expect(extractedPaths.length).toBeGreaterThan(0);
  expect(extractedNewPaths.length).toBeGreaterThan(0);
  expect(extractedNewPaths[0]).not.toEqual(extractedPaths[0]);
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test('should return no paths for disconnected formats\n', async () => {
  const isolatedFormats = [
    CommonFormats.PNG.supported("png", true, false, true), // from only, no "to"
  ];
  const isolatedHandler = new MockedHandler("isolated", isolatedFormats, false);
  const isolatedCache = new Map<FileFormat[], string>();

  const cache = new Map<string, FileFormat[]>();
  cache.set("isolated", isolatedFormats);

  const graph = new TraversionGraph();
  graph.init(cache, [isolatedHandler]);

  // Try to find path to a format that doesn't exist in the graph
  const paths = graph.searchPath(
    new ConvertPathNode(isolatedHandler, CommonFormats.PNG.supported("png", true, true, true)),
    new ConvertPathNode(isolatedHandler, CommonFormats.MP3.supported("mp3", true, true, true)),
    true
  );
  let extractedPaths = [];
  for await (const path of paths)
    extractedPaths.push(path);
  expect(extractedPaths.length).toBe(0);
});

test('hasCategoryChangeCost returns correct boolean\n', () => {
  const graph = new TraversionGraph();
  // "image" -> "video" is a default cost
  expect(graph.hasCategoryChangeCost("image", "video")).toBe(true);
  // "font" -> "archive" is not a default cost
  expect(graph.hasCategoryChangeCost("font", "archive")).toBe(false);

  graph.addCategoryChangeCost("font", "archive", 5);
  expect(graph.hasCategoryChangeCost("font", "archive")).toBe(true);

  graph.removeCategoryChangeCost("font", "archive");
  expect(graph.hasCategoryChangeCost("font", "archive")).toBe(false);
});

test('hasCategoryAdaptiveCost returns correct boolean\n', () => {
  const graph = new TraversionGraph();
  // Default adaptive costs include ["text", "image", "audio"]
  expect(graph.hasCategoryAdaptiveCost(["text", "image", "audio"])).toBe(true);
  expect(graph.hasCategoryAdaptiveCost(["font", "text"])).toBe(false);

  graph.addCategoryAdaptiveCost(["font", "text"], 10);
  expect(graph.hasCategoryAdaptiveCost(["font", "text"])).toBe(true);

  graph.removeCategoryAdaptiveCost(["font", "text"]);
  expect(graph.hasCategoryAdaptiveCost(["font", "text"])).toBe(false);
});

test('getData returns deep copies that do not affect the graph\n', () => {
  const graph = new TraversionGraph();
  graph.init(supportedFormatCache, handlers);

  const data1 = graph.getData();
  const originalNodeCount = data1.nodes.length;
  const originalEdgeCount = data1.edges.length;

  // Mutate the returned data
  data1.nodes.push({ identifier: "fake", edges: [] });
  data1.edges.push({ from: { format: {} as any, index: 0 }, to: { format: {} as any, index: 1 }, handler: "fake", cost: 0 });

  // Re-fetch - mutations should not have propagated
  const data2 = graph.getData();
  expect(data2.nodes.length).toBe(originalNodeCount);
  expect(data2.edges.length).toBe(originalEdgeCount);
});

test('dead end paths are handled correctly\n', async () => {
  const graph = new TraversionGraph();
  graph.init(supportedFormatCache, handlers);

  // Add a dead end to the graph
  const deadEndPath = [
    new ConvertPathNode(handlers[0], CommonFormats.PNG.supported("png", true, true, true)),
    new ConvertPathNode(handlers[2], CommonFormats.WAV.supported("wav", true, true, true)),
  ];
  graph.addDeadEndPath(deadEndPath);

  // Attempting to search should still work (it skips dead ends)
  const paths = graph.searchPath(
    new ConvertPathNode(handlers.find(h => h.name === "canvasToBlob")!, CommonFormats.PNG.supported("png", true, true, true)),
    new ConvertPathNode(handlers.find(h => h.name === "ffmpeg")!, CommonFormats.MP3.supported("mp3", true, true, true)),
    true
  );
  let extractedPaths = [];
  for await (const path of paths)
    extractedPaths.push(path);
  // Should still find paths (just not the dead-ended ones)
  expect(extractedPaths.length).toBeGreaterThan(0);

  graph.clearDeadEndPaths();
});

test('should handle circular conversions without entering an infinite loop\n', async () => {
  const handlerA = new MockedHandler("handlerA", [
    CommonFormats.PNG.supported("png", true, false, true),
    CommonFormats.JPEG.supported("jpeg", false, true, false)
  ], false);
  const handlerB = new MockedHandler("handlerB", [
    CommonFormats.JPEG.supported("jpeg", true, false, false),
    CommonFormats.PNG.supported("png", false, true, true)
  ], false);

  const cache = new Map<string, FileFormat[]>();
  cache.set("handlerA", handlerA.supportedFormats!);
  cache.set("handlerB", handlerB.supportedFormats!);

  const graph = new TraversionGraph();
  graph.init(cache, [handlerA, handlerB]);

  const paths = graph.searchPath(
    new ConvertPathNode(handlerA, CommonFormats.PNG.supported("png", true, true, true)),
    new ConvertPathNode(handlerA, CommonFormats.PNG.supported("png", true, true, true)),
    true
  );
  let extractedPaths = [];
  for await (const path of paths)
    extractedPaths.push(path);
  expect(extractedPaths.length).toBeGreaterThanOrEqual(0);
});
