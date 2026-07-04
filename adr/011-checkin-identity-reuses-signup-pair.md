# ADR-011: Check-in Web App Identity Reuses the Sign-Up F3 Name + Email Pair

Status: Accepted

Date: 2026-06-30

## Context

The new PAX-facing daily check-in + dashboard web app (`?cmd=checkin`, `script/dashboardWebapp.js`)
needs to identify which PAX is checking in before it will read or write anything in the current
month's Tracker sheet. No password, PIN, or other secret exists anywhere in this codebase or data
model — the sign-up web app (`script/signupWebapp.js`) already identifies a PAX by F3 Name + Email
alone, verified against the current month's Responses sheet via `findSignupMatch_`, with a
deliberate anti-enumeration property: a name-only match, an email-only match, and no match at all
must all produce the same response shape to the caller.

Introducing a new identity mechanism (e.g. a PIN set at sign-up time) would require a new column,
a way to set/reset it, and a second thing for a PAX to remember, for data (daily 1/0 workout
check-ins, already visible to the whole team on the Tracker sheet) that is not sensitive enough to
justify that cost.

## Decision

The check-in web app identifies a PAX using the same F3 Name + Email pair the sign-up web app
uses, verified with the same `findSignupMatch_` anti-enumeration check against the current month's
Responses sheet (`resolveCheckinIdentity_` in `script/dashboardWebapp.js`). No new identity
mechanism is introduced.

## Consequences

- No new sign-up-time step (setting a password/PIN) or reset flow is needed — a PAX who can
  already sign up can check in.
- `dashboardWebapp.js` reuses `signupWebapp.js`'s `findSignupMatch_`/`getCurrentAndNextMonths_`
  directly rather than duplicating matching logic, so the two web apps stay behaviorally
  consistent by construction.
- The trust model is unchanged from sign-up: anyone who knows a PAX's F3 Name and email can check
  in or view the dashboard on their behalf. This is acceptable because the underlying data (daily
  workout completion) is already visible to the whole team on the Tracker sheet, and matches the
  existing sign-up web app's trust model — this ADR does not raise or lower the bar.
- Every `cmd=checkin` write action re-verifies identity server-side on each call rather than
  trusting a client-held "already identified" flag, so a stale or forged client payload cannot
  write to the wrong PAX's row.

## Related

The anti-enumeration, current-month-Responses-sheet identity check this decision reuses was
established by the sign-up web app, not by a prior ADR — see `script/signupWebapp.js`'s
`findSignupMatch_` docstring for its original rationale.
