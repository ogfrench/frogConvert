---
id: few-readers-for-per-frame-properties
type: practice
summary: A custom property changed per frame restyles every element that reads it.
concern: ui
stack: [any]
severity: tip
last_verified: 2026-10-18
status: active
derived_from: [2026-10-16-per-frame-custom-properties-restyle-every-reader]
---

Register it with inherits: false, set it only where read, and draw many small things on one canvas.
