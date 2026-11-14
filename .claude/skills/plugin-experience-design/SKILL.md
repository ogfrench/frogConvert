---
name: plugin-experience-design
description: >-
  Design and validate AI plugin downloads, installation and onboarding for Claude Code/Cowork, ChatGPT and Copilot. Use for host support, editions and release readiness.
---

# Design an AI plugin experience

Treat a plugin as a **task that works on a specific host**, not just a ZIP. Keep the product identity and architecture; standardize task, installation and verification without imposing identical branding.

## Work from the actual product

1. Read the repo's design tokens, existing plugin/skill/MCP manifests, packaging scripts, installation page, tests, release process and open PRs. Avoid duplicating or replacing the established system.
2. Write a **capability/host matrix** before changing copy. For each host and edition record: what the user can do, required local/remote dependencies, where data travels, supported OS/architecture, available artifact, verification evidence and outstanding gate. Distinguish task guidance, bundled skills, local MCP, hosted MCP and a real installable package.
3. Identify the *primary successful task* and preferred supported installation path. Keep secondary platforms available without presenting speculative parity. Only promise no-clone installation when **all required runtime and data dependencies** ship. A manifest alone is not an installer.
4. Apply the shared experience contract below. Reuse product components, design tokens and language instead of creating a second mini-design-system. When two products share a distribution hub, place unrelated products in a separate, clearly labeled companion area rather than burying one inside the other's package.
5. Implement the smallest coherent change. Preserve stable skill IDs, MCP tool names, URLs and install paths unless migration is independently approved; test old configurations if changed.
6. Verify by actual installation and representative tasks, then inspect screenshots of the implemented page at phone and desktop widths. Use the existing visual-loop skill for visual changes. Distinguish verified, untested and blocked items in PR handover.

## Portable capability and source discipline

Use canonical source, accessible data and real host tools separately. An installed plugin is not tool permission. If absent tools or unavailable runtime block a file or render, continue useful work without claiming an artifact; ask only for the missing source. Route specialist skills selectively, including a negative unrelated-task case. See [cross-host standards](../../../../docs/host-capability-standards.md).

## Shared experience contract

Use this flexible sequence:

| Question | Design responsibility |
| --- | --- |
| What is this for? | Outcome-led name and one-sentence promise; avoid vague "AI-powered" claims |
| Where can I use it? | Visible supported platform choices, with **tested**, **preview**, or **not supported** state per host; never conflate Claude Code, Claude chat/Cowork, ChatGPT and Copilot |
| Which edition? | Full vs Essentials only when their install, source coverage or capabilities differ materially; concise comparison and recommended use case |
| What does it really do? | Three to five concrete tasks, tool-backed vs instruction-only distinctions, known limitations |
| How do I get started? | One prominent verified CTA for the recommended host, prerequisites, installation, permissions, authentication and a concrete first-run check |
| What should I try? | At least three truthful task prompts, including one ordinary edit or follow-up; don't imply a successful run from an illustrative prompt |
| Can I trust it? | File/data location, model-provider processing, filesystem/network access, provenance, version/checksum/update path, and troubleshooting |

Use platform switching only for real supported experiences. If a package is still in development, show a **View draft / Build status** link, not an inert Download button. If a feature is impossible in a host, state the limitation where the user would expect to use it.

## Visual coherence without homogenization

- Reuse existing tokens, focus states and breakpoints. Align terminology and interaction semantics, not visual branding.
- Keep one clear product entry point, primary task and action. Prefer existing routes over new portals.
- Test keyboard, mobile and copy controls. Match actual package names and destinations.
- Make empty, pending, error and unavailable states honest. Never invent ratings, host badges, live URLs, package binaries, test results or successful screenshots.
- Compare real renders, not Figma-only claims; fix clipping, height imbalance, overflow, hover/focus and contrast issues before calling the visual pass done.

## Evidence and release gates

Match canonical distributable skills against the *actual generated archive*,
including references, licenses, byte identity, version, source SHA and checksums.
A source directory or a passing unit test does not certify the published ZIP.
Enforce positive, negative and ambiguous routing tests, while keeping clean-host
installation and actual first-task acceptance as distinct evidence.

See [acceptance checklist](references/acceptance.md) when publishing, changing supported clients or claiming a ready-to-install download. Link actual evidence in the PR.

Check official host capabilities close to release. Claude Code plugins, Claude chat/Cowork uploads, ChatGPT local/remote integrations and Microsoft Copilot agents have different packaging and authorization models. Never infer portability from a shared name or `SKILL.md` file.

## Useful deliverable

Return the updated implementation or draft PR, plus a compact matrix: host and edition, task promise, artifact, status, blocker, proof and next test. Separate **implemented**, **verified** and **released**. Follow the user's merge or release instruction exactly; do not publish a private corpus or install runtime dependencies without approval.

Official host references and acceptance checks are in [the checklist](references/acceptance.md).
