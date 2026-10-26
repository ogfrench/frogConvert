---
id: one-suite-at-a-time
type: practice
summary: Run one test suite at a time on a shared stack or machine.
concern: testing
stack: [any]
severity: should
last_verified: 2026-10-18
status: active
derived_from: [2026-10-18-one-suite-at-a-time-on-a-shared-stack]
related: [one-dev-stack-per-tree, serial-agents-on-shared-stack]
---

Overlapped suites fail each other's loads. A red run made of load failures, not findings, is rerun alone before anyone debugs it.
