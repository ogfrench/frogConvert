// SheetJS, via the `xlsx` alias - see the provenance note in ./tmx.ts.
import * as XLSX from "xlsx";
import CommonFormats from "../core/CommonFormats/CommonFormats.ts";
import type { FileData, FileFormat } from "../core/FormatHandler/FormatHandler.ts";
import { BaseHandler } from "../core/FormatHandler/BaseHandler.ts";

/**
 * Spreadsheet cell values to CSV and JSON.
 *
 * Before this, the only route from xlsx to either was pandoc, and pandoc's
 * `json` is its own document tree, not data: xlsx -> json handed back
 * {"pandoc-api-version": ..., "blocks": [...]}, and xlsx -> csv flattened that
 * tree into rows. Both landing pages promised cell values.
 *
 * CSV is the first sheet, since CSV holds one table. JSON is one object per
 * row of the first sheet, keyed by its header row, matching csv -> json.
 */
export default class SpreadsheetHandler extends BaseHandler {
  public name = "spreadsheet";
  public requiresMainThread = false;

  public supportedFormats: FileFormat[] = [
    CommonFormats.XLSX.builder("xlsx").allowFrom(),
    CommonFormats.CSV.builder("csv").allowTo().markLossless(),
    CommonFormats.JSON.builder("json").allowTo().markLossless(),
  ];

  async doConvert(inputFiles: FileData[], _inputFormat: FileFormat, outputFormat: FileFormat): Promise<FileData[]> {
    return inputFiles.map(file => {
      const workbook = XLSX.read(file.bytes, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error("No worksheet found in this spreadsheet.");
      const text = outputFormat.internal === "csv"
        ? XLSX.utils.sheet_to_csv(sheet)
        : JSON.stringify(XLSX.utils.sheet_to_json(sheet), null, 2);
      return {
        name: this.replaceExtension(file.name, outputFormat.extension),
        bytes: new TextEncoder().encode(text),
      };
    });
  }
}
