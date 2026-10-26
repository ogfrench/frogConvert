---
id: estimate-runner-minutes
type: practice
summary: Estimate runner-minutes per trigger; one heavy run per release.
concern: ci
stack: [any]
severity: should
last_verified: 2026-10-25
status: active
derived_from: [2026-10-17-estimate-runner-minutes-before-merging-a-trigger, 2026-10-19-run-the-slow-ci-job-once-per-pr, 2026-10-25-one-release-pr-one-e2e-run]
implemented_by: [plugins/agent-workflow/skills/actions-cost]
---

Jobs times minutes times triggers. On demand, not a matrix. One release, one PR: fixes pushed to it. Per-push job near a minute. Fails fast, no log: billing.
