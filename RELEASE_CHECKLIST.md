# v3.0.0 sign-off checklist

Delete this file once v3.0.0 is tagged. It exists so the manual pass has a
script rather than being improvised, and so anything that fails has an obvious
place to be written down.

Everything below has been verified by automated tests or in a headless browser.
This list is the *human* pass: the things a person notices and a script does
not, plus the handful of paths that need a real file and a real eye.

## Before you start

- PR #18 is a **draft**. Flip it to ready when this list is clean.
- CI must be green on the head commit.
- Have to hand: a photo (a few MB), a text-heavy PDF, a scanned or
  image-heavy PDF, a video, and an `.eps` or `.ai` if you have one.

---

## 1. Compress, the headline feature

- [ ] `/compress` loads. The card matches the Convert card's width and padding.
- [ ] Drop a **mixed batch** (image + audio + video + PDF). Each row reports its
      own saving; the total is stated once.
- [ ] Drop a **photo** and pick *Smallest file*. This is the one that was wrong:
      it should be dramatically smaller, not −19%. Check it still looks fine.
- [ ] Drop the same photo at *High quality*. Visibly better, larger file.
- [ ] Drop the **text-heavy PDF**. It should honestly report little or no gain
      rather than pretending. Read the wording - it should not contradict itself.
- [ ] Drop the **image-heavy PDF**. Real saving at *Automatic*.
- [ ] **Cancel mid-batch** with the button. Finished files stay downloadable;
      the interrupted one says *stopped*, not *failed*.
- [ ] **Cancel with Escape.** Same outcome.

## 2. The level chooser, now a modal

- [ ] Tap **Compression level**. It opens a centred dialog, not a dropdown
      hanging over the Compress button.
- [ ] The current level carries a **tick**, not just bolder text.
- [ ] **Escape** closes it. So does tapping the backdrop.
- [ ] On a **phone-sized window**, every level is reachable without the dialog
      running off the bottom. This is what the old dropdown got wrong.

## 3. PostScript, EPS, Illustrator - new in this release

- [ ] Drop an `.eps` on the Converter. The card says *Ready to convert from EPS*.
- [ ] Convert it to **PDF**. Opens, artwork intact, **text is selectable** -
      that is the whole point; if it came out as a picture, stop and report it.
- [ ] Convert a **multi-page PDF → EPS**. You should get **one file per page**,
      not one file. (One file would mean pages were silently dropped.)
- [ ] Convert a PDF → **PS**, then that PS back to **PDF**. Page count survives.
- [ ] Drop an `.ai`. The notice under the Convert button states that layers and
      editable text are flattened. Convert it; the artwork should be right.
- [ ] Convert a PDF → **PDF/A**. It opens normally.
- [ ] Convert a PDF → **TIFF**. Multi-page, and a *sane size* - if it is tens of
      MB from a small source, the compression flag is not being applied.
- [ ] Try `PS → PDF` at *Smallest file* and again at *High quality*. **The sizes
      must differ.** Identical sizes mean the level is inert again.
- [ ] First PostScript conversion of the session shows a one-time ~16 MB
      download that names itself sensibly (not "PDF compressor").

## 4. PDF Editor - cancellation and Automatic

- [ ] Merge several large PDFs. A **Cancel** button is present during the wait.
- [ ] Press it. You return to the editor with your files intact - not an error
      dialog, not a stuck spinner.
- [ ] Same for **organize**, **watermark** and **extract**.
- [ ] **Escape** cancels too.
- [ ] Let one finish uninterrupted. The result is correct and downloads.
- [ ] Extract several pages **as a single PDF** from a document with a repeated
      logo or letterhead. The output should not be much larger than the source.
- [ ] The **PDF compression** menu offers **Automatic**, and the default is
      still **Original quality**. Both halves matter: it is on the menu, and it
      is not what you land on.
- [ ] Save an edit at *Automatic* and again at *Original quality*. The
      Automatic one should be smaller.

## 5. Agents and scripts - new in this release

Start the API with `bun run api` (port 3000).

- [ ] `POST /compress` with a file shrinks it:
      ```bash
      curl -X POST http://localhost:3000/compress \
        -F "file=@scan.pdf" -F "level=low" -D headers.txt -o out.pdf
      ```
      `headers.txt` carries an `X-Compress-Report` with the before/after sizes.
- [ ] The same call at `level=high` gives a **different, larger** file.
- [ ] `level=lossless` is **rejected with a 400**, not silently accepted.
- [ ] A file with nothing to give (a small vector PDF) comes back with
      `shrunk: false` and a reason, and its **original bytes**.
- [ ] **Send something with no compressor at all** (rename a text file to
      `notes.xyz`). You must get your file back **at its original size**, with
      `shrunk: false`, `reason: "unsupported"` and `savedPercent: 0`. This was
      broken: it returned *zero bytes* and claimed a 100% saving.
- [ ] Same check through MCP with `outputFilePath` set: the file on disk must
      be a **real file**, not 0 bytes. This is the one that could destroy data.
- [ ] Send an **MP4 or MP3**. Expect `shrunk: false`, `reason: "unsupported"`,
      original bytes back. FFmpeg does not run under Node, and compression has
      no browser-bridge fallback. Correct, documented, and *not* a regression -
      but confirm it fails honestly rather than emitting an empty file.
- [ ] In an MCP client, `compress_file` appears in the tool list and compresses
      a file given `filePath` + `outputFilePath`.
- [ ] Sanity check the thing that was broken: `POST /convert` with `pdf` in and
      `pdf` out still returns your file **unchanged**. That is expected -
      convert is not a compressor - and is why `/compress` exists.

## 6. The rest of the app still works

- [ ] A plain image conversion (PNG → JPG).
- [ ] A video conversion.
- [ ] Light/dark toggle.
- [ ] **Format filter** (Core / Core+ / All) opens as a dropdown, shows a tick
      on the active one, and switching it changes the format list.
- [ ] Mobile viewport: Compress, Convert and the PDF editor are all usable, and
      the PDF tabs are comfortable to tap.
- [ ] Install as a PWA, or open the existing install, and confirm it still runs.

## 7. Copy and metadata

- [ ] Page description and any Frogsworth tips read naturally.
- [ ] No user-facing string contains an em dash (a v3 rule).
- [ ] `/docs/slidedeck.html` opens, the counter reads `1/15` **on load**, and
      slide 12 is the v3 slide.

---

## Release steps, once the list above is clean

1. Flip PR #18 out of draft and merge it to `master`.
2. Tag: `git tag v3.0.0 && git push origin v3.0.0`.
   The electron workflow builds the desktop artifacts and publishes the GitHub
   Release from the tag.
3. Update the **GitHub repo description** (Settings → About). No tool available
   to me can edit this, so it needs doing by hand:
   > Convert 70+ file formats, compress images, audio and video, and edit or
   > shrink PDFs, all in your browser. No uploads, no servers: your files never
   > leave your device.
4. Close **#12, #14, #16, #19 and #21** against the release. Leave **#22**
   (smarter Automatic) open - it is deliberately post-v3.
5. Delete this file.

## Known limits, so they are not mistaken for bugs

- A text-only PDF barely shrinks. Correct: the level governs *image*
  downsampling, and there are no images to downsample.
- **Compressing a PNG gives the same file at every level.** PNG is lossless, so
  the quality dial has nothing to turn, and the resize cap does nothing to an
  image already under it.
- **Automatic matches Balanced on images and High quality on PDFs.** Both are
  the rule working, not a stuck control. See `docs/COMPRESS.md`.
- `PDF → EPS` returning one file per page is required by the format.
- Ghostscript presets are not monotonic for PDFs - a *lower* setting can
  produce a *larger* file on some documents. Automatic avoids the presets that
  did so on the two documents this was measured against.
- HEIC/AVIF are accepted at intake and then honestly refused per file.
- Cancelling during the degraded canvas PDF fallback waits for that one file;
  it runs on the main thread and there is nothing to terminate.
- Same-format `POST /convert` returns the file unchanged. Not a regression -
  it never compressed, and `/compress` is now the supported route.
- **Video and audio do not compress over REST/MCP**, only in the browser.
  `ffmpeg.wasm` has never run under Node; `convert` hides this with a
  headless-browser bridge, `compress` has no such fallback and says
  `unsupported` instead. Documented in `docs/INTEGRATIONS.md`. Worth its own
  issue after v3 - the bridge already exists, it is just not wired to compress.
