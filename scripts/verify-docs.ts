import fs from "fs";
import { resolve, basename } from "path";

/**
 * verify-docs.ts
 * Ensures that root-level markdown files and their counterparts in docs/
 * are identical. This prevents "frogConvert" vs "Leap" discrepancies
 * when files are duplicated across the repository.
 */

const rootDir = process.cwd();
const docsDir = resolve(rootDir, "docs");

const rootMdFiles = fs.readdirSync(rootDir).filter(f => f.endsWith(".md"));
let hasError = false;

console.log("🔍 Verifying documentation sync...");

for (const file of rootMdFiles) {
  const rootPath = resolve(rootDir, file);
  const docsPath = resolve(docsDir, file);

  if (fs.existsSync(docsPath)) {
    const rootContent = fs.readFileSync(rootPath, "utf-8").replace(/\r\n/g, "\n");
    const docsContent = fs.readFileSync(docsPath, "utf-8").replace(/\r\n/g, "\n");

    if (rootContent !== docsContent) {
      console.error(`❌ DISCREPANCY DETECTED: ${file} exists in both root and /docs/ but contents differ.`);
      console.error(`   Please sync them or remove the duplicate in /docs/ if the root version is the master.`);
      hasError = true;
    } else {
      console.log(`✅ ${file} is in sync.`);
    }
  }
}

if (hasError) {
  console.log("\n⚠️ Documentation verification failed. Please resolve the discrepancies before committing.");
  process.exit(1);
} else {
  console.log("✨ Documentation is perfectly in sync.");
}
