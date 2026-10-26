---
name: issue-management
description: >-
  Triage, write and reorganize GitHub issues and roadmaps with MECE scope,
  one owner per outcome, clear decisions and verifiable acceptance checks.
  Use for backlog cleanup, feature planning, issue splits and duplicate audits.
---

# Issue management

Use this when writing or reorganizing issues. Keep the repository's own issue conventions,
labels and decision authority. **MECE means distinct ownership with complete coverage,
not the fewest tickets.** Do not impose a new label taxonomy when existing labels work.

## Read before writing

1. Read the requested repository's open issues, the relevant closed/history issues,
   roadmap, labels and linked PRs. Read the code or deployed behavior before saying
   a feature exists or a defect is confirmed.
2. State the user outcome in one sentence. Inventory candidate work and map each
   deliverable to **one** owning issue. Mark gaps, genuine dependencies and overlaps.
3. Classify each issue by purpose:
   - **Roadmap:** concise outcomes, priority, stage, one link per owner, dependencies.
   - **Exploration/decision:** alternatives, evidence, unresolved questions, decision gate.
   - **Implementation:** a bounded user-visible or technical result with testable completion.
   - **Bug/security:** observed versus expected behavior, reproduction, impact and regression.
   - **Operations:** one maintenance action, timing, fallback and verification.
4. Search for duplicates before creating. Prefer sharpening an existing owner to opening
   competing checklists. Split only when the outcomes can independently ship or be verified.

## Write the issue

Use this small contract; omit fields that add no information:

- **Outcome / why:** what changes for the user, not a vague implementation theme.
- **Current evidence:** code, screenshots or reproducible behavior; label hypotheses as such.
- **Scope and non-goals:** one clear owner, explicit boundary with adjacent issues.
- **Decision/state:** Exploring, Decided, Ready, In progress or Shipped; "proposed" is not
  approval, "closed as duplicate" is not shipped.
- **Acceptance:** observable cases, edge cases, permissions/security, regression, and
  artifacts or tests needed to declare done.
- **Dependencies / links:** use exact live issue and PR references; link both directions
  when transferring work.

See [issue patterns](references/issue-patterns.md) for templates and a review checklist.

## Reorganize without losing history

1. Prepare an ownership table with **old issue -> new owner -> rationale**.
2. Move detailed requirements to the owning issue; leave a concise pointer in the
   other issue. Keep prior decisions visible, but clearly mark superseded proposals.
3. Keep an exploration item exploratory until explicitly approved. A roadmap is a
   summary, not blanket authorization to implement or change production permissions.
4. Close an issue only after confirming delivery or explaining consolidation. Mark
   duplicates/history as not implemented unless the owning PR actually shipped.
5. Distinguish authentication from ownership authorization, link visibility from
   privacy, and UI labels from server-enforced security. Review existing data and
   migrations before promising new defaults.
6. Preserve repository-specific labels and priorities. Urgency reflects impact and
   exposure, not a claim of an exploit. Do not silently escalate or mark work shipped.
7. After writes, re-fetch affected issues and verify titles, scope, labels, state,
   links and that no work was lost. Report what changed and what remains undecided.

**Stop condition:** every in-scope outcome has one accountable owner and a verifiable
closing condition, without duplicate acceptance criteria or falsely claimed delivery.
