import CommonFormats from '../core/CommonFormats/CommonFormats.ts';
import type { FileData, FileFormat, FormatHandler } from "../core/FormatHandler/FormatHandler.ts";
import { rethrowIfPasswordProtected } from "./_pdfErrors.ts";

import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

class pdftotxtHandler implements FormatHandler {

  public name: string = "pdftotxt";

  public supportedFormats: FileFormat[] = [
    CommonFormats.PDF.builder("pdf").allowFrom(),
    CommonFormats.TEXT.supported("text", false, true),
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

    if (inputFormat.format !== "pdf") throw "Invalid input format.";
    if (outputFormat.format !== "text") throw "Invalid output format.";

    if (/^((?!chrome|android).)*safari/i.test(navigator.userAgent))
      throw "PDF conversion is not supported on Safari. Please use Chrome or Firefox.";

    const outputFiles: FileData[] = [];

    for (const inputFile of inputFiles) {
      const loadingTask = pdfjsLib.getDocument({
        data: inputFile.bytes,
        isEvalSupported: false,
      });
      let pdfDocument;
      try {
        pdfDocument = await loadingTask.promise;
      } catch (e) {
        rethrowIfPasswordProtected(e, inputFile.name);
        throw e;
      }

      const pageTexts: string[] = [];

      try {
        for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
          const page = await pdfDocument.getPage(pageNum);
          try {
            const textContent = await page.getTextContent();
            pageTexts.push(textContent.items
              .map((item: any) => ("str" in item ? item.str : ""))
              .join(" "));
          } finally {
            page.cleanup();
          }
        }
      } finally {
        await pdfDocument.destroy();
      }

      const bytes = new TextEncoder().encode(pageTexts.join("\n") + "\n");
      const name = inputFile.name.split(".").slice(0, -1).join(".") + "." + outputFormat.extension;
      outputFiles.push({ bytes, name });
    }

    return outputFiles;
  }

}

export default pdftotxtHandler;
