# GitHub issue patterns

Read this reference only when drafting or performing a backlog restructuring.

## Map ownership first

| Outcome | Existing owner | New owner (if needed) | Stage | Evidence | Dependency |
| --- | --- | --- | --- | --- | --- |
| One independently verifiable result | #N | #N | Exploring/Ready/... | Code, report or reproduction | #N |

Each row must have **one** detailed owner. Multiple related issues are fine if the
work is independently testable. Split by outcome, not arbitrarily by frontend/backend,
unless those can genuinely ship and be verified separately.

## Issue templates

### Roadmap

```markdown
## Outcome
One sentence describing the product result and boundaries.

## Workstreams
| Outcome | Stage | Detailed owner | Dependency / next decision |
| --- | --- | --- | --- |
| ... | Exploring / Decided / Ready / In progress / Shipped | #123 | ... |

## Decision record
- Agreed: ...
- Still open: ...
- Not authorized: ...

## Completion
The connected user journey works; linked implementation issues are verified.
```

Keep the roadmap short. Do not copy the acceptance checklists from its owners.

### Exploration or decision

```markdown
## Problem / opportunity
## Evidence (separate observation from inference)
## Options and tradeoffs
## Recommendation (not yet approval)
## Decision needed and who can make it
## Next gate (when to create a Ready implementation issue)
```

Research may be valuable without having an implementation ready. Never convert an
interesting feature list into a committed roadmap merely by adding checkboxes.

### Implementation

```markdown
## User-visible outcome
## Existing behavior and evidence
## Scope
## Out of scope (link the owning issues)
## Acceptance criteria
- [ ] Normal path...
- [ ] Edge, empty, reconnect or old-data path...
- [ ] Permission and data exposure path where applicable...
- [ ] Verification evidence (tests, screenshots, real client/session)...
## Dependencies / rollout or migration
```

Avoid specifying unreviewed solutions as facts. Prefer expected behavior and
constraints, leaving implementation details to the implementer.

### Bug and security

```markdown
## Observed behavior (environment, revision, steps and evidence)
## Expected behavior
## Impact (who is affected, data at risk, actual vs potential)
## Reproduction or missing evidence
## Fix boundary
## Regression test and release verification
```

A suspected vulnerability is not automatically a proven exploit. Access control
must be checked at the server/resource boundary, not inferred from a UI label.

## MECE review before each write

- **No gap:** every agreed outcome is represented, even if its stage is Exploring.
- **No overlap:** one implementation owner, no competing lists of requirements.
- **Right altitude:** roadmap summarizes; decisions record alternatives; tasks can close.
- **Correct status:** planned is not deployed; reverted is not shipped; closed is not done.
- **Accurate security wording:** signed-in, owner-only, unlisted and public differ.
- **Traceability:** original finding, transferred owner, relevant PR and superseded
  decision remain findable.
- **Evidence:** observations reproduced or explicitly flagged as hypotheses.
- **Non-goals:** a future agent cannot accidentally expand scope from a broad title.
- **Labels:** follow the repository's existing vocabulary, avoid synonyms and label sprawl.

## Worked example (generic)

An online service has a product roadmap that repeats an exploration on new
audience activities. A security issue includes three evolving access models,
and an automation workstream assumes the wrong model.

Keep the roadmap as a status summary. Keep audience research in its single
exploration owner until one feature is decided. Open a dedicated access-control
implementation issue once the owner-only rule is approved; move all permission,
migration and regression requirements there. Keep the historical discussion
closed and clearly marked superseded. Link the automation workstream to the
access-control dependency, without giving it authority to change permissions.
Never say the private mode shipped before code, tests and deployment confirm it.
