---
id: compare-against-origin-main
type: practice
summary: Compare a change against origin/main after a fetch, never a local main.
concern: ci
stack: [any]
severity: should
last_verified: 2026-10-18
status: active
derived_from: [2026-10-18-review-baselines-come-from-the-remote]
---

Nothing fast-forwards a local main in a clone worked through worktrees. Read the sha a review tool prints as its baseline.
