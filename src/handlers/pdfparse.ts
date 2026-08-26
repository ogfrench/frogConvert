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
      const pathName = "node:path";
      const { createRequire } = await import(/* @vite-ignore */ moduleName);
      const { pathToFileURL } = await import(/* @vite-ignore */ urlName);
      const { dirname, join } = await import(/* @vite-ignore */ pathName);
      const require_ = createRequire(import.meta.url);
      // Resolved as a sibling of the package's own entry point, not as a deep
      // subpath. pdf-parse declares an `exports` map with no `./dist/*` entry,
      // so resolving the worker file directly is blocked by the package - it
      // threw "Cannot find module 'pdf-parse/dist/pdf-parse/esm/pdf.worker.mjs'"
      // and left the handler unregistered, silently falling MCP back to the
      // browser bridge for every pdf -> txt. The entry point is exported, and
      // both the cjs and esm builds ship pdf.worker.mjs beside it, so this
      // resolves whichever condition the host picked.
      const entry = require_.resolve("pdf-parse");
      PDFParse.setWorker(pathToFileURL(join(dirname(entry), "pdf.worker.mjs")).href);
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
      // A copy, because pdf.js detaches whatever buffer it is given, and
      // pdf-parse hands ours straight to it. The caller's bytes may still be
      // needed: a multi-hop route reuses them, MCP's convert_file falls back to
      // the browser bridge with the same array when the native path throws, and
      // the verifier converts one sample pdf to several targets in a row. Before
      // this, that second use failed with "Underlying ArrayBuffer has been
      // detached from the view". The other four pdf.js call sites in this
      // codebase already copy.
      const parser = new PDFParse({ data: inputFile.bytes.slice() });
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