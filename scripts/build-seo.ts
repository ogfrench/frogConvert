#!/usr/bin/env bun
/**
 * Generate the static SEO pages into dist/.
 *
 * The Vite plugin calls generateSeoPages() during the build; this runs the
 * same function standalone, which is how the output gets inspected without a
 * full app build.
 *
 *   bun run scripts/build-seo.ts [outDir]
 */
import { resolve } from "node:path";
import { generateSeoPages } from "../src/seo/generate.ts";

const root = resolve(import.meta.dir, "..");
const outDir = resolve(process.argv[2] ?? `${root}/dist`);

const { written, warnings } = await generateSeoPages({
  root, outDir, strict: true, log: msg => console.log(msg),
});

console.log(`wrote ${written.length} files to ${outDir}`);
if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`);
  for (const w of warnings) console.log(`  ${w}`);
}
