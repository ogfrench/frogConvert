// @vitest-environment node
import { describe, it, expect } from "vitest";
import sqlite3Handler from "./sqlite.ts";
import type { FileFormat } from "../core/FormatHandler/FormatHandler.ts";

async function handler() {
  const h = new sqlite3Handler();
  await h.init();
  const fmt = (internal: string) => h.supportedFormats!.find(f => f.internal === internal && f.format !== "itdb")!;
  return { h, csv: fmt("csv"), db: fmt("sqlite3") };
}

const csvFile = (name: string, text: string) => ({ name, bytes: new TextEncoder().encode(text) });

describe("sqlite3 handler: CSV <-> SQLite", () => {
  it("round-trips a CSV whose name and header are SQL keywords or have spaces", async () => {
    const { h, csv, db } = await handler();
    const input = 'order,first name,"note, with comma"\nfrog,Ann,"says ""hi"", twice"\ntoad,B,\n';
    const [database] = await h.doConvert([csvFile("table.csv", input)], csv as FileFormat, db as FileFormat);
    expect(new TextDecoder().decode(database.bytes.subarray(0, 15))).toBe("SQLite format 3");

    const [out] = await h.doConvert([{ name: "database.db", bytes: database.bytes }], db as FileFormat, csv as FileFormat);
    expect(out.name).toBe("table.csv");
    expect(new TextDecoder().decode(out.bytes).trim().split(/\r?\n/)).toEqual([
      'order,first name,"note, with comma"',
      'frog,Ann,"says ""hi"", twice"',
      "toad,B,",
    ]);
  });

  it("keeps every character of single-character and numeric values", async () => {
    const { h, csv, db } = await handler();
    const [database] = await h.doConvert([csvFile("n.csv", "a,b\nx,3\ny,2.5\n")], csv as FileFormat, db as FileFormat);
    const [out] = await h.doConvert([{ name: "d.db", bytes: database.bytes }], db as FileFormat, csv as FileFormat);
    expect(new TextDecoder().decode(out.bytes).trim().split(/\r?\n/)).toEqual(["a,b", "x,3", "y,2.5"]);
  });

  it("imports the older ', '-separated output this handler used to write", async () => {
    const { h, csv, db } = await handler();
    const [database] = await h.doConvert([csvFile("old.csv", "name,n\nfrog, 3\ntoad, 5\n")], csv as FileFormat, db as FileFormat);
    const [out] = await h.doConvert([{ name: "d.db", bytes: database.bytes }], db as FileFormat, csv as FileFormat);
    expect(new TextDecoder().decode(out.bytes).trim().split(/\r?\n/)).toEqual(["name,n", "frog,3", "toad,5"]);
  });

  it("keeps values that only look like numbers exactly as written", async () => {
    // Zip codes, hex and long IDs went through Number(): 00501 became 501.
    const { h, csv, db } = await handler();
    const input = "zip,hex,id,price\n00501,0x1A,12345678901234567890,1.50\n10001,0x1B,12345678901234567891,2.25\n";
    const [database] = await h.doConvert([csvFile("ids.csv", input)], csv as FileFormat, db as FileFormat);
    const [out] = await h.doConvert([{ name: "d.db", bytes: database.bytes }], db as FileFormat, csv as FileFormat);
    expect(new TextDecoder().decode(out.bytes).trim().split(/\r?\n/)).toEqual(input.trim().split("\n"));
  });

  it("gives repeated headers names that do not collide with a later header", async () => {
    const { h, csv, db } = await handler();
    const [database] = await h.doConvert([csvFile("dup.csv", "a,a,a_2\n1,2,3\n")], csv as FileFormat, db as FileFormat);
    const [out] = await h.doConvert([{ name: "d.db", bytes: database.bytes }], db as FileFormat, csv as FileFormat);
    const [header, row] = new TextDecoder().decode(out.bytes).trim().split(/\r?\n/);
    expect(new Set(header.split(",")).size).toBe(3);
    expect(row).toBe("1,2,3");
  });
});
