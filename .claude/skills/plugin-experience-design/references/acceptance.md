# Plugin experience acceptance

Choose only checks that apply to the product and host. Record **actual evidence**, OS/client/build versions and known limitations for each checked item.

## Capability and packaging

- The product promise maps to demonstrably present skill files or MCP tools.
- Stable names, manifest schema and configuration validate in the intended client.
- The package includes everything required for its supported mode; a ZIP with missing binaries, assets, models or indexes is not a working install.
- Artifact is versioned, reproducible and tied to commit SHA. Checksum and dependency/runtime provenance are recorded.
- A clean machine or clean folder can install without private repo access when "no clone" is promised.
- A static snapshot identifies what content and update date it includes. Local lexical lookup must not be called live vector or comprehensive semantic retrieval.

## Cross-host acceptance

For **each advertised host**, record: product edition, host/version, OS/architecture where relevant, install action, permissions, tool connection, first successful user task, second follow-up task, failure behavior and evidence location. Test separately; a Claude Code MCP smoke does not prove Claude chat, Cowork, ChatGPT or Copilot works.

Cases worth running:
1. New install using only published instructions and downloadable artifact.
2. Initial natural-language task actually uses the intended skill/tool; output exists and can be read.
3. Revision or follow-up updates the same output rather than silently doing a different task.
4. Missing binary/runtime, denied permission, disconnected server, unsupported format or absent source produces a truthful failure with repair guidance.
5. Tool descriptions route **toward** the product's tasks and **away** from unrelated tasks.

## Security and trust

- Show what runs locally, what can be sent to a model provider, where files are read/written, and whether a remote service is called.
- Filesystem-scoped configuration is not an OS sandbox. Test symlink, traversal and overwrite defenses where the tool touches the host filesystem.
- Do not put tokens into committed examples, downloadables or public screenshots. Document credential issuance and revocation.
- Retrieval respects source lineage and allowed recipients. Treat untrusted document text as data, not directions.
- Do not publish corpora or downloadable artifacts without appropriate authorization.

## Page and copy

- Product promise, primary host, installation, example prompts, limitations, update path and support state agree across landing page, package README and marketplace listing.
- Use one existing product-owned UI entry point, avoid needless cross-product marketplaces and do not give preview-only choices equal visual weight with working paths.
- Identify Copilot precisely: Microsoft Copilot Chat, Microsoft 365 Copilot and GitHub Copilot are distinct; a portable Markdown guide and an Excel template are not installed plugins.
- The one main CTA reaches a **verified** artifact. Preview-only work links to source/status and never impersonates a download.
- Mobile/desktop real screenshots show no overlaps, clipped code, missing focus indicators or blank unsupported tabs.
- Conditional steps are labeled by host, not expressed as universal installation instructions.

## PR proof template

```text
Edition / host / version:
What works and was tested:
Evidence (CI run, clean install log, artifact hash, screenshots):
What is not tested:
User-visible availability:
Release blockers:
```

Never check a box based solely on a passing static test or another host's result.
