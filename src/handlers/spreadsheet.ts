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
 *
 * The other direction, CSV or a JSON array to XLSX, writes one sheet. Nothing
 * else in the app wrote XLSX, so csv -> xlsx had no route at all.
 */
export default class SpreadsheetHandler extends BaseHandler {
  public name = "spreadsheet";
  public requiresMainThread = false;

  public supportedFormats: FileFormat[] = [
    CommonFormats.XLSX.builder("xlsx").allowFrom().allowTo(),
    CommonFormats.CSV.builder("csv").allowFrom().allowTo().markLossless(),
    CommonFormats.JSON.builder("json").allowFrom().allowTo().markLossless(),
  ];

  async doConvert(inputFiles: FileData[], inputFormat: FileFormat, outputFormat: FileFormat): Promise<FileData[]> {
    return inputFiles.map(file => {
      const sheet = this.#readSheet(file, inputFormat);
      let bytes: Uint8Array;
      if (outputFormat.internal === "xlsx") {
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
        bytes = new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
      } else {
        const text = outputFormat.internal === "csv"
          ? XLSX.utils.sheet_to_csv(sheet)
          : JSON.stringify(XLSX.utils.sheet_to_json(sheet), null, 2);
        bytes = new TextEncoder().encode(text);
      }
      return { name: this.replaceExtension(file.name, outputFormat.extension), bytes };
    });
  }

  #readSheet(file: FileData, inputFormat: FileFormat): XLSX.WorkSheet {
    if (inputFormat.internal === "json") {
      let rows: unknown;
      try { rows = JSON.parse(new TextDecoder().decode(file.bytes)); } catch { throw new Error("This JSON file could not be read."); }
      if (!Array.isArray(rows) || !rows.length || !rows.every(r => r !== null && typeof r === "object")) {
        throw new Error("JSON becomes a spreadsheet only as a list of objects or of rows, for example [{\"name\": \"Ada\"}].");
      }
      return rows.every(Array.isArray)
        ? XLSX.utils.aoa_to_sheet(rows as unknown[][])
        : XLSX.utils.json_to_sheet(rows as Record<string, unknown>[]);
    }
    const workbook = inputFormat.internal === "csv"
      ? XLSX.read(new TextDecoder().decode(file.bytes), { type: "string" })
      : XLSX.read(file.bytes, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw new Error("No worksheet found in this spreadsheet.");
    return sheet;
  }
}
