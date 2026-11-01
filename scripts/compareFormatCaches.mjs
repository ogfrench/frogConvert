import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

/** Compare handler and format order as well as all format metadata. */
export function compareFormatCaches(expected, actual) {
  const validate = (entries, label) => {
    if (!Array.isArray(entries)) throw new Error(`${label} is not a handler array`);
    const names = new Set();
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || !Array.isArray(entry[1])) {
        throw new Error(`${label} contains an invalid handler entry`);
      }
      if (names.has(entry[0])) throw new Error(`${label} contains duplicate handler ${entry[0]}`);
      names.add(entry[0]);
    }
  };
  validate(expected, "Committed cache");
  validate(actual, "Generated cache");
  const differences = [];
  const wanted = new Map(expected), found = new Map(actual);
  for (const [name] of expected) if (!found.has(name)) differences.push(`Missing handler: ${name}`);
  for (const [name] of actual) if (!wanted.has(name)) differences.push(`New handler: ${name}`);
  const a = expected.map(([name]) => name), b = actual.map(([name]) => name);
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    const index = a.findIndex((name, i) => name !== b[i]);
    const at = index < 0 ? a.length : index;
    differences.push(`Handler priority differs at ${at}: committed ${a[at] ?? "(end)"}, generated ${b[at] ?? "(end)"}`);
  }
  for (const [name, formats] of expected) {
    const other = found.get(name);
    if (!other) continue;
    const count = Math.max(formats.length, other.length);
    for (let i = 0; i < count; i++) {
      if (JSON.stringify(canonical(formats[i])) !== JSON.stringify(canonical(other[i]))) {
        differences.push(`${name} format ${i}: committed ${JSON.stringify(formats[i] ?? null)}, generated ${JSON.stringify(other[i] ?? null)}`);
        if (differences.length >= 25) return differences;
      }
    }
  }
  return differences;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [expectedPath = "public/cache.json", actualPath = "dist/cache.json"] = process.argv.slice(2);
    const expected = JSON.parse(readFileSync(expectedPath, "utf8"));
    const actual = JSON.parse(readFileSync(actualPath, "utf8"));
    const differences = compareFormatCaches(expected, actual);
    if (differences.length) {
      console.error("Format cache differs from a fresh enumeration:\n" + differences.join("\n"));
      console.error("Inspect the changes, then regenerate with bun run cache:refresh.");
      process.exitCode = 1;
    } else console.log("Committed format cache matches fresh handler capabilities and priority.");
  } catch (error) {
    console.error(`Cannot verify format cache: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
