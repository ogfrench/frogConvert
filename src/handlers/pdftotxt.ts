import CommonFormats from '../core/CommonFormats/CommonFormats.ts';
import type { FileData, FileFormat, FormatHandler } from "../core/FormatHandler/FormatHandler.ts";

import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;

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

    const outputFiles: FileData[] = [];

    for (const inputFile of inputFiles) {
      const loadingTask = pdfjsLib.getDocument({ data: inputFile.bytes });
      const pdfDocument = await loadingTask.promise;

      let fullText = "";

      for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
        const page = await pdfDocument.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item: any) => ("str" in item ? item.str : ""))
          .join(" ");
        fullText += pageText + "\n";
      }

      const bytes = new TextEncoder().encode(fullText);
      const name = inputFile.name.split(".").slice(0, -1).join(".") + "." + outputFormat.extension;
      outputFiles.push({ bytes, name });
    }

    return outputFiles;
  }

}

export default pdftotxtHandler;
