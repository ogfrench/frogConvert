import puppeteer from "puppeteer";
import path from "path";

const minify = process.argv.includes("--minify");
const outputPath = process.argv[2] || "cache.json";

const projectRoot = path.resolve(__dirname, "..");
const distPath = path.join(projectRoot, "dist");

const outputFile = Bun.file(outputPath);
if (await outputFile.exists()) {
  await outputFile.delete();
}

// Use port 0 to let the OS assign a random free port
const server = Bun.serve({
  async fetch(req) {
    const urlPath = new URL(req.url).pathname.replace("/convert/", "") || "index.html";
    const filePath = path.join(distPath, urlPath);
    const file = Bun.file(filePath);

    if (!(await file.exists())) return new Response("Not Found", { status: 404 });
    return new Response(file);
  },
  port: 0
});

const serverUrl = `http://localhost:${server.port}`;

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"]
});

try {
  const page = await browser.newPage();

  await Promise.all([
    new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timeout waiting for Phase 2")), 60000);
      page.on("console", msg => {
        if (msg.text().startsWith("Phase 2:")) {
          clearTimeout(timeout);
          resolve();
        }
      });
    }),
    page.goto(`${serverUrl}/convert/index.html`, { waitUntil: "networkidle0" })
  ]);

  const cacheJSON = await page.evaluate((minify) => {
    const cache = window.printSupportedFormatCache();
    return minify ? JSON.stringify(JSON.parse(cache)) : cache;
  }, minify);

  await Bun.write(outputPath, cacheJSON);
  console.log(`✓ Cache generated: ${outputPath} (${(cacheJSON.length / 1024).toFixed(1)} KB)`);

} catch (err) {
  console.error("error: cache build failed:", err.message);
  process.exit(1);
} finally {
  await browser.close();
  server.stop();
}
