<!-- docs-frontmatter
icon: 🗜️
label: Compress
desc: Make images, audio, video and PDFs smaller without uploading them
-->

# Compress

frogConvert has three modes: the **Converter**, the **PDF Editor**, and **Compress**. Compress is the "make this file smaller without changing what it is" surface — same format in, same format out. It's frogConvert-original, not part of the [Convert to it!](https://github.com/p2r3/convert) fork.

Everything runs locally. Files are never uploaded.

## Switching to Compress

The top bar's mode control (the icon showing the current mode) opens a menu with **Converter**, **PDF Editor** and **Compress**. Picking Compress moves the URL to `/compress`, so it can be bookmarked or shared directly.

## What it compresses

| Family | Engine | Typical result |
|---|---|---|
| Images (PNG, JPEG, WebP, TIFF, BMP) | ImageMagick | 40–70% on photos |
| Animated (GIF, APNG) | FFmpeg | Varies with frame count |
| Video | FFmpeg (re-encode forced) | Large, driven by source bitrate |
| Audio | FFmpeg | Driven by source bitrate |
| PDF | Ghostscript | 0% on text, 30–80% on image-heavy |

Anything else is refused at the drop zone rather than accepted and silently passed through.

## Levels

One control, four choices. The vocabulary is quality-forward — it names what the output looks like, not how hard the squeeze is:

| Level | Meaning |
|---|---|
| **Automatic** (default) | Reads each file and picks its own level. Won't re-crush what's already small. |
| **High quality** | Modest savings. |
| **Balanced** | Recommended. Big savings, quality you won't miss. |
| **Smallest file** | Visible quality loss. |

There is deliberately **no "lossless" level here**. As a compression level it can only mean "do nothing": it targets quality 100 with no resize, so re-encoding an already-compressed file comes back *larger* and the keep-threshold discards it. The level would reliably accomplish nothing, so it isn't offered. (The Converter's own setting does include **Original quality**, because "convert this without shrinking it" is a real request.)

### How Automatic works

Automatic doesn't apply a fixed tier. For each file it probes cheap metadata — bytes per megapixel for images, bytes per page for PDFs, container bitrate for audio/video — classifies the input into a quality band, then steps down one band. A file already at the bottom band is skipped and reported as *already squished* rather than re-crushed.

This is why two files dropped together can come out at different levels, and why Automatic is the default: it's the right answer when the user has no opinion.

## Reading the results

Each row shows the outcome for one file. The wording is deliberate:

- **−36%** — it shrank, and the smaller file is what you download.
- **no gain** — the re-encode came back within 2% of the original, so the **original** is kept. Nothing was degraded for a rounding error.
- **already squished** — the probe found it at minimum useful quality; it was never re-encoded.
- **can't squish this** — no compressor for that format; the file passes through untouched.
- **failed** — the engine errored. The original is kept.

A batch reports the total saved across only the files that actually shrank.

## PDF compression, honestly

PDFs use Ghostscript's `pdfwrite` device, mapped from the level:

| Level | Ghostscript preset | Image target |
|---|---|---|
| Smallest file | `/screen` | 72 dpi |
| Balanced | `/ebook` | 150 dpi |
| High quality | `/printer` | 300 dpi |

**These presets only bound image resampling.** Text stays text and vectors stay vectors — which is the point, but it also means:

- A **scanned** PDF (mostly embedded raster) can drop 70–85%.
- A **text** PDF is fonts and vector glyphs. There is almost nothing to resample, so it will report *no gain*. That is the feature working correctly, not failing.

This is also why Compress does not use the rasterising route that the Converter's PDF→image path uses. Rendering pages to bitmaps would "shrink" a text PDF only by destroying the text layer, selectable text, and searchability. Measured on a vector-only PDF: the rasterising approach saves 0%, Ghostscript saves 36%.

The Ghostscript engine is ~16 MB of WebAssembly. It is fetched **on first PDF compression only**, never at page load, with download progress shown. After that the browser caches it.

## Compression when converting

Compress is not the only place compression happens. Every conversion has always applied some — a 400 MB output nobody asked for is its own bug — but it used to be invisible. It is now an explicit setting.

The **Compression** setting in the settings menu follows the active mode:

- In **Converter** it controls the quality of converted output, and includes **Original quality** (no compression).
- In **Compress** it is the same setting as the card's own **Compress by** picker — two views of one value, kept in sync.
- In the **PDF Editor** it is hidden. Merging, organizing and watermarking have no compression step, so there is no knob to offer.

The two settings are **independent and separately persisted**. "How much quality to give up while changing format" and "how hard to squeeze" are different questions, and sharing one value meant changing it in one place silently moved the other.

For multi-hop conversions (e.g. HEIC → PNG → WebP), the chosen level applies to the **final** hop only; intermediates run at high quality so quality loss isn't compounded once per step. That rule lives in one place (`qualityForHop`) and is shared by the browser, MCP, REST and CLI surfaces.

## Limits

- Batch ceiling and total-size budget are shared with the rest of the app.
- The whole batch is held in memory; very large video batches are the practical limit.
- Cancellation takes effect **between files**, not mid-file — a single long video keeps going until that file finishes.
- PDF compression is **browser-only**. The Ghostscript package ships as WebAssembly with a browser loader, so the MCP/REST/CLI surfaces do not yet compress PDFs; they would need a native `gs` binary.

## Architecture

The engine is deliberately separate from the surface, so the Convert card, the Compress workspace and the agent surfaces all route through the same logic:

| Module | Job |
|---|---|
| `core/compression/resolveCompressor.ts` | Format → which engine + args. Whitelist-based; SVG/PSD/raw stay in pass-through. |
| `core/compression/compressBatch.ts` | Mixed-batch orchestrator. Groups by format so each engine initialises once, preserves input order, applies the keep-threshold. |
| `core/compression/plan.ts` | Tiered planner: preset + input size → concrete knobs (CRF, bitrate, max edge, quality). |
| `core/compression/inputQuality.ts` | Cheap metadata probe used by Automatic. |
| `core/compression/tierDown.ts` | Input band → the band to target. |
| `core/compression/pdfSettings.ts` | Level → Ghostscript `-dPDFSETTINGS`. |
| `core/compression/hopQuality.ts` | The one multi-hop rule, shared by all four surfaces. |
| `handlers/ghostscript.ts` | The PDF engine. |
| `components/CompressWorkspace/` | The UI. |

`core/` never imports `components/` — `resolveCompressor` takes the loaded handler list as a parameter rather than reading the UI store, which is what lets the headless surfaces reuse it.

## Licensing note

Ghostscript is AGPL-3.0. frogConvert is GPL-3.0-or-later, and GPLv3 §13 explicitly permits combining with AGPLv3 code: the combined work is conveyed under the GPL while the Ghostscript component keeps its own §13 network-use obligation. See the README's licensing section for the full reasoning.
