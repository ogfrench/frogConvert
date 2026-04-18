export type InputTier = "uncompressed" | "hq" | "medium" | "low" | "minimal";

export type InputQualityProbe = {
  inputTier: InputTier;
  detail: Record<string, number | string>;
};

const UNKNOWN: InputQualityProbe = { inputTier: "medium", detail: {} };

// Probing cheap metadata costs more than the win for tiny files — below this
// size the hardcoded default is good enough, skip the probe.
const SKIP_PROBE_BYTES = 1_000_000;

// Bytes-per-megapixel bands for compressed raster (JPEG/WebP/AVIF).
// Reference points (approximate, measured on typical captures):
//   - DSLR JPEG q=95, low-noise scene:  ~600 kB/MP  → hq
//   - iPhone HEIC→JPEG default:         ~300 kB/MP  → medium
//   - Web-optimised JPEG q=75:          ~150 kB/MP  → low
//   - Aggressively re-encoded thumb:     ~50 kB/MP  → minimal
// Bands are a proxy for *compression density*, not perceived quality — a
// clean source can read low bpp at high visual quality, and vice versa.
const LOSSY_IMG_BPP = { hq: 500_000, medium: 200_000, low: 80_000 };

// Bytes-per-megapixel for lossless rasters (PNG/BMP/TIFF). "Quality" here
// means dimension/palette/filter-optimisation headroom, not lossy headroom.
//   - Uncompressed 24-bit PNG:  ~3 MB/MP   → uncompressed
//   - Photoshop default PNG:    ~1 MB/MP   → hq
//   - pngcrush-optimised PNG:   ~200 kB/MP → medium
const LOSSLESS_IMG_BPP = { uncompressed: 2_000_000, hq: 500_000 };

// Bytes-per-page for PDF. Text-heavy vs image-heavy vs scanned dominate.
//   - Scanned PDF at 600 DPI with uncompressed images: ~8 MB/page → uncompressed
//   - 300-DPI JPEG-embedded scan:                     ~2 MB/page → hq
//   - Mixed text + 150-DPI figures:                  ~700 kB/page → medium
//   - Optimised eBook / technical spec:              ~200 kB/page → low
//   - Pure-text whitepaper with embedded fonts:       ~30 kB/page → minimal
const PDF_BPP = { uncompressed: 5_000_000, hq: 1_500_000, medium: 500_000, low: 150_000 };

// Total container kbps for video.
//   - Blu-ray / ProRes / broadcast source:    > 25 Mbps → uncompressed
//   - 4K streaming master / HQ H.264:         ~6-10 Mbps → hq
//   - 1080p streaming / typical YouTube HD:   ~2-4 Mbps → medium
//   - 720p mobile upload:                     ~0.8-1.5 Mbps → low
//   - Heavily re-encoded clip:                  < 600 kbps → minimal
const VIDEO_KBPS = { uncompressed: 10_000, hq: 4_000, medium: 1_500, low: 600 };

// Container kbps for audio. ~900+ signals lossless (FLAC/WAV/ALAC).
//   - 16-bit 44.1kHz stereo PCM (WAV):  ~1400 kbps → uncompressed
//   - 320 kbps MP3 / AAC HQ master:     ~320 kbps → hq
//   - 192 kbps streaming default:       ~192 kbps → medium
//   - 128 kbps podcast / voice MP3:     ~128 kbps → low
//   - Heavily compressed voicemail:     < 96 kbps → minimal
const AUDIO_KBPS = { uncompressed: 900, hq: 256, medium: 160, low: 96 };

// Raw byte-size fallback when no archetype probe matched. Used for unknown
// mime types only — the archetype probes are preferred when they succeed.
const SIZE_FALLBACK = { uncompressed: 100_000_000, hq: 10_000_000, medium: 1_000_000 };

// Base metadata-load deadline. The Blob is a zero-copy view, but some
// containers (non-faststart MP4, heavily fragmented WebM) need longer to
// locate the moov/seghead. Scale by file size instead of guessing.
const MEDIA_METADATA_TIMEOUT_BASE_MS = 5000;
const MEDIA_METADATA_TIMEOUT_PER_500MB_MS = 1000;
const MEDIA_METADATA_TIMEOUT_MAX_MS = 30_000;

function metadataTimeoutMs(size: number): number {
  const bonus = Math.floor(size / 500_000_000) * MEDIA_METADATA_TIMEOUT_PER_500MB_MS;
  return Math.min(MEDIA_METADATA_TIMEOUT_MAX_MS, MEDIA_METADATA_TIMEOUT_BASE_MS + bonus);
}

function asUint8(b: ArrayBuffer | Uint8Array): Uint8Array {
  return b instanceof Uint8Array ? b : new Uint8Array(b);
}

// PNG: 8-byte signature, then IHDR chunk at offset 8 carrying width/height
// as big-endian u32s at bytes 16 and 20. Returns null if the signature or
// chunk marker doesn't match.
function readPngDim(u8: Uint8Array): { width: number; height: number } | null {
  if (u8.length < 24) return null;
  if (u8[0] !== 0x89 || u8[1] !== 0x50 || u8[2] !== 0x4E || u8[3] !== 0x47) return null;
  if (u8[12] !== 0x49 || u8[13] !== 0x48 || u8[14] !== 0x44 || u8[15] !== 0x52) return null;
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
}

// JPEG: skip past SOI (FFD8), walk the marker segments until we hit an SOFn
// (FFC0–FFCF, excluding the DHT=C4, DAC=CC, and JPG=C8 reserved markers).
// SOFn payload: precision(1), height u16 BE, width u16 BE.
function readJpegDim(u8: Uint8Array): { width: number; height: number } | null {
  if (u8.length < 4 || u8[0] !== 0xFF || u8[1] !== 0xD8) return null;
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let i = 2;
  while (i + 3 < u8.length) {
    if (u8[i] !== 0xFF) return null;
    let marker = u8[i + 1];
    while (marker === 0xFF && i + 2 < u8.length) { i++; marker = u8[i + 1]; }
    i += 2;
    if (marker === 0xD8 || marker === 0xD9) return null;
    if (marker >= 0xD0 && marker <= 0xD7) continue;
    if (i + 1 >= u8.length) return null;
    const segLen = view.getUint16(i, false);
    const isSof = (marker >= 0xC0 && marker <= 0xCF)
      && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC;
    if (isSof) {
      if (i + 7 > u8.length) return null;
      return { width: view.getUint16(i + 5, false), height: view.getUint16(i + 3, false) };
    }
    if (i + segLen > u8.length) return null;
    i += segLen;
  }
  return null;
}

function headerDim(u8: Uint8Array, mime: string): { width: number; height: number } | null {
  if (mime === "image/png") return readPngDim(u8);
  if (mime === "image/jpeg" || mime === "image/jpg") return readJpegDim(u8);
  return null;
}

async function decodeDim(u8: Uint8Array, mime: string): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap === "undefined" || typeof Blob === "undefined") return null;
  try {
    const bitmap = await createImageBitmap(new Blob([u8 as BlobPart], { type: mime }));
    const dim = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    return dim;
  } catch {
    return null;
  }
}

export async function probeImage(bytes: ArrayBuffer | Uint8Array, mime: string): Promise<InputQualityProbe> {
  const u8 = asUint8(bytes);
  const dim = headerDim(u8, mime) ?? await decodeDim(u8, mime);
  if (!dim) return UNKNOWN;
  const mp = (dim.width * dim.height) / 1_000_000;
  if (mp <= 0) return UNKNOWN;
  const bpp = u8.byteLength / mp;
  const isLossless = mime === "image/png" || mime === "image/bmp" || mime === "image/tiff";
  if (isLossless) {
    if (bpp > LOSSLESS_IMG_BPP.uncompressed) return { inputTier: "uncompressed", detail: { mp, bpp } };
    if (bpp > LOSSLESS_IMG_BPP.hq) return { inputTier: "hq", detail: { mp, bpp } };
    return { inputTier: "medium", detail: { mp, bpp } };
  }
  if (bpp > LOSSY_IMG_BPP.hq) return { inputTier: "hq", detail: { mp, bpp } };
  if (bpp > LOSSY_IMG_BPP.medium) return { inputTier: "medium", detail: { mp, bpp } };
  if (bpp > LOSSY_IMG_BPP.low) return { inputTier: "low", detail: { mp, bpp } };
  return { inputTier: "minimal", detail: { mp, bpp } };
}

// Cache the in-flight import so concurrent probes share one load.
let _pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;
function loadPdfjs() {
  if (!_pdfjsPromise) _pdfjsPromise = import(/* @vite-ignore */ "pdfjs-dist");
  return _pdfjsPromise;
}

// Scan the last ~32KB of the PDF for /Count <n> entries. A multi-level pages
// tree has one /Count per node; the root /Count equals the sum of its
// children, so the max value across all matches is the page total. Returns
// null when no /Count is found (uncommon — usually means the trailer is
// further back or the file is malformed). Faster than booting pdfjs.
const PDF_TRAILER_SCAN_BYTES = 32_768;

function readPdfPageCountFromTrailer(u8: Uint8Array): number | null {
  const tailSize = Math.min(u8.length, PDF_TRAILER_SCAN_BYTES);
  const tail = u8.subarray(u8.length - tailSize);
  const text = new TextDecoder("latin1").decode(tail);
  let max = 0;
  let seen = 0;
  // Root /Count is always among the first few in a pages tree; bail early
  // to keep pathological many-subtree PDFs from scanning every match.
  for (const m of text.matchAll(/\/Count\s+(\d+)/g)) {
    const n = parseInt(m[1], 10);
    if (n > max) max = n;
    if (++seen >= 5) break;
  }
  return max > 0 ? max : null;
}

async function readPdfPageCountViaPdfjs(u8: Uint8Array): Promise<number | null> {
  try {
    const pdfjs = await loadPdfjs();
    const doc = await pdfjs.getDocument({ data: u8, disableFontFace: true, isEvalSupported: false }).promise;
    const pages = doc.numPages;
    await doc.destroy?.();
    return pages > 0 ? pages : null;
  } catch {
    return null;
  }
}

export async function probePdf(bytes: ArrayBuffer | Uint8Array): Promise<InputQualityProbe> {
  const u8 = asUint8(bytes);
  const pages = readPdfPageCountFromTrailer(u8) ?? await readPdfPageCountViaPdfjs(u8);
  if (!pages) return UNKNOWN;
  const bpp = u8.byteLength / pages;
  if (bpp > PDF_BPP.uncompressed) return { inputTier: "uncompressed", detail: { pages, bpp } };
  if (bpp > PDF_BPP.hq) return { inputTier: "hq", detail: { pages, bpp } };
  if (bpp > PDF_BPP.medium) return { inputTier: "medium", detail: { pages, bpp } };
  if (bpp > PDF_BPP.low) return { inputTier: "low", detail: { pages, bpp } };
  return { inputTier: "minimal", detail: { pages, bpp } };
}

export async function probeAudioVideo(bytes: ArrayBuffer | Uint8Array, mime: string): Promise<InputQualityProbe> {
  if (typeof document === "undefined" || typeof URL === "undefined" || typeof Blob === "undefined") return UNKNOWN;
  const isVideo = mime.startsWith("video/");
  const u8 = asUint8(bytes);
  const blob = new Blob([u8 as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const el = document.createElement(isVideo ? "video" : "audio") as HTMLMediaElement;
  let to: ReturnType<typeof setTimeout> | undefined;
  try {
    const duration = await new Promise<number>((resolve, reject) => {
      to = setTimeout(() => reject(new Error("probe timeout")), metadataTimeoutMs(u8.byteLength));
      el.preload = "metadata";
      el.onloadedmetadata = () => { clearTimeout(to); resolve(el.duration); };
      el.onerror = () => { clearTimeout(to); reject(new Error("metadata load failed")); };
      el.src = url;
    });
    if (!isFinite(duration) || duration <= 0) return UNKNOWN;
    const kbps = (u8.byteLength * 8) / duration / 1000;
    const bands = isVideo ? VIDEO_KBPS : AUDIO_KBPS;
    if (kbps > bands.uncompressed) return { inputTier: "uncompressed", detail: { duration, kbps } };
    if (kbps > bands.hq) return { inputTier: "hq", detail: { duration, kbps } };
    if (kbps > bands.medium) return { inputTier: "medium", detail: { duration, kbps } };
    if (kbps > bands.low) return { inputTier: "low", detail: { duration, kbps } };
    return { inputTier: "minimal", detail: { duration, kbps } };
  } catch {
    return UNKNOWN;
  } finally {
    if (to) clearTimeout(to);
    el.onloadedmetadata = null;
    el.onerror = null;
    // Drop src so the decoder releases its buffer before we revoke the URL.
    el.removeAttribute("src");
    URL.revokeObjectURL(url);
  }
}

export async function probeInputQuality(bytes: ArrayBuffer | Uint8Array, mime: string): Promise<InputQualityProbe> {
  if (!mime) return UNKNOWN;
  const size = bytes.byteLength;
  if (size < SKIP_PROBE_BYTES) return UNKNOWN;
  if (mime.startsWith("image/")) return probeImage(bytes, mime);
  if (mime === "application/pdf") return probePdf(bytes);
  if (mime.startsWith("audio/") || mime.startsWith("video/")) return probeAudioVideo(bytes, mime);
  if (size > SIZE_FALLBACK.uncompressed) return { inputTier: "uncompressed", detail: { size } };
  if (size > SIZE_FALLBACK.hq) return { inputTier: "hq", detail: { size } };
  if (size > SIZE_FALLBACK.medium) return { inputTier: "medium", detail: { size } };
  return { inputTier: "low", detail: { size } };
}
