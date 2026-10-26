---
id: simulate-the-users-sandbox
type: practice
summary: Before shipping a skill or tool, have an agent use it inside a copy of the user's environment.
concern: agents
stack: [any]
severity: should
last_verified: 2026-10-18
status: active
derived_from: [2026-10-18-simulate-the-users-sandbox-before-shipping-a-skill]
related: [state-the-job-first, fetch-as-an-ai-client-would]
---

No network, only the platform's documented libraries, only the unzipped package, and a real user prompt. Read its reply, its files and what it had to guess. Check the platform's size limits first.
