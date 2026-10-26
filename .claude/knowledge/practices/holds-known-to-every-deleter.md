---
id: holds-known-to-every-deleter
type: practice
summary: A hold must be known to every deleter.
concern: data
stack: [any]
severity: should
last_verified: 2026-10-11
status: active
derived_from: [2026-10-11-sweeps-must-know-about-holds]
---

List every path that deletes the thing, cron jobs included, and make each respect the hold.
Test the sweep, not only the paths you changed.
