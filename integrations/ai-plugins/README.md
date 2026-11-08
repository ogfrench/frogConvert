# frogConvert desktop AI plugins

This directory contains official-format Claude and ChatGPT plugin manifests plus four shared skill definitions. Both use the existing eight-tool MCP server.

## Distribution

The initial Bun-based proposal was rejected: `frogconvert@3.4.7` is not available on npm (confirmed by CI E404). A manifest-only ZIP that cannot start its MCP server is not a functioning plugin.

The new packaging workflow requires a compiled native executable and smoke-tests the MCP protocol plus a PDF merge from an empty working directory before uploading a ZIP. The ZIP includes the binary at `bin/frogconvert` (`bin/frogconvert.exe` on Windows), plugin manifests, skills, installation notes and SHA-256 checksums.

```sh
python3 -m unittest discover -s tests -p test_ai_plugins.py
python3 scripts/build-ai-plugins.py --target linux-x64 --binary release/frogconvert-linux --check
```

This is a platform-specific native package. Never advertise a ZIP for an OS/architecture until it passes its own clean-host test. The Essentials runtime disables Chromium fallback. Native and WASM conversions still require asset and dependency parity testing.

## Clients

- Claude: `claude/.claude-plugin/plugin.json`, `claude/.mcp.json`.
- ChatGPT: portable `chatgpt/plugin.json`, `chatgpt/mcp.json`.

Both package the same skills in `shared/skills/`, and both spawn a plugin-local MCP executable. ChatGPT desktop-only public submissions require explicit OpenAI approval.

## Privacy

The local MCP server has filesystem read/write access on the host. Local processing does not mean the AI model sees no user content. Current sandbox-root enforcement is lexical and not symlink-safe; it must be hardened before a general public release.

See [the public AI Plugins draft docs](../../docs/AI_PLUGINS.md) and [Security](../../SECURITY.md). Do not merge this PR until runtime, security and clean-machine checks are complete.
