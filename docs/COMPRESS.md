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
| PDF | Ghostscript (canvas fallback if unreachable) | 0% on text, 30–80% on image-heavy |

Documents, archives and plain text are refused at the drop zone with a toast, as is SVG — it's vector text, and the only thing a raster compressor could do to it is rasterise it.

The drop-zone filter is deliberately *not* the final word. It can only look at the MIME type, and the authoritative "is there a compressor for this?" answer needs the handler registry, which loads later. So a few image types that pass the filter (HEIC and AVIF, for instance) turn out to have no same-format compressor and come back marked *can't squish this*. Erring this way is on purpose: over-rejecting at the door would turn away files that can in fact be compressed, and a truthful per-file result costs the user nothing but a moment.

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
- **stopped** — you pressed Stop before this file's turn. It was never opened.
- **failed** — the engine errored. The original is kept.

A batch reports the total saved across only the files that actually shrank. When that saving is real but rounds to zero against the batch total — a win on one small file next to a large untouched one — it reads *under 1% smaller* rather than the nonsensical *0% smaller*.

Stop finishes the file currently being compressed and then halts; it does not abandon work mid-file. Everything already compressed is kept and downloadable.

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

### If the engine can't be fetched

The 16 MB payload needs one online moment. If it can't be reached — offline, a blocked network, a bad deploy — Compress falls back to rasterising pages and rebuilding the PDF from JPEGs, and **tells you what that cost**:

> Couldn't reach the PDF compressor, so pages were turned into images. The text is no longer selectable or searchable. Reconnect and re-run for a proper compress.

This route is strictly worse and is never chosen while Ghostscript is available. It destroys the text layer, so selection, search, copy/paste, accessibility and links all go with it. On a text or vector PDF it usually produces a *larger* file, which the 98% keep-threshold then discards — so you get your original back rather than a damaged copy. It earns its place only on scans, where the pages were already images.

It runs on the main thread (it needs a 2D canvas) while Ghostscript runs in a worker, which is why the two are separate handlers rather than one class with a branch.

Its libraries (pdf.js and pdf-lib) are imported on demand rather than at module scope. The handler is registered for every session but only *runs* on the rare offline path, so a static import would have put pdf-lib into every visitor's download to serve a route almost none of them take.

## Compression when converting

Compress is not the only place compression happens. Every conversion has always applied some — a 400 MB output nobody asked for is its own bug — but it used to be invisible. It is now an explicit setting.

The **Compression** control lives at the bottom of the settings menu and is present in **every** mode — it rebinds to whichever setting the active mode owns rather than disappearing, because hiding it made the setting look like it only existed where you last saw it.

It is titled for the mode you are in, because "Compression" on its own never says compression *of what*:

| Mode | Reads as | What it controls | Default | Levels offered |
|---|---|---|---|---|
| **Converter** | Compress on conversion | Quality of converted output | Automatic | Automatic, Original quality, High quality, Balanced, Smallest file |
| **Compress** | Compression level | How hard to squeeze. The same value as the card's own **Compress by** picker, two views kept in sync | Automatic | Automatic, High quality, Balanced, Smallest file |
| **PDF Editor** | Compress created PDF | Whether a saved PDF is also shrunk on the way out | **Original quality** | Original quality, High quality, Balanced, Smallest file |

The three settings are **independent and separately persisted**. "How much quality to give up while changing format", "how hard to squeeze" and "should editing this also shrink it" are different questions, and an earlier build that shared one value meant changing it in one place silently moved the others.

Two defaults are worth explaining:

- **The PDF Editor defaults to Original quality** because merging, organizing and watermarking are *edits, not exports*: you expect the same document back. Pick any other level and the finished PDF is run through the same Ghostscript engine, with the same 98% keep-threshold, on its way to the download. If that step fails for any reason it is skipped and you get your uncompressed result — losing a completed merge to an optional squeeze would be a much worse outcome than a large file.
- **The PDF Editor offers no Automatic.** Automatic means "read the file and decide", which is a good answer for a file handed over to be shrunk and a surprising one for a file handed over to be edited.

The engine is fetched ahead of time whenever a PDF becomes likely — a PDF dropped on Compress, PDF chosen as a conversion target, or a PDF-editor level set to anything but Original quality. It's a `<link rel="prefetch">`, so the browser downloads it at idle priority into the HTTP cache and can abandon it under memory pressure; nothing is wasted if you don't follow through.

For multi-hop conversions (e.g. HEIC → PNG → WebP), the chosen level applies to the **final** hop only; intermediates run at high quality so quality loss isn't compounded once per step. That rule lives in one place (`qualityForHop`) and is shared by the browser, MCP, REST and CLI surfaces.

## Using it from MCP / REST / CLI

Everything the Compress surface does is reachable from the agent surfaces, through `convert_file` (MCP) or `POST /convert` (REST) with **matching input and output formats** plus a `quality` preset:

```jsonc
{ "filePath": "/tmp/scan.pdf", "inputExt": "pdf", "outputExt": "pdf", "quality": "low" }
```

Images, audio, video and PDFs all work. The same 2% size-guard applies, so a file that cannot usefully shrink comes back unchanged rather than larger. See [INTEGRATIONS.md § Quality preset](INTEGRATIONS.md#quality-preset).

## Limits

- Batch ceiling and total-size budget are shared with the rest of the app.
- The whole batch is held in memory; very large video batches are the practical limit.
- Cancellation takes effect **between files**, not mid-file — a single long video keeps going until that file finishes.
- **The first PDF is slower.** The 16 MB engine is fetched and compiled on first use, then reused for the rest of the session. Every PDF after the first skips both steps.

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
