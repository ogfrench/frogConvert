import * as UPNG from "upng-js";

/**
 * Encode a canvas region as an indexed-palette PNG via UPNG. Used at low/medium
 * presets for document-like inputs where a 128–256 color palette is indistinguishable
 * from true-color but ~3–5× smaller on deflate.
 */
export function encodeCanvasPalettePng(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  cnum: number
): Uint8Array {
  const imgData = ctx.getImageData(0, 0, width, height);
  const pngBuf = UPNG.encode([imgData.data.buffer], width, height, cnum);
  return new Uint8Array(pngBuf);
}
