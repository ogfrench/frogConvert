import type { FileData, FileFormat, FormatHandler, ProgressEvent, QualityPreset } from "../core/FormatHandler/FormatHandler.ts";
import { extractQualityPreset } from "../core/FormatHandler/FormatHandler.ts";

// Internal flag sentinels — stripped from args before forwarding to FFmpeg.
const NO_GIF_PALETTE = "--no-gif-palette";
const NO_STREAM_COPY = "--no-stream-copy";

/**
 * Map a quality preset to FFmpeg encoder flags for the output container.
 * Return is a flat arg array, already pre-filtered so nothing is appended
 * on lossless-capable containers where the preset doesn't make sense.
 */
function ffmpegQualityArgs(preset: QualityPreset, outputFormat: FileFormat): string[] {
  const mime = outputFormat.mime ?? "";
  // Video containers: CRF-based rate control. Lower = better quality.
  if (mime.startsWith("video/")) {
    // GIF / APNG don't honor CRF (palette-based); skip.
    if (outputFormat.format === "gif" || outputFormat.format === "apng") return [];
    const crf = preset === "low" ? "32" : preset === "high" ? "18" : preset === "lossless" ? "0" : "23";
    return ["-crf", crf];
  }
  // Audio containers: bitrate target.
  if (mime.startsWith("audio/")) {
    // Lossless audio formats (FLAC/ALAC/WAV) don't take a bitrate.
    if (outputFormat.format === "flac" || outputFormat.format === "wav" || outputFormat.format === "alac") return [];
    if (preset === "lossless") return []; // Caller should have picked a lossless format; fall through to default.
    const bitrate = preset === "low" ? "96k" : preset === "high" ? "320k" : "192k";
    return ["-b:a", bitrate];
  }
  // Image containers: `-q:v` where lower qscale = higher quality.
  if (mime.startsWith("image/")) {
    // PNG / BMP / TIFF are already lossless — skip the flag.
    if (outputFormat.lossless) return [];
    const q = preset === "low" ? "8" : preset === "high" ? "2" : preset === "lossless" ? "1" : "4";
    return ["-q:v", q];
  }
  return [];
}

import { FFmpeg as FFmpegWASM } from "@ffmpeg/ffmpeg";
import type { LogEvent } from "@ffmpeg/ffmpeg";

import mime from "mime";
import normalizeMimeType from "../core/utils/normalizeMimeType.ts";
import CommonFormats from '../core/CommonFormats/CommonFormats.ts';

/** Parses `HH:MM:SS.ms` (or `HH:MM:SS`) into milliseconds. */
function parseFfmpegTimestamp(ts: string): number | null {
  const m = ts.match(/^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const sec = Number(m[3]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || !Number.isFinite(sec)) return null;
  return Math.round((h * 3600 + min * 60 + sec) * 1000);
}

/**
 * Extracts progress signals from a single FFmpeg log line.
 * - `Duration: HH:MM:SS.ms` appears once when the input is opened.
 * - `time=HH:MM:SS.ms` appears every ~0.5s during the run.
 */
function parseFfmpegProgress(line: string): { durationMs?: number; timeMs?: number } | null {
  // "Duration: 00:01:23.45, start: 0.000000, bitrate: ..."
  const dur = line.match(/Duration:\s*(\d+:\d{2}:\d{2}(?:\.\d+)?)/);
  if (dur) {
    const ms = parseFfmpegTimestamp(dur[1]);
    if (ms !== null) return { durationMs: ms };
  }
  // "frame=  123 fps=30 ... time=00:00:12.34 bitrate=..."
  const t = line.match(/\btime=(\d+:\d{2}:\d{2}(?:\.\d+)?)/);
  if (t) {
    const ms = parseFfmpegTimestamp(t[1]);
    if (ms !== null) return { timeMs: ms };
  }
  return null;
}

class NativeFFmpegAdapter {
  #logCallback: (log: { message: string }) => void = () => { };
  #tempDir: string = "";
  #ffmpegBinary: string = "ffmpeg";

  async load() {
    const fsName = "fs/promises";
    const pathName = "path";
    const osName = "os";
    const cpName = "child_process";

    const fs = await import(/* @vite-ignore */ fsName);
    const path = await import(/* @vite-ignore */ pathName);
    const os = await import(/* @vite-ignore */ osName);
    const { spawn } = await import(/* @vite-ignore */ cpName);

    this.#tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ffmpeg-node-"));

    const tryBinary = (bin: string) => new Promise<void>((resolve, reject) => {
      const p = spawn(bin, ["-version"]);
      p.on("close", (code: number) => code === 0 ? resolve() : reject());
      p.on("error", reject);
    });

    // Tier 1: native ffmpeg in system PATH
    try {
      await tryBinary("ffmpeg");
      this.#ffmpegBinary = "ffmpeg";
      return;
    } catch { /* fall through */ }

    // Tier 2: ffmpeg-static bundled binary
    try {
      const { default: staticPath } = await import(/* @vite-ignore */ 'ffmpeg-static') as { default: string };
      if (staticPath) {
        await tryBinary(staticPath);
        this.#ffmpegBinary = staticPath;
        console.warn("[FFmpeg] Native ffmpeg not found in PATH — using bundled ffmpeg-static. Some codecs (e.g. H.264, AAC) may be unavailable. Install ffmpeg for full support: https://ffmpeg.org/download.html");
        return;
      }
    } catch { /* fall through */ }

    throw new Error("ffmpeg not available. Install ffmpeg: https://ffmpeg.org/download.html");
  }

  on(event: string, cb: any) {
    if (event === "log") this.#logCallback = cb;
  }

  off(event: string, cb: any) {
    if (event === "log" && this.#logCallback === cb) this.#logCallback = () => { };
  }

  async exec(args: string[], timeout: number = -1): Promise<void> {
    const cpName = "child_process";
    const { spawn } = await import(/* @vite-ignore */ cpName);
    return new Promise((resolve, reject) => {
      const p = spawn(this.#ffmpegBinary, args, { cwd: this.#tempDir });

      p.stdout.on("data", (data: any) => {
        const msg = data.toString();
        msg.split('\n').forEach((line: string) => {
          if (line) this.#logCallback({ message: line });
        });
      });
      p.stderr.on("data", (data: any) => {
        const msg = data.toString();
        msg.split('\n').forEach((line: string) => {
          if (line) this.#logCallback({ message: line });
        });
      });

      let to: any;
      if (timeout > 0) {
        to = setTimeout(() => {
          p.kill();
          reject("timeout");
        }, timeout);
      }

      p.on("close", (code: number | null) => {
        if (to) clearTimeout(to);
        // code is null when the process was killed by a signal (e.g. our own
        // timeout handler calling p.kill()). Treat that as already-rejected —
        // don't inject a second "Conversion failed!" or call reject() again.
        if (code !== null && code !== 0) {
          // Inject the "Conversion failed!" marker so the recovery-pattern
          // checks in FFmpegHandler.doConvert() work for native ffmpeg too.
          this.#logCallback({ message: "Conversion failed!" });
          reject(new Error(`ffmpeg exited with code ${code}`));
        } else if (code === 0) {
          resolve();
        }
      });
      p.on("error", (err: any) => {
        if (to) clearTimeout(to);
        reject(err);
      });
    });
  }

  async writeFile(name: string, data: Uint8Array) {
    const fsName = "fs/promises";
    const pathName = "path";
    const fs = await import(/* @vite-ignore */ fsName);
    const path = await import(/* @vite-ignore */ pathName);
    await fs.writeFile(path.join(this.#tempDir, name), data);
  }

  async readFile(name: string): Promise<Uint8Array> {
    const fsName = "fs/promises";
    const pathName = "path";
    const fs = await import(/* @vite-ignore */ fsName);
    const path = await import(/* @vite-ignore */ pathName);
    const data = await fs.readFile(path.join(this.#tempDir, name));
    return new Uint8Array(data);
  }

  async deleteFile(name: string) {
    const fsName = "fs/promises";
    const pathName = "path";
    const fs = await import(/* @vite-ignore */ fsName);
    const path = await import(/* @vite-ignore */ pathName);
    await fs.rm(path.join(this.#tempDir, name), { force: true }).catch(() => { });
  }

  async listDir(dirPath: string): Promise<{ name: string; isDir: boolean }[]> {
    const fsName = "fs/promises";
    const pathName = "path";
    const fs = await import(/* @vite-ignore */ fsName);
    const path = await import(/* @vite-ignore */ pathName);
    const fullPath = path.join(this.#tempDir, dirPath);
    const entries = await fs.readdir(fullPath, { withFileTypes: true });
    return entries.map((e: any) => ({ name: e.name, isDir: e.isDirectory() }));
  }

  terminate() {
    if (this.#tempDir) {
      const fsName = "fs/promises";
      import(/* @vite-ignore */ fsName).then(fs =>
        fs.rm(this.#tempDir, { recursive: true, force: true }).catch(() => { })
      );
    }
  }
}

class FFmpegHandler implements FormatHandler {

  public name: string = "FFmpeg";
  public supportedFormats: FileFormat[] = [];
  public ready: boolean = false;

  #ffmpeg?: any; // NativeFFmpegAdapter | FFmpegWASM

  #stdout: string = "";
  clearStdout() {
    this.#stdout = "";
  }
  private removeFormat(predicate: (f: FileFormat) => boolean): void {
    const idx = this.supportedFormats.findIndex(predicate);
    if (idx !== -1) this.supportedFormats.splice(idx, 1);
  }
  async getStdout(callback: () => void | Promise<void>, tap?: (line: string) => void) {
    if (!this.#ffmpeg) return "";
    this.clearStdout();
    // Single handler that both accumulates the log and optionally feeds a tap —
    // the NativeFFmpegAdapter supports only one listener, so we fan out here.
    const handler = (log: LogEvent | { message: string }) => {
      this.#stdout += log.message + "\n";
      if (tap) tap(log.message);
    };
    this.#ffmpeg.on("log", handler);
    try {
      await callback();
    } finally {
      this.#ffmpeg.off("log", handler);
    }
    return this.#stdout;
  }

  async loadFFmpeg() {
    if (!this.#ffmpeg) return;

    if (this.#ffmpeg instanceof FFmpegWASM) {
      const isNodeOrBun = typeof process !== 'undefined' && process.versions && (process.versions.node || process.versions.bun);
      const coreURL = isNodeOrBun
        ? new URL('../../node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js', import.meta.url).href
        : "/wasm/ffmpeg-core.js";
      await this.#ffmpeg.load({ coreURL });
    } else {
      await this.#ffmpeg.load();
    }
  }
  terminateFFmpeg() {
    if (!this.#ffmpeg) return;
    this.#ffmpeg.terminate();
  }
  async reloadFFmpeg() {
    if (!this.#ffmpeg) return;
    this.terminateFFmpeg();
    await this.loadFFmpeg();
  }
  /**
   * FFmpeg tends to run out of memory (?) with an "index out of bounds"
   * message sometimes. Other times it just stalls, irrespective of any timeout.
   *
   * This wrapper restarts FFmpeg when it crashes with that OOB error, and
   * forces a Promise-level timeout as a fallback for when it stalls.
   * @param args CLI arguments, same as in `FFmpeg.exec()`.
   * @param timeout Max execution time in milliseconds. `-1` for no timeout (default).
   * @param attempts Amount of times to attempt execution. Default is 1.
   */
  async execSafe(args: string[], timeout: number = -1, attempts: number = 1): Promise<void> {
    if (!this.#ffmpeg) throw new Error("Handler not initialized.");
    try {
      if (timeout === -1) {
        await this.#ffmpeg.exec(args);
      } else {
        let raceTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            this.#ffmpeg.exec(args, timeout),
            new Promise((_, reject) => { raceTimer = setTimeout(reject, timeout); })
          ]);
        } finally {
          if (raceTimer !== undefined) clearTimeout(raceTimer);
        }
      }
    } catch (e) {
      // Retry on:
      //   - falsy rejection (the Promise.race timeout above rejects with undefined)
      //   - any error whose stringified form mentions "out of bounds" — this is
      //     the WASM OOM signature, and it can arrive as either a raw string
      //     (older WASM builds) or an Error (the native adapter, future builds).
      if (attempts > 1 && (!e || String((e as { message?: string })?.message ?? e).includes("out of bounds"))) {
        await this.reloadFFmpeg();
        return await this.execSafe(args, timeout, attempts - 1);
      }
      console.error(e);
      throw e;
    }
  }

  async init() {
    const isNodeOrBun = typeof process !== 'undefined' && process.versions && (process.versions.node || process.versions.bun);

    if (isNodeOrBun) {
      const native = new NativeFFmpegAdapter();
      try {
        await native.load();
        this.#ffmpeg = native;
      } catch {
        // Native ffmpeg binary not found in PATH; fall back to @ffmpeg/ffmpeg WASM
        this.#ffmpeg = new FFmpegWASM();
        await this.loadFFmpeg();
      }
    } else {
      this.#ffmpeg = new FFmpegWASM();
      await this.loadFFmpeg();
    }

    const getMuxerDetails = async (muxer: string) => {

      const stdout = await this.getStdout(async () => {
        await this.execSafe(["-hide_banner", "-h", "muxer=" + muxer], 3000, 5);
      });

      return {
        extension: stdout.split("Common extensions: ")[1].split(".")[0].split(",")[0],
        mimeType: stdout.split("Mime type: ")[1].split("\n")[0].split(".").slice(0, -1).join(".")
      };
    }

    const stdout = await this.getStdout(async () => {
      await this.execSafe(["-formats", "-hide_banner"], 3000, 5);
    });
    const blocks = stdout.split(" --\n");
    const lines = blocks.length > 1 ? blocks[1].split("\n") : stdout.split("\n").filter(l => l.startsWith(" "));

    for (let line of lines) {

      let len;
      do {
        len = line.length;
        line = line.replaceAll("  ", " ");
      } while (len !== line.length);
      line = line.trim();

      const parts = line.split(" ");
      if (parts.length < 2) continue;

      const flags = parts[0];
      const description = parts.slice(2).join(" ");
      const formats = parts[1].split(",");

      if (description.startsWith("piped ")) continue;
      if (description.toLowerCase().includes("subtitle")) continue;
      if (description.toLowerCase().includes("manifest")) continue;

      for (const format of formats) {

        let primaryFormat = formats[0];
        if (primaryFormat === "png") primaryFormat = "apng";

        let extension, mimeType;
        try {
          const details = await getMuxerDetails(primaryFormat);
          extension = details.extension;
          mimeType = details.mimeType;
        } catch (e) {
          extension = format;
          mimeType = mime.getType(format) || ("video/" + format);
        }
        mimeType = normalizeMimeType(mimeType);

        let category = mimeType.split("/")[0];
        if (
          description.includes("PCM")
          || description.includes("PWM")
          || primaryFormat === "aptx"
          || primaryFormat === "aptx_hd"
          || primaryFormat === "codec2"
          || primaryFormat === "codec2raw"
          || primaryFormat === "apm"
          || primaryFormat === "alp"
        ) {
          category = "audio";
          mimeType = "audio/" + mimeType.split("/")[1];
        } else if (
          category !== "audio"
          && category !== "video"
          && category !== "image"
        ) {
          if (description.toLowerCase().includes("audio")) category = "audio";
          else category = "video";
        }

        this.supportedFormats.push({
          name: description + (formats.length > 1 ? (" / " + format) : ""),
          format,
          extension,
          mime: mimeType,
          from: flags.includes("D"),
          to: flags.includes("E"),
          internal: format,
          category,
          lossless: ["png", "bmp", "tiff"].includes(format)
        });

      }

    }

    // ====== Manual fine-tuning ======

    const prioritize = ["webm", "mp4", "gif", "wav"];
    prioritize.reverse();

    this.supportedFormats.sort((a, b) => {
      const priorityIndexA = prioritize.indexOf(a.format);
      const priorityIndexB = prioritize.indexOf(b.format);
      return priorityIndexB - priorityIndexA;
    });

    // AV1 doesn't seem to be included in WASM FFmpeg
    this.removeFormat(c => c.mime === "image/avif");
    // HEVC stalls when attempted
    this.removeFormat(c => c.internal === "hevc");
    // RTSP stalls when attempted
    this.removeFormat(c => c.internal === "rtsp");

    // Add .qta (QuickTime Audio) support - uses same mov demuxer
    this.supportedFormats.push({
      name: "QuickTime Audio",
      format: "qta",
      extension: "qta",
      mime: "video/quicktime",
      from: true,
      to: true,
      internal: "mov"
    });

    // Normalize Bink metadata to ensure ".bik" files are detected by extension.
    const binkFormats = this.supportedFormats.filter(f =>
      f.internal === "bink"
      || f.format === "bink"
      || f.extension === "bik"
    );
    if (binkFormats.length > 0) {
      for (const binkFormat of binkFormats) {
        binkFormat.name = "Bink Video";
        binkFormat.format = "bik";
        binkFormat.extension = "bik";
        binkFormat.mime = "video/x-bink";
        binkFormat.from = true;
        binkFormat.to = false;
        binkFormat.internal = "bink";
        binkFormat.category = "video";
      }
    }

    // Add PNG input explicitly - FFmpeg otherwise treats both PNG and
    // APNG as the same thing.
    this.supportedFormats.push(CommonFormats.PNG.builder("png").allowFrom());

    this.#ffmpeg.terminate();

    this.ready = true;
  }

  async doConvert(
    inputFiles: FileData[],
    inputFormat: FileFormat,
    outputFormat: FileFormat,
    args?: string[],
    onProgress?: (p: ProgressEvent) => void
  ): Promise<FileData[]> {

    if (!this.#ffmpeg) {
      throw new Error("Handler not initialized.");
    }

    // Reset the progress bar at the start of every run. Internal recovery
    // retries (e.g. dimension padding, sample-rate coercion) recurse into
    // doConvert and would otherwise continue from the previous attempt's
    // partial fill, causing the bar to jump backwards mid-file.
    if (onProgress) onProgress({ ratio: 0 });

    // Defense in depth: extensions are interpolated into both
    //   - the `file '...'` directive in list.txt (passed to the concat
    //     demuxer with `-safe 0`), and
    //   - the output filename pattern `frame_%05d.<ext>` (passed to FFmpeg
    //     in cwd=tempdir on the native backend).
    // Format metadata is parsed from FFmpeg's own `-formats` output and
    // from handler manifests; both are normally trusted but should not be
    // able to escape a quoted string OR cause a path traversal. Whitelist
    // alphanumerics, dot, hyphen, underscore — covers every legitimate file
    // extension and rejects `'`, newlines, `/`, `\`, `..`-only inputs, etc.
    const SAFE_EXT = /^[a-zA-Z0-9._-]{1,16}$/;
    const isSafeExt = (ext: string | undefined): boolean =>
      !!ext && SAFE_EXT.test(ext) && ext !== "." && ext !== "..";
    if (!isSafeExt(inputFormat.extension)) {
      throw new Error("Refusing to convert: input format extension is not a safe identifier.");
    }
    if (!isSafeExt(outputFormat.extension)) {
      throw new Error("Refusing to convert: output format extension is not a safe identifier.");
    }

    await this.reloadFFmpeg();

    let forceFPS = 0;
    if (inputFormat.mime === "image/png" || inputFormat.mime === "image/jpeg") {
      // If user passed -r N in args, respect their choice — otherwise fall back
      // to a heuristic that's honestly a coin flip but matches old behavior.
      const rIdx = args ? args.indexOf("-r") : -1;
      const userFPS = (args && rIdx >= 0 && rIdx + 1 < args.length) ? Number(args[rIdx + 1]) : NaN;
      forceFPS = Number.isFinite(userFPS) && userFPS > 0 ? userFPS : (inputFiles.length < 30 ? 1 : 30);
    }

    let fileIndex = 0;
    let listString = "";
    for (const file of inputFiles) {
      const entryName = `file_${fileIndex++}.${inputFormat.extension}`;
      await this.#ffmpeg.writeFile(entryName, new Uint8Array(file.bytes));
      listString += `file '${entryName}'\n`;
      if (forceFPS) listString += `duration ${1 / forceFPS}\n`;
    }
    await this.#ffmpeg.writeFile("list.txt", new TextEncoder().encode(listString));

    // Formats that can hold multiple frames / animation
    const animatedFormats = new Set(["gif", "webp", "apng"]);
    const inputIsMultiFrame = inputFormat.mime?.startsWith("video/")
      || animatedFormats.has(inputFormat.format);
    // Only extract frames when the output is a static image format —
    // animated-capable outputs (GIF, WebP, APNG) should stay as a single
    // animated file, not be split into individual frames.
    const outputIsStaticImage = outputFormat.mime?.startsWith("image/")
      && !animatedFormats.has(outputFormat.format);
    const extractFrames = inputIsMultiFrame && outputIsStaticImage;

    const outputFileName = extractFrames
      ? `frame_%05d.${outputFormat.extension}`
      : "output";

    // Stream-copy fast path: if input and output are both video containers
    // and the input codecs are already compatible with the output container,
    // remux instead of re-encoding. Saves 30–100x time on MOV→MP4 etc.
    // Narrow gating: single file only (concat with -c copy is fragile across
    // differing timebases), video-to-video only, no user encoder overrides.
    const userHasEncoderFlag = args ? (
      args.includes("-c") || args.includes("-c:v") || args.includes("-c:a")
      || args.includes("-vcodec") || args.includes("-acodec")
    ) : false;
    const REMUX_OK: Record<string, { v: string[]; a: string[] }> = {
      mp4:  { v: ["h264","hevc","av1","mpeg4"], a: ["aac","mp3","ac3"] },
      mkv:  { v: ["h264","hevc","av1","vp9","mpeg4"], a: ["aac","mp3","ac3","opus","flac","vorbis"] },
      webm: { v: ["vp8","vp9","av1"],               a: ["opus","vorbis"] },
      mov:  { v: ["h264","hevc","prores","mpeg4"],  a: ["aac","mp3","alac"] },
    };
    let useStreamCopy = false;
    if (
      !extractFrames
      && inputFiles.length === 1
      && inputFormat.mime?.startsWith("video/")
      && outputFormat.mime?.startsWith("video/")
      && !userHasEncoderFlag
      && !args?.includes(NO_STREAM_COPY)
      && REMUX_OK[outputFormat.format]
    ) {
      const probeStdout = await this.getStdout(async () => {
        try { await this.#ffmpeg.exec(["-hide_banner", "-i", `file_0.${inputFormat.extension}`]); }
        catch { /* -i alone always exits non-zero */ }
      });
      const videoCodec = probeStdout.match(/Stream #\d+:\d+.*?: Video: (\w+)/)?.[1];
      const audioCodec = probeStdout.match(/Stream #\d+:\d+.*?: Audio: (\w+)/)?.[1];
      const compat = REMUX_OK[outputFormat.format];
      if (
        videoCodec && compat.v.includes(videoCodec)
        && (!audioCodec || compat.a.includes(audioCodec))
      ) {
        useStreamCopy = true;
      }
    }

    let appliedDefaultFpsCap = false;
    const command = ["-hide_banner", "-f", "concat", "-safe", "0", "-i", "list.txt"];
    if (extractFrames) {
      command.push("-f", "image2");
      // For video→frames, default to 1 fps to avoid dumping 3600 PNGs from a
      // 60s/60fps clip. Animated images (gif/webp/apng) keep their natural
      // frame rate since they're typically short. User can override with -r.
      const userHasR = args ? args.includes("-r") : false;
      const inputIsVideo = inputFormat.mime?.startsWith("video/");
      if (inputIsVideo && !userHasR) {
        command.push("-r", "1");
        appliedDefaultFpsCap = true;
      }
    } else {
      command.push("-f", outputFormat.internal);
    }
    if (useStreamCopy) {
      command.push("-c", "copy");
    } else if (outputFormat.mime === "video/mp4") {
      command.push("-pix_fmt", "yuv420p");
    } else if (outputFormat.internal === "dvd") {
      command.push("-vf", "setsar=1", "-target", "ntsc-dvd", "-pix_fmt", "rgb24");
    } else if (outputFormat.internal === "vcd") {
      command.push("-vf", "scale=352:288,setsar=1", "-target", "pal-vcd", "-pix_fmt", "rgb24");
    } else if (outputFormat.format === "gif" && !extractFrames && !args?.includes(NO_GIF_PALETTE)) {
      // Two-pass palette: without this, default 256-color palette bands gradients heavily.
      command.push(
        "-filter_complex",
        "split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle"
      );
    }
    // Map the quality preset to encoder-specific flags (CRF, bitrate, qscale).
    // Stream-copy bypasses encoding entirely so quality flags are irrelevant.
    if (!useStreamCopy) {
      const preset = extractQualityPreset(args);
      if (preset) command.push(...ffmpegQualityArgs(preset, outputFormat));
    }
    // Forward remaining args but strip our custom `--quality <preset>` pair —
    // it's not a real FFmpeg flag.
    if (args) {
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "--quality" && i + 1 < args.length) { i++; continue; }
        if (args[i] === NO_GIF_PALETTE || args[i] === NO_STREAM_COPY) continue;
        command.push(args[i]);
      }
    }
    command.push(outputFileName);

    // Progress sources (two, both feed the same throttled emitter):
    //
    //   1. FFmpegWASM's native `progress` event — guaranteed to fire in the
    //      browser, gives us `{ progress, time }` directly. This is the
    //      primary source for the WASM path.
    //
    //   2. Log-stream tap parsing `Duration:` / `time=` — works for the
    //      native child-process adapter (which doesn't emit a progress event)
    //      and as a belt-and-braces backup for WASM.
    //
    // Both sources share one throttle (≥ 250 ms between emits) so duplicate
    // events on WASM don't flood postMessage.
    let durationMs: number | null = null;
    let lastEmit = 0;
    const emitRatio = onProgress
      ? (ratio: number) => {
        const now = Date.now();
        if (now - lastEmit < 250) return;
        lastEmit = now;
        onProgress({ ratio: Math.min(1, Math.max(0, ratio)) });
      }
      : undefined;

    const progressTap = emitRatio
      ? (line: string) => {
        const parsed = parseFfmpegProgress(line);
        if (!parsed) return;
        if (parsed.durationMs !== undefined && durationMs === null) {
          durationMs = parsed.durationMs;
          return;
        }
        if (parsed.timeMs !== undefined && durationMs && durationMs > 0) {
          emitRatio(parsed.timeMs / durationMs);
        }
      }
      : undefined;

    // Native progress event — only the WASM adapter exposes this. The native
    // child-process adapter's `on("progress", ...)` is not implemented and
    // would be a no-op if we called it, so we gate on an instanceof check.
    let wasmProgressListener: ((ev: { progress: number; time: number }) => void) | null = null;
    if (emitRatio && this.#ffmpeg instanceof FFmpegWASM) {
      wasmProgressListener = (ev) => {
        // ev.progress is 0..1 (sometimes > 1 briefly at the very end).
        if (typeof ev.progress === "number" && isFinite(ev.progress)) {
          emitRatio(ev.progress);
        }
      };
      this.#ffmpeg.on("progress", wasmProgressListener);
    }

    let stdout: string;
    try {
      stdout = await this.getStdout(async () => {
        await this.#ffmpeg!.exec(command);
      }, progressTap);
    } catch {
      // Native ffmpeg rejects on non-zero exit code; use whatever was
      // accumulated before the failure so recovery patterns can still fire.
      stdout = this.#stdout;
    } finally {
      if (wasmProgressListener && this.#ffmpeg instanceof FFmpegWASM) {
        this.#ffmpeg.off("progress", wasmProgressListener);
      }
    }

    for (let i = 0; i < fileIndex; i++) {
      const entryName = `file_${i}.${inputFormat.extension}`;
      await this.#ffmpeg.deleteFile(entryName);
    }

    if (stdout.includes("Conversion failed!\n")) {

      const oldArgs = args ? args : []
      let recoveryArgs: string[] | null = null;
      let recoveryWarning: string | null = null;

      if (stdout.includes(" not divisible by") && !oldArgs.includes("-vf")) {
        const division = stdout.split(" not divisible by ")[1].split(" ")[0];
        recoveryArgs = [...oldArgs, "-vf", `pad=ceil(iw/${division})*${division}:ceil(ih/${division})*${division}`];
        recoveryWarning = `Output dimensions padded to a multiple of ${division} - black borders added to satisfy codec constraints.`;
      } else if (stdout.includes("width and height must be a multiple of") && !oldArgs.includes("-vf")) {
        const division = stdout.split("width and height must be a multiple of ")[1].split(" ")[0];
        recoveryArgs = [...oldArgs, "-vf", `pad=ceil(iw/${division})*${division}:ceil(ih/${division})*${division}`];
        recoveryWarning = `Output dimensions padded to a multiple of ${division} - black borders added to satisfy codec constraints.`;
      } else if (stdout.includes("Valid sizes are") && !oldArgs.includes("-s")) {
        const newSize = stdout.split("Valid sizes are ")[1].split(".")[0].split(" ").pop();
        if (typeof newSize !== "string") {
          throw new Error("FFmpeg conversion failed (could not parse valid sizes from output).", { cause: stdout });
        }
        recoveryArgs = [...oldArgs, "-s", newSize];
        recoveryWarning = `Output resized to ${newSize} - codec rejected the original dimensions.`;
      } else if (stdout.includes("does not support that sample rate, choose from (") && !oldArgs.includes("-ar")) {
        const acceptedBitrate = stdout.split("does not support that sample rate, choose from (")[1].split(", ")[0];
        recoveryArgs = [...oldArgs, "-ar", acceptedBitrate];
        recoveryWarning = `Audio sample rate changed to ${acceptedBitrate} Hz - encoder rejected the original.`;
      } else if (outputFormat.format === "gif" && !oldArgs.includes(NO_GIF_PALETTE) && stdout.includes("Aborted()")) {
        recoveryArgs = [...oldArgs, NO_GIF_PALETTE];
        recoveryWarning = "GIF palette generation skipped — video too large for high-quality dithering in-browser.";
      } else if (useStreamCopy && !oldArgs.includes(NO_STREAM_COPY)) {
        recoveryArgs = [...oldArgs, NO_STREAM_COPY];
        recoveryWarning = "Re-encoded instead of remuxing — codec wasn't fully compatible with the output container.";
      }

      if (recoveryArgs && recoveryWarning) {
        const result = await this.doConvert(inputFiles, inputFormat, outputFormat, recoveryArgs, onProgress);
        return result.map(f => ({ ...f, warnings: [...(f.warnings ?? []), recoveryWarning!] }));
      }

      // Extract the most relevant FFmpeg error line for the user-facing
      // message; keep the full stdout in `cause` for debugging.
      const failureLine = stdout
        .split("\n")
        .reverse()
        .find(l => l && !l.startsWith("frame=") && !l.includes("Conversion failed!"))
        ?.trim() ?? "Unknown FFmpeg error";
      throw new Error(`FFmpeg conversion failed: ${failureLine}`, { cause: stdout });
    }

    const baseName = inputFiles[0].name.replace(/\.[^.]+$/, '');

    if (extractFrames) {
      // Read all extracted frame files
      const dirEntries: { name: string; isDir: boolean }[] = await this.#ffmpeg.listDir(".");
      const frameFiles = dirEntries
        .filter((e: { name: string; isDir: boolean }) => !e.isDir && e.name.startsWith("frame_"))
        .map((e: { name: string; isDir: boolean }) => e.name)
        .sort();

      if (frameFiles.length === 0) {
        throw new Error("FFmpeg failed to extract any frames");
      }

      const results: FileData[] = [];
      for (let i = 0; i < frameFiles.length; i++) {
        const frameData = await this.#ffmpeg.readFile(frameFiles[i]);
        let frameBytes: Uint8Array;
        if (!(frameData instanceof Uint8Array)) {
          frameBytes = new TextEncoder().encode(frameData);
        } else {
          frameBytes = new Uint8Array(frameData.buffer, frameData.byteOffset, frameData.byteLength);
        }
        results.push({
          bytes: frameBytes,
          name: `${baseName}_frame_${i + 1}.${outputFormat.extension}`,
        });
        await this.#ffmpeg.deleteFile(frameFiles[i]);
      }

      await this.#ffmpeg.deleteFile("list.txt");
      if (appliedDefaultFpsCap) {
        const warn = "Extracted 1 frame per second (default). Pass -r N for a different rate.";
        for (const f of results) (f.warnings ??= []).push(warn);
      }
      return results;
    }

    let bytes: Uint8Array;

    // Validate that output file exists before attempting to read
    let fileData;
    try {
      fileData = await this.#ffmpeg.readFile("output");
    } catch (e) {
      throw new Error("Output file not created", { cause: e });
    }

    if (!fileData || (fileData instanceof Uint8Array && fileData.length === 0)) {
      throw new Error("FFmpeg failed to produce output file");
    }
    if (!(fileData instanceof Uint8Array)) {
      const encoder = new TextEncoder();
      bytes = encoder.encode(fileData);
    } else {
      bytes = new Uint8Array(fileData.buffer, fileData.byteOffset, fileData.byteLength);
    }

    await this.#ffmpeg.deleteFile("output");
    await this.#ffmpeg.deleteFile("list.txt");

    const name = baseName + "." + outputFormat.extension;

    return [{ bytes, name }];

  }

}

export default FFmpegHandler;
