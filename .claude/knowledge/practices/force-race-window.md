---
id: force-race-window
type: practice
summary: Force a race window instead of timing it.
concern: testing
stack: [any]
severity: should
last_verified: 2026-10-11
status: active
derived_from: [2026-10-11-deterministic-race-tests]
related: [wait-for-state-not-time]
---

Find a call that sits between the read and the write, monkeypatch it to land the competing
write, assert the result. Say in the test that the window is forced on purpose.
