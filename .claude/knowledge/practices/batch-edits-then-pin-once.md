---
id: batch-edits-then-pin-once
type: practice
summary: Batch the edits that invalidate a pinned digest; re-pin once, after the proving build.
concern: ci
stack: [any]
severity: should
last_verified: 2026-11-15
status: active
derived_from: [2026-11-15-batch-edits-that-invalidate-a-pinned-digest]
---

The cost is per edit, not per release. Commit a pin only after the second build passes, and keep the re-pin as one repo command, not a private script.
