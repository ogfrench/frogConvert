---
id: cheapest-model-with-catch
type: practice
summary: Delegate to the cheapest model only after measuring that delegation helps.
concern: agents
stack: [any]
severity: should
last_verified: 2026-10-28
status: active
derived_from: [2026-10-11-cheap-reviews-catch-real-bugs, 2026-10-28-test-single-loop-before-agents]
implemented_by: [plugins/agent-workflow/skills/model-delegation]
related: [review-every-commit, measure-single-loop-before-delegation]
---

Compare the main loop first. See `model-delegation` for the decision.
