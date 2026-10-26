---
id: one-dev-stack-per-tree
type: practice
summary: One dev stack per working tree.
concern: testing
stack: [any]
severity: should
last_verified: 2026-10-11
status: active
derived_from: [2026-10-11-second-stack-reloads-pages]
related: [check-what-is-on-the-port, serial-agents-on-shared-stack]
---

A second stack from the same tree, even on other ports, rewrites shared generated files and
reloads the first one's pages. No edits under a watched tree while browser tests run.
