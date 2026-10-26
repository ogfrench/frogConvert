---
id: pasted-secret-gets-a-home
type: practice
summary: A secret pasted in chat gets a home outside every repo and a rotation issue at once.
concern: security
stack: [any]
severity: should
last_verified: 2026-10-18
status: active
derived_from: [2026-10-18-a-pasted-secret-needs-a-home-and-a-rotation]
---

Store it in a mode-600 file or the environment's secrets, never echo it, and open one issue naming each credential by its last four characters, with rotation steps.
