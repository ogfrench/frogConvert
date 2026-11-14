# Test selection matrix

For each affected behavior ask: what can fail, what assertion detects it, and what
simpler test would miss it? Avoid universal ratios such as 70/20/10.

| Changed surface | Start with | Expand when |
| --- | --- | --- |
| Pure function, parser, validation | Table-driven unit and invalid-input assertions | Serialization or real dependency semantics differ |
| API/HTTP route, error response | API integration with real auth and negative cases | User session and browser navigation cross boundaries |
| SQL, migration, transactions | Disposable real database, constraints, concurrency and rollback checks | Deployment sequence or multiple processes change behavior |
| Tool/MCP protocol or package | Contract handshake, manifest, archive content and checksums | Client/host loading, permissions or actual tool effects are at risk |
| Authentication or authorization | Wrong-account, anonymous, expired, refresh and revocation checks | Cookies, redirects, CORS and login UX need real browser proof |
| UI interaction or accessibility | Component behavior and keyboard/semantic assertions | Browser-specific layout, hydration or routes can break |
| Visual design and animations | Real screenshots at relevant widths/themes; reduced-motion | Export and rendered output disagree or motion is consequential |
| Queue, websockets, live game | Deterministic state/concurrency integration | Reconnect and two actual clients must agree |
| File transformations | Real input/output round trip, metadata and negative cases | Native runtime, OS, printer or viewer affects fidelity |
| Release, security or config | Static validation plus staging/synthetic smoke | Actual host credentials, permissions, migration and recovery matter |

- A few stable core E2E journeys protect the product; targeted E2E protects changes.
- Check both success and meaningful refusal paths. Test requirements, not mock calls alone.
- E2E suite may be scheduled, but critical changes must validate the affected journey
  on the final candidate. Never declare a skipped suite green.
- An existing mandatory product gate remains mandatory even if this matrix suggests
  a cheaper strategy. Explicitly identify environment limitations and waivers.
