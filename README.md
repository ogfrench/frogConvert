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

The **PDF editor** (merge, organize, extract, watermark), the **MCP server**, the **REST API**, and the **test infrastructure** (Vitest + Puppeteer) are frogConvert-original; they are not part of the upstream project.

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
