import CommonFormats from '../core/CommonFormats/CommonFormats.ts';
import type { FileData, FileFormat, FormatHandler } from "../core/FormatHandler/FormatHandler.ts";
import { extractQualityPreset } from "../core/FormatHandler/FormatHandler.ts";
import { presetFor } from "../core/FormatHandler/qualityPresets.ts";
import { planImage } from "../core/compression/plan.ts";
import { imageToText, rgbaToGrayscale } from "./image-to-txt/src/convert.ts";
import { encodeCanvasPalettePng } from "../tools/palettePng.ts";

/** Inputs that are document-like (text/vector), palette-PNG compresses them well. */
const DOCUMENT_LIKE_INPUTS = new Set(["text", "svg"]);

class canvasToBlobHandler implements FormatHandler {

  public name: string = "canvasToBlob";

  public supportedFormats: FileFormat[] = [
    CommonFormats.PNG.supported("png", true, true, true),
    CommonFormats.JPEG.supported("jpeg", true, true),
    CommonFormats.WEBP.supported("webp", true, true),
    CommonFormats.GIF.supported("gif", true, false),
    CommonFormats.SVG.supported("svg", true, false),
    CommonFormats.TEXT.supported("text", true, true)
  ];

  #canvas?: HTMLCanvasElement;
  #ctx?: CanvasRenderingContext2D;

  public ready: boolean = false;
  public requiresMainThread: boolean = true;
  /** Reads `--quality`: this engine is one of the few that actually does. */
  public usesQuality = true;

  async init() {
    this.#canvas = document.createElement("canvas");
    this.#ctx = this.#canvas.getContext("2d") || undefined;
    this.ready = true;
  }

  async doConvert(
    inputFiles: FileData[],
    inputFormat: FileFormat,
    outputFormat: FileFormat,
    args?: string[]
  ): Promise<FileData[]> {

    const qualityPreset = extractQualityPreset(args);
    const preset = presetFor(qualityPreset);
    const usePalettePng =
      outputFormat.format === "png"
      && preset.pngCnum > 0
      && DOCUMENT_LIKE_INPUTS.has(inputFormat.format);

    if (!this.#canvas || !this.#ctx) {
      throw "Handler not initialized.";
    }

    const outputFiles: FileData[] = [];
    for (const inputFile of inputFiles) {

      if (inputFormat.mime === "text/plain") {

        const font = "48px sans-serif";
        const fontSize = parseInt(font);
        const footerPadding = fontSize * 0.5;
        const string = new TextDecoder().decode(inputFile.bytes);
        const lines = string.split("\n");

        this.#ctx.font = font;

        let maxLineWidth = 0;
        for (const line of lines) {
          const width = this.#ctx.measureText(line).width;
          if (width > maxLineWidth) maxLineWidth = width;
        }

        this.#canvas.width = maxLineWidth;
        this.#canvas.height = Math.floor(fontSize * lines.length + footerPadding);

        if (outputFormat.category === "image" || outputFormat.category?.includes("image")) {
          this.#ctx.fillStyle = "white";
          this.#ctx.fillRect(0, 0, this.#canvas.width, this.#canvas.height);
        }
        this.#ctx.fillStyle = "black";
        this.#ctx.strokeStyle = "white";
        this.#ctx.font = font;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          this.#ctx.fillText(line, 0, fontSize * (i + 1));
          this.#ctx.strokeText(line, 0, fontSize * (i + 1));
        }

      } else {

        const blob = new Blob([inputFile.bytes as BlobPart], { type: inputFormat.mime });
        // For SVG, convert to data URL to avoid "Tainted canvases may not be exported" error
        const url =
          inputFormat.mime === "image/svg+xml"
            ? `data:${inputFormat.mime};base64,${btoa(inputFile.bytes.reduce((str, byte) => str + String.fromCharCode(byte), ''))}`
            : URL.createObjectURL(blob);

        const image = new Image();
        await new Promise((resolve, reject) => {
          image.addEventListener("load", resolve);
          image.addEventListener("error", reject);
          image.src = url;
        });
        if (inputFormat.mime !== "image/svg+xml") URL.revokeObjectURL(url);

        this.#canvas.width = image.naturalWidth;
        this.#canvas.height = image.naturalHeight;
        this.#ctx.drawImage(image, 0, 0);

      }

      let bytes: Uint8Array;
      if (outputFormat.mime === "text/plain") {
        const pixels = this.#ctx.getImageData(0, 0, this.#canvas.width, this.#canvas.height);
        bytes = new TextEncoder().encode(await imageToText({
          width() { return pixels.width; },
          height() { return pixels.height; },
          getPixel(x: number, y: number) {
            const index = (y * pixels.width + x) * 4;
            return rgbaToGrayscale(pixels.data[index] / 255, pixels.data[index + 1] / 255, pixels.data[index + 2] / 255, pixels.data[index + 3] / 255);
          }
        }));
      }
      else if (usePalettePng) {
        bytes = encodeCanvasPalettePng(this.#ctx, this.#canvas.width, this.#canvas.height, preset.pngCnum);
      }
      else {
        const plan = planImage({
          pixelCount: this.#canvas.width * this.#canvas.height,
          preset: qualityPreset ?? "medium",
          outputLossless: !!outputFormat.lossless,
          archetype: "singleton",
        });
        const isLossy = !outputFormat.lossless && (outputFormat.format === "jpeg" || outputFormat.format === "webp");
        const quality = isLossy ? plan.imgQuality / 100 : undefined;
        bytes = await new Promise((resolve, reject) => {
          this.#canvas!.toBlob((blob) => {
            if (!blob) return reject("Canvas output failed");
            blob.arrayBuffer().then(buf => resolve(new Uint8Array(buf)));
          }, outputFormat.mime, quality);
        });
      }

      const name = inputFile.name.replace(/\.[^.]+$/, '') + "." + outputFormat.extension;

      outputFiles.push({ bytes, name });

    }

    return outputFiles;

  }

}

export default canvasToBlobHandler;
