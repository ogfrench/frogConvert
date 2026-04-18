import {
  initializeImageMagick,
  Magick,
  MagickFormat,
  MagickImageCollection,
  MagickReadSettings,
  MagickGeometry,
  type IMagickImage,
} from "@imagemagick/magick-wasm";

import mime from "mime";
import normalizeMimeType from "../core/utils/normalizeMimeType.ts";
import CommonFormats from "../core/CommonFormats/CommonFormats.ts";
import type { FileData, FileFormat, FormatHandler, QualityPreset } from "../core/FormatHandler/FormatHandler.ts";
import { extractQualityPreset } from "../core/FormatHandler/FormatHandler.ts";
import { planImage } from "../core/compression/plan.ts";

/**
 * Smart planner integration: decide per-image whether to downscale and at
 * what JPEG quality, based on the image's pixel count and the user's
 * quality preset. ICO has its own sizing path and is left alone.
 */
function applyPlan(image: IMagickImage, preset: QualityPreset, outputFormat: FileFormat) {
  if (outputFormat.format === "ico") return;
  const plan = planImage(image.width * image.height, preset, !!outputFormat.lossless);
  if (!outputFormat.lossless && !["png", "bmp", "tiff"].includes(outputFormat.format)) {
    image.quality = plan.imgQuality;
  }
  if (plan.imgMaxEdge != null) {
    const maxEdge = Math.max(image.width, image.height);
    if (maxEdge > plan.imgMaxEdge) {
      const scale = plan.imgMaxEdge / maxEdge;
      const geom = new MagickGeometry(Math.round(image.width * scale), Math.round(image.height * scale));
      image.resize(geom);
    }
  }
}

class ImageMagickHandler implements FormatHandler {

  public name: string = "ImageMagick";

  public supportedFormats: FileFormat[] = [];

  public ready: boolean = false;

  async init () {

    const wasmLocation = "/wasm/magick.wasm";
    const wasmBytes = await fetch(wasmLocation).then(r => r.arrayBuffer());

    await initializeImageMagick(wasmBytes);

    Magick.supportedFormats.forEach(format => {
      const formatName = format.format.toLowerCase();
      if (formatName === "apng") return;
      if (formatName === "svg") return;
      if (formatName === "ttf") return;
      if (formatName === "otf") return;
      let mimeType = format.mimeType || mime.getType(formatName);
      if (
        !mimeType
        || mimeType.startsWith("text/")
        || mimeType.startsWith("video/")
        || mimeType === "application/json"
      ) return;

      mimeType = normalizeMimeType(mimeType);

      // ImageMagick _really_ likes mislabeling formats
      let description = format.description;
      if (mimeType === "image/jpeg") description = CommonFormats.JPEG.name;
      if (mimeType === "image/gif") description = CommonFormats.GIF.name;
      if (mimeType === "image/webp") description = CommonFormats.WEBP.name;
      if (formatName === "ico") description = "Microsoft Windows ICO";
      if (formatName === "mpo") description = "Multi-Picture Object";
      if (formatName === "vst") description = "Microsoft Visio Template";

      this.supportedFormats.push({
        name: description,
        format: formatName === "jpg" ? "jpeg" : formatName,
        extension: formatName,
        mime: mimeType,
        from: mimeType === "application/pdf" ? false : format.supportsReading,
        to: format.supportsWriting,
        internal: format.format,
        category: mimeType.split("/")[0],
        lossless: ["png", "bmp", "tiff"].includes(formatName)
      });
    });

    // ====== Manual fine-tuning ======

    const prioritize = ["png", "jpeg", "gif", "pdf"];
    prioritize.reverse();

    this.supportedFormats.sort((a, b) => {
      const priorityIndexA = prioritize.indexOf(a.format);
      const priorityIndexB = prioritize.indexOf(b.format);
      return priorityIndexB - priorityIndexA;
    });

    this.ready = true;
  }

  async doConvert (
    inputFiles: FileData[],
    inputFormat: FileFormat,
    outputFormat: FileFormat,
    args?: string[]
  ): Promise<FileData[]> {

    const inputMagickFormat = inputFormat.internal as MagickFormat;
    const outputMagickFormat = outputFormat.internal as MagickFormat;
    const qualityPreset = extractQualityPreset(args) ?? "medium";

    const inputSettings = new MagickReadSettings();
    inputSettings.format = inputMagickFormat;

    // Detect animated-input → static-image conversion. In this case each
    // frame must be written to its own output file, otherwise ImageMagick
    // would silently drop all frames except the first.
    const animatedFormats = new Set(["gif", "webp", "apng"]);
    const inputIsAnimated = animatedFormats.has(inputFormat.format);
    const outputIsStaticImage = outputFormat.mime?.startsWith("image/")
      && !animatedFormats.has(outputFormat.format);
    const extractFrames = inputIsAnimated && outputIsStaticImage;

    if (extractFrames) {
      const outputs: FileData[] = [];
      for (const inputFile of inputFiles) {
        const baseName = inputFile.name.split(".").slice(0, -1).join(".");
        const frameBytesList: Uint8Array[] = await new Promise(resolve => {
          MagickImageCollection.use(fileCollection => {
            fileCollection.read(inputFile.bytes, inputSettings);
            const list: Uint8Array[] = [];
            for (const image of fileCollection) {
              image.autoOrient();
              applyPlan(image, qualityPreset, outputFormat);
              if (outputFormat.format === "ico" && (image.width > 256 || image.height > 256)) {
                const geometry = new MagickGeometry(256, 256);
                image.resize(geometry);
              }
              image.write(outputMagickFormat, (data) => {
                list.push(new Uint8Array(data));
              });
            }
            resolve(list);
          });
        });

        const multi = frameBytesList.length > 1;
        for (let i = 0; i < frameBytesList.length; i++) {
          const name = multi
            ? `${baseName}_frame_${i + 1}.${outputFormat.extension}`
            : `${baseName}.${outputFormat.extension}`;
          outputs.push({ bytes: frameBytesList[i], name });
        }
      }
      return outputs;
    }

    const warnings: string[] = [];
    const bytes: Uint8Array = await new Promise(resolve => {
      MagickImageCollection.use(outputCollection => {
        for (const inputFile of inputFiles) {
           if (inputFormat.format === "rgb") {
             // Best-guess dimensions for raw RGB data: assume square, round to nearest pixel
             inputSettings.width = Math.round(Math.sqrt(inputFile.bytes.length / 3));
             inputSettings.height = inputSettings.width;
           }

          if (outputFormat.format === "ico") {
            // Build a multi-size ICO bundle (Windows convention).
            // Peek the source dimensions once, then re-read the source
            // into the output collection N times and resize each copy.
            // clone() has a scoped callback lifetime that doesn't survive
            // outside the callback — re-reading is the reliable pattern.
            let sourceMax = 0;
            MagickImageCollection.use(probeCollection => {
              probeCollection.read(inputFile.bytes, inputSettings);
              const probe = probeCollection[0];
              if (probe) sourceMax = Math.max(probe.width, probe.height);
            });
            const targetSizes = [16, 32, 48, 64, 128, 256].filter(s => s <= sourceMax);
            if (targetSizes.length === 0) targetSizes.push(Math.min(256, sourceMax || 256));
            if (targetSizes.length < 6 && sourceMax > 0) {
              warnings.push(`Source image (${sourceMax}px) is smaller than 256px - some ICO sizes were skipped to avoid upscaling`);
            }

            for (const size of targetSizes) {
              MagickImageCollection.use(tmpCollection => {
                tmpCollection.read(inputFile.bytes, inputSettings);
                while (tmpCollection.length > 0) {
                  const image = tmpCollection.shift();
                  if (!image) break;
                  image.autoOrient();
                  // ICO entries must be square. MagickGeometry preserves
                  // aspect ratio by default, so force it off — otherwise
                  // a 100×200 source would produce a 128×256 entry and
                  // Windows would render it stretched.
                  const geom = new MagickGeometry(size, size);
                  geom.ignoreAspectRatio = true;
                  image.resize(geom);
                  outputCollection.push(image);
                }
              });
            }
            continue;
          }

          MagickImageCollection.use(fileCollection => {
            fileCollection.read(inputFile.bytes, inputSettings);
            while (fileCollection.length > 0) {
              const image = fileCollection.shift();
              if (!image) break;
              image.autoOrient();
              applyPlan(image, qualityPreset, outputFormat);
              outputCollection.push(image);
            }
          });
        }
        outputCollection.write(outputMagickFormat, (bytes) => {
          resolve(new Uint8Array(bytes));
        });
      });
    });

    const baseName = inputFiles[0].name.split(".").slice(0, -1).join(".");
    const name = baseName + "." + outputFormat.extension;
    return [{ bytes, name, ...(warnings.length > 0 && { warnings }) }];

  }

}

export default ImageMagickHandler;

