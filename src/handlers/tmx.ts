// `xlsx` is pinned to the SheetJS CDN tarball in package.json because the
// community `xlsx` npm package is abandoned. `bun update` won't bump it.
// When updating SheetJS, change the URL in package.json by hand.
import * as XLSX from "xlsx";
import { DOMParser } from "@xmldom/xmldom";
import CommonFormats from '../core/CommonFormats/CommonFormats.ts';
import type { FileData, FileFormat } from "../core/FormatHandler/FormatHandler.ts";
import { BaseHandler } from "../core/FormatHandler/BaseHandler.ts";

const XML_NS = "http://www.w3.org/XML/1998/namespace";

export default class TMXHandler extends BaseHandler {
  public name = "tmx";
  public requiresMainThread = false;

  public supportedFormats: FileFormat[] = [
    CommonFormats.TMX.builder("tmx-to-xlsx").allowFrom(),
    CommonFormats.XLSX.builder("tmx-to-xlsx").allowTo(),
    CommonFormats.XLSX.builder("xlsx-to-tmx").allowFrom(),
    CommonFormats.TMX.builder("xlsx-to-tmx").allowTo()
  ];

  async doConvert(
    inputFiles: FileData[],
    inputFormat: FileFormat,
    outputFormat: FileFormat,
    args?: string[]
  ): Promise<FileData[]> {
    return inputFiles.map(file => {
      // Branch: XLSX -> TMX
      if (inputFormat.extension === "xlsx" && outputFormat.extension === "tmx") {
        const workbook = XLSX.read(file.bytes, { type: 'array' });
        const sheetName = workbook.SheetNames[0] || "Sheet1";
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) {
          throw new Error("No valid spreadsheet found.");
        }
        
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as string[][];
        if (rows.length === 0) {
          throw new Error("Spreadsheet is empty.");
        }

        const langs = rows[0] || [];
        let tmxString = `<?xml version="1.0" encoding="UTF-8"?>\n<tmx version="1.4">\n  <header srclang="en-US" adminlang="en-US" datatype="plaintext"/>\n  <body>\n`;
        let tuidCounter = 1;

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length === 0) continue;
          
          let hasContent = false;
          let tuContent = `    <tu tuid="${tuidCounter++}">\n`;
          
          for (let j = 0; j < langs.length; j++) {
            const lang = langs[j];
            const textRaw = row[j];
            const text = textRaw !== undefined && textRaw !== null ? String(textRaw) : "";
            
            if (lang && text) {
              const escapedText = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
              tuContent += `      <tuv xml:lang="${lang}"><seg>${escapedText}</seg></tuv>\n`;
              hasContent = true;
            }
          }
          tuContent += `    </tu>\n`;
          
          if (hasContent) {
            tmxString += tuContent;
          } else {
            tuidCounter--; // revert counter if we discarded an empty row
          }
        }
        tmxString += `  </body>\n</tmx>`;
        return { bytes: new TextEncoder().encode(tmxString), name: this.replaceExtension(file.name, "tmx") };
      }

      // Default Branch: TMX -> XLSX
      const text = new TextDecoder().decode(file.bytes);
      const doc = new DOMParser().parseFromString(text, "text/xml");

      // Collect unique language codes from <tuv xml:lang="...">
      const getLang = (el: Element) => el.getAttributeNS(XML_NS, "lang") || el.getAttribute("xml:lang") || "";
      const tuvs = Array.from(doc.getElementsByTagName("tuv"));
      const langs = [...new Set(tuvs.map(getLang))].filter(Boolean);

      // Build rows: header + one row per <tu>
      const rows: string[][] = [langs];
      const tus = Array.from(doc.getElementsByTagName("tu"));
      for (const tu of tus) {
        const row_tuvs = Array.from(tu.getElementsByTagName("tuv"));
        const row = langs.map(lang => {
          const tuv = row_tuvs.find(t => getLang(t) === lang);
          const segs = tuv ? tuv.getElementsByTagName("seg") : [];
          return (segs.length > 0 ? segs[0].textContent : "") ?? "";
        });
        rows.push(row);
      }

      const ws = XLSX.utils.aoa_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Translations");
      
      const raw = XLSX.write(wb, { type: "array", bookType: "xlsx" });
      const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);

      return { bytes, name: this.replaceExtension(file.name, "xlsx") };
    });
  }
}
