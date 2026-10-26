---
id: test-derived-names-against-reserved
type: practice
summary: Test every name derived by rule against the reserved names.
concern: testing
stack: [any]
severity: should
last_verified: 2026-10-18
status: active
derived_from: [2026-10-11-test-derived-names-against-reserved-ones]
---

Uniforms, CSS variables, routes, columns: derive them all in a test and fail on a collision with the reserved set, read from its source, not copied.
