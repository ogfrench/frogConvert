# ChatGPT plugin scratchpad

Date: 2026-11-09
Status: In progress. No merge, public download, host acceptance, or installed ChatGPT plugin.

## Goal
Complete and verify the existing native frogConvert ChatGPT package without changing its eight-tool MCP API or representing partial format support as complete conversion parity.

## Verified baseline
- master package.json version: 3.4.10.
- Portable ChatGPT package files exist in integrations/ai-plugins/chatgpt/ and are assembled by scripts/build-ai-plugins.py.
- The source plugin manifest still says version 3.4.7; the archive builder overwrites its version with package.json.
- Packaging CI builds and smoke-tests Linux native MCP. Windows and macOS clean-host tests are missing.
- The existing smoke checks eight tools, PDF merge, no-overwrite and CSV-to-JSON.
- The AI plugin docs still describe merged PR #123 as a draft.
- Desktop-only local MCP submissions require OpenAI partner allowlisting: https://developers.openai.com/plugins/deploy/desktop-only

## Decisions
1. Preserve bundled-executable local-first model and four skills.
2. Fix misleading stale metadata/docs without removing documented release gates.
3. Extend executable smoke and security coverage before adding platform installers.
4. Do not claim support for web, Android, or unapproved ChatGPT local execution.
5. Do not ship a public plugin archive just because packaging tests pass.

## Work log
- 2026-11-09: Reviewed plugin manifest, native packaging script, Linux packaging workflow, docs and security review.
- 2026-11-09: Created isolated branch feature/chatgpt-acceptance-2026-11-09.

## Pending acceptance
- Binary provenance, reproducible ZIPs, checksums and absence of secrets.
- Native/WASM format parity and errors, symlink/overwrite/race review.
- Clean Windows, macOS x64/arm64 and Linux installations.
- Real ChatGPT desktop import, permission policy and tool calls on an eligible account.
- Independent review and exact-head CI.
- Public publication approval is a separate gate.
