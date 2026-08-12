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
- **Run the MCP server or REST API**: `bunx frogconvert mcp` or `bunx frogconvert api`. See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).
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

## Credits

The **conversion pipeline** (route finder, format handlers, Dijkstra routing) is forked from [Convert to it!](https://p2r3.github.io/convert/) by p2r3 ([original repo](https://github.com/p2r3/convert)). Full credit for the core conversion engine goes to the original author. The fork reimagines the UI/UX with quality-of-life improvements.

The **PDF editor** (merge, organize, extract, watermark), the **Compress mode** and its compression engine, the **MCP server**, the **REST API**, and the **test infrastructure** (Vitest + Puppeteer) are frogConvert-original; they are not part of the upstream project.

### Bundled handlers

Several format handlers are third-party projects vendored as git submodules (see [SUBMODULES.md](SUBMODULES.md) for the pinned revisions):

| Project | Author | Used for |
|---|---|---|
| [envelope](https://github.com/p2r3/envelope), [sppd](https://github.com/p2r3/sppd) | p2r3 | Envelope archives, Super Pixel Paint documents |
| [qoi-fu](https://github.com/pfusik/qoi-fu), [qoa-fu](https://github.com/pfusik/qoa-fu) | Piotr Fusik | QOI images, QOA audio (MIT) |
| [espeakng.js](https://github.com/TheZipCreator/espeakng.js), [image-to-txt](https://git.sr.ht/~thezipcreator/image-to-txt) | TheZipCreator | Text-to-speech, image-to-text |
| [gimper](https://github.com/ConnorTippets/gimper), [RPG-Maker-MV-Decrypter](https://github.com/ConnorTippets/RPG-Maker-MV-Decrypter), [terraria-world-file-ts](https://github.com/ConnorTippets/terraria-world-file-ts) | ConnorTippets | GIMP `.xcf`, RPG Maker assets, Terraria worlds |

The MIDI synthesis handler uses the TimGM6mb soundfont via FluidSynth; see [src/handlers/midi/README.md](src/handlers/midi/README.md) for that credit in full.

### Built on

frogConvert is mostly a careful shell around other people's engines. The heavy lifting is done by:

**Ghostscript** (PDF and PostScript, via [@jspawn/ghostscript-wasm](https://github.com/jspawn/ghostscript-wasm)) · **ImageMagick** ([magick-wasm](https://github.com/dlemstra/magick-wasm)) · **FFmpeg** ([ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm)) · **Pandoc** · **LibreOffice** (when installed natively) · [**pdf-lib**](https://pdf-lib.js.org/) and [**pdf.js**](https://mozilla.github.io/pdf.js/) · [**SheetJS**](https://sheetjs.com/) · [**7-Zip**](https://www.7-zip.org/) (7z-wasm) · [**SQLite**](https://sqlite.org/) · [**Verovio**](https://www.verovio.org/) and [**VexFlow**](https://www.vexflow.com/) (music engraving) · [**three.js**](https://threejs.org/) (3D) · [**FluidSynth**](https://www.fluidsynth.org/) via js-synthesizer · [**eSpeak NG**](https://github.com/espeak-ng/espeak-ng) · [**Mermaid**](https://mermaid.js.org/), [**marked**](https://marked.js.org/) and [**highlight.js**](https://highlightjs.org/) (docs rendering).

Ghostscript is AGPLv3; its licence ships alongside the binary at `/wasm/gs/LICENSE`. Licences for the remaining dependencies are in their respective `node_modules` entries.

## License

frogConvert is licensed under the **GNU General Public License, version 3 or
later** (GPL-3.0-or-later). The full GPLv2 text is retained in
[LICENSE](LICENSE) as the upstream terms this fork inherited; see below.

<details>
<summary>Why GPLv3 when LICENSE contains the GPLv2 text</summary>

The conversion pipeline is forked from [Convert to it!](https://github.com/p2r3/convert),
which ships the stock GPLv2 text with the "How to Apply These Terms" template
placeholders left unfilled, and states no version anywhere in its README or
source headers. GPLv2 section 9 covers exactly that case:

> If the Program does not specify a version number of this License, you may
> choose any version ever published by the Free Software Foundation.

frogConvert therefore elects **GPLv3** for this derivative work. This is
recorded here rather than left implicit so the reasoning is auditable.

The election matters because GPLv3 section 13 permits combining a covered work
with AGPLv3 code, which is what allows the Ghostscript-based PDF compressor to
ship. That engine is now part of the Compress mode rather than an optional
extra, so AGPLv3 section 13's network-interaction requirement applies to the
combination - which is why the hosted app links to its own source. The upstream
Ghostscript LICENSE is shipped alongside the binary at `/wasm/gs/LICENSE`.
</details>
