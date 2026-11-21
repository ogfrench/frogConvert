---
name: product-passport
description: >-
  Map product features to code and verify real user journeys. Use for
  product maps, cross-layer regressions and release evidence.
---

# Product Passport

Map product behavior to source and verify it independently. **Executable source code is the source of truth.** Tests and runtime artifacts supply proof; maps and docs only navigate. Investigate code/document disagreements. Compilation, screenshots, HTTP 200 and self-authored checklists alone do not verify behavior.

## DUNE entry and exit

For substantive coding work, use the capability record as a **navigation hint** and verify paths against code and tests. Follow canonical ownership, avoiding duplicate state or APIs. End with task-level evidence and a map update in the same PR, or `map unchanged` with a reason. Source-repo `docs/dune.md` describes the method, not a required layout for other products.

## Work with the product's existing architecture

1. Inspect source, tests, build configuration and entry points. Verify map claims against code and behavior. Identify state owners, transport, persistence and dependencies. Reuse existing product tools; never impose a universal runtime or foreign architecture.
2. Trace the **whole user journey**, from discovery and detail through preview, primary action and resulting artifact. Inspect neighboring surfaces for misleading categories, boilerplate or fake previews. Apply the [feature contract](references/feature-contract.md) and [experience journey review](references/experience-journey.md). Never change code to satisfy stale documentation.
3. Choose a proof path proportionate to risk: focused static checks for localized changes, actual task journeys for behavioral changes, and independent/security/host acceptance for high-risk or release-critical changes. See the [verification contract](references/verification-contract.md). Follow stricter product-owned rules.
4. Change the owning layer without duplicate state, cross-process imports or unrelated refactors. Prefer code and tests over explanatory comments; preserve legal notices, tool directives and necessary external constraints.
5. Exercise the real product in isolation, including negative paths. For visual products inspect the **actual rendered detail view and collection context**, not only routes, thumbnails or mocks. Verify live preview where appropriate and that the primary action produces the expected result. Inspect resulting artifacts, state and interactions. Tie evidence to exact revision/runtime, marking passed, failed, blocked or not run.
6. Reproduce and correct failures, rerun the affected checks, and record remaining risks. A separate reviewer or independently constructed test is appropriate when the same agent both implemented and verified a high-risk change. Do not manufacture proof or silently convert a waiver into a pass.
7. Update regressions before refreshing the product map in the same change. Never finish with a known stale map. Use [maintenance](references/maintenance.md) to fix recurring root causes instead of adding prose.

## Keep product maps current

For substantive product or release work, inspect the existing canonical map and feature entries; seed a small map if missing. Update impacted entry points, owners, integrations and journeys **in the same PR** after verifying code and tests. For shared mutable state, record the authoritative owner, critical invariants and conflict policy, not a second copy of implementation logic. Cosmetic edits need no map churn.

Keep private evidence within its product repository. Never treat a map as source or claim unrun tests as passed. At completion report `map updated` (paths), `map unchanged` (why), or `map blocked` (missing evidence). See [feature contract](references/feature-contract.md) for the map format. The [plugin product map](references/plugin-product-map.md) records this workflow family's ownership and routing. Repo-level instructions must preserve this obligation even when the skill is not loaded.

## Boundaries with other skills

- Use `visual-loop` for actual rendered UI/slide inspection and option comparisons. Product Passport selects the feature journey and records proof; it does not replace visual judgment.
- Use `architecture-gardener` for structural drift, recurring workaround patterns and justified ownership-boundary repairs. Product Passport remains responsible for feature navigation, real behavioral proof and updating the product map when a repair changes capabilities.
- Use `plugin-experience-design` for installation, host compatibility, and downloadable plugin acceptance.
- Use `learning-loop` for reusable lessons, and `best-practices` for existing engineering rules. Keep private project evidence out of this public skill and its examples.
- Use independent adversarial review where consequential. Existing product release gates, human authorization, and deployed-revision checks remain authoritative.
- Ordinary copy edits, purely local functions, and generic research do not need a new passport or full end-to-end run.

## Result

Report the affected features, ownership path, exact commands or user actions run, revision/environment, verifiable artifacts, failures, limitations, and next gate. Never write "verified" without task-level evidence. Do not claim an unavailable host was exercised.
