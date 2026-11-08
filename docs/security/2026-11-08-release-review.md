# frogConvert security review and handoff | 2026-11-08

**Decision:** separate security PR on the released `v3.4.9` base. No Dependabot updates, no automatic publication of unaccepted Claude/ChatGPT plugin ZIPs. This is a source review and targeted hardening, **not** a comprehensive penetration test.

## Boundaries examined

- Browser-only conversion, local storage and IndexedDB retention (`SECURITY.md`).
- Loopback REST API and native MCP: `src/api/index.ts`, `src/mcp/core/fileInput.ts`, file overwrite/sandbox tests.
- Build and release: Electron desktop installers, Docker, AI plugin candidate packaging and documentation.
- Intentional trust boundaries: a local MCP agent can operate on files with the permissions of its host process; `FROGCONVERT_SANDBOX_ROOT` is defense-in-depth, **not** an OS sandbox.

## Findings

| ID | Priority | Evidence | Action |
| --- | --- | --- | --- |
| FC-S1 | **High / localhost attack surface** | REST accepted `Origin: null`, which can originate from sandboxed iframes and file-based browser documents. It also accepted any local-origin port, not necessarily the API origin. | **Fixed in this PR:** require exact local Host, reject opaque/null Origin and cross-/same-site Fetch Metadata. CLI/MCP without Origin remain supported; same-origin local browser access is still supported. Pure guard tests cover both. |
| FC-S2 | **Medium / filesystem escape race** | Existing sandbox containment checked real paths before using `readFile`/`writeFile`. A final-component symlink could be swapped between the check and open. | **Partially mitigated:** use POSIX `O_NOFOLLOW` on actual file opens when the sandbox is enabled, and close handles explicitly. Preserve unsandboxed symlink behavior. **Not fixed:** parent-directory races and Windows filesystem reparse-point handling. |
| FC-S3 | **Medium / memory and configuration** | File content was read into memory before checking `MAX_UPLOAD_MB`; nonfinite or nonpositive configuration silently disabled the effective size ceiling. | **Fixed:** validate size configuration, stat through the opened handle before reading, then check actual length; test invalid configuration and oversized file/base64 inputs. |
| FC-S4 | **Operational / distribution** | Desktop `v3.4.9` is released, but Claude/ChatGPT candidate ZIPs are marked previews and have not passed all real-host and platform approval gates. | Keep separate from desktop installers. Record build SHA, reproducible archives, clean Windows/macOS installation, real file conversions and approved client loading before a public plugin release. |
| FC-S5 | **Known privacy trade-off** | Local REST/MCP processes can access authorized local paths; AI clients can transmit user-supplied paths or contents to their providers. Browser IndexedDB keeps resumable files temporarily. | Do not claim that local conversion implies model-side privacy or secure document isolation. Preserve clear `SECURITY.md` and AI plugin disclosures. |

## Second-agent review protocol

1. Inspect the full diff, especially `src/api/localRequest.ts` and its call site. Confirm blocked cross-origin scenarios while local CLI/MCP calls and legitimate same-origin web requests remain functional.
2. Run `bun x vitest run src/api/localRequest.test.ts src/mcp/core/fileInput.overwrite.test.ts`, `bun x tsc --noEmit`, and the normal CI, including real PDF merge/extract cases and browser/desktop builds on the **final** commit.
3. Re-check the sandbox: directory traversal, dangling and in-root symlinks, Windows junction/reparse behavior, path creation, overwrite protection and concurrent replacement. Only the **leaf** symlink race is partially addressed by `O_NOFOLLOW`; do not claim a fully race-free filesystem boundary.
4. Inspect `src/api/index.ts` for other origin, Host, Fetch Metadata, request-body size and DNS rebinding paths. Validate that the API remains bound to loopback and does not grant cross-origin browser calls.
5. Validate native and WASM conversion input/output caps, error handling, archive extraction, browser bridge network egress, generated PDF safety, and MCP tool permissions.
6. Run secret scanning and inspect plugin ZIP manifests. Check no tokens, source documents or unexpected binaries enter release artifacts. Do not conflate the public desktop release with the not-yet-approved ChatGPT plugin.
7. Decide how to handle the residual Windows/parent-directory race. Require OS-enforced sandboxing or a secure directory-descriptor design before promising arbitrary untrusted-client filesystem isolation.
8. After merge, increment beyond published `v3.4.9` (do not mutate its existing tag), run the full desktop/Docker release gates, and publish truthful notes. AI plugin distribution needs separate clean-host and provider approval.
9. Leave Dependabot PRs untouched.

**Scope limitation:** source review only. No claim of zero vulnerabilities, externally verified privacy, exhaustive file-format coverage, or live client acceptance is made here.
