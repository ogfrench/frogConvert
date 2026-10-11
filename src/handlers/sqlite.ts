import CommonFormats from '../core/CommonFormats/CommonFormats.ts';
import type { FileData, FileFormat, FormatHandler } from "../core/FormatHandler/FormatHandler.ts";
import { parse, unparse } from "papaparse";
class sqlite3Handler implements FormatHandler {

  public name: string = "sqlite3";
  public supportedFormats?: FileFormat[];
  public ready: boolean = false;

  async init() {
    this.supportedFormats = [
      {
        name: "SQLite3",
        format: "sqlite3",
        extension: "db",
        mime: "application/vnd.sqlite3",
        from: true,
        to: true,
        internal: "sqlite3",
        category: "database",
        lossless: false
      },
      {
        name: "iTunes Database",
        format: "itdb",
        extension: "itdb",
        mime: "application/vnd.sqlite3",
        from: true,
        to: false,
        internal: "sqlite3",
        category: "database",
        lossless: false
      },
      // Lossy because extracts only tables  
      CommonFormats.CSV.builder("csv").allowTo().allowFrom()
    ];
    this.ready = true;
  }

  getTables(db: { prepare: (sql: string) => any }) {
    const stmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table';");
    const row: string[] = [];
    try {
      while (stmt.step()) {
        row.push(stmt.get(0) as string);
      }
    } finally {
      stmt.finalize();
    }
    return row;
  }

  async doConvert(
    inputFiles: FileData[],
    inputFormat: FileFormat,
    outputFormat: FileFormat
  ): Promise<FileData[]> {
    const outputFiles: FileData[] = [];

    const { default: sqlite3InitModule } = await import("@sqlite.org/sqlite-wasm");
    const sqlite3 = await sqlite3InitModule();

    if (inputFormat.internal === "sqlite3" && outputFormat.internal === "csv") {
      for (const file of inputFiles) {
        const p = sqlite3.wasm.allocFromTypedArray(file.bytes);

        const db = new sqlite3.oo1.DB();
        if (!db.pointer) {
          throw new Error("Database pointer is undefined")
        }
        const flags = sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE;
        const rc = sqlite3.capi.sqlite3_deserialize(
          db.pointer,
          "main",
          p,
          file.bytes.byteLength,
          file.bytes.byteLength,
          flags
        );
        db.checkRc(rc);

        try {
          for (const table of this.getTables(db)) {
            const stmt = db.prepare(`SELECT * FROM ${quoteIdent(table)}`);
            const fields: string[] = stmt.getColumnNames();
            const data: unknown[][] = [];
            try {
              while (stmt.step()) {
                data.push(Array.from({ length: stmt.columnCount }, (_, j) => stmt.get(j)));
              }
            } finally {
              stmt.finalize();
            }

            outputFiles.push({
              name: `${table}.csv`,
              bytes: new TextEncoder().encode(unparse({ fields, data }) + "\n")
            })
          }
        } finally {
          db.close();
        }
      }
    }
    if (inputFormat.internal === "csv" && outputFormat.internal === "sqlite3") {
      const db = new sqlite3.oo1.DB();
      if (!db.pointer) {
        throw new Error("Database pointer is undefined")
      }
      try {
        for (const file of inputFiles) {
          const { data } = parse<string[]>(new TextDecoder("utf-8").decode(file.bytes), {
            header: false,
            skipEmptyLines: true,
          });
          if (data.length === 0) continue;
          const [header, ...rows] = data;
          const columns = columnNames(header);
          const types = columns.map((_, i) => inferType(rows.map(r => r[i])));
          const table = quoteIdent(file.name.replace(/\.csv$/i, "") || "data");

          db.exec(`CREATE TABLE ${table} (${columns.map((c, i) => `${quoteIdent(c)} ${types[i]}`).join(", ")})`);
          const insert = db.prepare(`INSERT INTO ${table} VALUES (${columns.map(() => "?").join(", ")})`);
          try {
            for (const row of rows) {
              insert.bind(columns.map((_, i) => toValue(row[i], types[i]))).stepReset();
            }
          } finally {
            insert.finalize();
          }
        }
        outputFiles.push({
          name: "database.db",
          bytes: sqlite3.capi.sqlite3_js_db_export(db)
        });
      } finally {
        db.close();
      }
    }

    return outputFiles;
  }
}

export default sqlite3Handler;

// Table and column names come from the file name and the CSV header, so they
// can be SQL keywords ("table", "order") or contain spaces and quotes.
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function columnNames(header: string[]): string[] {
  // SQLite compares identifiers case-insensitively, and a generated "a_2" can
  // collide with a real "a_2" header, so check every candidate against all.
  const used = new Set<string>();
  return header.map((raw, i) => {
    const base = raw.trim() || `column${i + 1}`;
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base}_${n}`;
    used.add(name.toLowerCase());
    return name;
  });
}

// Trimmed because this handler's own SQLite -> CSV output used to write
// ", " between values, and those files should still import cleanly.
function toValue(raw: string | undefined, type: string): string | number | null {
  const value = (raw ?? "").trim();
  if (value === "") return null;
  return type === "TEXT" ? value : Number(value);
}

// A column is numeric only if every value reads back exactly as written, so
// 00501, 0x1A, 1.50 and IDs past 2^53 stay TEXT instead of being rewritten.
function isExactNumber(v: string): boolean {
  const n = Number(v);
  return Number.isFinite(n) && String(n) === v && (!Number.isInteger(n) || Number.isSafeInteger(n));
}

function inferType(values: (string | undefined)[]): string {
  const present = values.map(v => (v ?? "").trim()).filter(v => v !== "");
  if (present.length === 0 || !present.every(isExactNumber)) return "TEXT";
  return present.every(v => Number.isInteger(Number(v))) ? "INTEGER" : "REAL";
}
