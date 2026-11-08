<!-- docs-frontmatter
icon: 🤖
label: AI Plugins
desc: Claude and ChatGPT desktop integrations
-->

# AI Plugins

Use frogConvert Essentials from compatible desktop AI clients to convert files, compress images and PDFs, and edit PDFs. The conversion engine runs on the machine starting the local MCP server.

## Downloads

**Development preview, not yet released.** The build pipeline packages a native executable with the plugin, rather than downloading the application from npm. The original npm-based design was rejected because the referenced package is unpublished.

| Client | Planned distribution | State |
| --- | --- | --- |
| Claude Code | Downloadable platform-specific ZIP | Linux proof of concept in CI |
| Claude Cowork | Downloadable plugin | Clean install not yet tested |
| ChatGPT Desktop | Portable desktop-only ZIP | Needs runtime tests and local-MCP submission approval |

This documentation page does **not** offer a download link to an unverified installer. The active [draft PR](https://github.com/ogfrench/frogConvert/pull/123) and [AI plugin packaging workflow](https://github.com/ogfrench/frogConvert/actions/workflows/ai-plugins.yml) contain validation and preview artifacts. After approval, verified archives and SHA-256 checksums should be published through [GitHub Releases](https://github.com/ogfrench/frogConvert/releases).

## How installation will work

A platform-specific ZIP contains the matching native MCP executable, plugin metadata and four skills. There is no repo clone, Bun, or npm installation on the receiving machine. Chromium browser-assisted conversion is **disabled in Essentials**. Native and WASM format support still depends on the packaged assets and installed engines; only tested routes should be advertised.

### Claude Code

Extract the package and use the installed plugin folder:

```sh
claude --plugin-dir /absolute/path/to/frogconvert
```

The package uses `.claude-plugin/plugin.json`, `.mcp.json` and `skills/`. Claude Code should load the local executable using the `${CLAUDE_PLUGIN_ROOT}` path token. Once available, confirm the eight MCP tools in `/mcp`.

Claude Cowork needs a separate installation test. macOS Gatekeeper and Windows security prompts require verification for distributed binaries, especially when unsigned.

### ChatGPT Desktop

The ChatGPT package uses the portable Agent Plugins `plugin.json` and `mcp.json` format, with a local stdio executable under `bin/` and `${PLUGIN_ROOT}` for path resolution.

OpenAI currently limits public distribution of local-MCP desktop plugins to approved partners. The package cannot be described as a generally available ChatGPT plugin until [desktop-only plugin requirements](https://developers.openai.com/plugins/deploy/desktop-only) and a real clean install are satisfied. Browser and mobile ChatGPT cannot run a local stdio binary.

## Available skills

| Skill | Task |
| --- | --- |
| `convert-files` | Convert between supported file formats |
| `compress-files` | Reduce size without changing format |
| `edit-pdfs` | Merge, reorganize, extract and watermark PDFs |
| `inspect-formats` | Discover actual local format support |

The MCP server exposes eight tools; supported format routes can differ from the browser experience because Essentials deliberately disables the Chromium bridge. The full browser app remains available at [frogconvert.xyz](https://frogconvert.xyz).

## Safety

The MCP executable may read and write local files as directed by an agent. It is not a sandbox. `FROGCONVERT_SANDBOX_ROOT` is currently enforced lexically and does not block every symlink traversal. Essentials disables Chromium; the separate full MCP runtime still uses an unsandboxed bridge when browser fallback is enabled. Do not assume the model provider receives no file data: filenames, metadata, content and tool responses can be part of the AI conversation.

Keep original files. Review requested output paths and tools before authorizing writes. See [Security](../SECURITY.md) and [MCP/REST reference](INTEGRATIONS.md).

## Release gates

The installers remain previews until: each OS/architecture passes a clean-host MCP and real conversion test, binary assets and optional dependencies are packaged or limitations documented, file-path security is hardened, the browser bridge is reviewed, and desktop installation paths are verified. Do not advertise full 70+ format parity until measured.
