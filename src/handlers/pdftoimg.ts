import CommonFormats from '../core/CommonFormats/CommonFormats.ts';
import type { FileData, FileFormat, FormatHandler } from "../core/FormatHandler/FormatHandler.ts";
import { extractQualityPreset } from "../core/FormatHandler/FormatHandler.ts";
import { presetFor } from "../core/FormatHandler/qualityPresets.ts";
import { planImage } from "../core/compression/plan.ts";
import { isSafari } from "../tools/pdfThumbnails.ts";
import { rethrowIfPasswordProtected } from "./_pdfErrors.ts";

import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { encodeCanvasPalettePng } from "../tools/palettePng.ts";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

const MAX_TOTAL_MEGAPIXELS = 600;

class pdftoimgHandler implements FormatHandler {

  public name: string = "pdftoimg";

  public supportedFormats: FileFormat[] = [
    CommonFormats.PDF.builder("pdf").allowFrom(),
    CommonFormats.PNG.supported("png", false, true),
    CommonFormats.JPEG.supported("jpeg", false, true),
  ];

  public ready: boolean = true;
  public requiresMainThread = true;

  async init () {
    this.ready = true;
  }

  async doConvert (
    inputFiles: FileData[],
    inputFormat: FileFormat,
    outputFormat: FileFormat,
    args?: string[]
  ): Promise<FileData[]> {

    if (isSafari())
      throw new Error("PDF conversion isn't supported on Safari — try Chrome or Firefox");

    if (
      outputFormat.format !== "png"
      && outputFormat.format !== "jpeg"
    ) throw new Error("That output format isn't supported for PDF conversion");

    const quality = extractQualityPreset(args);
    const preset = presetFor(quality);

    const dpiIdx = args ? args.indexOf("--dpi") : -1;
    const isExplicitDpi = dpiIdx >= 0;
    const rawDpi = (isExplicitDpi && args && dpiIdx + 1 < args.length) ? Number(args[dpiIdx + 1]) : preset.pdfDpi;
    const dpi = Number.isFinite(rawDpi) ? Math.min(600, Math.max(36, rawDpi)) : preset.pdfDpi;
    const scale = dpi / 72;

    const qIdx = args ? args.indexOf("--quality") : -1;
    const qualityRaw = (args && qIdx >= 0 && qIdx + 1 < args.length) ? args[qIdx + 1] : undefined;
    const numQ = qualityRaw ? Number(qualityRaw) : NaN;
    const jpegPlan = planImage(0, quality ?? "medium", false);
    const jpegQuality: number = Number.isFinite(numQ) && numQ > 0 && numQ <= 1
      ? numQ
      : jpegPlan.imgQuality / 100;

    const isPng = outputFormat.format === "png";
    const pngCnum = isPng ? preset.pngCnum : 0;

    const outputFiles: FileData[] = [];
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");

    for (const inputFile of inputFiles) {
      let pdf;
      try {
        pdf = await pdfjsLib.getDocument({
          data: inputFile.bytes.slice(),
          isEvalSupported: false,
          isOffscreenCanvasSupported: false,
        }).promise;
      } catch (e) {
        rethrowIfPasswordProtected(e, inputFile.name);
        throw e;
      }

      try {
        const baseName = inputFile.name.replace(/\.[^.]+$/, '');
        let totalMP = 0;

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          try {
            const viewportAtRequestedScale = page.getViewport({ scale });
            const requestedMP = (viewportAtRequestedScale.width * viewportAtRequestedScale.height) / 1_000_000;

            const targetMP = isExplicitDpi ? 25 : preset.pdfMp;

            let viewport = viewportAtRequestedScale;
            if (requestedMP > targetMP) {
              viewport = page.getViewport({ scale: scale * Math.sqrt(targetMP / requestedMP) });
            }

            totalMP += (viewport.width * viewport.height) / 1_000_000;
            if (totalMP > MAX_TOTAL_MEGAPIXELS) {
              throw new Error(`PDF too large (total > ${MAX_TOTAL_MEGAPIXELS}MP). Try lower quality.`);
            }

            canvas.width = viewport.width;
            canvas.height = viewport.height;

            await page.render({ canvas, viewport }).promise;

            let bytes: Uint8Array;
            if (isPng && pngCnum > 0) {
              bytes = encodeCanvasPalettePng(ctx, canvas.width, canvas.height, pngCnum);
            } else {
              const blob = await new Promise<Blob>((resolve, reject) =>
                canvas.toBlob(b => b ? resolve(b) : reject(new Error("Canvas toBlob failed")), outputFormat.mime, jpegQuality)
              );
              bytes = new Uint8Array(await blob.arrayBuffer());
            }

            const suffix = pdf.numPages > 1 ? `_${pageNum}` : "";
            outputFiles.push({ bytes, name: `${baseName}${suffix}.${outputFormat.extension}` });
          } finally {
            page.cleanup();
          }
        }
      } finally {
        await pdf.destroy();
      }
    }

    return outputFiles;
  }

}

export default pdftoimgHandler;
