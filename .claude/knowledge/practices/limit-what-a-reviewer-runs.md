---
id: limit-what-a-reviewer-runs
type: practice
summary: Tell a reviewer which commands it may run.
concern: agents
stack: [any]
severity: should
last_verified: 2026-10-18
status: active
derived_from: [2026-10-18-reviewers-must-not-build-in-your-worktree]
related: [review-every-commit, one-suite-at-a-time]
---

Read-only is about edits, not output: a suite or build in your worktree rewrites what a running gate reads. Or give it its own worktree.
