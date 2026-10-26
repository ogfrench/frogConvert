---
id: headless-matches-hover-none
type: practice
summary: Headless Chrome matches hover: none; key touch fallbacks on pointer: coarse.
concern: testing
stack: [any]
severity: tip
last_verified: 2026-10-18
status: active
derived_from: [2026-10-16-headless-chrome-matches-hover-none]
---

It also matches pointer: none and never pointer: coarse. Check matchMedia in the test browser before trusting a capture.
