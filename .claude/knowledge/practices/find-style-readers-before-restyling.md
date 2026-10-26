---
id: find-style-readers-before-restyling
type: practice
summary: Before restyling a component, find the code that reads its computed style.
concern: ui
stack: [any]
severity: should
last_verified: 2026-10-18
status: active
derived_from: [2026-10-18-restyling-breaks-programs-that-read-styles]
---

Exporters, measurers and probes read styles no screenshot shows. Run one on the change, and make it handle the empty case.
