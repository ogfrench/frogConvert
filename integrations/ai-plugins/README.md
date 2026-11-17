# frogConvert desktop AI plugins

This directory contains Claude and ChatGPT native plugin manifests plus four shared skills. Native packages use the existing eight-tool local MCP server. The separate Claude workspace archive is skills-only, and does not run MCP.

## Distribution

The initial Bun-based proposal was rejected: `frogconvert@3.4.7` is not available on npm (confirmed by CI E404). A manifest-only ZIP that cannot start its MCP server is not a functioning native conversion plugin; the intentionally skills-only Claude workspace edition is guidance, not a conversion executor.

The packaging workflow requires a compiled native executable and smoke-tests the MCP protocol, a PDF merge, format listing and CSV-to-JSON conversion from an empty working directory before uploading a preview ZIP. Native preview builds on Windows x64, macOS arm64 and macOS x64 now run only when manually dispatched; the full release workflow still builds all targets. CI is not evidence of installation in the ChatGPT client. The ZIP includes the binary at `bin/frogconvert` (`bin/frogconvert.exe` on Windows), plugin manifests, skills, installation notes and SHA-256 checksums.

```sh
python3 -m unittest discover -s tests -p test_ai_plugins.py
python3 scripts/build-ai-plugins.py --target linux-x64 --binary release/frogconvert-linux --check
```

Release output additionally contains one `frogconvert-claude-workspace-v<version>.zip`, with a root manifest and skills only. Use it in Claude's workspace uploader; it has no `bin/` directory, `.mcp.json` or executable. The native ZIPs remain platform-specific packages for Claude Code or candidate ChatGPT desktop hosts. Never advertise a native ZIP for an OS/architecture until it passes its own clean-host test. The Essentials runtime disables Chromium fallback. Native and WASM conversions still require asset and dependency parity testing.

## Clients

- Claude: `claude/.claude-plugin/plugin.json`, `claude/.mcp.json`.
- ChatGPT: portable `chatgpt/plugin.json`, `chatgpt/mcp.json`.

All editions include the same skills in `shared/skills/`. Only platform-specific native editions spawn a local MCP executable; the Claude workspace edition does not. ChatGPT desktop-only public submissions require explicit OpenAI approval.

## Privacy

The local MCP server has filesystem read/write access on the host. Local processing does not mean the AI model sees no user content. Sandbox-root enforcement rejects known path escapes and uses POSIX no-follow for leaf files; parent-directory races and Windows reparse-point behavior remain unresolved, so it is not an OS security sandbox.

See the [AI Plugins documentation](../../docs/AI_PLUGINS.md) and [Security](../../SECURITY.md). Release archives are downloadable candidates, not evidence of runtime, security, platform or ChatGPT host acceptance. The packaging work was merged in #123 and cross-platform preview CI in #128. The public install and download gates remain open until clean-host and ChatGPT approval pass.
