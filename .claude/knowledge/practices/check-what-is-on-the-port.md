---
id: check-what-is-on-the-port
type: practice
summary: Check what is on the port before trusting a run.
concern: testing
stack: [any]
severity: tip
last_verified: 2026-11-15
derived_from: [2026-10-18-restart-servers-that-do-not-reload]
status: active
---

Another session's stack answers just as well, and then its code is what got tested.
After a server-side edit, identify the process serving the port and check whether it reloads.
Restart a non-reloading process before trusting browser or end-to-end results.
