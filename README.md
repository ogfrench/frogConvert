<!-- docs-frontmatter
icon: 📖
label: frogConvert
desc: What is it & how to use
-->

# [frogConvert](https://frogconvert.xyz)

_(Backup domain: [frogconvert.netlify.app](https://frogconvert.netlify.app/)) · [GitHub](https://github.com/ogfrench/frogConvert)_

**Truly universal online file converter, plus a built-in PDF editor.**

frogConvert runs entirely in your browser. Convert between 70+ file formats or edit PDFs (merge, reorder, extract pages) without uploading anything to a server. Also available as an MCP server and a local REST API for AI agents and scripts.

## Quick start

- **Just use it**: [frogconvert.xyz](https://frogconvert.xyz).
- **Convert a file**: [docs/CONVERTER.md](docs/CONVERTER.md).
- **Edit a PDF**: [docs/PDF_EDITOR.md](docs/PDF_EDITOR.md).
- **Run the MCP server or REST API**: `bunx frogconvert mcp` or `bunx frogconvert api`. See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).
- **Self-host, Docker, desktop builds**: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Recent changes

Headline of 1.1.0: a full in-browser **PDF editor** plus programmatic PDF access over MCP and REST. Full history in [CHANGELOG.md](CHANGELOG.md).

## Docs

| | |
|---|---|
| [docs/CONVERTER.md](docs/CONVERTER.md) | End-user guide: converting files |
| [docs/PDF_EDITOR.md](docs/PDF_EDITOR.md) | End-user guide: editing PDFs |
| [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) | MCP and REST API reference |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Self-host, Docker, desktop, CLI |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Internal design and subsystems |
| [docs/HANDLERS.md](docs/HANDLERS.md) | Authoring a new format handler |
| [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) | PR workflow, testing, style |
| [AGENTS.md](AGENTS.md) | Rules for AI pair-programming agents |
| [SECURITY.md](SECURITY.md) | Privacy posture and responsible disclosure |
| [CHANGELOG.md](CHANGELOG.md) | Release history |

## Credits

The **conversion pipeline** (route finder, format handlers, Dijkstra routing) is forked from [Convert to it!](https://p2r3.github.io/convert/) by p2r3 ([original repo](https://github.com/p2r3/convert)). Full credit for the core conversion engine goes to the original author. The fork reimagines the UI/UX with quality-of-life improvements.

The **PDF editor** (merge, organize, extract), the **MCP server**, the **REST API**, and the **test infrastructure** (Vitest + Puppeteer) are frogConvert-original; they are not part of the upstream project.

## License

See [LICENSE](LICENSE).
