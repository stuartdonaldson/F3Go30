# ADR-019: Static Origin Primary for All Front Ends, GAS Reduced to Redirect-Only

Status: Accepted

Date: 2026-07-20

Implementation: F3Go30-ubwl

## Context

ADR-018 made the static origin primary for signup, and kept `SignupApp.html`
standing as an **availability fallback** — mirroring `CheckinApp.html` under the
earlier check-in split. Both ADR-018 and the check-in precedent treat the GAS
HTML pages as serving a real purpose: a second origin to fall back to if the
static host (GitHub Pages) is unreachable.

That premise was tested and resolved on 2026-07-20 (`F3Go30-ys15`):
**unreachable-host availability fallback is not a requirement.** No PAX-facing
guarantee depends on the GAS front end being able to render signup or check-in
if the static origin is down. This narrows what the GAS front ends are for —
they exist to honour links already distributed before the static migration
(TinyURL short links, Slack messages, bookmarks), not to guarantee the flow
stays reachable.

## Decision

The **static origin is primary for every PAX-facing front end** — check-in and
signup alike. The **GAS front ends are reduced to redirect-only**: `?cmd=...`
requests arriving at the GAS origin are answered with a query-preserving
redirect to the equivalent static URL, not a rendered fallback page.

- **`?static=0` is a developer/legacy escape hatch, not a PAX-facing
  availability guarantee.** It exists to let a developer force the GAS-rendered
  path (for debugging or for links that predate the static migration), not to
  promise PAX continuity if the static origin is unreachable.
- No PAX-facing flow is entitled to a working GAS-rendered page as a fallback.
  Rendering it after this decision is a matter of not deleting the capability
  outright, not of a live requirement to keep it correct.

## Supersedes

ADR-018 is Accepted and immutable; it is not edited by this record. ADR-018's
availability-fallback claim — that `SignupApp.html` "remains as the
availability fallback" — is **superseded by this ADR, scoped to that claim
only**. ADR-018's placement decision (static origin primary, in-page signup
step, no top-level navigation, unchanged JSON API) is unaffected and remains
accurate.

## Consequences

**Easier:**

- `F3Go30-wjpu` (remove `SignupApp.html`) loses one of its two blocking
  justifications: the availability-fallback role no longer exists to preserve.
  The remaining justification — a month of real static-signup use before
  removal — still applies, per `F3Go30-90l5`.
- The GAS front ends' scope shrinks to one job: redirect. That is a smaller,
  more testable surface than a second rendered UI kept in sync with the static
  page.

**Harder:**

- Any documentation or code comment that still describes the GAS HTML pages as
  an availability fallback (ADR-018's own text, `CheckinApp.html`/
  `SignupApp.html` framing) is now stale with respect to that claim and should
  be read through this ADR, not taken at face value.
