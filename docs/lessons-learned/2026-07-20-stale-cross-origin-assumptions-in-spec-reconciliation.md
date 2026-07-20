# LL: Stale same-origin/URL-shape assumptions surfaced only by live-run diagnosis, not code reading

Date: 2026-07-20
Domain: testing

## Observation

While reconciling `tests/playwright/identity-token-flow.spec.js` with F3Go30-833s.11 (bead
F3Go30-bkxg), two separate incorrect assumptions were caught only by running the spec live
against SIT and inspecting the resulting screenshot/URL, not by reading the code:

1. A rewritten test assertion initially expected the check-in→signup handoff
   (`signupDeepLinkUrl_`, CheckinApp.html) to land on a prefilled static signup info step,
   based on a nearby code comment describing identity as carried via a "shared localStorage
   key." Live verification (a temporary probe script navigated to the actual redirect URL)
   showed the static page instead opened a blank intro/identify step — the comment described
   same-origin GAS-to-GAS behavior that no longer applied once F3Go30-833s.11 made the hop
   cross-origin.
2. After fixing the primary redirect issue, one of seven tests still failed with "Neither the
   automatic top-redirect nor its fallback link appeared within timeout." A screenshot of the
   failed run showed the browser had actually navigated successfully — to the static check-in
   page. The test's `followTokenRedirect` helper only recognized a GAS-shaped
   `cmd=checkin&id=` URL as "arrived," so it looped to its own timeout. This path in the test
   had never been exercised far enough to reach this mismatch until this session's earlier fix
   let it proceed past its prior blocking failure.

## Why Chain (branched)

Branch A — assertion written from a stale code comment
  Why 1 — The new assertion assumed identity carries across the check-in→signup redirect.
  Why 2 — That assumption came from a code comment describing the deep link's localStorage
          handoff, written for the pre-F3Go30-833s.11 same-origin case.
  Why 3 — Nothing flagged that comment's premise (same-origin) as needing re-validation once
          the surrounding control flow changed to a cross-origin redirect.
  Root cause A: No step in test-writing requires confirming a referenced code comment's stated
  premise (e.g. "same origin," "shared storage") still holds after a recent architectural
  change to the surrounding control flow, before relying on that comment to write an assertion.

Branch B — shared test helper's URL contract silently diverged from production
  Why 1 — `followTokenRedirect`'s arrival check only recognized the GAS-hosted checkin URL
          shape (`cmd=checkin&id=`).
  Why 2 — The actual production handoff (`buildCheckinUrl_`, SignupApp.html) has preferred the
          static check-in URL shape (no `cmd=` param) since v2.4.0 — well before this bead's
          .11 change — but the test helper was never updated to match.
  Why 3 — This helper's only exercise path in the test suite was gated behind a different,
          unrelated failure, so the divergence went undetected until that other failure was
          fixed and the test could finally reach this code path.
  Root cause B: No regression signal exists for "a shared test helper's URL-matching contract
  silently diverges from an evolving production redirect target," because the helper has no
  direct test of its own and its only exercise path can be masked by an unrelated failure
  upstream in the same test.

## Initial Candidates

Branch A: c — add a step to a testing/spec-writing skill (or the implementation-gate skill):
before relying on a code comment to write a test assertion, check the comment's git blame /
surrounding recent commits for whether its stated premise (origin, storage scope, etc.) still
holds.

Branch B: c/d — add a lightweight unit test (or gate checklist item) for shared Playwright test
helpers that encode a URL-shape contract (e.g. `followTokenRedirect`), so a production redirect
target change is caught by a direct, fast-failing check rather than only surfacing as an
opaque timeout in an unrelated end-to-end test, once some other blocking issue is cleared.
