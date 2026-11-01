---
id: evaluate-skill-triggers
type: practice
summary: Test positive, negative and ambiguous skill triggers before promotion.
concern: agents
stack: [any]
severity: should
last_verified: 2026-10-28
status: active
derived_from: [2026-10-28-evaluate-skill-routing]
implemented_by: [plugins/agent-workflow/skills/learning-loop]
related: [measure-single-loop-before-delegation]
---

Schema checks do not prove behavior. Compare completed tasks with and
without a skill, checking routing errors and regressions.
