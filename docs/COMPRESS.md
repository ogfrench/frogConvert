<!-- docs-frontmatter
icon: 🗜️
label: Compress
desc: Make images, audio, video and PDFs smaller without uploading them
-->

# Compress

frogConvert has three modes: the **Converter**, the **PDF Editor**, and **Compress**. Compress is the "make this file smaller without changing what it is" surface - same format in, same format out. It's frogConvert-original, not part of the [Convert to it!](https://github.com/p2r3/convert) fork.

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

Documents, archives and plain text are refused at the drop zone with a toast, as is SVG - it's vector text, and the only thing a raster compressor could do to it is rasterise it.

The drop-zone filter is deliberately *not* the final word. It can only look at the MIME type, and the authoritative "is there a compressor for this?" answer needs the handler registry, which loads later. So a few image types that pass the filter (HEIC and AVIF, for instance) turn out to have no same-format compressor and come back marked *can't compress this*. Erring this way is on purpose: over-rejecting at the door would turn away files that can in fact be compressed, and a truthful per-file result costs the user nothing but a moment.

## Levels

One control, four choices. The vocabulary is quality-forward - it names what the output looks like, not how hard the compression is:

| Level | Meaning |
|---|---|
| **Automatic** (default) | Reads each file and picks a level. Won't recompress what's already small. |
| **High quality** | Modest savings, original dimensions kept. |
| **Balanced** | Big savings, quality you won't miss. |
| **Smallest file** | Visible quality loss, and images are resized. |

### What each level does to an image

| | Quality | Long edge |
|---|---|---|
| High quality | 93 | unchanged |
| Balanced | 80 | 2560 px |
| Smallest file | 65 | 1920 px |

**The resize is where the saving is.** Halving an image's long edge quarters its pixels, and the pixel count *is* the file. An earlier version of this only resized above 30 megapixels - which no phone or camera photo reaches - so quality alone had to carry the whole ladder, and it could not: a 4 MB photo re-encoded at the same dimensions came back around 3.4 MB whatever level you chose.

For calibration: Squoosh ships at quality 75 by default, and the aggressive presets in tools like iLoveIMG and TinyPNG sit near 65 and resize as well. **Smallest file** is deliberately in that company. **High quality** never resizes, so it stays a true "just re-encode it" option.

There is deliberately **no "lossless" level here**. As a compression level it can only mean "do nothing": it targets quality 100 with no resize, so re-encoding an already-compressed file comes back *larger* and the keep-threshold discards it. The level would reliably accomplish nothing, so it isn't offered. (The Converter's own setting does include **Original quality**, because "convert this without shrinking it" is a real request.)

### How Automatic works

Automatic doesn't apply a fixed tier. It runs three steps per file:

1. **Probe.** Read cheap container metadata - bytes per megapixel for images, bytes per page for PDFs, container bitrate for audio and video - and place the file in a quality band from *uncompressed* down to *minimal*. This measures how densely the file is **already** compressed. It never decodes the whole file, so it costs milliseconds.
2. **Pick a level from the band.** Raw and high-quality inputs get **Balanced**; a file that is already web-optimised gets **High quality**, since compressing it again trades visible quality for almost nothing; a file in the bottom band is left alone entirely and reported as *already compressed*. Automatic never selects **Smallest file** - that one resizes, and resizing is not something to do to someone who expressed no preference.
3. **Apply the format's rule.** "One band down" is not safe everywhere. PDFs are the standing exception and resolve to a conservative target instead; see [PDF compression, honestly](#pdf-compression-honestly).

This is why two files dropped together can come out at different levels, and why Automatic is the default: it's the right answer when the user has no opinion.

**Automatic aims for a reliable win, not the biggest one.** If you want to push harder, say so with an explicit level - and note that an explicit level is never second-guessed. The probe only ever *chooses* on your behalf; it will not refuse a level you picked yourself, because whether a file can still shrink is a guess until the engine has actually tried.

One definition backs all of this: `src/core/compression/automatic.ts`. The Converter, Compress and the MCP/REST entry point all call it, so the three surfaces cannot drift apart or miss a new per-format rule.

### What each level is actually worth

Measured by driving the real app in a browser, one file per level, downloading the result and weighing it (`scripts/level-sweep.mjs`):

| Flow | Original quality | Automatic | High quality | Balanced | Smallest file |
|---|---|---|---|---|---|
| **Convert** a 5.3 MB PNG to JPEG | 2,132,172 | 417,150 | 839,253 | 417,150 | 246,795 |
| **Compress** a 2.1 MB JPEG | n/a | 497,203 | 969,280 | 497,203 | 308,378 |
| **PDF Editor** merging two image-heavy PDFs | 2,595,455 | 143,673 | 143,673 | 69,133 | 27,024 |

Three things in that table look like bugs and are not:

- **Automatic matches Balanced on images.** That is Automatic working: it probed the file, placed it in a band, and Balanced is where that band lands.
- **Automatic matches High quality on PDFs.** The per-format rule above. A lower Ghostscript preset can produce a *larger* PDF, so Automatic aims at the setting that reliably helps.
- **Original quality in the PDF Editor is much larger than every other row**, because it is the merged document untouched. That is the point of the default: an edit hands back what you edited.

A fourth case worth knowing: **compressing a PNG gives the same file at every level.** PNG is lossless, so the quality dial has nothing to turn, and the only other lever is the resize cap - which does nothing to an image already smaller than it. Identical output is the correct answer, not a broken control.

## What the progress modal tells you

A compression run moves through phases, and the modal names each one rather than showing a single sentence throughout. In order:

| Line | What is actually happening |
|---|---|
| `Downloading the video compressor...` | First use of an engine on this device: fetching and compiling a WASM binary. 32 MB for FFmpeg, 16 MB for Ghostscript, 14 MB for ImageMagick. Says *this happens once and may take a moment*, because it does. |
| `Getting the engine ready` | The engine is loading inside the worker. Separate from the line above: the worker keeps its own instance, so an engine already warm on the main thread still loads here. |
| `Reading your file...` | The file's bytes are coming off disk. Files are read one at a time, however large the batch, so only one is ever resident. |
| `Compressing your file...` | The engine is working. This is where the live detail appears. |

Underneath, a live line reports whatever the engine is willing to say — `Encoded 12.4s of 47.0s of media. · 34%`, `Fetching the compressor (52%)`, `Rasterising page 12 of 50 · 24%`. It alternates with `feel free to switch tabs` on a 9-seconds-on, 3-seconds-off rhythm, and gains a `· MM:SS` elapsed clock once a run passes ten seconds, so something is always moving.

The spinner distinguishes the two kinds of wait: a thin ring while nothing is being processed yet (engine download, file read), the gooey one while an engine is actually working.

**Not every engine reports progress.** Six do — FFmpeg, Ghostscript, comics, pdfCanvasCompress, pdftoimg, pdftotxt — which covers video, PDF and comic archives, the slow cases. Image compression through ImageMagick shows the phase, the file name and the elapsed clock, but no percentage, because the engine does not provide one. The batch position (`Compressing file 2 of 5...`) always works, since it is counted here rather than reported by the engine.

The same status line, from the same module (`src/conversion/progressStatus.ts`), is what the Converter and the PDF editor show. A video that reports `Encoded 3.2s of 8.7s` while being converted reports it identically while being compressed.

## Reading the results

Each row shows the outcome for one file. The wording is deliberate:

- **−36%** - it shrank, and the smaller file is what you download.
- **no gain** - the re-encode came back within 2% of the original, so the **original** is kept. Nothing was degraded for a rounding error.
- **already compressed** - it was at minimum useful quality already, so it was never re-encoded.
- **can't compress this** - no compressor for that format. The file is never opened, so it is not in the download either; your copy on disk is the only one there has ever been.
- **stopped** - you pressed Stop. Either this file was never reached, or it was the one in flight and was abandoned. Your original is untouched either way.
- **failed** - the engine errored. The original is kept.

A batch reports the total saved across only the files that actually shrank. When that saving is real but rounds to zero against the batch total - a win on one small file next to a large untouched one - it reads *under 1% smaller* rather than the nonsensical *0% smaller*.

Stop abandons the file being compressed rather than waiting for it to finish - the moment you most want out is usually a large video, which is exactly the case that used to make you wait. Everything already compressed is kept and downloadable, and the interrupted file is reported *stopped*, not *failed*: it is your decision, not our error.

### Download names

A shrunk file downloads as `name-compressed.ext`, so it stays distinguishable from its source once both sit in the same folder ("photo (1).png" says nothing; "photo-compressed.png" does). Files that passed through untouched keep their original names - they *are* the originals. Files that were never opened at all (a format with no compressor, or one you stopped before it was reached) are listed in the results with their reason but left out of the archive: you already have them, byte for byte. Multi-file results arrive as `compressed-<timestamp>.zip`, timestamped so repeated runs never collide.

## PDF compression, honestly

PDFs use Ghostscript's `pdfwrite` device, mapped from the level:

| Level | Ghostscript preset | Image target |
|---|---|---|
| Smallest file | `/screen` | 72 dpi |
| Balanced | `/ebook` | 150 dpi |
| High quality | `/printer` | 300 dpi |

**These presets only bound image resampling.** Text stays text and vectors stay vectors - which is the point, but it also means:

- A **scanned** PDF (mostly embedded raster) can drop 70–85%.
- A **text** PDF is fonts and vector glyphs. There is almost nothing to resample, so it will report *no gain*. That is the feature working correctly, not failing.

### Why Automatic picks High quality for PDFs

For every other format, a lower preset means a smaller file. **PDFs do not behave that way**, so Automatic does not step them down the ladder - it targets `/printer` regardless of the probed band.

The reason is that Ghostscript decodes and re-encodes embedded images, and for a modern well-produced PDF that trade can go the wrong way. Two real documents, measured:

| Document | `/screen` | `/ebook` | `/printer` |
|---|---|---|---|
| 59-page consulting report | **−56%** | −32% | −37% |
| 71-page research brief (JPEG2000 images) | **+42%** | **+65%** | −18% |

The second file gets *bigger* at both aggressive presets, because its JPEG2000 images are re-encoded into a less efficient form. `/printer` was the only preset that helped both, and 300 dpi still downsamples any real scan - which is where the large savings actually live. So Automatic takes the reliable win.

If you want the 56%, pick **Smallest file** explicitly. That is exactly the split the two settings are for: Automatic is cautious on your behalf, an explicit level is you overriding that. The 98% keep-threshold means a preset that would inflate a file never ships it - you get *no gain* and your original back, never something larger.

This is also why Compress does not use the rasterising route that the Converter's PDF→image path uses. Rendering pages to bitmaps would "shrink" a text PDF only by destroying the text layer, selectable text, and searchability. Measured on a vector-only PDF: the rasterising approach saves 0%, Ghostscript saves 36%.

The Ghostscript engine is ~16 MB of WebAssembly. It is fetched **on first PDF compression only**, never at page load, with download progress shown. After that the browser caches it.

### If the engine can't be fetched

The 16 MB payload needs one online moment. If it can't be reached - offline, a blocked network, a bad deploy - Compress falls back to rasterising pages and rebuilding the PDF from JPEGs, and **tells you what that cost**:

> Couldn't reach the PDF compressor, so pages were turned into images. The text is no longer selectable or searchable. Reconnect and re-run for a proper compress.

This route is strictly worse and is never chosen while Ghostscript is available. It destroys the text layer, so selection, search, copy/paste, accessibility and links all go with it. On a text or vector PDF it usually produces a *larger* file, which the 98% keep-threshold then discards - so you get your original back rather than a damaged copy. It earns its place only on scans, where the pages were already images.

It runs on the main thread (it needs a 2D canvas) while Ghostscript runs in a worker, which is why the two are separate handlers rather than one class with a branch.

Its libraries (pdf.js and pdf-lib) are imported on demand rather than at module scope. The handler is registered for every session but only *runs* on the rare offline path, so a static import would have put pdf-lib into every visitor's download to serve a route almost none of them take.

## Compression when converting

Compress is not the only place compression happens. Every conversion has always applied some - a 400 MB output nobody asked for is its own bug - but it used to be invisible. It is now an explicit setting.

The **Compression** control lives at the bottom of the settings menu and is present in **every** mode - it rebinds to whichever setting the active mode owns rather than disappearing, because hiding it made the setting look like it only existed where you last saw it.

It is titled for the mode you are in, because "Compression" on its own never says compression *of what*:

| Mode | Reads as | What it controls | Default | Levels offered |
|---|---|---|---|---|
| **Converter** | Conversion compression | Quality of converted output | **Original quality** | Original quality, Automatic, High quality, Balanced, Smallest file |
| **Compress** | Compression level | How hard to compress. The same value as the card's own **Compression level** picker, two views kept in sync | Automatic | Automatic, High quality, Balanced, Smallest file |
| **PDF Editor** | PDF compression | Whether a saved PDF is also shrunk on the way out | **Original quality** | Original quality, Automatic, High quality, Balanced, Smallest file |

Only **Compress** defaults to Automatic, because shrinking the file is the whole
request there. The Converter and the PDF Editor both default to Original quality:
one is asked for a format change and the other for an edit, and neither was asked
to make the file smaller. Below `high` the plan applies a long-edge cap, so an
Automatic default on the Converter could return a 4032x3024 photo at 2560 px -
unrecoverable, on the only copy the user keeps.

The three settings are **independent and separately persisted**. "How much quality to give up while changing format", "how hard to compress" and "should editing this also shrink it" are different questions, and an earlier build that shared one value meant changing it in one place silently moved the others.

Two defaults are worth explaining:

- **The PDF Editor defaults to Original quality** because merging, organizing and watermarking are *edits, not exports*: you expect the same document back. Pick any other level and the finished PDF is run through the same Ghostscript engine, with the same 98% keep-threshold, on its way to the download. If that step fails for any reason it is skipped and you get your uncompressed result - losing a completed merge to an optional compression would be a much worse outcome than a large file.
- **The PDF Editor offers no Automatic.** Automatic means "read the file and decide", which is a good answer for a file handed over to be shrunk and a surprising one for a file handed over to be edited.

The engine is fetched ahead of time whenever a PDF becomes likely - a PDF dropped on Compress, PDF chosen as a conversion target, or a PDF-editor level set to anything but Original quality. It's a `<link rel="prefetch">`, so the browser downloads it at idle priority into the HTTP cache and can abandon it under memory pressure; nothing is wasted if you don't follow through.

For multi-hop conversions (e.g. HEIC → PNG → WebP), the chosen level applies to the **final** hop only; intermediates run at high quality so quality loss isn't compounded once per step. That rule lives in one place (`qualityForHop`) and is shared by the browser, MCP, REST and CLI surfaces.

## Using it from MCP / REST / CLI

Everything the Compress surface does is reachable from the agent surfaces, through `convert_file` (MCP) or `POST /convert` (REST) with **matching input and output formats** plus a `quality` preset:

```jsonc
{ "filePath": "/tmp/scan.pdf", "inputExt": "pdf", "outputExt": "pdf", "quality": "low" }
```

Images, audio, video and PDFs all work. The same 2% size-guard applies, so a file that cannot usefully shrink comes back unchanged rather than larger. See [INTEGRATIONS.md § Quality preset](INTEGRATIONS.md#quality-preset).

## Limits

### Sizes

| | Limit | Why |
|---|---|---|
| One file | **2 GB** | The engines are 32-bit WebAssembly builds with a 4 GB address space and need working room inside it. Past this the engine aborts, not the browser. |
| One batch | **1–4 GB**, scaled to the device | A quarter of reported device memory, floored at 1 GB and capped at 4 GB. Lands at 2 GB on an ordinary 8 GB machine. |
| File count | 300 | Shared with the rest of the app; rarely the binding limit. |

Files over 512 MB are accepted with a heads-up that it will take a few minutes, rather than refused.

These are deliberately not the kind of quota a hosted tool imposes. TinyPNG stops at 5 MB and CloudConvert at 1 GB because they pay for the bandwidth and the CPU; nothing here leaves your machine, so the only question is whether the tab survives. Intake is partial, not all-or-nothing: what fits is taken and you're told what wasn't.

Compress reads **one file at a time**, at the moment it compresses it, so the batch total does not have to fit in memory. What accumulates is the *output*, and an output is smaller than its input or it is discarded. Files it cannot handle, and files you stop it before reaching, are never read off disk at all - and so are not included in the download, since they are byte-identical to what you already have.
- **Cancel** abandons the file being worked on, not just the ones after it. Anything already compressed stays downloadable, and the interrupted file is reported *stopped* rather than *failed*. The one exception is the degraded canvas route for PDFs (used only when the Ghostscript payload is unreachable), which runs on the main thread and cannot be interrupted.
- The PDF editor's optional compression step can be skipped mid-run. The edit itself is already complete by then, so skipping simply hands back the uncompressed document.
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

`core/` never imports `components/` - `resolveCompressor` takes the loaded handler list as a parameter rather than reading the UI store, which is what lets the headless surfaces reuse it.

## Licensing note

Ghostscript is AGPL-3.0. frogConvert is GPL-3.0-or-later, and GPLv3 §13 explicitly permits combining with AGPLv3 code: the combined work is conveyed under the GPL while the Ghostscript component keeps its own §13 network-use obligation. See the README's licensing section for the full reasoning.
