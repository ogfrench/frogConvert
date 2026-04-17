import CommonFormats from '../core/CommonFormats/CommonFormats.ts';
import type { FileData, FileFormat, FormatHandler } from "../core/FormatHandler/FormatHandler.ts";
import { extractQualityPreset } from "../core/FormatHandler/FormatHandler.ts";
import { isSafari } from "../tools/pdfThumbnails.ts";
import { rethrowIfPasswordProtected } from "./_pdfErrors.ts";

import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

const MAX_TOTAL_MEGAPIXELS = 1000;
const QUALITY_TARGETS: Record<string, number> = { low: 1.2, medium: 2.5, high: 8.5, lossless: 50 };

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
    const dpiIdx = args ? args.indexOf("--dpi") : -1;
    const isExplicitDpi = dpiIdx >= 0;

    const dpiFromPreset: Record<string, number> = { low: 72, medium: 144, high: 300, lossless: 600 };
    const defaultDpi = (quality ? dpiFromPreset[quality] : undefined) ?? 144;
    const rawDpi = (isExplicitDpi && args && dpiIdx + 1 < args.length) ? Number(args[dpiIdx + 1]) : defaultDpi;
    const dpi = Number.isFinite(rawDpi) ? Math.min(600, Math.max(36, rawDpi)) : defaultDpi;
    const scale = dpi / 72;

    const jpegFromPreset: Record<string, number> = { low: 0.7, medium: 0.92, high: 0.97, lossless: 1 };
    const qIdx = args ? args.indexOf("--quality") : -1;
    const qualityRaw = (args && qIdx >= 0 && qIdx + 1 < args.length) ? args[qIdx + 1] : undefined;
    const numQ = qualityRaw ? Number(qualityRaw) : NaN;
    const jpegQuality: number | undefined = (quality ? jpegFromPreset[quality] : undefined)
      ?? (Number.isFinite(numQ) && numQ > 0 && numQ <= 1 ? numQ : undefined);

    const outputFiles: FileData[] = [];
    const canvas = document.createElement("canvas");
    let warnings: string[] = [];

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

            // Target sensible screen resolution (Medium ~2.5MP) to avoid monster files
            const targetMP = isExplicitDpi ? 25 : (QUALITY_TARGETS[quality ?? "medium"] ?? 12);

            let viewport = viewportAtRequestedScale;
            if (requestedMP > targetMP) {
              viewport = page.getViewport({ scale: scale * Math.sqrt(targetMP / requestedMP) });
              const msg = `Automatically adjusted resolution for large pages.`;
              if (!warnings.includes(msg)) warnings.push(msg);
            }

            totalMP += (viewport.width * viewport.height) / 1_000_000;
            if (totalMP > MAX_TOTAL_MEGAPIXELS) {
              throw new Error(`PDF too large (total > ${MAX_TOTAL_MEGAPIXELS}MP). Try lower quality.`);
            }

            canvas.width = viewport.width;
            canvas.height = viewport.height;

            await page.render({ canvas, viewport }).promise;

            const blob = await new Promise<Blob>((resolve, reject) =>
              canvas.toBlob(b => b ? resolve(b) : reject(new Error("Canvas toBlob failed")), outputFormat.mime, jpegQuality)
            );
            const bytes = new Uint8Array(await blob.arrayBuffer());
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

    if (warnings.length > 0 && outputFiles.length > 0) {
      outputFiles[0].warnings = warnings;
    }

    return outputFiles;
  }

}

export default pdftoimgHandler;
