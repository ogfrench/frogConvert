---
id: reproduce-ci-with-pinned-versions
type: practice
summary: Reproduce a CI failure with the exact version CI runs.
concern: ci
stack: [any]
severity: should
last_verified: 2026-10-11
status: active
derived_from: [2026-10-11-pin-ci-tool-versions-locally]
---

Pin scanners and linters in CI, download that version locally, and scan what you are about
to push with it.
