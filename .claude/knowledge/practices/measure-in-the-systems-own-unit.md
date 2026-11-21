---
id: measure-in-the-systems-own-unit
type: practice
summary: Measure in a custom unit by reading it from the running page, never by recomputing its definition.
concern: testing
stack: [any]
severity: should
last_verified: 2026-11-16
status: active
derived_from: [2026-11-16-measure-with-the-unit-the-system-defines]
---

A probe element sized in the unit gives pixels per unit. A recomputed definition is wrong where the definition has a second branch, such as a height limit on a short, wide screen.
