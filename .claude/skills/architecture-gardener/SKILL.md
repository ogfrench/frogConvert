---
name: architecture-gardener
description: >-
  Inspect architecture drift, ownership boundaries and recurring workarounds.
  Use for architecture audits and structural root-cause repairs, not routine edits.
---

# Architecture Gardener

Keep existing products maintainable by identifying structural causes of recurring defects. Code and observed behavior establish what exists; requirements determine whether it is correct. An unfamiliar architecture is not a defect. **Inspect first, propose narrowly, verify independently.** Do not transplant a preferred framework, enforce a universal folder layout, or replace a product's existing tools.

## DUNE paved paths and structural constraints

Look for the single supported API and state owner before proposing a new abstraction. When a recurring bug demonstrates a missing boundary, prefer a focused type, schema, dependency or negative-path regression over additional instructions. Verify both a known invalid case and a legitimate exception before making a rule mandatory. Do not copy blanket framework bans between products. Product Passport owns capability navigation; Gardener owns architectural root causes and dependency constraints.

## Choose the right mode

- **Inspect (default):** Read-only architecture audit. Trace one concrete symptom or boundary, identify plausible failure modes, and report supported findings. Do not modify code, settings, generated outputs, or private data.
- **Repair (explicit request):** Reproduce a supported defect, change the smallest owning code path, and add a regression test or check that detects the original failure. Confirm before a major architectural change.
- **Garden (requested recurring review):** Compare a bounded set of changed modules or past incidents with a baseline. Propose low-noise guardrails and retirement of duplicated workarounds. Do not schedule work, mutate branches, create issues, or deploy without authorization.

## Inspect the actual system

1. Establish the target repository, revision, architecture, and user's requested scope. Read its entry points, module interfaces, integration tests, runtime topology, build scripts, and local instructions. Docs are navigation aids, not correctness proof. Use existing code search and test harnesses; never require a new global CLI.
2. Trace a behavior through its actual owners: UI or caller, service, API/process boundary, persistence, external integration, and error paths as applicable. Distinguish intentional adapters, independently deployed processes, and shared domain logic from accidental duplication.
3. Look for evidence of *harm*, not merely unfamiliar structure: conflicting sources of truth, rules duplicated with different outcomes, forbidden dependency direction, hidden writes, leaky authorization, workarounds that mask broken invariants, unreachable tests, or changes that require multiple unrelated files for the same policy.
4. Test rival explanations. A repeated pattern can be a valid compatibility boundary; a large module can be cohesive; apparently unused code may serve another runtime. If the evidence does not establish a problem, say so. Prefer no finding over speculative refactoring.
5. Classify observations as **verified defect**, **supported risk**, **hypothesis**, or **healthy difference**. Cite exact code paths and revisions, relevant runtime/test evidence, impact, and what would falsify the finding. Avoid invented metrics or scores.

## Repair only what is justified

1. Reproduce the failing behavior in a safe, disposable environment before editing whenever feasible. If blocked, identify the missing evidence rather than claiming reproduction.
2. Fix the root ownership/state/boundary cause through existing patterns. Preserve interfaces and compatibility where required. Never treat formatting, naming preference, or documentation drift alone as a mandate to restructure.
3. Protect the boundary with the narrowest reliable check: executable negative-case regression, type/API contract, focused import rule, or integration test. Confirm the check catches the known failure on a safe fixture or earlier revision when practical.
4. Challenge false positives with a legitimate contrasting implementation before proposing enforcement. Keep advisory checks advisory until deterministic, low-noise, and cost-effective on the real repository.
5. Run affected unit, integration, and user-journey verification appropriate to the changed behavior. Record the exact SHA, environment, test outputs, skipped checks, and rollback. Independent review is required for consequential trust-boundary changes.

## Output contract

For each material finding, report: **claim and severity; observed code paths and revision; evidence/test performed; impact; alternative explanation; smallest recommended change; regression guard; verification status**. Prioritize correctness and security over style. Separate `passed`, `failed`, `blocked`, and `not_run`. An audit with no supported findings is a valid outcome.

The audit is not a release certificate or a license to refactor. A structural proposal must explain the user-visible failure it prevents and the cost of changing it.

## Skill boundaries

- **`product-passport`:** maps features and proves user behavior. Use it for cross-layer feature journeys and release proof; Gardener handles structural causes and drift. Coordinate when a boundary repair changes behavior.
- **`visual-loop`:** owns rendered UI, visual comparisons, and screenshot inspection. Gardener does not judge slide or interface aesthetics.
- **`best-practices` / `learning-loop`:** existing rules and the evidence-led promotion process. Add durable guidance only after a defect or repeated pattern warrants it.
- **Independent review:** adversarial/security review remains separate from the agent that made a high-risk edit.
- **Not a trigger:** ordinary copy, isolated cosmetic edits, small functions with clear ownership, or broad architecture rewrites requested without a demonstrated need.

Keep client-specific source, private repository details, credentials, logs, and host identifiers inside their owning repository. Only generalize sanitized lessons into this public plugin.
