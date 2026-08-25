import type { FileData, FileFormat, FormatHandler } from "../core/FormatHandler/FormatHandler.ts";
import CommonFormats from "../core/CommonFormats/CommonFormats.ts";

class libreofficeHandler implements FormatHandler {

  public name: string = "libreoffice";

  // IMPORTANT: starts EMPTY. Populated inside init() only after the soffice
  // binary is detected. This mirrors FFmpeg's pattern (FFmpeg.ts:159) and
  // prevents the graph from creating libreoffice edges when the binary is
  // not available, otherwise the graph would route through us and the
  // executor would throw "Handler not ready after init".
  public supportedFormats: FileFormat[] = [];

  public ready: boolean = false;

  /**
   * Handler has two execution modes:
   *   - "native": running in Node/Bun (Electron, CLI, API server) with the
   *               soffice binary installed. doConvert() shells out directly.
   *   - "remote": running in a browser that has a localhost API server on
   *               /api with libreoffice available. doConvert() POSTs to
   *               /api/convert and the API server runs soffice natively.
   *   - "disabled": neither available, graph gets no libreoffice edges.
   */
  #mode: "native" | "remote" | "disabled" = "disabled";

  #sofficeBinary: string = "soffice";
  #tempDir: string = "";
  #profileDir: string = "";
  #queue: Promise<void> = Promise.resolve();

  constructor() {
    // Force re-detection on every page load. The browser persists
    // supportedFormatCache to localStorage and falls back to a pre-built
    // cache.json. Both can contain stale entries for this handler:
    //   - cache.json is built in headless Chromium (no Node), so the entry
    //     is empty there, but a present-but-empty entry still counts as a
    //     cache HIT and prevents initCacheMissHandlers from running init().
    //   - localStorage may carry over stale entries from previous runs.
    // Removing the entry forces a cache MISS, which forces init() to run,
    // which performs the actual binary detection. The cost is one fast
    // spawn() call, there's no real benefit to caching this handler.
    if (typeof window !== "undefined" && window.supportedFormatCache) {
      window.supportedFormatCache.delete("libreoffice");
    }
  }

  async init() {
    const isNodeOrBun = typeof process !== "undefined"
      && process.versions
      && (process.versions.node || process.versions.bun);

    if (isNodeOrBun) {
      // Node/Bun context (Electron, CLI, API server): try native binary
      if (await this.#initNative()) {
        this.#mode = "native";
        this.#populateFormats();
        this.ready = true;
        return;
      }
    } else {
      // Browser context: probe for a localhost API server with libreoffice
      if (await this.#probeRemoteApi()) {
        this.#mode = "remote";
        this.#populateFormats();
        this.ready = true;
        return;
      }
    }

    // Neither mode available, stay disabled.
    // supportedFormats remains empty, graph will not route through us.
  }

  /** Native mode: detect soffice and set up temp/profile dirs. Returns true on success. */
  async #initNative(): Promise<boolean> {
    const binary = await this.#findSofficeBinary();
    if (!binary) {
      console.warn("[LibreOffice] soffice not found in PATH or common install locations. Native mode disabled.");
      return false;
    }
    this.#sofficeBinary = binary;

    // Create temp dir + a single shared user profile dir.
    // The mutex serializes calls, so one profile is safe and avoids the
    // per-call ~3-5s cost of LibreOffice initializing a fresh profile.
    try {
      const fsName = "fs/promises";
      const pathName = "path";
      const osName = "os";
      const fs = await import(/* @vite-ignore */ fsName);
      const path = await import(/* @vite-ignore */ pathName);
      const os = await import(/* @vite-ignore */ osName);

      // Best-effort sweep of stale libreoffice-node-* dirs from prior runs
      // that crashed before terminate() fired. Failure here is non-fatal.
      try {
        const tmpRoot = os.tmpdir();
        const entries = await fs.readdir(tmpRoot);
        const staleThresholdMs = 24 * 60 * 60 * 1000;
        const cutoff = Date.now() - staleThresholdMs;
        for (const name of entries) {
          if (!name.startsWith("libreoffice-node-")) continue;
          const full = path.join(tmpRoot, name);
          try {
            const st = await fs.stat(full);
            if (st.mtimeMs < cutoff) {
              await fs.rm(full, { recursive: true, force: true });
            }
          } catch { /* ignore per-entry stat/rm failures */ }
        }
      } catch (sweepErr: any) {
        console.warn("[LibreOffice] stale temp sweep skipped:", sweepErr?.message || sweepErr);
      }

      this.#tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "libreoffice-node-"));
      this.#profileDir = path.join(this.#tempDir, "profile");
      await fs.mkdir(this.#profileDir, { recursive: true });
      return true;
    } catch (e: any) {
      console.warn("[LibreOffice] failed to create temp dirs:", e?.message || e);
      return false;
    }
  }

  /**
   * Remote mode: check if a localhost API server is running with libreoffice
   * available. The Vite dev plugin auto-spawns this server and proxies /api
   * to it. Falls back to disabled if anything fails.
   */
  async #probeRemoteApi(): Promise<boolean> {
    // Avoid noisy 404s in the console on known static production environments
    // where the local API is guaranteed to be absent.
    if (typeof window !== "undefined") {
      const h = window.location.hostname;
      if (h === "frogconvert.xyz" || h.endsWith(".netlify.app")) {
        return false;
      }
    }

    try {
      const resp = await fetch("/api/health", {
        signal: AbortSignal.timeout(2000)
      });
      if (!resp.ok) return false;
      const data = await resp.json();
      const available = Array.isArray(data?.handlers) && data.handlers.includes("libreoffice");
      if (available) {
        console.info("[LibreOffice] remote mode enabled via /api, using localhost API server.");
      }
      return available;
    } catch {
      return false;  // API not running, unreachable, or returned invalid JSON
    }
  }

  /** Populate supportedFormats. Shared between native and remote modes. */
  #populateFormats() {
    this.supportedFormats = [
      // Inputs, Office formats that LibreOffice can convert to PDF
      CommonFormats.PPTX.builder("pptx").allowFrom(),
      CommonFormats.DOCX.builder("docx").allowFrom(),
      CommonFormats.XLSX.builder("xlsx").allowFrom(),
      // Legacy PPT (no CommonFormats entry exists)
      {
        name: "Microsoft PowerPoint (PPT)",
        format: "ppt",
        extension: "ppt",
        mime: "application/vnd.ms-powerpoint",
        from: true, to: false, internal: "ppt",
        category: ["presentation", "document"], lossless: false
      },
      // OpenDocument formats
      {
        name: "OpenDocument Text",
        format: "odt",
        extension: "odt",
        mime: "application/vnd.oasis.opendocument.text",
        from: true, to: false, internal: "odt",
        category: "document", lossless: false
      },
      {
        name: "OpenDocument Presentation",
        format: "odp",
        extension: "odp",
        mime: "application/vnd.oasis.opendocument.presentation",
        from: true, to: false, internal: "odp",
        category: ["presentation", "document"], lossless: false
      },
      {
        name: "OpenDocument Spreadsheet",
        format: "ods",
        extension: "ods",
        mime: "application/vnd.oasis.opendocument.spreadsheet",
        from: true, to: false, internal: "ods",
        category: ["spreadsheet", "document"], lossless: false
      },
      // Plain-text and markup inputs that soffice reads natively.
      // Useful as fallback PDF routes when Pandoc's office-format writers
      // are not the cheapest option (e.g. md -> html -> pdf alongside
      // md -> docx -> pdf).
      CommonFormats.HTML.builder("html").allowFrom(),
      {
        name: "Rich Text Format",
        format: "rtf",
        extension: "rtf",
        mime: "application/rtf",
        from: true, to: false, internal: "rtf",
        category: "document", lossless: false
      },
      CommonFormats.TEXT.builder("text").allowFrom(),
      CommonFormats.CSV.builder("csv").allowFrom(),
      // EPUB is deliberately absent. LibreOffice writes EPUB but has no import
      // filter for it, so declaring `from: true` gave the graph an epub -> pdf
      // edge that always failed with "source file could not be loaded".
      // Verified against LibreOffice 26.2 with a real 6,150-byte EPUB: exit 1,
      // no output. It also made md -> pdf fail, because the router preferred
      // md -> epub -> pdf over the md -> html -> pdf route that works.

      // Output
      CommonFormats.PDF.builder("pdf").allowTo()
    ];
  }

  terminate() {
    if (this.#tempDir) {
      const fsName = "fs/promises";
      import(/* @vite-ignore */ fsName).then(fs =>
        fs.rm(this.#tempDir, { recursive: true, force: true })
          .catch((e: any) => console.warn("[LibreOffice] failed to remove temp dir on terminate:", e?.message ?? e))
      );
    }
  }

  /**
   * Find the soffice binary. Returns the full path (or bare command) on
   * success, or null if not found.
   *
   * We avoid running `soffice --version` because on Windows it opens the GUI
   * and hangs instead of printing to stdout. Instead:
   *   1. Check well-known Windows install paths via file existence (fast)
   *   2. Check macOS paths
   *   3. Try `soffice` in $PATH via a quick `which`/`where` probe
   */
  async #findSofficeBinary(): Promise<string | null> {
    const fsName = "fs/promises";
    const fs = await import(/* @vite-ignore */ fsName);

    // Tier 1: well-known paths (use forward slashes, Bun mangles backslashes in spawn)
    const knownPaths = [
      "C:/Program Files/LibreOffice/program/soffice.exe",
      "C:/Program Files (x86)/LibreOffice/program/soffice.exe",
      "/usr/bin/soffice",
      "/usr/local/bin/soffice",
      "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    ];
    for (const p of knownPaths) {
      try {
        await fs.access(p);
        return p;
      } catch { /* not found, try next */ }
    }

    // Tier 2: check $PATH via `where` (Windows) or `which` (Unix)
    try {
      const cpName = "child_process";
      const { execSync } = await import(/* @vite-ignore */ cpName);
      const cmd = process.platform === "win32" ? "where soffice" : "which soffice";
      const result = execSync(cmd, { encoding: "utf8", timeout: 3000, stdio: ["pipe", "pipe", "pipe"] }).trim();
      if (result) {
        // Verify the resolved path actually exists
        await fs.access(result.split("\n")[0]);
        return result.split("\n")[0];
      }
    } catch { /* not in PATH */ }

    return null;
  }

  /**
   * Enqueue a conversion so only one soffice process runs at a time.
   * LibreOffice can't safely share a user profile across concurrent instances.
   */
  #enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.#queue = this.#queue.then(() => fn().then(resolve, reject));
    });
  }

  async doConvert(
    inputFiles: FileData[],
    inputFormat: FileFormat,
    outputFormat: FileFormat,
    _args?: string[],
  ): Promise<FileData[]> {
    if (this.#mode === "remote") {
      return this.#doConvertRemote(inputFiles, inputFormat, outputFormat);
    }
    // Native mode: serialize via mutex (LibreOffice can't run concurrent instances)
    return this.#enqueue(() => this.#doConvertInner(inputFiles, inputFormat, outputFormat));
  }

  /**
   * Remote mode: POST each file to /api/convert on the localhost API server.
   * The API server runs the native libreoffice handler internally and returns
   * the converted bytes. Uses the JSON endpoint contract from
   * src/api/routes/convert.ts.
   */
  async #doConvertRemote(
    inputFiles: FileData[],
    inputFormat: FileFormat,
    outputFormat: FileFormat
  ): Promise<FileData[]> {
    const results: FileData[] = [];
    for (const file of inputFiles) {
      const base64 = bytesToBase64(file.bytes);
      const resp = await fetch("/api/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          base64Bytes: base64,
          inputMime: inputFormat.mime,
          inputExt: inputFormat.extension,
          outputMime: outputFormat.mime,
          outputExt: outputFormat.extension,
        }),
      });
      if (!resp.ok) {
        let errMsg = resp.statusText;
        try {
          const errJson = await resp.json();
          errMsg = errJson?.error || errMsg;
        } catch { /* ignore */ }
        throw new Error(`[LibreOffice remote] /api/convert failed: ${errMsg}`);
      }
      const output: Array<{ fileName: string; base64Bytes: string }> = await resp.json();
      for (const out of output) {
        results.push({ name: out.fileName, bytes: base64ToBytes(out.base64Bytes) });
      }
    }
    return results;
  }

  async #doConvertInner(
    inputFiles: FileData[],
    _inputFormat: FileFormat,
    _outputFormat: FileFormat
  ): Promise<FileData[]> {
    const fsName = "fs/promises";
    const pathName = "path";
    const cryptoName = "crypto";
    const fs = await import(/* @vite-ignore */ fsName);
    const path = await import(/* @vite-ignore */ pathName);
    const crypto = await import(/* @vite-ignore */ cryptoName);

    const outputFiles: FileData[] = [];

    for (const inputFile of inputFiles) {
      // Create isolated per-call directory (avoids filename collisions
      // and provides clean output dir for soffice --outdir)
      const callId = crypto.randomUUID();
      const callDir = path.join(this.#tempDir, callId);

      try {
        await fs.mkdir(callDir, { recursive: true });

        // Sanitize filename to prevent path traversal
        const safeName = path.basename(inputFile.name) || "input";
        const inputPath = path.join(callDir, safeName);
        await fs.writeFile(inputPath, inputFile.bytes);

        await this.#exec(callDir, inputPath);

        // LibreOffice writes <basename>.pdf in the output directory
        const dotIndex = safeName.lastIndexOf(".");
        const baseName = dotIndex > 0 ? safeName.slice(0, dotIndex) : safeName;
        const outputPath = path.join(callDir, baseName + ".pdf");

        let pdfBytes: Uint8Array;
        try {
          const data = await fs.readFile(outputPath);
          pdfBytes = new Uint8Array(data);
        } catch {
          throw new Error(
            "LibreOffice produced no output - input file may be corrupt or unsupported"
          );
        }

        outputFiles.push({ name: baseName + ".pdf", bytes: pdfBytes });
      } finally {
        // Clean up per-call directory (always, even on early failure)
        fs.rm(callDir, { recursive: true, force: true })
          .catch((e: any) => console.warn("[LibreOffice] failed to remove call dir:", e?.message ?? e));
      }
    }

    return outputFiles;
  }

  async #exec(outDir: string, inputPath: string): Promise<void> {
    const cpName = "child_process";
    const urlName = "url";
    const { spawn } = await import(/* @vite-ignore */ cpName);
    const { pathToFileURL } = await import(/* @vite-ignore */ urlName);

    // pathToFileURL, not a hand-rolled encoder. Running every path segment
    // through encodeURIComponent turned the Windows drive letter "C:" into
    // "C%3A", and LibreOffice does not reject that URI - it hangs on it until
    // the 120s timeout kills it, so every native conversion on Windows failed
    // by timing out. Measured on the same file: file:///C:/... exits 0 with an
    // 86,639-byte PDF, file:///C%3A/... produces nothing.
    const profileUri = pathToFileURL(this.#profileDir).href;

    const args = [
      "--headless",
      "--norestore",
      "--convert-to", "pdf",
      "--outdir", outDir,
      `-env:UserInstallation=${profileUri}`,
      inputPath,
    ];

    return new Promise((resolve, reject) => {
      const p = spawn(this.#sofficeBinary, args);

      let stderr = "";
      p.stdout?.on("data", () => {});
      p.stderr?.on("data", (data: any) => { stderr += data.toString(); });

      const timeout = setTimeout(() => {
        // SIGKILL (not default SIGTERM), a hung soffice may ignore SIGTERM,
        // leaving the mutex permanently locked and temp dirs leaked.
        p.kill("SIGKILL");
        reject(new Error("LibreOffice conversion timed out (120s)"));
      }, 120_000);

      p.on("close", (code: number | null) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve();
        } else if (code !== null) {
          reject(new Error(
            `LibreOffice exited with code ${code}${stderr ? ": " + stderr.trim() : ""}`
          ));
        }
        // code === null means killed by signal, usually our timeout handler
        // (already rejected above), but could be an external kill. Reject to
        // avoid permanently locking the mutex.
        if (code === null) reject(new Error("LibreOffice process was killed by signal"));
      });

      p.on("error", (err: any) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

}

export default libreofficeHandler;

/**
 * Chunked base64 encoder, plain `btoa(String.fromCharCode(...bytes))` blows
 * the argument stack for files larger than ~100KB. Chunk through
 * String.fromCharCode in 32KB blocks to stay safe for arbitrary file sizes.
 */
function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;  // 32KB
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
