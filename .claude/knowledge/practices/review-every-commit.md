---
id: review-every-commit
type: practice
summary: Review every commit before pushing it.
concern: agents
stack: [any]
severity: should
last_verified: 2026-10-11
status: active
derived_from: [2026-10-11-cheap-reviews-catch-real-bugs]
implemented_by: [plugins/agent-workflow/agents/cheap-reviewer.md]
---

Review read-only, on a mid-size model, with a fixed brief: correctness and safety,
`file:line`, a concrete scenario, a word cap. The `cheap-reviewer` subagent does exactly
this. Verify each finding before acting on it.
