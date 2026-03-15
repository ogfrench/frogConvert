import CommonFormats from '../core/CommonFormats/CommonFormats.ts';
import type { FileData, FileFormat, FormatHandler } from "../core/FormatHandler/FormatHandler.ts";

import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

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
    outputFormat: FileFormat
  ): Promise<FileData[]> {

    if (
      outputFormat.format !== "png"
      && outputFormat.format !== "jpeg"
    ) throw "Invalid output format.";

    const mimeType = outputFormat.format === "jpeg" ? "image/jpeg" : "image/png";
    const outputFiles: FileData[] = [];

    for (const inputFile of inputFiles) {
      const pdf = await pdfjsLib.getDocument({ data: inputFile.bytes }).promise;
      const baseName = inputFile.name.split(".").slice(0, -1).join(".");

      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 2 });

        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({ canvas, viewport }).promise;

        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(b => b ? resolve(b) : reject("Canvas toBlob failed"), mimeType)
        );
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const suffix = pdf.numPages > 1 ? `_${pageNum}` : "";
        outputFiles.push({ bytes, name: `${baseName}${suffix}.${outputFormat.extension}` });
        page.cleanup();
      }

      await pdf.destroy();
    }

    return outputFiles;
  }

}

export default pdftoimgHandler;
