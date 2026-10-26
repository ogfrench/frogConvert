---
id: work-that-survives-cut-short
type: practice
summary: Ask for work that survives being cut short.
concern: agents
stack: [any]
severity: should
last_verified: 2026-10-18
status: active
derived_from: [2026-10-11-background-agents-hit-usage-limits, 2026-10-18-check-worktrees-after-an-agent-stops]
implemented_by: [plugins/agent-workflow/skills/model-delegation]
---

Agents share the session's limits: have them write findings as they go, push after every
green commit, resume rather than restart, and clean up. After one stops, check each
worktree against its remote.
