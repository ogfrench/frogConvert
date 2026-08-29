<!-- docs-frontmatter
icon: 📖
label: frogConvert
desc: What is it & how to use
-->

# [frogConvert](https://frogconvert.xyz)

_(Backup domain: [frogconvert.netlify.app](https://frogconvert.netlify.app/)) · [GitHub](https://github.com/ogfrench/frogConvert)_

**Truly universal online file converter, plus a built-in PDF editor and file compressor.**

> Turn your file into the prince it always was.

frogConvert runs entirely in your browser. Convert between 70+ file formats, compress images, audio, video and PDFs, and edit PDFs (merge, reorder, extract, watermark) - without uploading anything to a server. Also available as an MCP server and a local REST API, so agents and scripts can convert, compress and edit PDFs headlessly.

## Quick start

- **Just use it**: [frogconvert.xyz](https://frogconvert.xyz).
- **Convert a file**: [docs/CONVERTER.md](docs/CONVERTER.md).
- **Edit a PDF**: [docs/PDF_EDITOR.md](docs/PDF_EDITOR.md).
- **Make a file smaller**: [docs/COMPRESS.md](docs/COMPRESS.md).
- **Run the MCP server or REST API**: clone the repo, then `bun run mcp` or `bun run api`. See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).
- **Self-host, Docker, desktop builds**: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Recent changes

See [CHANGELOG.md](CHANGELOG.md) for the full history.

## Docs

| | |
|---|---|
| [docs/CONVERTER.md](docs/CONVERTER.md) | End-user guide: converting files |
| [docs/PDF_EDITOR.md](docs/PDF_EDITOR.md) | End-user guide: editing PDFs |
| [docs/COMPRESS.md](docs/COMPRESS.md) | End-user guide: compressing files |
| [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) | MCP and REST API reference |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Self-host, Docker, desktop, CLI |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Internal design and subsystems |
| [docs/HANDLERS.md](docs/HANDLERS.md) | Authoring a new format handler |
| [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) | PR workflow, testing, style |
| [AGENTS.md](AGENTS.md) | Rules for AI pair-programming agents |
| [SECURITY.md](SECURITY.md) | Privacy posture and limits |
| [CHANGELOG.md](CHANGELOG.md) | Release history |
| [COPYRIGHT](COPYRIGHT) | Copyright, attribution, and the GPLv3 election |
| [SUBMODULES.md](SUBMODULES.md) | Vendored submodules, pinned revisions, review dates |
| [docs/ADDING_A_MODE.md](docs/ADDING_A_MODE.md) | Playbook for shipping a new top-level surface |

## Credits

The **conversion pipeline** (route finder, format handlers, Dijkstra routing) is forked from [Convert to it!](https://p2r3.github.io/convert/) by p2r3 ([original repo](https://github.com/p2r3/convert)). Full credit for the core conversion engine goes to the original author. The fork reimagines the UI/UX with quality-of-life improvements.

**What is frogConvert's own work.** Two of the three surfaces did not exist upstream in any form and were built here from scratch:

- **Compress** (`/compress`) - the surface, the compression engine in [src/core/compression/](src/core/compression/), the Ghostscript-WASM integration, the mixed-batch orchestrator, the keep-threshold and the whole level model.
- **The PDF editor** (`/pdf`) - merge, organize, extract, watermark.

Along with the **MCP server**, the **local REST API**, the UI, the docs, the desktop/PWA packaging, and the test infrastructure (Vitest + Puppeteer, including the corpus suites).

What is inherited is the conversion pipeline and the handlers that existed at the fork point. Full copyright detail is in [COPYRIGHT](COPYRIGHT).

### Bundled handlers

Several format handlers are third-party projects vendored as git submodules (see [SUBMODULES.md](SUBMODULES.md) for the pinned revisions):

| Project | Author | Used for |
|---|---|---|
| [envelope](https://github.com/p2r3/envelope), [sppd](https://github.com/p2r3/sppd) | p2r3 | Envelope archives, Super Pixel Paint documents |
| [qoi-fu](https://github.com/pfusik/qoi-fu), [qoa-fu](https://github.com/pfusik/qoa-fu) | Piotr Fusik | QOI images, QOA audio (MIT) |
| [espeakng.js](https://github.com/zipsegv/espeakng.js), [image-to-txt](https://github.com/zipsegv/image-to-txt) | zipsegv | Text-to-speech, image-to-text |
| [gimper](https://github.com/ConnorTippets/gimper), [RPG-Maker-MV-Decrypter](https://github.com/ConnorTippets/RPG-Maker-MV-Decrypter), [terraria-world-file-ts](https://github.com/ConnorTippets/terraria-world-file-ts) | ConnorTippets | GIMP `.xcf`, RPG Maker assets, Terraria worlds |

The MIDI synthesis handler uses the TimGM6mb soundfont via FluidSynth; see [src/handlers/midi/README.md](src/handlers/midi/README.md) for that credit in full.

### Built on

frogConvert is mostly a careful shell around other people's engines. The heavy lifting is done by:

**Ghostscript** (PDF and PostScript, via [@jspawn/ghostscript-wasm](https://github.com/jspawn/ghostscript-wasm)) · **ImageMagick** ([magick-wasm](https://github.com/dlemstra/magick-wasm)) · **FFmpeg** ([ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm)) · **Pandoc** · **LibreOffice** (when installed natively) · [**pdf-lib**](https://pdf-lib.js.org/) and [**pdf.js**](https://mozilla.github.io/pdf.js/) · [**SheetJS**](https://sheetjs.com/) · [**7-Zip**](https://www.7-zip.org/) (7z-wasm) · [**SQLite**](https://sqlite.org/) · [**Verovio**](https://www.verovio.org/) and [**VexFlow**](https://www.vexflow.com/) (music engraving) · [**three.js**](https://threejs.org/) (3D) · [**FluidSynth**](https://www.fluidsynth.org/) via js-synthesizer · [**eSpeak NG**](https://github.com/espeak-ng/espeak-ng) · [**Mermaid**](https://mermaid.js.org/), [**marked**](https://marked.js.org/) and [**highlight.js**](https://highlightjs.org/) (docs rendering).

Ghostscript is AGPLv3; its licence ships alongside the binary at `/wasm/gs/LICENSE`. Licences for the remaining dependencies are in their respective `node_modules` entries.

## No warranty

frogConvert is a hobby project and is provided **as is**, with no warranty of
any kind - including no guarantee of security, correctness, or that your files
come out the other side intact. GPLv3 sections 15 to 17 are the operative
terms. Keep your originals, and see [SECURITY.md](SECURITY.md) for the honest
version of what this does and does not promise.

## License

frogConvert is licensed under the **GNU General Public License, version 3 or
later** (GPL-3.0-or-later). The full text is in [LICENSE](LICENSE). The GPLv2
text inherited from the upstream project is retained verbatim in
[LICENSE.upstream-GPLv2](LICENSE.upstream-GPLv2). Copyright, attribution and
the full reasoning are in [COPYRIGHT](COPYRIGHT).

<details>
<summary>Why GPLv3 when the upstream project shipped the GPLv2 text</summary>

The conversion pipeline is forked from [Convert to it!](https://github.com/p2r3/convert).
Verified against that repository at commit `2fc7143`, it ships the stock GPLv2
text with the "How to Apply These Terms" placeholders unfilled, has no License
section in its README, no `license` field in `package.json`, and no GPL headers
in any source file. Its README does mention a version once - contributor
guidance at line 33 telling format proposers to "make sure the license is
compatible with GPL-2.0" - which is a statement about acceptable dependencies,
not about the program's own licence version.

GPLv2 section 9 provides:

> If the Program does not specify a version number of this License, you may
> choose any version ever published by the Free Software Foundation.

frogConvert elects **GPLv3** for this derivative work on the reading that the
line above is dependency guidance rather than a version election. That is a
judgement call rather than a certainty, and [COPYRIGHT](COPYRIGHT) sets out the
evidence so it can be challenged. The unambiguous fix is for upstream to state
a version explicitly.

The election matters because GPLv3 section 13 permits combining a covered work
with AGPLv3 code, which is what allows the Ghostscript-based PDF compressor to
ship. That engine is part of Compress rather than an optional extra, so AGPLv3
section 13's network-interaction requirement applies to the combination - which
is why the hosted app offers its own source. That offer lives on the docs page
(reachable from the footer's *view docs*): a link to the repository, and a link
to the exact commit the running build came from, which is the revision the
source offer is actually about. The upstream Ghostscript LICENSE is shipped
alongside the binary at `/wasm/gs/LICENSE`.

Not legal advice.
</details>
