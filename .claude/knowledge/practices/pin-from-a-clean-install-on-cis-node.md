---
id: pin-from-a-clean-install-on-cis-node
type: practice
summary: Pin a bundle's digest from a clean install of the exact commit on the Node CI uses; make the pin command refuse anything else.
concern: ci
stack: [any]
severity: should
last_verified: 2026-11-16
status: active
derived_from: [2026-11-16-pin-from-a-clean-install-on-cis-node]
---

The ZIP's bytes depend on the Node's zlib and, when it bundles packages, on the installed tree. A worktree drifts from its lockfile; a fresh `npm ci` cannot. A second build in the clean tree proves the pin.
