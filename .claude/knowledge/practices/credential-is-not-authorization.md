---
id: credential-is-not-authorization
type: practice
summary: A valid credential is not authorization.
concern: security
stack: [any]
severity: must
last_verified: 2026-10-11
status: active
derived_from: [2026-10-11-api-key-is-not-authorization]
related: [test-with-the-wrong-account]
---

Every route that reads per-account data compares the caller with the owner. If any account
can mint the credential (an API key), "behind a key" gates nothing.
