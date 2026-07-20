# ADR-018: The Static Origin Is the Primary Signup Front End

Status: Accepted

Date: 2026-07-19

Implementation: F3Go30-833s.9

## Context

Signup has two possible front ends over one backend. `handleSignupPost_`
(`script/WebApp.js:128`) dispatches `identify`, `save`, and `feedback` as JSON
actions behind `?cmd=signup`; `SignupApp.html` is a GAS-rendered HTML page that
calls those same actions. Check-in already went through this split and resolved
it: the static page on GitHub Pages calls the JSON API directly, and
`CheckinApp.html` remains as the zero-install fallback.

Signup did not follow, and the seam shows. The static check-in page cannot
render signup, so three flow-critical paths navigate the **top-level document**
cross-origin to the GAS signup page (`signupDeepLinkUrl_`,
`static-pages/src/index.html:1327`):

| Exit | Trigger | Mechanism |
|---|---|---|
| "Edit" on the goals reminder | PAX edits WHO/WHAT/HOW | `target="_top"` anchor (`:1027`) |
| "Sign up" button | PAX not yet registered | `window.top.location.href` (`openSignup_`, `:1331`) |
| Auto-redirect on identify | `knownPaxNotRegistered` | `attemptTopRedirect_` (`:642`, `:895`) |

Today this is a context switch. Once the static page is installable
(`docs/pwa-design.md`), it becomes a defect: each of these replaces the installed
app's document with `script.google.com`, and on iOS hands off to Safari with no
way back except re-tapping the home screen icon. The third fires on *identify* at
a month boundary, ejecting a returning PAX before they ever reach the dashboard.

The question this ADR settles is **where the primary signup front end lives.**

### Candidates evaluated

1. **A step inside the existing static check-in page** (chosen).
2. **A separate static `signup.html`** on the same origin.
3. **Keep GAS `SignupApp.html` primary; suppress the ejection when installed** —
   detect `display-mode: standalone` and open the GAS page out-of-app so the
   installed shell keeps its state.

### Why a separate static page is worse than an in-page step (rules out 2)

`signup.html` would be same-origin and inside the manifest `scope`, so it opens
*inside* the standalone window — where iOS provides no back button. It also
needs the identity handed to it, reproducing in static form the very handoff
that `urlIdentityJson` (`script/WebApp.js:49`) exists to serve. An in-page step
has no navigation and no handoff: the identity is already in memory.

### Why suppressing the ejection is throwaway work (rules out 3)

It addresses the symptom only for installed users, leaves the browser and
GAS-page flows split across two origins, and is deleted entirely by candidate 1.
It also cannot deliver the second-order benefit below.

### What makes candidate 1 cheap

No server work. `handleSignupIdentify_` already returns `months`, `aoList`, and
`goalList` on **both** the matched and unmatched paths
(`script/signupWebapp.js:542`) — the complete set of server-injected template
variables `SignupApp.html` receives at render time. The API this needs exists and
is already in production use by the check-in page.

## Decision

The **primary signup front end is the static origin**, implemented as a step
inside `static-pages/src/index.html` and driven by the existing `?cmd=signup`
JSON actions.

- **No top-level navigation participates in signup.** The three exits above are
  deleted, not redirected. Identity carries in memory rather than through a URL.
- **`urlIdentityJson` has nothing to carry** in this model. The cross-origin
  identity handoff is removed rather than ported.
- **`SignupApp.html` remains as the zero-install fallback**, mirroring
  `CheckinApp.html` under the check-in split. Both front ends keep calling the
  same JSON handlers, so this adds no backend divergence.
- **The JSON API is unchanged.** This is a front-end placement decision.

Whether to retire `SignupApp.html` entirely is **not decided here** — it needs a
month of real static-signup use first, and would be its own record.

### Relationship to the check-in split

This applies to signup the pattern check-in already follows: static origin
primary, GAS HTML as fallback, one shared JSON contract. `buildStaticCheckinUrl_`
(`script/Utilities.js:425`) is the existing precedent for pointing emitted links
at the static origin with a GAS fallback; signup needs its counterpart.

## Consequences

**Easier:**

- The static origin becomes a complete front end rather than a check-in-only
  surface. Installability (`docs/pwa-design.md`) stops having a hole in its main
  loop.
- The check-in session token can stop being URL-carried. A signup flow that
  navigates to `script.google.com` and back is what forces the token into the
  URL today; removing it is a precondition for token rotation
  (`F3Go30-833s.8`).
- One UI to change when signup fields change, once the fallback is retired.

**Harder:**

- `index.html` grows by roughly 600 lines against a current 2,013. The page's
  dependency-free single-file property is worth keeping; revisit that constraint
  if it passes ~3,500 lines.
- Every emitted signup link must be migrated. Because the static page honours the
  same query vocabulary (`?cmd=signup`, `targetMonth`, `autoStart`, `ns`,
  `contextDate` — the convention `buildStaticCheckinUrl_` documents at
  `Utilities.js:418`), migrating a link is a base-URL swap with the query string
  preserved, and the GAS page's job for already-distributed links — TinyURL short
  links (`ShortHC` in TrackerDB, `CreateNewTracker.js:314`), Slack messages
  (`buildSignupSlackMessage_`, `Utilities.js:347`), `HomeApp.html`'s button, PAX
  bookmarks — is a query-preserving redirect. Tracked as `F3Go30-833s.11`.
- Two signup UIs exist until the fallback is retired, and they can drift. The
  shared JSON handlers and `test_signup_webapp.js` bound the risk to presentation.
- **Test coverage moves with the front end, and not uniformly.** The handler and
  pure-function tests (`test_signup_webapp.js` and peers) `require()` the
  `script/*.js` modules directly and are unaffected — that is what bounds the risk
  above. Two GAS-bound suites are not: `tests/playwright/identity-token-flow.spec.js`
  is the signup E2E and would otherwise cover only the demoted fallback, and the
  client-invariant tests (`test_context_date_client_roundtrip.js`,
  `test_ns_client_roundtrip.js`) assert against `SignupApp.html` source with no
  static equivalent. Static twins are part of this change's definition of done, not
  a follow-up — `tests/playwright/static-checkin.spec.js` is the existing precedent
  for one. Tracked as `F3Go30-833s.12`. Retiring `SignupApp.html` later should
  shrink its GAS-side coverage to the redirect path rather than delete it outright.
- Signup is a flow every PAX uses monthly; this touches it. Ship SIT-then-PROD
  with the GAS page still standing.
