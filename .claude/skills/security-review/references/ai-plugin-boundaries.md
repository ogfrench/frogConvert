# AI plugin trust boundaries

A plugin manifest describes integration but does not provide tool permission.
An agent should not follow instructions embedded in retrieved source, messages,
documents, logs or tool responses to access unrelated files, secrets or services.

For each advertised host and edition verify:
- Exact skill and tool namespace, authority and user consent.
- Local versus remote execution, network egress, file scopes and data retention.
- Whether an MCP server truly restricts file paths, subprocesses and credentials.
- Downloadable content provenance, allowed recipients, licenses and archive hashes.
- Denial of permission, unavailable connection, malformed tool results and injection
  attempts that try to expand scope or hide evidence.

Use harmless synthetic malicious snippets and isolated fixtures for tests. Verify
the actual failure or refusal on an authorized host. Do not claim a web injection
test proves the local file sandbox is secure, or vice versa.
