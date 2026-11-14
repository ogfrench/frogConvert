# Durable baseline, execution scratchpad and before/after proof

Use one **authoritative** active checklist in the PR description (or issue/plan
until a PR exists). Supporting data may live in the product's protected evidence
directory. Do not create a second contradictory status tracker or rely only on
conversation memory.

## Before
- Expected user outcome, observed starting behavior and known failure.
- Reproducible input, baseline SHA, runtime/host, and a failing test, screenshot
  or artifact when feasible. State "not captured" if no baseline exists.
- Planned scope, risks, non-goals and acceptance criteria.

## During
- Current branch/head, completed versus verified work, open decisions, blockers,
  changed assumptions, failed checks and the exact next action.
- Update PR status after each material change; keep uncommitted work visible
  only in the live worktree, commit/push authorized changes before handover.
- If compacted or interrupted, reload source, PR, CI and state. Observed reality
  overrides a summary. Reopen proof invalidated by later edits.

## After
- Repeat the same user journey or artifact under comparable conditions.
- Record changed behavior, outputs, tests, before/after screenshots if visual,
  negative paths, exact revision, host/version and evidence locations.
- Label tests passed, failed, blocked or not run. Attribute old and new
  observations to their different SHAs; never combine them into one proof.
- State what merged, shipped, installed, deployed or remains unverified.

A checklist or screenshot alone is not runtime proof. For visual defects,
use visual-loop to inspect both images at readable scale. For test selection,
use test-strategy, and for the final PR state use delivery-loop.
