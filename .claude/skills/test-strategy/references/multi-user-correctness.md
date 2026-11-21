# Multi-user and shared-state correctness

Use for features where separate users, clients, jobs or retries can interact with the same mutable state. This includes collaborative editing, reservations, claims, shared counters, real-time sessions, tenant-owned resources and offline synchronization. Do not assume every multi-account application needs CRDTs, WebSockets or a new collaboration platform.

## Understand the operations before selecting an algorithm

Inspect the current source, persistence model, callers, permissions, background jobs and observed behavior. Answer:

1. What is shared, what is user-owned, and which component commits authoritative changes?
2. What is the smallest independently editable unit? Can operations commute, or do they depend on order?
3. Which invariants must always hold, including uniqueness, capacity, authorization, conservation and lifecycle states?
4. What happens when clients retry, disconnect, reconnect, edit stale state or arrive out of order?
5. Does the product require offline editing, real-time presence, conflict histories or only eventual UI refresh?
6. What should each user observe when a conflict is rejected, merged, overwritten or delayed?

## Choose the smallest correctness-preserving mechanism

| Operation or requirement | Starting point | Important limit |
| --- | --- | --- |
| Independent properties | Targeted field updates | Whole-row writes from stale reads can lose changes |
| Replaceable visual preference | Explicit last-writer-wins, if acceptable | Never silently apply to money, permissions or irreplaceable work |
| Counter | Atomic increment/decrement | Add bounds/checks in the transaction when required |
| One-time claim or limited stock | Conditional update, unique constraint or transaction | Read-then-write without atomic validation races |
| Related state transitions | Transaction over all relevant reads and writes | Confirm isolation and failure/retry behavior |
| User-owned or tenant-owned records | Server-side authorization on reads, writes and subscriptions | Client filtering is not a security boundary |
| Concurrent edits to one record | Version check/optimistic concurrency or explicit conflict resolution | Return an intelligible conflict response |
| Live collaborative text | A proven text collaboration algorithm, such as OT or CRDT, if justified | Generic property-level last-writer-wins loses intent |
| Offline, distributed edits | CRDT or domain-specific reconciliation where required | Additional state, deletion and migration complexity |
| Presence, cursors or typing indicators | Ephemeral state with expiry | Do not confuse presence with durable business state |

Avoid introducing duplicate state authorities. Preserve the product's existing implementation patterns unless evidence shows they fail required behavior.

## Verify competing operations

Use controlled barriers, transactions, interleavings or isolated clients to reproduce races; arbitrary sleeps are weak evidence. Where relevant test:

- Two independent edits both survive, without restoring stale unrelated fields.
- Two callers claim the final resource; the invariant permits only one winner.
- Two requests with the same idempotency key produce one logical effect; distinct intentional actions follow their separate contract.
- An action races with close, delete, cancellation or cleanup.
- A reconnecting stale client cannot silently overwrite newer authoritative state.
- Duplicate, reordered and failed delivery follows the documented retry and reconciliation policy.
- An unauthorized account or tenant cannot read, modify, subscribe to or infer protected state.
- Concurrent migration/background jobs cannot violate the same invariants that interactive writes enforce.
- All clients converge to an allowed outcome, with understandable errors or conflict UI where required.

Check persistent state, not only response codes or optimistic UI. Use the smallest reliable integration setup that exercises the real transaction/transport boundary. Add a real multi-client journey for changes to collaboration, permissions or synchronization behavior. Keep independent test state and verify the final integrated revision.

Record actual results and exact environment, revision, unrun checks and remaining risks. Passing one-client happy paths, compiling a CRDT library or producing a screenshot does not prove concurrency correctness.
