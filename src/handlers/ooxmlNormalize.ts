import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

const MAX_NORMALIZE_BYTES = 256 * 1024 * 1024;

/**
 * Rewrite an OOXML package (docx/pptx/xlsx) into the form pandoc's readers
 * understand, without changing its content. Both forms below are valid OOXML;
 * Excel and Word write the second, openpyxl, pandas and other generators the
 * first, and pandoc only reads the second:
 *
 * - Absolute relationship targets (`Target="/xl/worksheets/sheet1.xml"`).
 *   Pandoc resolves every target against the source part's folder, so this
 *   became `xl//xl/worksheets/sheet1.xml` and the file was rejected as
 *   corrupt ("Failed to parse XLSX: Entry not found").
 * - Inline string cells (`t="inlineStr"`) in xlsx. Pandoc reads text cells
 *   only from the shared-strings table, so every label in the sheet vanished
 *   and only the numbers came out.
 *
 * Returns the input unchanged when it is not a zip or has nothing to rewrite.
 */
export function normalizeOoxmlForPandoc(bytes: Uint8Array): Uint8Array {
  let entries: Record<string, Uint8Array>;
  try {
    // fflate allocates each member at its declared size and never grows it,
    // so the declared total is the memory bound. A few lying headers asked
    // for gigabytes before pandoc ran; over budget, pandoc gets the original.
    let declared = 0;
    entries = unzipSync(bytes, {
      filter: ({ originalSize }) => {
        declared += originalSize;
        if (declared > MAX_NORMALIZE_BYTES) throw new Error("OOXML package too large to normalize");
        return true;
      },
    });
  } catch {
    return bytes;
  }
  const relsChanged = relativizeTargets(entries);
  const stringsChanged = inlineStringsToShared(entries);
  return relsChanged || stringsChanged ? zipSync(entries) : bytes;
}

function relativizeTargets(entries: Record<string, Uint8Array>): boolean {
  let changed = false;
  for (const [name, data] of Object.entries(entries)) {
    const m = name.match(/^(.*?)_rels\/[^/]*\.rels$/);
    if (!m) continue;
    const baseDir = m[1];
    const xml = strFromU8(data);
    const next = xml.replace(/<Relationship\b[^>]*>/g, (tag) => {
      if (/TargetMode\s*=\s*"External"/.test(tag)) return tag;
      return tag.replace(/Target="\/([^"]*)"/, (_all, abs: string) => `Target="${relativeTo(baseDir, abs)}"`);
    });
    if (next !== xml) {
      entries[name] = strToU8(next);
      changed = true;
    }
  }
  return changed;
}

const SST_PATH = "xl/sharedStrings.xml";
const SST_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml";
const SST_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings";

function inlineStringsToShared(entries: Record<string, Uint8Array>): boolean {
  const sheets = Object.keys(entries).filter(n => /^xl\/worksheets\/[^/]+\.xml$/.test(n));
  if (sheets.length === 0) return false;

  const existing = entries[SST_PATH] ? strFromU8(entries[SST_PATH]) : null;
  let index = existing ? (existing.match(/<si[\s>]/g) ?? []).length : 0;
  const added: string[] = [];

  for (const name of sheets) {
    const xml = strFromU8(entries[name]);
    if (!xml.includes('t="inlineStr"')) continue;
    // Cells never nest, so a lazy match from <c to </c> is exactly one cell.
    // A self-closing <c .../> has no </c>, so it is excluded or the match would
    // run on into the next cell.
    const next = xml.replace(/<c\b([^>]*?)\bt="inlineStr"([^>]*?)(?<!\/)>([\s\S]*?)<\/c>/g, (_all, pre: string, post: string, inner: string) => {
      const is = inner.match(/<is>([\s\S]*?)<\/is>/);
      if (!is) return _all;
      added.push(`<si>${is[1]}</si>`);
      return `<c${pre}t="s"${post}><v>${index++}</v></c>`;
    });
    entries[name] = strToU8(next);
  }
  if (added.length === 0) return false;

  if (existing) {
    entries[SST_PATH] = strToU8(existing.replace(/<\/sst>\s*$/, `${added.join("")}</sst>`)
      .replace(/\s(count|uniqueCount)="\d+"/g, ""));
    return true;
  }
  entries[SST_PATH] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${added.join("")}</sst>`,
  );
  const relsName = "xl/_rels/workbook.xml.rels";
  if (entries[relsName]) {
    const rels = strFromU8(entries[relsName]);
    if (!rels.includes(SST_REL)) {
      entries[relsName] = strToU8(rels.replace(/<\/Relationships>\s*$/,
        `<Relationship Id="rIdFrogSst" Type="${SST_REL}" Target="sharedStrings.xml"/></Relationships>`));
    }
  }
  const ctName = "[Content_Types].xml";
  if (entries[ctName]) {
    const ct = strFromU8(entries[ctName]);
    if (!ct.includes('PartName="/xl/sharedStrings.xml"')) {
      entries[ctName] = strToU8(ct.replace(/<\/Types>\s*$/,
        `<Override PartName="/xl/sharedStrings.xml" ContentType="${SST_TYPE}"/></Types>`));
    }
  }
  return true;
}

/** POSIX-style relative path from folder `fromDir` (ending in "/" or empty) to `target`. */
function relativeTo(fromDir: string, target: string): string {
  const from = fromDir.split("/").filter(Boolean);
  const to = target.split("/");
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  return [...Array(from.length - i).fill(".."), ...to.slice(i)].join("/");
}
