# ADR-020: Namespace Time-Trigger Fan-Out (ADR-014 D4) Deferred, Not Implemented

Status: Accepted

Date: 2026-08-04

Implementation: none (this record documents a deferral, not a change)

## Context

ADR-014 D4 decided that the four time-based triggers — `sendNagEmail`,
`markEmptyCellsAsMinusOne`, `MONTHLY_AUTO_GENERATE_HANDLER_`,
`cleanupStaleCheckinSessions` — would **fan out** over `{parent bound
Template} ∪ {NamespaceDB rows whose matching per-trigger column = Enabled}`,
each namespace wrapped in its own `try/catch`, the parent processed first.

The 2026-08-04 design review (`docs/design-review-2026-08-04.md`, finding
DR-02) found the schema half built and the consumer half absent:

- `NAMESPACE_DB_COLUMNS_` declares all four opt-in columns (`go30tools.js`);
  `_parseNamespaceRegistryRow_` parses them into `nagEnabled` /
  `minusOneEnabled` / `autoGenerateEnabled` / `cleanupSessionsEnabled`;
  `_upsertNamespaceRow_` writes them. A `NamespaceDB` row can be provisioned
  today with any of these flags set to Enabled.
- `script/nag.js`, `script/markMinusOne.js`, `script/CreateNewTracker.js`, and
  `script/CheckinSessions.js` contain **zero** references to `NamespaceDB` or
  to any of the four flags. No fan-out loop exists anywhere in the codebase.
  Each trigger runs once, against the bound/active spreadsheet only.

This is latent today because the only namespaces that exist are smoke
environments provisioned and torn down within minutes
(`tools/smokeTestNamespace.js`) — none live long enough for a nightly trigger
to matter. It stops being latent the day a `regional` or `demo` tenant (ADR-014
D7) is registered with any fan-out column Enabled: that tenant silently gets
no nightly −1 marking, no nag emails, no monthly auto-generation, and no
stale-session cleanup, with nothing logging the gap — because nothing is
looking for that namespace at all. ADR-014 reads as though this already
works, so a future maintainer registering a tenant has no reason to check.

## Decision

**D4's fan-out behaviour is deferred, not implemented, and the four
`NamespaceDB` opt-in columns are reserved-not-live** until a real non-smoke
namespace actually needs it. This ADR does not change ADR-014's design — the
column schema and per-namespace opt-in shape are still the intended eventual
mechanism — it only corrects ADR-014's status from "decided and built" to
"decided and outstanding" for this one sub-decision.

Rationale for deferring implementation over building it now: nothing today
exercises the fan-out loop long enough to validate it, and an unexercised loop
against the four trigger entry points' own 6-minute execution cap would add
risk (an infinite/slow namespace iteration silently starving the parent's own
run) without buying any observed function. Implement it — one shared
`forEachTriggerScope_(flagName, fn)` helper called from all four entry points,
not four hand-copied loops — when a `regional` or `demo` tenant is actually
registered with a fan-out column Enabled.

## Supersedes

ADR-014 is Accepted and immutable; it is not edited by this record. ADR-014's
D4 claim — that the four time-based triggers fan out over
`{parent} ∪ {Enabled NamespaceDB rows}` — is **superseded by this ADR, scoped
to that claim only**. Every other part of ADR-014 (D1–D3, D5–D7, the
`NamespaceDB` schema itself, the resolution seam, the lifecycle) is unaffected
and remains accurate.

## Consequences

**Easier:**

- No unexercised fan-out loop ships against a live trigger budget before
  anything needs it.
- Registering a `smoke` namespace (the only kind that exists today) is
  unaffected — smoke environments never live long enough to hit a nightly
  trigger regardless of this decision.

**Harder:**

- Setting any of `NagEnabled` / `MinusOneEnabled` / `AutoGenerateEnabled` /
  `CleanupSessionsEnabled` to Enabled on a `NamespaceDB` row today has **no
  effect** — the columns are write-only until the fan-out helper is built. An
  operator provisioning a `regional`/`demo` tenant (ADR-014 D7) must not infer
  live-tracker maintenance from those columns being set.
- Before any non-smoke namespace is registered with data an operator cares
  about staying correct day to day, the fan-out helper described above must
  land first — this ADR is the marker that gates that.
