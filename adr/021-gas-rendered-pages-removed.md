# ADR-021: GAS-Rendered Signup/Check-In Pages Removed Outright

Status: Accepted

Date: 2026-08-04

Implementation: this record (code already merged same day — see design-review-2026-08-04.md DR-04)

## Context

ADR-019 reduced the GAS-hosted front ends to redirect-only: a plain `doGet` at
`?cmd=signup`, `?cmd=checkin`, or the bare home route answered with a
query-preserving redirect to the static origin by default, but `?static=0`
stayed as "a developer/legacy escape hatch" that could still render
`SignupApp.html` / `CheckinApp.html` (via the shared `IdentityCore.html`
partial). ADR-019 was explicit that this was deliberate: "Rendering it after
this decision is a matter of not deleting the capability outright, not of a
live requirement to keep it correct."

`F3Go30-90l5` recorded the human decision that this capability was scheduled
for removal on a soak trigger (`F3Go30-wjpu`: one full tracker month of
static-only use in PROD after the redirect defaults shipped), specifically to
avoid deleting a fallback before it had been proven unnecessary in practice.

The 2026-08-04 design review (`docs/design-review-2026-08-04.md`, finding
DR-04) found the posture already settled but the execution bead scoped too
narrowly (`SignupApp.html` only, predating ADR-019's generalization to every
front end) — and, separately, ~2,300 lines of hand-duplicated client logic
between `CheckinApp.html` and `static-pages/src/index.html` actively drifting
(a live rolling-average chart fix found in the working tree during that same
review had not been mirrored into the GAS copy).

On review, the human decision was made to skip the remaining soak period and
execute the removal immediately rather than wait out `F3Go30-wjpu`'s trigger
date — the posture was never in question, only the timing, and the
duplicated-surface cost was judged to outweigh the value of further waiting.

## Decision

`script/SignupApp.html`, `script/CheckinApp.html`, and `script/IdentityCore.html`
are deleted outright, along with:

- the GAS-template-rendering code paths that served them
  (`buildCheckinPageOutput_`, `renderCheckinPageForTypedIdentify_`, and the
  template-building branches of `renderSignupPage_`/`renderCheckinPage_`,
  replaced by an unconditional redirect via `renderStaticRedirect_` or, on the
  practically-Node-test-only case a static URL can't be built at all, the new
  minimal `renderStaticUnavailable_`);
- the `?static=0` opt-out (`buildStaticRedirectUrl_`, `script/Utilities.js`) —
  there is nothing left to opt into;
- the `formIdentify=1` doPost branch and its real `<form target="_top">` POST
  handler, specific to the removed page's sandboxed-iframe escape mechanics;
- the now-orphaned `getCachedCheckinSessionTitle_`/`cacheCheckinSessionTitle_`
  title-cache mechanism (`CheckinSessions.js`) that existed solely to give the
  removed page's server-side template a personalized `<title>` without
  opening the CheckinSessions sheet — no remaining caller needs it, since the
  static page has always resolved its own title client-side.

**What is kept, unchanged:** the `?cmd=signup`/`?cmd=checkin`/`?cmd=admin`
`doPost` JSON API — the static front end's own backend, per F3Go30-wjpu's own
scope note ("KEEP the `?cmd=signup` GAS route as a query-preserving
redirect... removing the route would break every old link") — and the
redirect route itself, which now fires unconditionally instead of being the
default-on-but-optable-out behavior ADR-019 established. `HomeApp.html` is
unaffected; it was never in DR-04's scope.

## Supersedes

ADR-019 is Accepted and immutable; it is not edited by this record. Its
`?static=0` claim — "a developer/legacy escape hatch... they exist to honour
links already distributed before the static migration... not to guarantee the
flow stays reachable" — is **superseded by this ADR, scoped to that claim
only**: the escape hatch itself is gone, because the pages it escaped to no
longer exist. ADR-019's core decision (static origin primary, GAS reduced to
redirect for everything else) is unaffected and remains accurate — this
record only removes the one exception ADR-019 had carved out.

## Consequences

**Easier:**

- `F3Go30-wjpu` closes as done rather than waiting on its soak trigger; no
  execution bead remains open for this decision.
- The duplicated client-logic surface DR-04/DR-06 identified (~2,300 lines
  across `CheckinApp.html` + `static-pages/src/index.html`) is gone in one
  side — every future check-in/dashboard/bonus change is made once, not
  twice, and cannot drift the way the working-tree chart fix already had.
- `F3Go30-zcxc` (a hardening bead for `IdentityCore.html`'s `callApi`) closes
  as obsolete — the file it would have hardened no longer exists.
- Playwright coverage shrinks by one whole spec
  (`tests/playwright/identity-token-flow.spec.js`, fully retired — its
  GAS-iframe-driven coverage was already subsumed by
  `tests/playwright/static-checkin.spec.js` and `static-signup.spec.js`) and
  one `describe` block inside `static-checkin.spec.js` ("Existing GAS
  HtmlService check-in page still works unchanged").

**Harder / accepted tradeoffs:**

- `?static=0` is gone as a developer debugging affordance for the (now
  nonexistent) GAS-rendered page — moot, since there is nothing left to
  debug that way.
- The GAS-side "Not you?" reset link's cross-origin hand-off had dedicated
  Playwright coverage (`identity-token-flow.spec.js`) specifically because
  the sandboxed-iframe/cross-origin mechanics were fragile. The static
  page's equivalent link is a same-document, same-origin action with no
  comparable fragility, so this is judged an acceptable, much-lower-risk
  coverage gap rather than one requiring a replacement spec before merge.
- Any future need for a second, GAS-rendered front end (e.g. a genuinely
  unreachable static host) would require rebuilding this capability from
  scratch rather than re-enabling a flag — accepted, per ADR-019's own
  finding that unreachable-host availability was never a real requirement.
