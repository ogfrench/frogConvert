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
 * The other direction, CSV or a JSON array to XLSX, writes one sheet. The TMX
 * handler wrote XLSX already, but only from TMX, so csv -> xlsx had no route.
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
        if (inputFormat.internal !== "xlsx") fitColumns(sheet);
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
    if (inputFormat.internal === "json") return jsonToSheet(file);
    if (inputFormat.internal === "csv") return csvToSheet(file);
    const workbook = XLSX.read(file.bytes, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw new Error("No worksheet found in this spreadsheet.");
    return sheet;
  }
}

/** Size each column to its longest cell (capped), so a name is not cut off by the number beside it. */
function fitColumns(sheet: XLSX.WorkSheet): void {
  if (!sheet["!ref"]) return;
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const widths: { wch: number }[] = [];
  for (let col = range.s.c; col <= range.e.c; col++) {
    let longest = 4;
    for (let row = range.s.r; row <= range.e.r; row++) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
      if (!cell) continue;
      const text = cell.w ?? String(cell.v ?? "");
      longest = Math.max(longest, ...text.split("\n").map((line: string) => line.length));
    }
    widths.push({ wch: Math.min(longest + 2, 60) });
  }
  sheet["!cols"] = widths;
}

/** UTF-8 when the bytes are valid UTF-8, else Windows-1252: what Excel writes for CSV in Western Europe. */
function decodeCsv(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** Plain decimals that survive being a number: no leading zero, at most 15 digits, no exponent. */
const SAFE_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.(\d+))?$/;

/**
 * Read cells as text first (raw: true): without it "007" becomes 7, long IDs
 * lose digits, "1E3" becomes 1000, and "=HYPERLINK(...)" is stored as a live
 * formula. Then turn back only what is safely a number, so amounts stay
 * numbers (SUM, sorting and charts work) and codes, ZIPs and IDs stay text.
 * Decimals keep their written places ("3.50" stays 3.50).
 */
function csvToSheet(file: FileData): XLSX.WorkSheet {
  const workbook = XLSX.read(decodeCsv(file.bytes), { type: "string", raw: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("This CSV file has no rows.");
  for (const [address, cell] of Object.entries(sheet)) {
    if (address.startsWith("!") || cell.t !== "s" || typeof cell.v !== "string") continue;
    const match = SAFE_NUMBER.exec(cell.v);
    if (!match || cell.v.replace(/\D/g, "").length > 15) continue;
    const value = Number(cell.v);
    if (Object.is(value, -0)) continue;
    cell.t = "n";
    cell.v = value;
    delete cell.w;
    if (match[1]) cell.z = "0." + "0".repeat(match[1].length);
  }
  return sheet;
}

/**
 * JSON must be a list of rows that are either all arrays or all objects, so
 * the sheet has one shape. A nested object or array inside an object row is
 * written as its JSON text: dropping it silently would lose the data.
 */
function jsonToSheet(file: FileData): XLSX.WorkSheet {
  const refuse = () => new Error('JSON becomes a spreadsheet only as a list of objects or a list of arrays, for example [{"name": "Ada"}].');
  let rows: unknown;
  try { rows = JSON.parse(new TextDecoder().decode(file.bytes)); } catch { throw new Error("This JSON file could not be read."); }
  if (!Array.isArray(rows) || !rows.length) throw refuse();
  if (rows.every(Array.isArray)) return XLSX.utils.aoa_to_sheet(rows as unknown[][]);
  if (!rows.every(r => r !== null && typeof r === "object" && !Array.isArray(r))) throw refuse();
  const flat = (rows as Record<string, unknown>[]).map(row => Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, v !== null && typeof v === "object" ? JSON.stringify(v) : v]),
  ));
  return XLSX.utils.json_to_sheet(flat);
}

