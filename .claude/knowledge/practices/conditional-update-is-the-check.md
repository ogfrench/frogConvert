---
id: conditional-update-is-the-check
type: practice
summary: A conditional update is the check.
concern: data
stack: [any]
severity: should
last_verified: 2026-10-18
status: active
derived_from: [2026-10-18-check-and-write-in-one-transaction]
---

"Check, then write" lets two callers both pass the check. Put the condition in the `WHERE`
and act only if a row changed.
In Redis, check inside the transaction, `WATCH` every key the check reads, and put dependent
writes in the same `MULTI`. A reader that closes something closes first, then reads.
