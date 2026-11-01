/** Browser route priority, preserving the order shipped in 3.4.3.
 * New handlers sort after these by name until their priority is reviewed.
 */
const PRIORITY = [
  "svgTrace",
  "canvasToBlob",
  "envelope",
  "jszip",
  "fromjson",
  "tojson",
  "TextEncoding",
  "pdftoimg",
  "Ghostscript",
  "PdfCanvasCompress",
  "pdftotxt",
  "FFmpeg",
  "font",
  "imageToPdf",
  "libreoffice",
  "pandoc",
  "meyda",
  "ImageMagick",
  "htmlEmbed",
  "bunburrows",
  "renamezip",
  "renametxt",
  "renamejson",
  "svgForeignObject",
  "threejs",
  "qoi-fu",
  "vtf",
  "mcMap",
  "sppd",
  "sqlite3",
  "als",
  "nbt",
  "qoa-fu",
  "petozip",
  "pyturtle",
  "flptojson",
  "sb3tohtml",
  "CgBI to PNG converter",
  "batToExe",
  "libopenmpt",
  "floHandler",
  "miditextcodec",
  "midi",
  "wad",
  "lzh",
  "tar",
  "txtToInfiniteCraft",
  "icns",
  "mcSchematic",
  "bsor",
  "espeakng",
  "aseprite",
  "toon",
  "bson",
  "n64rom",
  "VexFlow",
  "curani",
  "sevenZip",
  "ota",
  "rpgmvp",
  "exe2bat",
  "jsonToC",
  "json5",
  "comics",
  "aperturePicture",
  "turbowarp",
  "opusMagnum",
  "xcf",
  "terrariaWld",
  "minecraft-lang",
  "celariaMap",
  "cybergrind",
  "fenToJson",
  "chessjs",
  "piskel",
  "rgba",
  "xcursor",
  "textToSource",
  "pdfparse",
  "har",
  "tmx",
  "spreadsheet"
] as const;
const rank = new Map<string, number>(PRIORITY.map((name, index) => [name, index]));

export function compareHandlerPriority(a: { name: string }, b: { name: string }): number {
  const difference = (rank.get(a.name) ?? PRIORITY.length) - (rank.get(b.name) ?? PRIORITY.length);
  if (difference) return difference;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** Run imports in parallel, but publish the handlers in a stable order. */
export async function appendHandlersInPriorityOrder<T extends { name: string }>(
  target: T[], loaders: Array<() => Promise<T[]>>,
): Promise<void> {
  const groups = await Promise.all(loaders.map(load => load()));
  target.push(...groups.flat().sort(compareHandlerPriority));
}
