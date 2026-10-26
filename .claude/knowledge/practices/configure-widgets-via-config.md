---
id: configure-widgets-via-config
type: practice
summary: Configure a third-party widget through its config, not by patching its DOM after creation.
concern: ui
stack: [any]
severity: should
last_verified: 2026-10-11
status: active
derived_from: [2026-10-11-third-party-editor-overrides]
---

Its render loop rewrites attributes such as `aria-label`. For its CSS, match or exceed its
own selectors.
