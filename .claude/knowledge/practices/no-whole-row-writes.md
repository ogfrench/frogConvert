---
id: no-whole-row-writes
type: practice
summary: No whole-row writes from a stale read.
concern: data
stack: [any]
severity: must
last_verified: 2026-10-11
status: active
derived_from: [2026-10-11-whole-row-orm-writes-revert-saves]
related: [conditional-update-is-the-check]
---

Counters are one statement (`SET n = n + 1`). Other writers name their columns. A whole-row
`update()` is a bug unless the writer really sets every field, and even then it puts back
counters and ownership changed meanwhile.
