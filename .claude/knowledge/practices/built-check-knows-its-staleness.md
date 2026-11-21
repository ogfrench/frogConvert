---
id: built-check-knows-its-staleness
type: practice
summary: A check on a built artifact must report its age and fail when the sources are newer.
concern: testing
stack: [any]
severity: should
last_verified: 2026-11-15
status: active
derived_from: [2026-11-15-a-check-on-a-built-artifact-must-know-it-is-stale]
---

A check that reads build output cannot see a source fix until the build runs. When a finding survives a fix, rebuild first; make the check say how old its input is.
