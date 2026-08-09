<!-- docs-frontmatter
icon: 📜
label: Changelog
desc: Release history
-->

# Changelog

All notable changes to frogConvert. Loosely follows [Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org/).

## [3.0.0] - 2026-08-08

Compression becomes a first-class feature. It was previously invisible - every conversion quietly applied a `medium` preset, and the only user-facing compression was a same-format easter egg in the Convert card. There is now a dedicated **Compress** mode, PDFs can actually be compressed, and the setting that was always being applied is now something you can see and change.

Adding a real PDF engine paid for two things beyond compression: **PostScript, EPS and Illustrator conversion** - formats the app had no support for at all, from the one engine that handles them properly - and the ability to shrink what the PDF Editor saves. The PDF Editor's long edits also became **cancellable**, closing the last place in the app where an operation could trap you on a spinner.

### Added
- **Compress mode**, a third app surface alongside the Converter and PDF Editor, at `/compress`. Same format in, same format out, for images, animated images, audio, video and PDFs. [src/components/CompressWorkspace/](src/components/CompressWorkspace/). Reuses the Convert card's dropzone, file-management and button styles rather than inventing a parallel visual language.
- **PDF compression via Ghostscript-WASM.** [src/handlers/ghostscript.ts](src/handlers/ghostscript.ts). The existing canvas + pdf-lib route cannot do this job: it rasterises pages, so on a vector or text PDF it saves nothing (measured 0%) and on a scan it only "wins" by destroying the text layer. Ghostscript's `pdfwrite` device resamples embedded images and rebuilds object streams while leaving text as text. Measured on a vector-only PDF: 51.8 KB → 33.1 KB (−36%). The ~16 MB binary is fetched on first PDF compression only, never at page load, with download progress; it is deliberately excluded from the service-worker precache.
- **Mixed-batch orchestrator.** [src/core/compression/compressBatch.ts](src/core/compression/compressBatch.ts) groups a batch by format so each engine initialises once, preserves input order, and applies a 98% keep-threshold - a re-encode that saves less than 2% is discarded and the original kept, so nothing is degraded for a rounding error.
- **`docs/COMPRESS.md`**, including an explicit section on why a text-heavy PDF reports "no gain" and why that is correct rather than broken.
- **PDF compression on MCP, REST and CLI.** [src/handlers/ghostscript.node.ts](src/handlers/ghostscript.node.ts). `convert_file` / `POST /convert` with matching `pdf` in and out now compresses through the same engine and the same level mapping as the browser.
- **Canvas fallback for PDFs**, used only when the Ghostscript payload cannot be fetched at all (offline, blocked). It rasterises pages, which destroys the text layer, so it always says so rather than reporting a silent saving. A fallback result that fails the keep-threshold is discarded without a warning, since no damage reached the user.
- **Compressed downloads are self-describing.** A shrunk file downloads as `photo-compressed.png`; saved next to its source under the original name it became "photo (1).png", and nothing said which of the two was the small one. Files handed back untouched keep their original names, because labelling original bytes "-compressed" would be a lie. Batches zip as `compressed-<timestamp>.zip`.
- **Sharing PDFs into the app now offers Compress** alongside Edit and Convert. A shared scan is at least as likely headed for compression as for either of the others; previously the surface was unreachable from the share sheet entirely.
- **`docs/ADDING_A_MODE.md`** - the playbook for shipping a top-level surface, distilled from building this one, with the steps Compress itself got wrong marked as the places to look hardest.
- **PostScript, EPS and Illustrator conversion** ([#19](https://github.com/ogfrench/frogConvert/issues/19)). `PS → PDF`, `EPS → PDF` and `AI → PDF`, plus `PDF → PS` and `PDF → EPS`, through the same Ghostscript engine this release adds for PDF compression. Vector content stays vector: verified that a `PS → PDF` round trip keeps its pages, keeps its fonts, and emits no image XObject. Once a PostScript file is a PDF, everything else the app does with PDFs (PNG/JPEG, text extraction, the PDF Editor, Compress) reaches it for free through the existing route finder, with no new graph wiring.
- **PDF/A-2b and multi-page TIFF export**, from the same engine. [src/core/ghostscript/args.ts](src/core/ghostscript/args.ts).
- **`.ai` files state what they cost before you convert.** A modern `.ai` is a PDF carrying a private Illustrator payload, so the artwork converts perfectly and the layers, editable text and effects do not survive. The Converter says so under the button rather than letting it be discovered afterwards.
- **The PDF Editor's long edits can be cancelled** ([#21](https://github.com/ogfrench/frogConvert/issues/21)). Merge, organize, watermark and extract are main-thread pdf-lib loops that previously parked you on a spinner with no way out but a reload. They now yield at checkpoints, carry a Cancel button, and honour Escape; a cancelled edit is a neutral outcome rather than an error.
- **Real progress, from every engine that reports it.** Compressing a 190 MB video showed an indeterminate spinner for minutes with nothing to distinguish work from a hang. FFmpeg, Ghostscript and ImageMagick all emit progress on stderr; none of it reached the UI. The modal now alternates a percentage with a line telling you the tab is yours - *feel free to switch tabs*, on its own line rather than flickering in place - on a 9s/3s cycle. It covers Convert, Compress and the PDF Editor, since all three drive the same engines. Where an engine genuinely cannot report (a single-shot WASM call with no callback), the surface says so instead of inventing a number.
- **Image → PDF.** The picker offered *PDF - Portable Document Format* from any image, because Ghostscript declares PDF writable, and the route search then found nothing - so a common conversion ended on "Conversion not available yet". It now goes through pdf-lib, which needs no engine and is already a dependency. Reported as "merging these pages creates a broken PDF": the merge was innocent, the inputs were pages of 1080 by 2400 **inches**, written by a tool that assumed 1 DPI and blew past the PDF spec's 14400-unit page limit by 12x.
- **Bulk file actions in the PDF Editor.** Files were the only collection in the app without them - a per-row `x`, one file at a time, and no way to start over short of reloading. Merge, Organize and Watermark now carry **Replace all** and **Clear** in the same count row, with `+ Add` on its own row beneath the list, matching the Converter's and Compress's shared Files modal rather than inventing a third vocabulary.
- **Reset style, in the watermark settings.** Watermark size, colour, opacity, rotation and repeat persist across sessions, so a value nudged once stays nudged for weeks, and nothing in the panel said you were off-default; the only way back was **Clear**, which also discards your files. A **Reset style** button now sits at the foot of the Customize block on both the desktop sidebar and the phone tray, and appears only while the style differs from its defaults - so it doubles as the missing off-default signal. The watermark text is untouched by it, being the one field you always retype. [src/components/PdfWorkspace/PdfWorkspace.ts](src/components/PdfWorkspace/PdfWorkspace.ts).

### Changed
- **Line endings are settled, once.** 8 of 335 tracked text files had drifted to CRLF; normalising 5 of them accounted for roughly 2,200 lines of this release's diff, and they would have flipped back the next time anyone edited them on Windows. A `.gitattributes` (`* text=auto eol=lf`) pins it, with the remaining three renormalised in the same commit and verified content-identical. Read this release with `git diff --ignore-all-space`.
- **The test suite fails a file that leaves a long-lived timer running.** A timer outliving its test fires into an environment with no document and throws where nothing can catch it, so the run reports every test passing and still exits 1 - which happened twice while cutting this release. The check watches only timers our own code arms, judged by the frame that called `setTimeout` rather than the nearest frame belonging to us: the MCP SDK arms one inside `client.close()` and puppeteer inside `browser.disconnect()`, and blaming those on our call site names a line with no timer in it.
- **Video and audio now compress over REST and MCP.** `ffmpeg.wasm` throws on
  construction under Node, so those formats came back `unsupported` from the
  agent surfaces - true about the process, not about the file. `compress_file`
  and `POST /compress` now fall back to the same headless browser `convert_file`
  has used for years. If the bridge cannot be reached the file returns unshrunk
  with its original bytes, never empty.
- **A converter that fails to download says so.** A dropped fetch of a one-time
  ~16 MB engine was reported as "didn't complete this time - try a different
  target format or another file": advice that cannot work, pointed at a file
  that was never the problem. Reported on a real EPS to PDF over a weak
  connection.
- **Nothing downloads until you ask.** The Converter and the PDF Editor used to
  fire a download moments after their success modal appeared. All three surfaces
  now wait for the button, and that button names what it will produce -
  "Download" or "Download 3 files (.zip)" - rather than the old "Download again",
  which claimed something had already happened.
- **One file manager, not two.** Compress used to render its own list of files
  with its own remove buttons and no way to add more. It opens the Converter's
  files modal now - paging, per-row replace, drop-more, remove all - through a
  small source adapter. The only configured difference is that Compress accepts
  a mixed batch on purpose and the Converter needs one format in.
- **The compression levels are three real steps.** High quality applied no
  resize at all, so on a large photo it reported *nothing to compress* while
  Balanced took 83% off - the whole ladder's step sat between the top two
  settings. The long-edge caps are now 3840 / 2560 / 1920 against quality
  93 / 80 / 65.
- **Cancelling a per-file PDF job keeps what it finished.** Organize, watermark
  and extract build their output one document at a time; stopping used to
  discard the completed ones, so Cancel could only be paid for by redoing them.
- **The waiting Converter button says what it is waiting for.** "Loading
  formats" was wrong twice - the formats are already on screen and selectable -
  and it is now "Downloading converters", with a subtle breathing animation so
  a slow connection does not read as a frozen page, and an explicit offline
  state. Failures while offline say so instead of blaming the file.
- **Compression is now a visible setting, in every mode.** The **Compression** control sits at the bottom of the settings menu and rebinds to whichever value the active mode owns: converted-output quality in the Converter (default **Original quality**), compression strength in Compress (default Automatic, the same value as the card's own picker and kept in sync), and whether a saved PDF is also shrunk in the PDF Editor (default **Original quality**). Only Compress defaults to Automatic, because shrinking is the whole request there; a conversion was asked for a format change and an edit was asked for an edit, and below `high` the levels apply a long-edge cap, so an Automatic default would silently return a 4032x3024 photo at 2560 px. Hiding it anywhere made the setting look like it only existed where you last saw it. The three values are independent and separately persisted - "how much quality to give up while changing format", "how hard to compress" and "should editing this also shrink it" are different questions, and an earlier build that shared one value meant changing it in one place silently moved the others.
- **The PDF Editor can shrink what it saves.** Merge, organize, watermark and extract route their finished PDF through the same Ghostscript engine, level mapping and 98% keep-threshold as the Compress surface. It defaults to Original quality because these are *edits, not exports* - you expect the same document back - and offers no Automatic, since "read the file and decide" is a good answer for a file handed over to be shrunk and a surprising one for a file handed over to be edited. The step never costs you your work: if it fails or wouldn't save enough, you get the uncompressed result.
- **Ghostscript is fetched before it is needed.** A PDF dropped on Compress, PDF chosen as a conversion target, or a PDF-Editor level set to anything but Original quality each start the ~16 MB download via `<link rel="prefetch">`, so it overlaps with whatever you do next instead of landing on the critical path. Nothing is downloaded for users who never touch a PDF.
- **Level names use one quality-forward vocabulary**: Automatic / Original quality / High quality / Balanced / Smallest file. The previous set mixed two scales - "No compression" is a quality statement, "Extreme compression" is an amount - and "Automatic / Match the source" was simply wrong, since matching the source is what the lossless option does. Compress offers the same words minus the do-nothing option: as a compression *level*, lossless can only mean "do nothing", because it targets quality 100 and the re-encode comes back larger.
- **Multi-hop conversions no longer compound quality loss.** One shared rule ([src/core/compression/hopQuality.ts](src/core/compression/hopQuality.ts)) applies the requested level to the final hop only, with intermediates at high quality. The browser and the MCP/REST/CLI surfaces previously disagreed in opposite directions; they now share the rule.
- **The control is titled for its mode**: *Conversion compression*, *Compression level*, *PDF compression*. One heading reading "Compression" in three places never said compression of what, and the card's own field was relabelled from "Compress by" (whose value, "Automatic", never completed the sentence) to "Compression level".
- **The Compress card is the Convert card**, measured rather than approximated: same width, margin, padding, radius, border and surface on both breakpoints, verified against `#convert-card` in Chromium at 1440x900 and 390x844. Category pills above it (Any / Image / Audio / Video / PDF) state what the surface accepts and open the file picker pre-filtered to the tapped family. The page asks "What will you compress today?".
- **A same-format pick in the Converter now signposts Compress.** Picking png to png converts nothing; when a compressor exists for the format, the hint says "Want it smaller?" and one click switches mode, instead of ending at "you'll get your file back unchanged".
- **Copy overhaul.** "Squish" is gone from every user-facing string, no user-facing string contains an em dash, and each level blurb earns its space (none opens by repeating its own label; punctuation is consistent within a menu).
- **One verb for stopping.** *Stopped*, *Cancelled* and *Canceled* all appeared, sometimes stacked three deep in one modal, and one of them announced itself before anything had actually stopped. Every surface now says **stopped**, once, after it has.
- **Plainer verbs in progress copy.** "Encoded 12.4s of 20.0s of video" told you the internals; it now says **converted** or **compressed** according to what you asked for, and **file** rather than **media**.
- **The PDF Editor timestamps what it saves.** `merged.pdf` collided with the last `merged.pdf` in the download folder, so the browser silently produced `merged (1).pdf` and nothing said which was which. Output now carries the same timestamp the Converter and Compress already used.
- **Pages sits above the watermark settings.** Watermark was the one tab where scope came last, so on a phone the range input and its Select all / Deselect all were pushed below five controls - off-screen exactly when you are choosing which pages to mark. All three tabs now read files, then scope, then the tool's own settings.
- **The file manager says what it does, and the two surfaces agree.** *Remove all* is now **Clear** in the shared Files modal. The refresh button beside it is **Replace all files** on both the Converter and Compress: it was labelled "Replace file" on one while discarding the whole queue, and it *added* files on the other, so the same glyph in the same position did opposite things. Three files in and one picked left you with one on the Converter and four on Compress. Both replace now; adding keeps its own labelled home in the Files modal's **Drop more files** zone.
- **Only one top-bar dropdown is open at a time.**
- **The Compress background no longer promises speed.** Its emoji set carried a balloon (inflation, the opposite of the feature) and a lightning bolt, on the one surface where speed is the weakest claim in the app: a 16 MB Ghostscript fetch on first use and a ten-minute worker ceiling on video. The set is now nine things that all mean *smaller*. "Fast" also came out of the JSON-LD product description, the JSON-LD feature list and the docs site's meta description; privacy is the claim this app can actually defend, and it was already making it.

### Fixed
- **A damaged PDF is no longer replaced by a blank page and called a 99% saving.** Ghostscript treats a corrupt PDF as something to *recover* rather than refuse: handed a truncated file it repairs what it can, exits 0, and writes a valid PDF containing one blank page. Every guard passed it - the return code succeeded, the `%PDF-` header was real, and 2 KB is far under the 98% keep-threshold - so all four surfaces reported a saving of up to 99.9% over a blank page, and anyone who trusted that number and deleted the original lost the document. Measured on a report truncated at 40 KB, 200 KB, 1 MB and 3 MB: every one produced the same 2,183-byte blank page. Compression is now rejected unless the output still has every page the input had, which is the right invariant because resampling images and rebuilding object streams never touches the page tree - verified unchanged across every real compression in this release (3, 1, 84 and 71 pages, at every level). A file that cannot be checked against its original is refused rather than reported as a win. [src/core/compression/pdfIntegrity.ts](src/core/compression/pdfIntegrity.ts).
- **A password-protected PDF is no longer emptied and called a saving.** The same blank-page substitution as above, wearing the one disguise page count cannot see through. Ghostscript has no password, so on an encrypted document it reads the page tree, fails to decrypt the content streams, and writes out that many *empty* pages - the page count matches exactly, so every guard passed it. Measured in the built app on a LibreOffice password-protected file: 12,783 bytes and one page of text came back as 2,188 bytes, one blank page, zero extractable characters and no longer encrypted, reported as an **83% saving** and offered for download. Compression now refuses an encrypted input and keeps the original, still encrypted. [src/core/compression/pdfIntegrity.ts](src/core/compression/pdfIntegrity.ts).
- **The PDF Editor no longer silently blanks a password-protected page.** The same cause on the edit side: every tool loaded its source with `ignoreEncryption: true`, which suppresses the throw but supplies no password, so pages copy across structurally intact and completely empty. Measured merging a password-protected file with a 4-page document: the output had all 5 pages, of which pages 2-5 carried 3,930 / 3,953 / 3,953 / 2,635 characters and page 1 carried **zero**, with no error and nothing on screen to suggest anything was lost. Merge, Organize, Watermark and Extract now refuse an encrypted source through one shared loader, so the answer is the same on the web, over REST and over MCP. [src/tools/pdfSource.ts](src/tools/pdfSource.ts).
- **Automatic stopped refusing long PDFs it could shrink by two thirds.** A PDF's quality tier is read from bytes per page, which for a PDF says almost nothing about what Ghostscript can do - a long document is thin per page however heavy its images are. So a thesis landed in the `minimal` tier and Automatic handed it straight back as "already compressed". Measured on a 5.1 MB, 100+ page LaTeX thesis: Automatic saved nothing while every other level shrank it, `/printer` by **65%** to 1.8 MB. Since Automatic is the default, this withheld the saving from precisely the users who expressed no preference. PDFs now always get a try; the keep-threshold already discards any result gaining under 2%, so a genuinely minimal PDF still comes back untouched - it just gets there by measuring the output rather than predicting it. [src/core/compression/tierDown.ts](src/core/compression/tierDown.ts).
- **A `.webm` file is recognised again, so Compress can shrink one.** Dropping a WebM on Compress answered "can't compress this", and the cause was not in the compressor: one ffmpeg line can name several containers (`matroska,webm`), and the app asked ffmpeg about only the *first* of them, so every alias inherited the primary's extension. Nothing in the app claimed `.webm` for reading, `findMatchingFormat` returned no match, and the file was refused before any engine was consulted. The alias name is the container's own extension in ffmpeg's convention, so it is used now. Measured on a 4.8 MB clip: **−34%**, and an audio-dominant 3.2 MB WebM came back **29% smaller** rather than inflating. Two related repairs went with it: the shipped format cache in [public/cache.json](public/cache.json) was regenerated, having predated v3 and so carried no `Ghostscript`, `PdfCanvasCompress` or `imageToPdf` entries at all (888 formats to 898); and `handlerSupportsFormat` now pairs a demuxer with a muxer that disagree about their mime, which it previously could not.
- **An empty file is no longer described as "already compressed."** Anything under the 512-byte floor took that answer, including a 0-byte file, which is not compressed - there is nothing in it. It now reports the same way as any other file that could not be processed.
- **Compression progress and results are announced to screen readers.** The surface was visual-only: a screen-reader user got silence from "Compress" until the results replaced the view, with no way to distinguish a long batch from a stalled one. Progress now runs in the shared conversion modal, which is itself a polite live region, and the results head announces the outcome.
- **The Compress level dropdown was painted over by the page description.** `#compress-content` carries a transform from the entrance animation, making it an atomic stacking context, so the dropdown's own `z-index` only ordered it *within* that subtree and `#compress-description` (a later sibling) covered the part that overflowed the box. Fixed with the same `position`/`z-index` guard `.ws-empty-layout` already uses in the PDF workspace; the two magic `z-index: 60` values became `--z-floating`, since a raw number outside the documented scale is what let this drift unnoticed.
- **`PDF → EPS` does not silently discard pages.** An EPS cannot hold more than one page, and Ghostscript's `eps2write` responds to a multi-page PDF by exiting 0, warning on a stream nobody reads, and writing a file containing one page. A 3-page source round-tripped back to 1 page with no error anywhere the user could see. The route always uses Ghostscript's `%d` template and returns one file per page.
- **TIFF export is LZW-compressed.** The `tiff24nc` device defaults to uncompressed: the same 3-page source measured 19,583,480 B raw against 54,929 B with LZW, a factor of 356.
- **A `.ai` file reported as `application/pdf` is not routed to the plain PDF handler**, which converted it fine while discarding the Illustrator payload. An exact extension match now beats a MIME-only fallback in [detectFormat.ts](src/core/FormatHandler/detectFormat.ts): the browser's MIME is a guess from an OS table, an extension a format claims is a deliberate statement.
- **The compression level does something on the PostScript routes.** The distiller preset is the only lever it has there and it was never passed, so `PS → PDF` produced identical bytes at every setting - the same inert-control defect the video levels had. Measured end to end on a 10 MB image-heavy source, `PS → PDF` now spans 127,981 B at *Smallest file* to 1,070,509 B at *High quality*. PDF/A takes it too, and still carries its `pdfaid` marker at every preset.
- **Extracting pages as a single PDF does not inflate the output.** Adding cancellation checkpoints split `extract()`'s copy loop; pdf-lib builds a fresh object copier per `copyPages` call, so a font or letterhead image shared by every page was copied once per page instead of once. Measured at +132% on 30 pages sharing one image.
- Compress dropzone height now matches the PDF workspace footprint - it is the whole point of that page, not one field among several.
- The taller Compress dropzone applies to the empty state only. Once files are in, the zone is the Converter's own 5.5rem summary row instead of a 10rem box with one line floating in it.
- **PDFs were unreachable from the Compress browse button.** The file input's `accept` list omitted them, so the surface's headline feature worked by drag-and-drop only.
- **Nothing strands the surface on "Compressing…" any more.** A picked file that is moved or deleted before the run (`file.arrayBuffer()` rejects), an engine crash, or a failed WASM instantiation each now land back somewhere actionable; Emscripten's `instantiateWasm` hook has no error channel, so a failed instantiation previously hung the batch forever.
- **Stopping a batch is reported as *stopped*, not *failed***, and the results never claim "nothing left to shave off" about files that were never opened. A real saving that rounds to zero reads "under 1% smaller" rather than "0% smaller".
- **Compression did not actually compress, on three of the five families it advertised.** Four independent defects, each invisible to a green test suite because each lived in a seam between mocked units:
  - The quality probe could **veto an explicitly chosen level**. It reads container metadata, not pixels, so "already as small as it gets" was a guess - and it was overruling an instruction. Image-heavy PDFs reported *already compressed* at every setting. The probe now only chooses when the user has expressed no preference; the keep-threshold, which measures the output instead of predicting it, remains the real guard.
  - **pdf.js detached the file.** `probePdf` falls back to pdf.js for documents whose page count is not in the trailer-scan window, and pdf.js takes ownership of the buffer it is handed. The caller's bytes came back at length 0, so the probe divided zero by the page count and would have handed Ghostscript an empty document. Three of the four `getDocument` call sites already passed a copy; the two that did not now do.
  - **No video or audio was ever compressible.** The capability check demanded a single format entry flagged both readable and writable. FFmpeg publishes a demuxer entry and a muxer entry per container, so nothing it handles ever resolved and every clip reported *can't compress this*.
  - **Video quality levels were inert.** `planVideo` varied only the size thresholds, all above 75 MB, so every ordinary clip fell through to a hardcoded CRF and the three levels produced byte-identical output. Video now scales quality by preset the way images and audio always have; Balanced is unchanged.

  Measured in a browser on real documents: a 59-page consulting report −37% at Automatic and −56% at Smallest file; a 71-page research brief −17%; a 17 MB screen recording −86% at Smallest file against −66% at High quality.
- **Automatic aims at the reliable win rather than the largest one, and PDFs get their own rule.** For every other format a lower preset means a smaller file; PDFs do not behave that way, because Ghostscript re-encodes embedded images. Measured on the research brief: `/screen` grew it 42% and `/ebook` grew it 65%, while `/printer` shrank it 18%. Automatic therefore targets `/printer` for PDFs. One definition now backs Automatic everywhere ([src/core/compression/automatic.ts](src/core/compression/automatic.ts)); it replaced three divergent copies, only some of which had learned the PDF rule.
- **Stop now stops.** Compress abandons the file being compressed instead of finishing it - measured at 1.3 s on a 17 MB video, where the previous contract meant minutes on exactly the file someone presses Stop over. The interrupted file is reported *stopped*, and the degraded fallback is not attempted for a file the user just cancelled.
- **The PDF Editor's compression step can be skipped.** It previously had no cancel at all: worst case a 16 MB engine fetch, a WASM compile and the pass itself, with the 10-minute worker timeout as the only exit. The edit is already complete when that step begins, so skipping returns the finished document uncompressed. A multi-file save skips the rest too.
- **One worker job at a time, enforced rather than assumed.** The worker client kept its cancel, force-cleanup and error hooks in single slots, justified by a comment claiming only one surface is ever active. Nothing enforced it, and there are three callers. Jobs are now serialised onto one queue.
- **Escape closes the compression-level dropdown.** The handler was bound to the menu, so it only fired once focus was already inside it - never in the ordinary case of opening it by mistake. On a narrow screen the open menu covers the Compress button and swallows the click aimed at it, leaving the surface effectively stuck.
- **"Open Compress" brings your files with it** instead of landing on an empty card and asking you to pick them again.
- **Compress no longer refuses large files.** The surface read the whole batch into memory before the first engine ran, so its 500 MB cap was sized for that and capped the wrong thing: one 800 MB video was refused in order to guard against a batch of them. Inputs are now read one file at a time, at the moment each is compressed, so the resident set is a single file however large the batch. A single file may be up to **2 GB** (a real ceiling: the engines are 32-bit WebAssembly builds needing working room inside a 4 GB address space), and a batch up to **1-4 GB** scaled to `navigator.deviceMemory`. Files over 512 MB are accepted with a heads-up about the wait rather than refused. Verified in a browser: a 655 MB video that the old cap rejected outright now compresses.
- **Files that were never opened are no longer in the download.** A format with no compressor, or a file you stopped before it was reached, is not read off disk at all - so the archive no longer carries a byte-identical copy of something already on your machine. Both are still listed in the results with their reason, and the download button names the count it will actually produce.
- **The mobile menu is scrollable.** It previously overflowed short viewports with `position: fixed` and no height bound, leaving the bottom items unreachable; Compression now sits last in it, after Theme, Mode and Formats.
- One 16 MB engine load, however racy the callers: concurrent first uses share a single fetch-and-compile, and a load that failed offline can be retried.
- A finished worker run clears its cancellation callbacks, so a later hard-cancel can no longer terminate a worker that is busy with an unrelated job.
- **The Converter announced compressions that never happened.** Every hop is handed `--quality`, but only 7 of ~42 handlers read it, and the claim was made from the *setting* - before any handler ran, and regardless of the target. Weighed in the real UI, a 1,207,043-byte JPEG to ZIP came back byte-identical at every level and 126 bytes *larger* than the input, under the words "Compressed at Smallest file". Handlers now declare `usesQuality`, opt-in and absence meaning no, and the claim is made only when the hop that produced the kept artifact actually read it. A zero-hop path is excluded too, or the source node's handler would be credited for work no one did. Where a level was chosen and could not apply, the modal now says so.
- **Video progress was pinned at 0%.** FFmpeg's `out_time_us` was being read from a line the build does not emit for video, so a four-minute compression sat at zero throughout - worse than no progress bar, because it looked stalled.
- **The merge preview no longer overflows a phone.** A PDF built from screenshots has pages many times taller than they are wide, and the grid sized cards from the page rather than the viewport.
- **Removing a file on a phone no longer closes the sheet under your finger.** `cleanup()` deletes the body-appended tray, and Organize, Watermark and Extract routed their `x` through a full tool re-render - so clearing three files meant reopening the tray three times. Worse, the scroll lock is derived from an open tray existing, so deleting one without re-deriving it left `overflow-y: hidden` on `<html>` with nothing on screen to dismiss: the page could not be swiped until the tray was opened and closed again. Focus was dropped to `<body>` on all three tabs. All three are fixed, and the tray's Escape handler no longer outlives its tray.
- **MP4 → WEBM converts, and finishes** ([#23](https://github.com/ogfrench/frogConvert/issues/23)). Two faults, one behind the other. `libvpx-vp9` and `libopus` both die with a memory-access fault on a two-second clip, and ffmpeg selects exactly that pair for a `.webm` output; both are now pinned to encoders that complete. That stopped the crash and exposed the second fault underneath: libvpx's default speed encodes 1080p at about ten times realtime in this core - 205s for a 20-second clip - against the ten-minute worker ceiling, so a longer clip simply ran out of time and reported the generic failure. `-cpu-used 5` is 4.6x faster on the same source. Peak wasm heap was flat at 100-115 MB across every duration against a 2 GiB limit, so this was never the memory problem it looked like from the outside.
- **The compression level reaches the WebM encoder** ([#25](https://github.com/ogfrench/frogConvert/issues/25)). It never did: `-crf` is inert for libvpx in this core, so all four levels produced byte-identical output and every WebM came back at the encoder's own default. The reported 20-second phone video went in at 7,276 kbps and came out at 972 - an 87% cut on a *format conversion*, the same at every setting. The route now sets a bitrate derived from the source rather than a constant, because a fixed ladder would inflate a lean clip. Measured on six seconds of 1072x1920 at two source bitrates, output as a share of input:

  | Level | 7,067 kbps source | 1,523 kbps source |
  |---|---|---|
  | Original quality | 78% | 86% |
  | High quality | 63% | 70% |
  | Balanced | 42% | 60% |
  | Smallest file | 28% | 60% |

  No level exceeds its input at either bitrate, which is the constraint that ruled out fixed targets. On the lean source the two lowest levels converge, because libvpx will not go below roughly 900 kbps at this resolution - the encoder's floor, not a bug.
- **Removing a file in the PDF Editor is announced to screen readers.** Nothing about a removal reads as text: the row disappears and the count beside it is rebuilt rather than edited, so a sighted user watched the list get shorter while a screen-reader user got silence. The obvious markup does not work - `aria-live` on the count is inert, because that element is recreated on every update and a region that arrives already holding its message is not a change to anything the reader was watching. The app now carries one static live region and only its text moves. Identical text is not a change either, so two removals producing the same sentence would announce once; a trailing no-break space alternates, making the second textually distinct without altering a word that is read out.
- **A status handle survives its own run no longer.** `resetAll()` on Compress abandoned an in-flight run's handle instead of cancelling it, leaving a 1s interval repainting a modal for a batch that no longer existed. Found by counting timers rather than reasoning about them: 7 of 51 armed by one suite were still ticking at the end.
- **Frogsworth can be torn down.** `initFrogsworth` constructed the widget and dropped the reference, which made `destroy()` unreachable and left a 15s idle timer and three window listeners with no owner. `destroyFrogsworth()` now exists.
- **Deferred callbacks no longer reach for globals that have gone.** Every repeating and long-lived timer was swept - four intervals and six timeouts of 100ms or more - and the three that read a global from a timer nobody owns were guarded: a 200ms poll that only stops once the format graph loads, the dancing frog's hover animation, and a five-second object-URL revoke. The rest either capture their element or are cleared in a `finally`, and were left alone.
- **The success confetti no longer reaches for a document that may be gone.** All three success paths - Convert, Compress and the PDF Editor - scheduled the celebration on a 150ms timer and read the popup *inside* it, through an accessor that resolves against `document`. A timer outlives whatever scheduled it, so under load that read could land after the surrounding page had been torn down. It surfaced in CI as a run with 1,110 passing tests and nothing failing that still went red on an uncaught `ReferenceError: document is not defined`. The three copies are now one helper that captures the popup up front and dereferences nothing global, and `triggerConfetti` checks for a document before drawing on one.
- **Background emoji sharpen under the cursor again after the window is resized.** The proximity unblur measured every emoji's centre once, at startup, and never again, while the wrappers are positioned in viewport percentages - so a resize moved all nine and left the halo lighting up coordinates nothing occupies any more. Measured across a 1600 to 900 resize: up to 644px of drift, which is most of the window. Two smaller errors went with it: the first measurement was taken while the entrance animation still held the wrappers 20px low, and it read the span, which runs the infinite float keyframe, so the anchor was a frame of an oscillation rather than a rest position. Positions are now taken from the wrapper, re-measured when the entrance settles, and re-measured on resize through a coalescing frame. Verified by hovering all nine after a resize: nine of nine sharpen. [src/components/AmbientBackground/AmbientBackground.ts](src/components/AmbientBackground/AmbientBackground.ts).

### Known limits
- On an already-lean WebM source the two lowest compression levels converge, because libvpx will not encode below roughly 900 kbps at 1080p. The encoder's floor rather than a defect, and it never inflates. The level's target is also taken from the *container* bitrate and spent on the video stream, so "no level exceeds its input" is what every measured source did, not a hard guarantee for one where audio carries most of the bitrate.
- Cancelling a Compress batch during the degraded canvas PDF fallback (which only runs when Ghostscript is unreachable) waits for that one file: it is a main-thread handler, so there is nothing to terminate.
- The whole batch is held in memory.
- The Compress drop zone filters on MIME type alone, so a few image types that have no same-format compressor (HEIC, AVIF) are accepted and then reported *can't compress this* per file. Erring this way is deliberate: the authoritative answer needs the handler registry, which loads later, and over-rejecting at the door would turn away files that can in fact be compressed.

---

## [2.5.0] - 2026-07-15

Zip download names are now unique and content-descriptive. Repeated exports no longer overwrite the previous download or pick up browser `(1)`/`(2)` suffixes, and multi-file archives are named for the operation that produced them instead of borrowing one arbitrary source file's name.

### Fixed
- **Multi-file zip downloads collided on repeat.** Every zip name that a convert or PDF batch produced was either day-granular or had no time component at all, so running the same export twice handed the browser an identically named file - it silently overwrote the earlier download or appended `(1)`, `(2)`. The two convert archives, [src/conversion/actions.ts](src/conversion/actions.ts), used `frogConvert-${getFormattedDate()}.zip` / `original-files-${getFormattedDate()}.zip` where `getFormattedDate()` returned only `YYYY-MM-DD`, so any two "download all" clicks on the same day collided. The organize- and extract-per-source archives, [src/components/PdfWorkspace/PdfWorkspace.ts](src/components/PdfWorkspace/PdfWorkspace.ts), used `${firstName}_organized.zip` / `${firstName}_pages.zip` with **no** disambiguator, so they collided on every repeat. All six archive names now carry a compact ISO-8601 timestamp (see below) so they're unique to the second.

### Changed
- **New shared `timestampForFilename()` helper.** [src/conversion/download.ts](src/conversion/download.ts) exports `timestampForFilename(d = new Date())`, returning a compact ISO-8601 basic-format stamp `YYYYMMDD-HHMMSS` in local time - the de-facto standard for machine-generated exports (Google Takeout, `IMG_YYYYMMDD_HHMMSS` camera files, log rotation): sortable, filesystem-safe (no colons), unique to the second, and without the separator noise of a full `YYYY-MM-DD_HH-MM-SS` form. Lives in `download.ts` because both the converter (`actions.ts`) and the PDF workspace (`PdfWorkspace.ts`) already import their zip helper from there. Unit-tested in [src/conversion/download.test.ts](src/conversion/download.test.ts).
- **Multi-file zip names now describe the operation, not one source file.** A per-source archive only exists when there is **more than one** output, so naming it after `files[0]` (`report_organized.zip`) misrepresented an N-file bundle as belonging to a single "report". [src/components/PdfWorkspace/PdfWorkspace.ts](src/components/PdfWorkspace/PdfWorkspace.ts) now emits `organized-pdfs-<ts>.zip`, `extracted-pages-<ts>.zip`, `watermarked-pdfs-<ts>.zip`, and `pdfs-<ts>.zip`; the converter emits `frogConvert-<ts>.zip` and `original-files-<ts>.zip`. Example: `organized-pdfs-20260715-143207.zip`. The dead `firstName` binding in `doOrganizeSavePerSource` was removed; the one in `doExtract` stays (it still names the single-file grouped-extract output). Individual (single-file) downloads are unaffected - only the multi-file archive names changed.

---

## [2.4.0] - 2026-07-04

Hamburger/close icon rendering fix: the three menu bars no longer rasterize at different thicknesses on fractional display scaling, and the menu-open ✕ is larger and crosses exactly at its middle.

### Fixed
- **Hamburger bars render at even thickness on 125%/150% display scaling.** [src/components/TopBar/TopBar.css](src/components/TopBar/TopBar.css) `#hamburger-btn` bars sat on a 7px vertical pitch (2px bar + 5px gap). At fractional devicePixelRatios (Windows display scaling, browser zoom) 7px maps to a non-integer device-pixel step - 8.75 device px at 125% - so each bar landed on an unrelated subpixel phase: one rasterized as solid rows while another smeared across an extra half-lit row and read as visibly thinner. Pitch is now 6px (2px bar + 4px `gap`); 6 × any quarter-step DPR (1, 1.25, 1.5, 1.75, 2…) has a fractional part of exactly 0 or .5 - its own mirror image - so the outer bars always rasterize identically and the glyph stays vertically symmetric. Verified by per-row pixel analysis in headless Chromium at DPR 1 / 1.25 / 1.5 / 2. (An 8px pitch would make all three bars phase-identical, but was rejected during the cut: it produced a 16×18 taller-than-wide glyph that read as oversized on the 44px mobile control. The 18×14 wide format matches canonical hamburger proportions; only the middle bar can pick up a half-shade softness, and only at ×.25/×.75 scales.)
- **Hamburger bar ends no longer blurry.** Bars were `width: 85%` of the padded content box, resolving to a fractional 15.296875px at a fractional x-offset. Now a fixed `18px` at an integer offset inside the button (`padding: 0` - the fixed width replaces the padding-derived sizing), at both the 36px desktop and 44px coarse-pointer control sizes.
- **Menu-open ✕ crosses at its middle and matches the hamburger's optical size.** The ✕ is the two outer bars converged with `translateY` and rotated ±45°. `translateY(±7px)` at 125% scaling is ±8.75 device px, so the two strokes snapped to the pixel grid in opposite directions and their intersection drifted off the middle of the glyph - very visible on what was a ~12px ✕ (the 45° rotation shrank the 15.3px bars' footprint by 1/√2). Now `translateY(±6px)` (matches the new 6px bar pitch; ±6 × quarter-step DPRs land on the same subpixel phase, so the strokes snap together, not apart) plus `scaleX(1.4)` stretching each arm to 25.2px, so the ✕ spans ~17.8px - optically matching the 18px-wide hamburger. Ink-map analysis confirms the crossing sits exactly on the button's center row/column with all four arms mirror-symmetric at DPR 1 / 1.25 / 1.5 / 2 / 4, including at fractional page offsets, and that mobile (44px control, DPR 3) keeps the same optical size as v2.3.10.
- **Docs sidebar toggle aligned to the same geometry.** [src/styles/docs.css](src/styles/docs.css) `#nav-toggle` had the same defect worse: 1.5px bars can never fill a whole device-pixel row, so they rendered unevenly at every scale, on a fractional 5.5px pitch. Now the same 18×2px bars on a 6px pitch as the app hamburger.

---

## [2.3.10] - 2026-05-20

Custom-cursor visibility fix for low-contrast displays.

### Fixed
- **Custom cursor visible on low-contrast displays.** [src/components/CustomCursor/CustomCursor.css](src/components/CustomCursor/CustomCursor.css) bead `::after` rules in both themes were tuned for the brand surface and disappeared once the display itself was poor (cheap LCDs, glare, dim brightness, narrow viewing angle). Light mode was `rgba(255, 255, 255, 0.50)` fill + `rgba(0, 0, 0, 0.10)` border, which read as ~50% white on a white page with a barely-there edge. Dark mode was `rgba(255, 255, 255, 0.07)` fill + `rgba(255, 255, 255, 0.13)` border, which on `#000000` produced a ~7% luma delta against the page (effectively a ghost). Bead fill now lifts to `rgba(255, 255, 255, 0.85)` (light) / `rgba(255, 255, 255, 0.32)` (dark), border to `rgba(0, 0, 0, 0.28)` (light) / `rgba(255, 255, 255, 0.55)` (dark), and an extra `0 0 0 1px` halo ring is added to the `box-shadow` stack in both themes so the bead always carries a one-pixel contrast edge regardless of the surface underneath. The rainbow `::before` highlight, the `.cursor-glow` aura, the interactive / active-click state transitions, and the `(pointer: coarse)` short-circuit are untouched. Picked from an A/B side-by-side prototype across white, black, mid-grey, gradient, brand accent, light-on-light text, dark-on-dark text, mixed-luma image content, and frosted top-bar surfaces.

---

## [2.3.9] - 2026-05-18

Spacing fix on top of v2.3.8: the gap above the action-footer divider was double-counted because flex containers don't collapse vertical margins, so `<p>`'s natural 1.5rem `margin-bottom` plus the footer's 1.5rem `margin-top` stacked to ~3rem.

### Fixed
- **Popup-footer gap normalised to 1.5rem.** [src/conversion/conversion.css](src/conversion/conversion.css) now zeroes the margin-bottom on the body element directly preceding `.popup-actions-footer` via `#popup .popup-scroll > *:has(+ .popup-actions-footer) { margin-bottom: 0 }`. The footer keeps its `margin-top: var(--space-6)` as the single source of truth for the gap above the divider. Result: uniform 1.5rem above divider / 1rem below (the footer's existing padding-top) on every popup with an action footer, regardless of whether the last body element is `<p>`, a notice card, or a custom `<div>`. Previously the gap ranged from ~1.5rem to ~3rem depending on what kind of element preceded the footer; now all popups read the same.

---

## [2.3.8] - 2026-05-13

Two polish items on top of v2.3.7: error popups no longer blame the file by default, and every popup with an action footer keeps breathing room between the body and the divider line.

### Fixed
- **Error popups stop blaming the file by default.** [src/conversion/actions.ts](src/conversion/actions.ts) `showConversionFailedPopup` was emitting the same body - *"The file may be corrupted, password-protected, or too complex for the converter."* - for every error kind except `not_available`, including the catch-all `kind: "unknown"` for errors that don't match any classification regex. EPS to PNG and similar routes that are advertised in the format graph but fail at runtime (ImageMagick WASM ships without Ghostscript) were falsely accusing the user's file. The function now branches by `kind`: `not_available` and `unknown` both render under "Conversion not available yet" with neutral, capability-gap copy and the maintainer email; `input_issue` keeps the file-side copy (password / corrupt / variant); `runtime_failure` says "X to Y was interrupted, try again or use a smaller file"; `cancelled` early-returns so a leaked cancellation can't render under a failure title.
- **No more duplicate "Something went wrong" line in error popups.** The muted detail span was echoing the same generic string the body already conveyed. [src/conversion/actions.ts](src/conversion/actions.ts) `showConversionFailedPopup` now suppresses the detail span when `error.message` equals `GENERIC_CONVERSION_ERROR_TEXT` or `CONVERSION_NOT_AVAILABLE_TEXT`; specific messages (password, worker crashed, too-large) still surface.
- **`toUserErrorInfo` recognises WASM-handler capability gaps.** [src/components/utils/index.ts](src/components/utils/index.ts) now classifies `NoDecodeDelegateForThisImageFormat`, `MagickDelegateError`, `Ghostscript`, `unable to load module`, `ImageMagick is not configured`, `not authorized` / `not authorization`, and `policy denies` as `kind: "not_available"`. Covers ImageMagick policy.xml denials (e.g. PDF read disabled) and the Ghostscript-missing case for EPS/PS. Regression test at [src/components/utils/toUserErrorText.test.ts](src/components/utils/toUserErrorText.test.ts).
- **Popup-footer breathing room.** [src/conversion/conversion.css](src/conversion/conversion.css) `#popup .popup-actions-footer` flipped `margin-top: auto` to `var(--space-6)` (1.5rem). The `auto` was redundant - `#popup` is flex-column and `.popup-scroll` is `flex: 1 1 auto`, so the wrapper already pushes the footer to the bottom - and it left the body's last paragraph sitting flush against the 1px `border-top` divider above the action buttons. 1.5rem gap above divider, 1rem padding-top below (footer's existing `padding-top: var(--space-4)`) gives a uniform breathing pocket on every popup with a footer (`showAlertPopup`, `showConfirmPopup`, `showSizeWarningPopup`, `showFileTypeMismatchPopup`, `showUploadSummaryPopup`, `showUnsupportedFilePopup`, `ensureCancelButton`, `showPartialDownloadPopup`, conversion success modal, PDF success modal).

---

## [2.3.7] - 2026-05-13

Two small follow-ups on v2.3.6: the cold-start splash now fully owns the boot UI (the legacy thin loading bar at the top is gone), and the popup scroll architecture is simplified so the wrapper is structural-only and each popup that needs scrolling provides its own inner scroller.

### Removed
- **`#loading-bar`.** v2.3.3's cold-start splash overlay covers the entire viewport during boot, so the 3px breathing bar at `top: 0` was hidden underneath and only visible in the brief window after the splash dismissed but before phase-2 handlers finished. Deleted [src/main.ts](src/main.ts) `showLoadingBar()`, the two call sites, the `hasLocalStorageCache` flag that gated them, and the `#loading-bar` CSS + `loading-bar-grow` / `loading-bar-breathe` / `loading-bar-finish` keyframes + `--z-loading-bar` token from [src/styles/global.css](src/styles/global.css). The splash is now the single source of "we're booting" feedback.

### Changed
- **`.popup-scroll` is structural, not a scroller.** [src/components/Popup/Popup.css](src/components/Popup/Popup.css) `.popup-scroll` flipped from `overflow-y: auto` to `overflow: visible`. The wrapper still exists to anchor margin-reset selectors and to give `popupContent()` a stable target to clear on rotation, but popups that genuinely need scrolling supply their own inner scroller (`.type-filter-scroll`, `.upload-summary-list`). Removes the awkward double-scroll situation where both `.popup-scroll` and an inner list could each show a scrollbar.

---

## [2.3.6] - 2026-05-13

Scrollbar-inside-the-card refactor across the three modal surfaces (Popup, FilesModal, PdfWorkspace mobile trays), a handful of UX defects that surfaced under v2.3.3's cold-start splash, and security/privacy hardening on the HAR handler, share-target SW, and CSP.

### Fixed
- **Scrollbar no longer escapes rounded corners.** [src/components/Popup/Popup.ts](src/components/Popup/Popup.ts), [src/components/FilesModal/FilesModal.css](src/components/FilesModal/FilesModal.css), and [src/components/PdfWorkspace/PdfWorkspace.css](src/components/PdfWorkspace/PdfWorkspace.css) all moved from outer-element `overflow: auto` to an inner `.popup-scroll` / `.ws-tray-scroll`. Outer stays `overflow: hidden` with `border-radius`; inner owns the scrollbar so it lives inside the rounded card instead of protruding past the corner. Drops the `direction: rtl` hack the FilesModal was using to fake scrollbar-on-the-left.
- **PDF Workspace mobile tray, overlay, toolbar invisible at boot.** v2.3.3 added `html.app-revealed body > * { animation: app-fade-in 0.25s forwards }` to FOUC-gate the page. `forwards` stuck every body-appended element at opacity 1, which beat the mobile tray's opacity-based hidden state, so the tray ghost was visible (and intercepting taps) before the kebab was opened. [index.html](index.html) now drops `app-revealed` once the first `animationend` fires (with a `setTimeout(350)` fallback for prefers-reduced-motion), so any later body-appended element inherits no animation. Regression covered by a new [test/e2e/conversion-flow.test.ts](test/e2e/conversion-flow.test.ts) case that probes a post-boot `<div style="opacity:0">` plus a Watermark-tray DOM test in [src/components/PdfWorkspace/PdfWorkspace.dom.test.ts](src/components/PdfWorkspace/PdfWorkspace.dom.test.ts).
- **Cancel button no longer bleeds into the next popup.** [src/components/Popup/Popup.ts](src/components/Popup/Popup.ts) `popupContent()` now strips any non-`.popup-scroll` direct children of `#popup` on rotation, matching the pre-refactor `popupBox.innerHTML = ""` semantic. `ensureCancelButton` in [src/conversion/cancellation.ts](src/conversion/cancellation.ts) appends `.popup-actions-footer` as a sibling of `.popup-scroll`; without the strip it survived `replacePopup([...])` and ghosted under the cancellation spinner and success modal.
- **Background-emoji proximity unblur tuned.** [src/components/AmbientBackground/AmbientBackground.ts](src/components/AmbientBackground/AmbientBackground.ts) now uses CORE_RADIUS=60 (fully clear) plus HALO_RADIUS=180 (ramp). The single-radius linear ramp from v2.3.5 never quite let the cursor-area emoji fully sharpen. Also dropped the `isWide` MOBILE_BREAKPOINT gate: `isTouchUi()` is the correct gate, and the width gate was masking the effect on narrow desktop windows.
- **`#bg-visuals` hidden by input modality, not viewport width.** [public/404.html](public/404.html) and [src/styles/global.css](src/styles/global.css) flipped `@media (max-width: 800px) { #bg-visuals: none }` to `@media (hover: none) and (pointer: coarse)`. iPad-landscape (~1024px wide, pure touch) was paying for parallax it can't trigger; narrow desktop windows now keep their visuals.
- **Background-emoji set refresh.** [index.html](index.html), [public/404.html](public/404.html), [src/main.ts](src/main.ts): converter set drops ABC-letters and lightning for palette + package; PDF-editor set replaced printer / lock / ruler with bookmark / watermark drop / notebook (more on-the-nose for the tools).
- **Long URLs in docs wrap.** [src/styles/docs.css](src/styles/docs.css) `#doc-body a` gains `overflow-wrap: anywhere`. A long unbroken URL in CONTRIBUTING.md was overflowing the doc body on narrow viewports.

### Security
- **HAR handler hardening.** [src/handlers/har.ts](src/handlers/har.ts) `sanitizeZipPath` strips `..` segments (both literal and percent-encoded), drive letters, and absolute-path prefixes before passing entry names to JSZip. Zip-slip surface neutralised. Also a 250 MB input cap so a pathological DevTools capture can't lock the worker on `JSON.parse`. Unit coverage at [src/handlers/har.test.ts](src/handlers/har.test.ts).
- **Service-worker share-target pre-parse cap.** [src/pwa/sw.ts](src/pwa/sw.ts) rejects multipart POSTs whose `content-length` exceeds 110% of `SHARE_TARGET_MAX_TOTAL_BYTES` before calling `formData()`. The post-parse counter still runs for streams without a content-length header; this just prevents a multi-GB share from OOMing the SW on low-RAM phones before the per-byte loop has any chance to reject.
- **CSP-Report-Only baseline.** [public/_headers](public/_headers) adds `Content-Security-Policy-Report-Only` to production deploys. No enforce, no breakage. Surfaces inline-script and unexpected connect-src violations in browser DevTools so the eventual flip to enforced can be planned with eyes open.

### Internal
- **`ensureHandlerInit` race-fix.** [src/workers/handlerInit.ts](src/workers/handlerInit.ts) wraps `FormatHandler.init()` in a WeakMap-keyed in-flight promise. Concurrent callers (two routes both warming the same handler) now share one init; failures clear the cache so retry is possible. Replaces three inline `if (!handler.ready) await handler.init()` sites in [src/workers/conversion.worker.ts](src/workers/conversion.worker.ts). Tests at [src/workers/handlerInit.test.ts](src/workers/handlerInit.test.ts).
- **[SUBMODULES.md](SUBMODULES.md)** lists all nine vendored submodules under `src/handlers/` with pinned commit SHAs, upstream URLs, and a last-reviewed column (locked to 2026-05-13). Plus a short audit checklist for future updates.
- **`fenToJson` handler test** at [src/handlers/fenToJson.test.ts](src/handlers/fenToJson.test.ts) closes the round-trip coverage gap.
- **Format cache refreshed.** [public/cache.json](public/cache.json) regenerated to match the current handler registrations (post-v2.3.2 additions were not yet baked in).

### Docs
- **ARCHITECTURE.md** cross-links the PWA-entry-points and Session-persistence sections so the two "load files into the app" surfaces aren't conflated. New "Browser bridge" plus "Cancellation" subsections under MCP/REST.
- **CONTRIBUTING.md** gains a five-line directory cheatsheet so new contributors don't have to crack ARCHITECTURE for first-touch directories.
- **CONVERTER.md** splits Install / Entry points / Offline. iOS share-target caveat called out: iOS Safari's Web Share Target is limited, depending on iOS version the share menu may launch frogConvert without auto-loading the file.
- **DEPLOYMENT.md** cache section rewritten. Pre-built `public/cache.json` is the production path (Docker, Netlify, Electron); manual capture via `printSupportedFormatCache()` is supported but rarely needed.
- **INTEGRATIONS.md** corrects the MCP tool count (6 → 7; the four PDF tools are merge / organize / extract / watermark) and documents the REST API's loopback-only binding with the Origin/Host check (DNS-rebinding defense).
- **PDF_EDITOR.md** Extract folded into the Organize section (Extract is a sub-mode of the Organize tab, not its own tab). Output description names the watermark "combined vs zip" choice.

---

## [2.3.5] - 2026-05-12

Restores the background-emoji unblur-on-cursor effect that's been gone since the a11y pass back in `781f9c9`. Intended to land as part of v2.3.4 but branch protection blocks force-pushing the release commit, so it ships as a patch.

### Fixed
- **Background emojis sharpen near the cursor again.** The `#bg-visuals span:hover` rule that unblurred emojis under the pointer was deleted in `781f9c9` because those spans had to flip to `pointer-events: none` to stop swallowing real clicks - once they were unhoverable, the CSS `:hover` route was dead. [src/components/AmbientBackground/AmbientBackground.ts](src/components/AmbientBackground/AmbientBackground.ts) now drives the unblur from JS using the `dist` value already computed for parallax: spans within 140px of the smoothed cursor lerp from `blur(12px)/opacity:0.22` toward `blur(0)/opacity:0.6`. The CSS `transition: filter, opacity` on [src/styles/global.css](src/styles/global.css) was dropped - per-frame JS writes would lag-chase a 0.5s transition, and the parallax smoothing already supplies the easing.

---

## [2.3.4] - 2026-05-12

Three UI alignment fixes after on-device review: the PDF editor's content arrival now mirrors the converter card's slide-up instead of popping in, the PWA "Reload now" pill no longer ships with the browser's default 3D button bevel, and the docs theme toggle uses an actual SVG icon instead of a Unicode glyph that sat off-center inside its button.

### Fixed
- **PDF tool content arrives with an entrance, not a pop.** [src/components/PdfWorkspace/PdfWorkspace.ts](src/components/PdfWorkspace/PdfWorkspace.ts) now adds a `.ws-content-enter` class to the layout root each render function mounts (empty dropzone, merge left+right, organize left+right, watermark left+right). The outer `#pdf-tool-content.entrance.d5` already fires during the page cascade but the tool UI is lazy-loaded into it afterwards, so the slide-up played on an empty container and content then appeared with no animation, most visibly on mobile where the chunk-load gap is widest. A `shouldEnter(signature)` gate keeps the slide from replaying on in-place updates (adding a file, toggling a watermark setting) so only tool switches and empty↔populated transitions animate. New keyframe in [src/components/PdfWorkspace/PdfWorkspace.css](src/components/PdfWorkspace/PdfWorkspace.css) reuses the global `slideUp` so `prefers-reduced-motion` neutralizes it via the existing `*` gate in [src/styles/global.css](src/styles/global.css).
- **PWA "Reload now" banner button no longer has a default browser bevel.** [src/components/ConvertCard/ConvertCard.css](src/components/ConvertCard/ConvertCard.css) `.convert-notice-link` was set to `<button>` in [src/pwa/registerSW.ts](src/pwa/registerSW.ts) when the update prompt was extracted from inline styles, but never reset the browser's default `outset` button border. That painted as darker arcs at the top-left and bottom-right of the pill - visible on dark mode in particular. Added `border: none` plus an explicit `cursor: pointer` (now that it's a `<button>` and not an `<a>`).
- **Docs theme toggle icon centers in its button.** [src/docs/theme.ts](src/docs/theme.ts) was writing the Unicode glyphs `☼` (U+263C) and `☽` (U+263D) into `#theme-toggle` via `textContent`. The fallback font's glyph metrics for those characters put the visible shape in the upper half of the em-box, so even with the button flex-centered the icon read as drifting toward the top. Switched to inline Lucide SVGs (`Icons.moon` / `Icons.sun`, added to [src/components/icons.ts](src/components/icons.ts)) so the icon is geometrically centered like every other icon-only control. The HTML fallback in [docs/index.html](docs/index.html) keeps `&#9790;` for the no-JS case.

---

## [2.3.3] - 2026-05-12

Lighthouse audit cleanup plus a cold-start splash so the page no longer flashes blank while phase-2 handlers are still downloading. Source maps reach DevTools, agent-readable docs are honest, and the markdown URLs advertised to crawlers actually serve markdown.

### Added
- **Cold-start splash overlay.** [index.html](index.html) ships an inline `#cold-start-splash` div (frog logo + title + indeterminate progress bar) styled via an inline `<style>` block so it renders before any JS or CSS chunk arrives. The overlay is dismissed when [src/main.ts](src/main.ts) adds `body.app-ready` at the end of the loading sequence, with a 15s safety-net `setTimeout` so a boot crash can't lock the user on the splash. The existing FOUC gate moved off inline `style.cssText` mutations to `html.app-loading` / `html.app-revealed` classes for cleaner cascade.
- **[public/llms.txt](public/llms.txt)** per the [llmstxt.org](https://llmstxt.org/) spec: H1 title, blockquote summary, link sections for project / user docs / contributor docs / crawler policy. Every URL points at `/docs/*.md` (verified to serve `text/markdown`) instead of the root-level paths that return HTML in production. Fixes Lighthouse's `llms-txt` failure (Agentic Browsing 67 → 100).

### Fixed
- **Source maps now resolve in DevTools.** [vite.config.js](vite.config.js) was building with `sourcemap: 'hidden'` - `.map` files were emitted but the `//# sourceMappingURL=` comment was stripped from every chunk, so DevTools couldn't auto-load them and Lighthouse's `valid-source-maps` audit failed. Flipped to `sourcemap: true`. No bundle-size delta (maps were already on disk), no privacy delta (public repo).
- **Root-level `/README.md`, `/CHANGELOG.md`, `/SECURITY.md`, `/AGENTS.md` no longer 404-as-HTML.** Those URLs were advertised in [public/robots.txt](public/robots.txt) but the Netlify SPA fallback was serving `text/html` (the converter page) at them; markdown crawlers got the index page instead of the docs. Re-pointed the `robots.txt` comments at `/docs/<file>.md` (where `viteStaticCopy` actually mirrors root markdown via `{ src: "*.md", dest: "docs" }`).
- **`LICENSE` now ships in `dist/`.** The `viteStaticCopy` glob `*.md` didn't match because `LICENSE` has no extension. Added `{ src: "LICENSE", dest: "docs" }` in [vite.config.js](vite.config.js) so `https://frogconvert.xyz/docs/LICENSE` resolves.
- **`#loading-bar` respects iOS safe-area inset.** [src/styles/global.css](src/styles/global.css) fixed-position bar was sitting at `top: 0`, ending up under the notch / Dynamic Island on iOS PWAs. Switched to `top: env(safe-area-inset-top, 0px)`.
- **`.convert-notice` mobile layout switches at the right breakpoint.** [src/components/ConvertCard/ConvertCard.css](src/components/ConvertCard/ConvertCard.css) was vertical-stacking notices only below 600px, but `MOBILE_BREAKPOINT` is 800px everywhere else. Aligned to 800px.

### Changed
- **PWA update banner moved off inline styles.** [src/pwa/registerSW.ts](src/pwa/registerSW.ts) was setting `position: fixed; bottom: 1rem; right: 1rem; ...` via `notice.style.cssText`. Extracted to `.convert-notice-pwa-update` in [src/components/ConvertCard/ConvertCard.css](src/components/ConvertCard/ConvertCard.css) with `env(safe-area-inset-bottom)` for notch handling and a `slide-up-fade` entrance.
- **Docs topbar controls now use the `--control-size` token.** [src/styles/docs.css](src/styles/docs.css) `.topbar-btn`, `#theme-toggle`, `#nav-toggle` migrated off hardcoded `2rem` heights/widths. `--topbar-h` recomputed from the same token. Added `line-height: var(--leading-none)` so glyph-only buttons don't drift vertically. Drops the duplicate mobile padding rule.

### Internal
- **`.page-title` mobile sizing.** [src/styles/global.css](src/styles/global.css) bumps the title to `2.25rem` with extra top margin at ≤800px; [src/components/TopBar/TopBar.css](src/components/TopBar/TopBar.css) keeps the ≤400px font-size override but drops the now-redundant margin rules. Cleaner cascade, no visual change at supported widths.

---

## [2.3.2] - 2026-05-09

Three quiet defects fixed: a missing icon on the Electron build, a `manifest.webmanifest` 404 firing on every dev / E2E / desktop session, and uncaught `THREE.WebGLRenderer` failures on hardware-acceleration-disabled environments.

### Fixed
- **Electron app icon.** `electron-builder` was building NSIS / DMG / AppImage artifacts with the default Electron icon - `package.json` `build` block had no `icon` field. Added `"icon": "public/icon-512.png"` (cross-platform; electron-builder generates per-target sizes from the 512 PNG). `BrowserWindow` in [src/electron.cjs](src/electron.cjs) also now passes `icon:` so the running window - taskbar on Linux, window-frame on Windows - shows the frog instead of the default Electron logo.
- **`Manifest fetch from .../manifest.webmanifest failed, code 404`.** [index.html](index.html) hardcoded `<link rel="manifest" href="/manifest.webmanifest">`, but `vite-plugin-pwa` is only active for the production-web build (gated off for desktop via `!isDesktopBuild`, off for dev via `devOptions.enabled: false`). So dev, Puppeteer E2E (`vite createServer` random port) and the Electron desktop build all hit a 404 on every page load. The static link is now removed; `vite-plugin-pwa` already injects a `<link rel="manifest">` automatically during the production-web build, and emits nothing in the gated-off paths - so the link only ships when the file actually does.
- **`THREE.WebGLRenderer: A WebGL context could not be created`** on systems where ANGLE falls back to the Microsoft Basic Render Driver (CI runners, VMs, RDP, `--disable-gpu` Chromium). Three handlers (`threejs.ts`, `sppd.ts`, `bsor/renderer.ts`) instantiated `WebGLRenderer` with no probe and no try/catch; three.js then logged its three internal errors and threw uncaught. New shared bootstrap [src/handlers/_webgl.ts](src/handlers/_webgl.ts) pre-flights with a cheap `canvas.getContext('webgl2'||'webgl')` probe and wraps the constructor - failures surface as a single, actionable error ("WebGL is not available… enable hardware acceleration") through the normal conversion-error channel.

### Privacy
- **No more Google Fonts.** [index.html](index.html), [public/404.html](public/404.html), [docs/index.html](docs/index.html), and [docs/slidedeck.html](docs/slidedeck.html) had a `<link rel="preconnect">` plus a parallel `<link rel="stylesheet">` to `fonts.googleapis.com`, loaded on every page visit. Inter is already bundled via `@fontsource-variable/inter` (imported in [src/styles/global.css](src/styles/global.css)) and the system-font fallback chain in `--font-sans` covers any load failure. The Google Fonts links were dropped entirely. No more font-CDN referer/IP leak.
- **[SECURITY.md](SECURITY.md) rewritten** to reflect the actual behavior: MCP runs over stdio (not a port), no font CDN, no SLA / ack-within-X-days commitments. Hobby project, single maintainer.

### Internal
- Unit test [src/handlers/_webgl.test.ts](src/handlers/_webgl.test.ts) covers the probe-fail, constructor-throw, and happy paths so the WebGL fallback can't silently regress.

---

## [2.3.1] - 2026-05-09

Internal polish on top of v2.3.0: design tokens consolidated at `:root`, unified `:focus-visible` contract across every interactive surface, and a small Organize-view trim.

### Changed
- **"Add blank page" trailing card removed from Organize.** It was a literal duplicate of the existing `ws-page-insert-trailing` `+` button that already inserts a blank page at the end. Same handler (`insertBlankPage(pages.length)`), same affordance - the second card was dead UI.
- **`:focus-visible` rings unified onto a single contract.** `outline: 2px solid var(--primary); outline-offset: 2px; box-shadow: none` across `icon-btn`, `cat-tab`, `format-option`, `pill-option`, `btn-primary`, `btn-secondary`, `btn-tertiary`, `ws-btn`, `close-btn*`, `pagination-btn`, `ws-page-card`, `ws-file-card`, `ws-wm-slider`, `floating-card-surface`, `toolbar-primary`. Drops the double-shadow ring; outline-only respects forced-colors mode.
- **`--touch-target` token (2.75rem)** added at `:root`. `.close-btn-md` bumped 2.5rem → 2.75rem under `(any-pointer: coarse)` to hit WCAG 2.5.5.
- **Resume popup copy simplified.** `N PDF · M pages`, drops the "Undo history will reset" and "custom watermark" hints. The summary already conveys the load on next render.

### Internal
- **Design tokens consolidated at `:root`.** New `--rainbow-gradient` (single source for the selected-state ::before border), `--transition-fast/normal/slow/spring`, `--ease-out-expo`, full `--z-*` scale (`z-base` … `z-skip-link`), and `--bp-*` breakpoint references. Rename rather than restack - zero visual change. 11 component CSS files migrated off hardcoded durations and z-indices.
- **PdfWorkspace class-name pruning.** `.ws-file-add` / `.ws-page-add` removed; `.ws-dropzone` (from `createDropzone`) carries the drop-target visual; `.ws-file-card` / `.ws-page-card` carry grid-cell shape. Two classes compose without an add-only third. Sortable `draggable` selector and click-delegation guard updated to match.
- **Mobile toolbar primary buttons** (Merge, Watermark export, Extract, Export PDF) inherit the unified focus ring via `.toolbar-primary`.
- **`floating-card-surface`** removed from `ws-page-plus` - the per-card plus-buttons live on top of the page card and don't need their own surface.

---

## [2.3.0] - 2026-05-08

frogConvert is now an installable Progressive Web App with offline support and resumable sessions. Drop a file, close the tab, come back - your work is offered back to you. Share files into frogConvert from the OS share sheet or "Open with…" menu. Conversion handlers and assets cache as you use them so repeat conversions work offline.

### Added
- **Service worker and Web App Manifest.** Install prompt on Chromium / Edge / Safari; standalone display; iOS apple-touch-icon and status-bar styling; Android adaptive icons (maskable). Offline-ready toast on first install, dismissable update banner when a new version is available - never silent skipWaiting (`registerType: 'prompt'`).
- **Web Share Target.** A POST handler in [src/pwa/sw.ts](src/pwa/sw.ts) accepts multipart shares from the OS share sheet, writes the payload to a dedicated CacheStorage entry, and redirects to `/?share-target=ready`. The page replays from cache and routes files into the Converter or PDF Editor based on file type. Capped at 25 files / 500 MB total per share.
- **File handlers (`launchQueue`).** "Open with frogConvert" registers for image / video / audio / PDF / text / ZIP / 7z extensions; files arrive via the same `EXTERNAL_FILES_EVENT` path as share-target.
- **Resume prompt.** Cold-start with a saved session of the same kind shows a "Resume your last conversion?" / "Resume your PDF workspace?" popup. Same-tab reload silently restores instead. Tab-clone (Chrome "Duplicate tab") detected via BroadcastChannel and routed to the orphan path so two tabs never last-write-win on the same sessionId.
- **Session persistence - Converter.** Files, target format, page selection survive tab close, browser restart, and accidental mode-switches. Bytes round-trip as `Uint8Array` through IndexedDB.
- **Session persistence - PDF Editor.** Files, active tool tab (Merge / Organize / Watermark), page selection, watermark settings (text, size, color, opacity, rotation, repeat-mode, page range) all persist across reload.
- **Cache-size helpers.** `getTotalCacheBytes`, `clearAllCaches`, `formatCacheBytes`, `sumCacheBytes` in [src/pwa/cacheControls.ts](src/pwa/cacheControls.ts) - wiring for a future Settings affordance.

### Changed
- **Mobile category filter auto-resets** on entering `(max-width: 800px)`. The category strip is hidden on mobile, so leaving an active category set silently filtered the format list with no way to clear it. The `change` listener now resets the filter when crossing into the mobile breakpoint.
- **Top-bar control icons** redrawn on a unified 16×16 grid (`.top-control-icon` class) for visual parity across mode / theme / app-mode toggles. Theme toggle gained a proper SVG moon glyph in place of the `&#9788;` codepoint, which rendered inconsistently across fonts.
- **`apple-touch-icon`** now points at `/apple-touch-icon-180.png` instead of the favicon, so iOS home-screen installs get a real 180×180 icon instead of an upscaled 32×32 favicon.
- **Documentation pass.** README headline bumped, ARCHITECTURE gained PWA + persistence sections, CLAUDE.md file map covers the new directories, CONVERTER and PDF_EDITOR mention Install / Share / Resume, DEPLOYMENT documents the SW serving headers, SECURITY notes the local CacheStorage footprint.

### Fixed
- **Watermark flat-page list desync after file mutations.** `wmFlatPages` was rebuilt only on tab activation; removing a file from the sidebar while the Watermark tab was inactive left a stale flat-index map. `onFilesMutated()` now calls `wmSyncWithFiles()` first so the next render sees a consistent view.
- **Centralised dirty tracking in PdfWorkspace.** Per-mutation-site `markDirty` calls were drifting (some paths missed manifest-only updates after reorder). All file/state mutations now route through the shared mutation hook, so a save is never missed.

### Internal
- **`src/pwa/`** - service worker, registration, share-target replay, cache controls, constants. Workbox runtime caches: CacheFirst for `/wasm/` (30 entries, 7-day TTL, status 200 only - opaque cross-origin entries rejected), StaleWhileRevalidate for `/assets/` (200 entries, 30-day TTL), `/js/`, `/docs/*.md`. NavigationRoute precaches `/index.html` with a denylist for `/api`, `/.well-known`, `/docs`, `/headless`. JS chunks runtime-cached, not precached, so install isn't a 17 MB download.
- **Custom share-target fetch listener installed before Workbox's `registerRoute`.** A multipart POST to `/` has `request.mode === "navigate"` and would otherwise be eaten by the precached `/index.html` NavigationRoute. Order is load-bearing.
- **`src/components/persistence/`** - IndexedDB-backed session store (two stores: `sessions` keyed by sessionId, `fileBytes` keyed by `<sessionId>:<fileId>`), generic `createPersistor` factory, Converter-specific wiring. PDF Workspace inlines the same factory at [src/components/PdfWorkspace/PdfWorkspace.ts](src/components/PdfWorkspace/PdfWorkspace.ts).
- **Manifest-last write order.** Bytes write before manifest, so a tab kill mid-flush leaves a stale manifest pointing only at fileIds whose bytes already landed - never a manifest referencing unwritten bytes. Quota-exceeded errors pause autosave with a single warning toast; non-quota errors (missing file, serialization) skip the id and continue.
- **`bumpNextFileId`** in [src/tools/types.ts](src/tools/types.ts) so restored sessions don't collide with fresh file ids minted in the same browser session.
- **Build-time PWA wiring.** [vite.config.js](vite.config.js) gains `vite-plugin-pwa` (`injectManifest` strategy, `srcDir: 'src/pwa'`, `globPatterns` precaches HTML/CSS/icons/fonts only). Disabled for desktop builds (`!isDesktopBuild`) since Electron runs from `app://` where a service worker is both useless and a registration footgun.
- **nginx + Netlify**: `Service-Worker-Allowed: /` on `/sw.js`; no-cache on `/sw.js` and entry HTMLs (`/index.html`, `/docs/index.html`, `/headless/index.html`); immutable 1y on `/wasm/*`; correct `application/manifest+json` for `/manifest.webmanifest`.
- **Tests.** New unit suites: `registerSW.test.ts` (env gating: Electron / file-protocol / no-window skip), `shareTarget.test.ts` (cache replay + `launchQueue` consumer), `cacheControls.test.ts` (byte formatting + sum), `sessionStore.test.ts`, `createPersistor.test.ts` (dirty tracking, manifest-last invariant, quota pause).
- **Dependencies.** `vite-plugin-pwa ^1.3.0`, `workbox-window ^7.4.1`. Workbox runtime modules pulled transitively.

---

## [2.2.1] - 2026-05-07

Audit-driven patch release. Three Critical-class data-loss paths closed, mobile-first touch and a11y sweep across both routes, watermark preview rebuilt on a synchronous bitmap cache, and power-user keyboard productivity in the PDF Editor and Format modal.

### Fixed
- **App-mode switch no longer destroys PDF workspace state.** Toggling between Converter and PDF Editor used to call `resetAll()` on the workspace, wiping loaded files, page reorder, watermark settings, and the undo history. Users who organized a long PDF and tapped the mode toggle by mistake (or to glance at the converter copy) returned to an empty workspace with no recovery. The mode-out path now calls `cleanup()` instead - DOM listeners and the body-mounted toolbar/tray are torn down, but module state is preserved. `initPdfWorkspace()` re-renders on subsequent calls so coming back remounts the UI on the existing data.
- **Success popup no longer eats your file when closed early.** The post-conversion popup launched a `setTimeout(downloadAllConvertedFiles, 400)` gated on `popupBox.classList.contains("open")`. Fast-clickers who tapped *Done* before 400 ms got confetti but no download. Blob URLs are independent of popup lifetime, so the guard was dropping the file for no reason. Removed; downloads now fire unconditionally. Confetti stays popup-anchored.
- **Files modal no longer replaces your file list when you drop on its background.** Drops anywhere on the modal except the inner *Drop more PDFs* zone bubbled to UploadZone's window-level handler, which silently called `proceedWithFiles()` and replaced `currentFiles`. Capture-phase `dragover`/`drop` listeners on the modal element now claim drops while open and route to `addMoreFiles()`.
- **Mobile last grid row no longer hidden behind the fixed toolbar.** `.ws-grid-card` `padding-bottom` recomputed via `var(--space-12) + var(--space-6) + var(--space-3) + env(safe-area-inset-bottom)` (single-row toolbar) and `+ var(--space-12) + var(--space-4)` more for the Organize two-row variant, so the last row of thumbnails has 20 px of breathing room above the floating toolbar.
- **Mascot apology removed from Safari PDF error popup.** The Safari-specific error message ended with `Frogsworth is sorry`, which violated the CLAUDE.md "no mascot catchphrases" rule inside a critical-error popup. The message already names the escape route (Chrome / Firefox); the kaomoji was noise.
- **Em dash in `showDetectedFormat` copy** replaced with a comma per the project copy rule (no em dashes in user-facing strings).
- **Files modal `.file-row` no longer pretends to be clickable.** `cursor: pointer` was set without a row-level click handler - only inner buttons were interactive. Pointer cursor dropped.
- **`.popup-actions` vs `.popup-actions-footer` inconsistency.** `showSizeWarningPopup` migrated from the legacy ad-hoc class to the shared `.popup-actions-footer` so size-warning, success, and error popups render their action rows identically.

### Added
- **Ctrl/Cmd+Click for non-contiguous page selection** in the PDF Editor's Organize tab. `toggleSelection()` takes a third `ctrl` flag that explicitly toggles the clicked page and overrides Shift, matching the Windows / macOS multi-select convention so power users can pick or unpick a single page without disturbing a Shift range. Plain click and Shift+Click behavior unchanged.
- **Redo (Ctrl+Y / Ctrl+Shift+Z)** in the PDF Editor. A 30-snapshot redo stack runs alongside the existing undo history. New mutating actions clear the redo branch (same convention as code editors and image tools). `cleanup()` and `resetAll()` clear both stacks.
- **Arrow-key navigation across the Format modal options.** ↓ from the search input pulls focus into the first visible option; ↑ from the first option pulls focus back into search. ↑/↓/Home/End move within the option list. Saves keyboard users ~70 Tab presses to reach the bottom of the All Formats list.
- **Arrow-key navigation across the PDF Editor tab bar.** Arrow Left / Right / Home / End move focus between Merge / Organize / Watermark inside the new tablist.
- **Move ▲ / ▼ buttons in the PDF mobile tray.** Touch users couldn't reorder pages because the long-press drag fought page scrolling and the move-row was hidden behind the desktop-only `body.ws-keyboard-mode`. The tray now exposes Move up / Move down buttons that reuse the existing `moveSelection()`, giving touch users a non-drag reorder path.
- **Mobile dismiss button on toasts.** Toasts had click-to-dismiss but no announced affordance for screen-reader or keyboard users; a real `× Dismiss` button now lives inside every toast with `aria-label="Dismiss"`.
- **Skip-link** for keyboard users. The first Tab from the address bar now reveals a visible "Skip to content" link that jumps to `<main>`, saving the previous ~10 Tab stops through nav controls.

### Mobile
- **Touch-target sweep across the app** under `@media (any-pointer: coarse)`. `--control-size` bumped from 36 px to 44 px (WCAG 2.5.5), `.icon-btn`, `.close-btn-md`, `.close-btn-lg`, `.pagination-btn`, the Files modal "Replace all"/"Remove all" buttons, `.cat-tab` rows, `.format-option` rows, the Watermark Customize summary, and the watermark slider hit area all hit 44 × 44. `(any-pointer: coarse)` was chosen over `(pointer: coarse)` so hybrid touch laptops get touch-density even when a mouse is also present.
- **iOS focus-zoom killed without scaling the type system.** Inputs receive a surgical `font-size: 16px` under `(any-pointer: coarse)` that prevents Safari from zooming on focus. The 13 px `--text-base` token stays untouched, so the design scale is unchanged.
- **Watermark slider hit area extended.** Slider track stays 4 px tall but the input element's hit area now spans 44 px so finger-drag on opacity / rotation actually works.
- **UploadZone file-info row wraps actions to a second line on touch** so the three icon buttons (manage / replace / remove) never crowd the filename.
- **Mobile toolbar tracks the virtual keyboard.** A `visualViewport` listener writes `--kb-offset` to the document element and `.ws-toolbar { bottom: ... + var(--kb-offset) }` slides the Export button above the on-screen keyboard. The Watermark text input no longer hides Export behind the keyboard.
- **Watermark input quick-flow** + empty-text passthrough - typing nothing no longer blocks export; the source PDFs are saved unchanged.

### Accessibility
- **`prefers-reduced-motion` is now respected app-wide.** A global CSS gate caps every animation and transition to 0.01 ms. The AmbientBackground parallax loop has a parallel JS guard since inline-style writes bypass the CSS gate. Bg-emoji floats, frog-pulse, ws-shimmer, ws-spin, dot-pulse, files-error-slide-in, and the entrance animations all stop when the system pref is on.
- **`:focus-visible` rings on every affordance that strips outline elsewhere.** `.icon-btn`, `.cat-tab`, `.format-option`, `.pill-option`, `.btn-primary`, `.btn-secondary`, `.ws-btn`, `.close-btn`, `.pagination-btn`, `.ws-page-card`, `.ws-file-card`, `.ws-wm-slider` - keyboard users now see a 2 px primary ring (with 2 px offset) on focus.
- **PDF Editor tab bar marked as a `role="tablist"`** with `role="tab"` + `aria-selected` + `aria-controls` per button and roving `tabindex`. The active tab's id flows into `aria-labelledby` on the tabpanel. Screen readers announce "tab, 2 of 3, Organize, selected" instead of three loose buttons.
- **Page cards and file cards moved to `role="button"` + `aria-pressed` + `tabindex=0` + `aria-label`** (e.g. "Page 5 of 12, not pressed"). Selection state is now announced; the previous mix of `aria-checked` without a matching role was inert for AT.
- **Watermark `.ws-wm-status` gets `aria-live="polite"`** so SR users hear export progress and validation states.
- **Toast role / live-region differs by variant.** `variant-error` uses `role="alert"` + `aria-live="assertive"`; info/warn use `role="status"` + `aria-live="polite"`. Severity is also conveyed beyond color: `⚠` icon prefix on warn / error variants (WCAG 1.4.1).
- **Mobile menu marked as a `role="dialog" aria-modal="true"` with focus trap.** Tab and Shift+Tab cycle within the menu, Escape closes, focus restores to the hamburger button. The hamburger's `aria-expanded` now flips with menu state.
- **Light-mode `--muted-foreground` bumped from `#71717a` to `#5f5f6a`** so 11 / 12 px muted text passes WCAG AA (≥ 4.5 contrast).
- **Headlines selectable.** `.page-title`, `.page-description`, and `.footer-text` shed `pointer-events: none` (z-index already separates them from `#bg-visuals`).
- **Background-emoji mouse-trap killed.** `#bg-visuals span` flipped to `pointer-events: none`; emojis no longer steal mouse events from interactive content under them.
- **Native I-beam restored on text inputs while the custom cursor is active.** `html.custom-cursor-active *` set `cursor: none !important`, hiding the I-beam from `<input type="text">` and `<textarea>`. A targeted override under `(pointer: fine)` brings it back.

### Performance
- **Watermark preview rebuilt on a synchronous bitmap cache.** The previous URL cache + 250 ms debounce timer is gone. Each page is now rendered once via pdfjs (lazy, on intersection-observer entry) into an `ImageBitmap`, and every settings change composites that cached bitmap with a Canvas 2D watermark overlay synchronously on the next animation frame. No PDF round-trip per slider tick. LRU-bounded at 200 entries (~45 MB ceiling). Slider drag is now smooth instead of stuttering.
- **TopBar scroll listener rAF-coalesced** so `.scrolled` class toggles fire at most once per frame instead of per scroll event (40-100× reduction in style recalcs on fast scroll).

### Internal
- **`--button-surface` token** added to the design system: light theme maps to `--secondary`, dark theme overrides to `--card`. ~25 button definitions across 9 components consolidate onto the single token, removing the `.dark .btn-secondary` override cascade. Top-bar buttons opt out and bind directly to `--card` so they always match the base card surface.
- **`cleanup()` exported from PdfWorkspace** for app-mode switches that should preserve module state.
- **Build hardening.** Puppeteer timeouts lengthened in the cache-build script and on-failure error surfacing so cold-start cache rebuilds don't fail silently in CI.

---

## [2.2.0] - 2026-05-07

Watermark tab for the PDF editor, plus a sweep of accessibility fixes across the workspace.

### Added
- **Watermark tab in the PDF Editor**: Stamp a text watermark on all pages or a custom range like `1-3, 8, 10-12`. Style controls: size, color (hex + swatch), opacity, rotation. Toggle **Repeat across page** to tile the watermark with internally-computed spacing. Live preview reflects the actual export and reserves aspect-ratio so the page renders instantly without layout shift. Helvetica-only text with character-set validation. Available in the UI, MCP (`pdf_watermark`), and REST (`POST /pdf/watermark`).
- **Shared sidebar primitives** in `PdfWorkspace.ts` (`makeSidebarFileRow`, `makeSidebarDivider`, `makeSectionLabel`) so Merge / Organize / Watermark render the file row and divider markup from one source.

### Changed
- **Watermark UI unified with Merge/Organize**: same active-file row at the top of the sidebar, same Select all / Deselect all pattern, same sticky-bottom mobile toolbar + tray drawer.
- **Watermark MCP/REST surface narrowed to text-only**: `source` discriminator and `placement` field removed from `pdf_watermark` and `POST /pdf/watermark`. `text`, `fontSize`, `colorHex` are now top-level fields; placement is always center. Image-source watermarks have been removed from the public API to match the UI.
- **Watermark UI defaults aligned with engine**: the workspace now derives `fontSize` (`80`) and `opacity` (`0.5`) from `WATERMARK_DEFAULTS` in [src/tools/pdfWatermark.ts](src/tools/pdfWatermark.ts) instead of holding its own values (previously `64` / `0.2`). UI, MCP (`pdf_watermark`), and REST (`POST /pdf/watermark`) defaults are now identical.

### Fixed
- **Combined-mode watermark output filename**: `doWatermarkExportCombined` no longer double-suffixes (e.g. `report_watermarked_watermarked.pdf` → `report_watermarked.pdf`). Now reuses `merge()` from [src/tools/pdfMerge.ts](src/tools/pdfMerge.ts) instead of an inline `PDFDocument.create()` loop.

### Accessibility
- **Watermark tab is now keyboard- and screen-reader accessible**:
  - Page cards are tabbable (`tabindex=0`), have programmatic names (`Page A1`, `Page B3`, etc.), and toggle on `Space` / `Enter` (matching the Organize tab).
  - Sliders (`Size`, `Opacity`, `Rotation`) gained a thumb-bound `:focus-visible` ring (the previous `outline: none` left keyboard users with no visible focus indicator - WCAG 2.4.7).
  - Inputs that surface error states (`Watermark text`, `Color hex`, `Page range`) now toggle `aria-invalid` alongside the existing red border. The text input is wired to its error message via `aria-describedby` so screen readers announce *why* the input is invalid.
  - The disabled `Export PDF` button is wired via `aria-describedby` to its status paragraph, so AT users hear *why* it's disabled (e.g. "Pick at least one page").
  - The `Color` row is now a `role="group"` labelled by the visible `Color` text, tying the hex field and swatch together for AT.
  - Visible labels (`Text`, `Size`, `Color`, etc.) link to their inputs via `aria-labelledby`, eliminating drift between visible and announced names.
- **PDF Workspace: cross-tab a11y improvements**:
  - The mobile **More options** tray is now a proper `role="dialog"` with an accessible name, an `Escape` close handler; focus moves into the tray on open and returns to the trigger on close.
  - Drop-zone "Add more PDFs" cards are now keyboard-activatable (`role="button"`, `tabindex=0`, `Space` / `Enter`), with a visible `:focus-visible` ring.
  - Page cards across all tabs gained an on-brand `:focus-visible` ring.
  - The internal `el()` helper now routes `role` and ARIA attributes via `setAttribute`, so the workspace no longer relies on ARIAMixin IDL reflection (patchy in older Firefox/Safari and jsdom).

### Performance
- **Watermark preview**: lazy-render observer unobserves cards after first paint (subsequent re-renders go through `wmKickVisible` directly), and the Helvetica encode probe is memoized per-text so a 300-page grid runs `font.encodeText()` once per text change instead of once per visible card.

## [2.1.3] - 2026-05-04

Error-copy normalization, quality-resolution unification, and palette-PNG encoding.

### Added
- **Unified error copy via `toUserErrorText`**: Worker crashes, password-protected files, parse failures, timeouts, and empty-output errors now map to consistent friendly messages across UI, REST API, and MCP. Title constants shared from `src/components/utils/index.ts`.
- **PDF feedback contact line**: PDF Workspace and `pdf_*` MCP tools / `/pdf/*` API surface "Still stuck, or want to share feedback? Email francois.prevot@frog.co." for non-validation failures, distinct from the format-request line on the converter side.
- **`resolveEffectiveQuality`** (`src/core/compression/resolveEffectiveQuality.ts`): API/MCP requests now match the web UI's silent same-format auto-tier-down. Cross-format requests fall back to `medium`; same-format requests probe the input and pick the next lower tier; already-minimal inputs return unchanged.
- **Palette-PNG encoding** (`src/tools/palettePng.ts`): UPNG-based indexed-palette PNG encoder. `pdftoimg.ts` and `canvasToBlob.ts` use it at low/medium presets for document-like inputs (~3–5× smaller deflate at indistinguishable visual quality).
- **`ValidationError`** in `src/mcp/core/fileInput.ts`: tagged class for caller-supplied input failures. API/MCP catch-alls surface its message verbatim; everything else flows through the friendly normalizer.

### Changed
- **Deeper theme contrast**: Dark-mode background `#0a0a0a` → `#000000` with card `#141414` → `#0a0a0a`. Light-mode card `#ffffff` → `#fdfdfd` for subtle separation from the page background.
- **Removed "in frogConvert" phrasing**: "Not in the converter yet" → "Conversion not available yet"; "isn't in frogConvert yet" → "isn't available yet". Applied across UI, REST `/path` and `/convert`, MCP `find_conversion_path` and `convert_file`, and the format modal's no-outputs message.
- **Sharpened unreadable-file copy**: "Another copy might work" → "Try re-exporting it or uploading a fresh copy."
- **Worker-crash detail**: "The conversion stumbled while processing this file." → "The converter crashed while processing this file."

## [2.1.2] - 2026-04-29

More PDF routes via LibreOffice.

### Added
- **LibreOffice now accepts HTML, RTF, TXT, CSV, and EPUB inputs**: Unlocks alternative PDF routes such as `md → html → pdf` alongside the existing `md → docx → pdf`, plus direct `txt → pdf`, `rtf → pdf`, `csv → pdf`, `html → pdf`, and `epub → pdf` when LibreOffice is available (native binary or localhost API).

## [2.1.1] - 2026-04-22

Audio-to-video uploadability and phase-aware progress UI.

### Fixed
- **Audio → video produces a real video stream**: MP3 → MP4 (and MOV, MKV, M4V, AVI, FLV, TS, MTS, WebM) now embed a bundled placeholder frame so the output is accepted by YouTube and similar platforms. Previously the container held an audio track only.

### Changed
- **Phase-aware spinner**: The pathfinding, WASM handler download, and file-reading phases now show the plain rotating spinner. The gooey spinner stays for the actual encode/compress phase so the UI reflects what the app is really doing.

## [2.1.0] - 2026-04-18

Adaptive compression and live conversion feedback.

### Added
- **Same-format compression**: Re-encodes PNG, MP4, MP3, etc. to reduce file size with a 2% safety fallback.
- **Compress button**: UI automatically switches to "Compress" when a same-format re-encode is detected.
- **Size delta reporting**: Success popups now show exact megabyte savings and percentage reductions.
- **Conversion notices**: Detailed cards explain handler adaptations (e.g., resolution caps or codec changes).
- **Live progress**: Dynamic updates showing elapsed time and handler status for conversions over 10 seconds.
- **Honest cancellation**: Interrupting a batch now reports exactly which files were finished.
- **Adaptive sampling**: Video-to-image extraction targets 300 frames based on duration instead of a fixed rate.

### Changed
- **Archetype-aware quality**: Tailored presets for photos (Q90), PDF pages (Q87), and video frames (Q78).
- **Proactive codec handling**: Skips re-encoding for compatible streams (MP3/AAC/FLAC) and snaps to supported sample rates.
- **PDF safeguards**: Auto-shrinks documents exceeding browser safety limits (600 MP).

## [2.0.0] - 2026-04-17

In-browser PDF Editor, 70+ formats, and security hardening.

### Added
- **PDF Workspace**: Merge, reorder, rotate, and extract pages entirely in-browser using `pdf-lib` and `pdfjs-dist`.
- **Extended Formats**: Expanded support to over 70 file formats across all conversion engines.
- **Upload UX**: Front-load validation with drag-reject feedback and legacy Office format hints.
- **Toast component**: Accessible, dismissable notifications for info, warnings, and errors.

### Stability
- **Security Hardening**: Origin/Host validation for local API, post-body shape checking, and sandbox constraints.
- **Resource Protection**: Archive size caps guard against zip-bombs; HTML sanitization prevents network leaks during conversion.
- **Cleanup Overhaul**: try/finally cleanup for workers, aggressive subprocess termination, and stale temp dir sweeping.
- **Recovery System**: Global error listeners surface actionable popups instead of leaving the UI stuck.

### UX & Performance
- **Unified Selection**: Standardized tap-to-toggle and shift-click range selection across mobile and desktop.
- **Batch Summaries**: Detailed modals showing added vs. skipped files with specific rejection reasons.
- **MIME Priority**: Preferred over filename extensions for more reliable format detection.
- **Performance**: TraversionGraph lookups optimized from linear time to constant time using a Map.
- **Mobile Polish**: Two-row PDF toolbar layout with a dynamic kebab tray for better accessibility.


## [1.0.x and earlier]

Pre-changelog releases. Notable additions since forking from [Convert to it!](https://github.com/p2r3/convert):

- MCP server and REST API for AI agents ([docs/INTEGRATIONS.md](docs/INTEGRATIONS.md)).
- Quality presets (low / medium / high / lossless) for FFmpeg, ImageMagick, pdftoimg.
- LibreOffice handler for DOCX/PPTX/XLSX to PDF.
- Soft cancel and partial downloads for batch conversions.
- Format Mode system (Core / Plus / All).
- Frame extraction for animated formats and videos.
- ICO multi-size bundles.
- Web Worker offloading for heavy conversions and route finding.
- Frogsworth mascot.
- Full Vitest + Puppeteer test suite.
