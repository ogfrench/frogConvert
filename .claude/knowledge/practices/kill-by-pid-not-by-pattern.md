---
id: kill-by-pid-not-by-pattern
type: practice
summary: Kill a known PID, not a full-command-line pattern.
concern: ci
stack: [any]
severity: should
last_verified: 2026-11-15
status: active
derived_from: [2026-10-18-pkill-f-matches-its-own-shell]
---

A `pkill -f` pattern can also match the shell running it, preventing the next command
from starting. Save the PID at launch and stop that PID, or use the task harness's
stop command. If matching is unavoidable, inspect the matches before killing.
