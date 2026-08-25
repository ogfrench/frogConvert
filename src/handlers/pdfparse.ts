// file: pdfparse.ts

import type { FileData, FileFormat, FormatHandler } from "../core/FormatHandler/FormatHandler.ts";
import CommonFormats from "../core/CommonFormats/CommonFormats.ts";
import { PDFParse } from 'pdf-parse';
import { rethrowIfPasswordProtected } from "./_pdfErrors.ts";


class pdfparseHandler implements FormatHandler {

  public name: string = "pdfparse";
  public supportedFormats?: FileFormat[] = [
    CommonFormats.PDF.builder("pdf").allowFrom(),
    CommonFormats.TEXT.builder("txt").allowTo(),
  ];
  public ready: boolean = false;

  async init () {
    // '/js/pdf.worker.mjs' is an HTTP path that only exists because the app
    // copies the worker into dist/js/. Off the web server - MCP, the REST API,
    // the CLI - there is nothing to serve it, and pdf-parse fails with
    // "Setting up fake worker failed", taking every route that starts at
    // pdf -> txt with it. Resolve the real file from node_modules there.
    // Node detection, not `typeof document`: src/mcp/core/polyfills.ts
    // installs a DOM shim, so document exists under MCP and the REST API.
    const isNode = typeof process !== "undefined" && !!process.versions?.node;
    if (isNode) {
      const moduleName = "node:module";
      const urlName = "node:url";
      const { createRequire } = await import(/* @vite-ignore */ moduleName);
      const { pathToFileURL } = await import(/* @vite-ignore */ urlName);
      const require_ = createRequire(import.meta.url);
      PDFParse.setWorker(pathToFileURL(require_.resolve("pdf-parse/dist/pdf-parse/esm/pdf.worker.mjs")).href);
    } else {
      PDFParse.setWorker('/js/pdf.worker.mjs');
    }
    this.ready = true;
  }

  async doConvert (
    inputFiles: FileData[],
    inputFormat: FileFormat,
    outputFormat: FileFormat
  ): Promise<FileData[]> {
    const outputFiles: FileData[] = [];

    for (const inputFile of inputFiles) {
      const parser = new PDFParse({ data: inputFile.bytes });
      let text;
      try {
        text = await parser.getText();
      } catch (e) {
        rethrowIfPasswordProtected(e, inputFile.name);
        throw e;
      } finally {
        await parser.destroy();
      }

      outputFiles.push({
        bytes: new TextEncoder().encode(text.text),
        name: inputFile.name.replace(/\.pdf$/i, ".txt"),
      });
    }

    return outputFiles;
  }

}

export default pdfparseHandler;