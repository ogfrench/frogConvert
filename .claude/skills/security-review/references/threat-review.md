# Focused threat review

Use only applicable questions for the exposed boundary.

- **Actors:** What can an anonymous caller, authenticated user, different tenant,
  admin, service account, or compromised agent actually invoke?
- **Objects:** Can one principal read, mutate, share or delete another's objects?
  Check both guessed identifiers and legitimate cross-account links.
- **Data:** Could logs, traces, generated packages, screenshots, LLM input,
  attachment names, error messages or backup exports disclose private content?
- **Credentials:** Who issues and revokes tokens? Does a cheap new identity evade
  rate limits? Are tokens over-scoped or persisted in downloadable artifacts?
- **Filesystem:** Check archive extraction, traversal, symlinks, parent races,
  Windows path/reparse semantics, replacement and oversized file behavior.
- **Dependencies:** Identify build-time downloads, integrity pins, artifact digests,
  update channels and untrusted scripts in package/install paths.
- **Recoverability:** Does rejection leave persistent state unchanged? Can failed
  migration, compromised token, or broken deploy be rolled back cleanly?

Record one threat, one actual vulnerable path, one proof and one proposed
regression per finding. Do not turn absence of evidence into a vulnerability.
