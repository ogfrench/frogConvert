# frogConvert AI plugins

This directory contains two platform-specific plugin packages and shared skills.
The existing frogConvert MCP server remains the only implementation of file conversion, compression and PDF operations.

| Package | Manifest | Intended client |
| --- | --- | --- |
| Claude | `claude/.claude-plugin/plugin.json` and `claude/.mcp.json` | Claude Code (and compatible desktop plugin hosts) |
| ChatGPT | `chatgpt/plugin.json` and `chatgpt/mcp.json` | ChatGPT Desktop with local MCP support |

## Build preview ZIPs

```sh
python3 scripts/build-ai-plugins.py --check
python3 -m unittest discover -s tests -p test_ai_plugins.py
```

Produces `dist/ai-plugins/frogconvert-claude.zip` and
`dist/ai-plugins/frogconvert-chatgpt.zip`. Each has a single
`frogconvert/` root, the relevant manifest/MCP configuration and the same four skills.
The versions of both plugin manifests and MCP launch commands are synchronized
to the repository `package.json` at build time.

### What is included

This first package is a **Bun-based preview**, not a standalone binary.
The MCP configuration invokes `bunx frogconvert@<version> mcp` on the user's
machine. Bun must be installed and in PATH. The npm package must have that
exact version available, and initial startup needs network access to download
dependencies if uncached. Conversions run locally once started, except any
network activity of third-party runtimes or the AI client's own file handling.
It is important not to describe this as a zero-dependency or offline installer.

The package does **not** ship with Chromium, LibreOffice or other optional
native executables. Format parity and no-sandbox browser bridge hardening
remain separate release gates.

ChatGPT local MCP publication is currently subject to OpenAI's desktop-only
submission restrictions and partner approval. Do not publish or advertise the
ChatGPT package as generally installable without confirming access and real
desktop smoke tests.

## Installation and risk boundaries

See [AI plugin docs](../../docs/AI_PLUGINS.md). The MCP server reads/writes
local paths given by the agent. Where suitable, restrict access using
`FROGCONVERT_SANDBOX_ROOT`, and approve each invocation. The current path
containment check uses lexical resolution, not filesystem realpath checks;
symlink bypasses must be addressed before claiming a security sandbox.

Do not merge or publish these draft packages until the CI artifact checks and
clean-host workflow tests have passed. Versioned GitHub Releases should
publish ZIPs and SHA-256 checksums, but this branch does not automatically
publish a release.
