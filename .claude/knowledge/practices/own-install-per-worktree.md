---
id: own-install-per-worktree
type: practice
summary: Every worktree gets its own install.
concern: ci
stack: [any]
severity: should
last_verified: 2026-10-18
status: active
derived_from: [2026-10-18-each-worktree-gets-its-own-install]
---

A shared node_modules carries workspace links into the checkout that installed it, so tests run another branch's code. Check with require.resolve.
