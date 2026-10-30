import type { FileData, FileFormat, FormatHandler } from "../core/FormatHandler/FormatHandler.ts";

import { parseODT, parseODP, parseODS } from "./envelope/parseODF.js";
import parseDOCX from "./envelope/parseDOCX.js";
import parsePPTX from "./envelope/parsePPTX.js";
import { assertPptxSafeForEnvelope } from "./pptxZipGuard.ts";
import parseXLSX from "./envelope/parseXLSX.js";
import CommonFormats from '../core/CommonFormats/CommonFormats.ts';

class envelopeHandler implements FormatHandler {

  public name: string = "envelope";

  public supportedFormats: FileFormat[] = [
    CommonFormats.DOCX.builder("docx").allowFrom(),
    // Not offered: the route finder cannot rank Envelope below Pandoc for
    // PPTX -> HTML (same category, and the web app registers Envelope first),
    // so enabling it made Envelope the browser's route and dropped slide tables
    // and pictures. Pandoc reads PPTX with both. pptxZipGuard stays in front of
    // the parser for when a real fallback ranking exists.
    // CommonFormats.PPTX.builder("pptx").allowFrom(),
    // CommonFormats.XLSX.builder("xlsx").allowFrom(),
    {
      name: "OpenDocument Text",
      format: "odt",
      extension: "odt",
      mime: "application/vnd.oasis.opendocument.text",
      from: true,
      to: false,
      internal: "odt",
      category: "document",
      lossless: false
    },
    {
      name: "OpenDocument Presentation",
      format: "odp",
      extension: "odp",
      mime: "application/vnd.oasis.opendocument.presentation",
      from: true,
      to: false,
      internal: "odp",
      category: "presentation",
      lossless: false
    },
    {
      name: "OpenDocument Spreadsheet",
      format: "ods",
      extension: "ods",
      mime: "application/vnd.oasis.opendocument.spreadsheet",
      from: true,
      to: false,
      internal: "ods",
      category: "spreadsheet",
      lossless: false
    },
    // Technically not "lossless", but it's about as close as we'll ever get
    CommonFormats.HTML.supported("html", false, true, true)
  ];

  public ready: boolean = true;

  async init () {
    this.ready = true;
  }

  async doConvert (
    inputFiles: FileData[],
    inputFormat: FileFormat,
    outputFormat: FileFormat
  ): Promise<FileData[]> {

    if (outputFormat.internal !== "html") throw "Invalid output format.";

    let parser: (bytes: Uint8Array) => Promise<string>;
    switch (inputFormat.internal) {
      case "odt": parser = parseODT; break;
      case "odp": parser = parseODP; break;
      case "ods": parser = parseODS; break;
      case "docx": parser = parseDOCX; break;
      case "pptx": parser = parsePPTX; break;
      case "xlsx": parser = parseXLSX; break;
      default: throw "Invalid input format.";
    }

    const outputFiles: FileData[] = [];

    const encoder = new TextEncoder();

    for (const inputFile of inputFiles) {
      // Envelope reads `bytes.buffer` from offset 0, ignoring a view's
      // byteOffset: hand it an exact copy so it parses what was checked.
      const input = inputFile.bytes.byteOffset === 0 && inputFile.bytes.byteLength === inputFile.bytes.buffer.byteLength
        ? inputFile.bytes : inputFile.bytes.slice();
      if (inputFormat.internal === "pptx") await assertPptxSafeForEnvelope(input);
      const fragment = await parser(input);
      // This fallback exports user-controlled slide styles. An HTML download
      // must not fetch third-party resources or execute scripts when opened.
      const html = inputFormat.internal === "pptx"
        ? `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'"></head><body><div style="background: #fff">${fragment}</div></body></html>`
        : `<div style="background: #fff">
        ${fragment}
      </div>`;
      const bytes = encoder.encode(html);
      const baseName = inputFile.name.split(".").slice(0, -1).join(".");
      const name = baseName + "." + outputFormat.extension;
      outputFiles.push({ bytes, name });
    }

    return outputFiles;

  }

}

export default envelopeHandler;
