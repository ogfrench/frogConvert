---
id: claim-shared-work-atomically
type: practice
summary: Claim shared work in one step.
concern: data
stack: [any]
severity: must
last_verified: 2026-10-11
status: active
derived_from: [2026-10-11-claim-shared-state-atomically]
related: [conditional-update-is-the-check]
---

Read-and-delete is two steps; use one atomic operation (a Redis `MULTI`, `SPOP`, or an
`UPDATE ... WHERE` that reports the rows it changed), and put items back if the work after
the claim fails.
