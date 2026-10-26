---
id: gate-push-on-exit-status
type: practice
summary: Push only after the gate's own exit status says green.
concern: ci
stack: [any]
severity: must
last_verified: 2026-10-18
status: active
derived_from: [2026-10-18-gate-a-push-on-the-real-exit-status]
---

Not after `;`, and not after `| tail` or `| grep`, whose status is the pipe's last command. Use `set -o pipefail`, or run the gate, read it, then push.
