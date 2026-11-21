---
id: scope-host-css-from-embedded-content
type: practice
summary: Scope a host page's element selectors so they never reach the content it embeds.
concern: ui
stack: [any]
severity: should
last_verified: 2026-11-15
status: active
derived_from: [2026-11-15-scope-host-page-css-away-from-embedded-content]
---

A bare `section{padding}` in the host hit an embedded slide's own section and broke it only on the host page. Guard with `:where(:not(.root x))` and measure embedded content on the host.
