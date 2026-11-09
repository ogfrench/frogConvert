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

## Implementation update 2026-11-09
- Updated source ChatGPT manifest version to match `package.json` v3.4.10, and added a regression test in `tests/test_ai_plugins.py`.
- Corrected the existing website `docs/AI_PLUGINS.md` status: PR #123 and #125 have merged, but ChatGPT downloads remain unapproved and untested in a real host.
- Corrected `integrations/ai-plugins/README.md` security claims to distinguish POSIX leaf protection from unresolved parent-directory races/Windows reparse behavior.
- Extended `.github/workflows/ai-plugins.yml` with Windows x64, macOS arm64 and macOS x64 native build, clean-folder MCP protocol tests, package checksums and per-platform preview artifact uploads. The existing Linux probe remains.
- Verified GitHub runner labels: `windows-latest`, `macos-15` (arm64), `macos-15-intel` (x64). Bun is pinned at 1.4.4. CI will determine whether these builds succeed.
- Confirmed `docs/AI_PLUGINS.md` is routed by the static docs generator to `/docs/ai_plugins/`; the branch has not been deployed.

## Current decision and blocker
- Do not publish artifact download links or call it ChatGPT-compatible until OpenAI desktop-only execution is approved and actual host import/tool calls work.
- CI native probes are not the same as clean-machine acceptance or host approval.

## Cross-platform review and CI evidence
- PR: https://github.com/ogfrench/frogConvert/pull/128 (draft; do not merge).
- Native packaging run #42588648098 passed all five jobs on commit `18a8c66e56129e126f6dc708e73dd56b85bb6573`: manifest validation, Linux, Windows x64, macOS arm64, macOS x64. Four per-platform preview artifacts generated. This is not clean-machine installation or ChatGPT host approval.
- Adversarial distribution finding: native archive builder had omitted `LICENSE`, `LICENSE.upstream-GPLv2` and `COPYRIGHT`. Added the existing notices to both Claude and ChatGPT package archives and test assertions. Full source/license obligations still require distribution review.
- These follow-up changes have a later SHA than the successful run. Require exact-head CI again.
- Current browser/MCP privacy and filesystem limitations remain disclosed in SECURITY and website docs.
