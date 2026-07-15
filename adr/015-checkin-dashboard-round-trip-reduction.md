# ADR-015: Check-in/Dashboard Round-Trip Reduction via Shared Context Handle + Prefetch

Status: Accepted
Date: 2026-07-14

## Context

ADR-013 rejected onEdit-trigger and queue/polling approaches for checkin/dashboard latency and
recommended two viable, not-yet-implemented directions instead: (1) merge round trips within an
already-live synchronous execution, and (2) warm a shared cache inline off the write path.
F3Go30-qi26 (epic) picked up that work. Baseline measurement (qi26.5's harness, first captured
before any of this epic's changes) showed the returning-PAX flow — page load → auto-identify →
check-in submit → dashboard load — paying for the same identity/month resolution multiple times
across independent Apps Script executions: `handleCheckinIdentify_`, `handleCheckinSubmit_`, and
`handleCheckinDashboard_` (`script/dashboardWebapp.js`) each independently re-resolved the target
month (`resolveMonths`/`resolveDashboardMonth_`, a `TrackerDB` scan) and the PAX's identity/row
(a Responses-sheet match + Tracker roster scan), even though `handleCheckinIdentify_` had already
done that work seconds earlier in the same browser session. Separately, the dashboard's full
roster read paid an unconditional ~½s `DriveApp.getLastUpdated()` freshness probe
(`ensurePaxCacheFresh_`, `PaxCache.js`) even when nothing was cached yet to validate, and the
check-in page's first paint (`doGet`) opened the `CheckinSessions` sheet just to resolve a
bookmarked link's personalized page title. Measured dashboard `totalMs` was ~7.4s, with
`resolveIdentityMs` (~2.5s, including the freshCheck + whole-roster read) the single most
expensive component.

## Decision

Reduce round trips and redundant resolution entirely within each request's own live, synchronous
execution — consistent with ADR-013's rejection of trigger/queue infrastructure for this flow.
No new persistent background process, trigger, or queue is introduced.

1. **Resolved-context handle (F3Go30-qi26.1).** `handleCheckinIdentify_` returns a lean
   `resolvedContext` handle (sheetId, the PAX's Tracker `rowIndex` + canonical F3 name, and the
   month fields needed to reconstruct a `monthInfo`) alongside its normal response.
   `CheckinApp.html` echoes this handle back on the `checkin` and `dashboard` POSTs that follow
   within the same session. The server treats it strictly as a hint: `resolveLeanIdentityFromHandle_`
   and `resolveFullIdentityFromHandle_` re-validate that the row named in the handle still carries
   the handle's canonical F3 name before trusting it, and return `null` on a miss — the caller then
   falls through to the original full-resolution path (`resolveCheckinIdentity_` /
   `resolveCheckinIdentityFull_`) transparently, with no user-visible error. This handles roster
   edits, month rollovers, and stale/absent handles without any correctness compromise.
2. **Dashboard prefetch (F3Go30-qi26.2).** The client fires a silent dashboard fetch immediately
   after identify resolves (using the handle from step 1), while the PAX is still on the check-in
   step. `Continue to Dashboard` renders from that cached payload (or rides the in-flight prefetch)
   instead of blocking on a fresh round trip.
3. **doGet title deferral (F3Go30-qi26.3).** A bookmarked check-in link's personalized page title
   is resolved from a `CacheService` write-through cache instead of opening the `CheckinSessions`
   sheet on the first-paint path. A cache miss falls back to the generic namespace title.
4. **Dashboard freshCheck deferral (F3Go30-qi26.4).** The Drive-modtime freshness probe
   (`ensurePaxCacheFresh_`) only runs when a roster cache entry exists to validate. A cold-cache
   read is definitionally current, so the read moment is stamped as the freshness marker
   (`markPaxCacheFreshNow_`) instead of paying for the probe. The whole-roster Tracker read itself
   remains unconditional and on the critical path — the team board requires every PAX's row; only
   the redundant freshness *check* around an already-live read was removable.
5. **Measurement harness (F3Go30-qi26.5).** `tools/measureCheckinPerformance.js`, a repeatable
   Playwright-driven tool, captures per-round-trip network timing across this flow plus an Axiom
   correlation window, so future optimization work (and regression detection) has a repeatable
   before/after baseline instead of one-off manual measurement. See docs/OPERATIONS.md
   §Performance Testing.

## Consequences

- Each fast path (`resolveLeanIdentityFromHandle_`, `resolveFullIdentityFromHandle_`) is a
  parallel implementation alongside its original full-resolution counterpart, not a shared code
  path — deliberate, since the two have different available inputs (a validated row hint vs.
  nothing) and different Axiom timing breakdowns worth keeping distinct. This is duplication that
  must be kept in sync by hand if the underlying Tracker row shape changes.
- The resolved-context handle is client-held state that must be echoed back correctly by
  `CheckinApp.html`; every server consumer must keep re-validating it (never trust it outright) or
  a roster edit could silently serve a stale row. This validation is the load-bearing correctness
  guarantee of the whole approach.
- No new trigger, queue, or persistent background process was introduced — consistent with
  ADR-013's finding that this flow's request cycle has no genuine need for detachment.
- `tools/measureCheckinPerformance.js` (F3Go30-qi26.5) is now the reference tool for validating
  this and any future latency work on this flow — before/after comparisons should use it rather
  than ad hoc timing.
- The dashboard's whole-roster read remains a required, unconditional cost of building the team
  board; it was deliberately not deferred/paginated in this round (F3Go30-qi26.4's scope was the
  freshness probe around it, not the read itself) — a future optimization pass could revisit
  lazy-loading roster-derived stats after first paint if that read becomes the next bottleneck.
- Live-deploy confirmation that dashboard `totalMs` is materially reduced (via the harness against
  a real SIT/PROD deployment) is tracked as a human follow-up on F3Go30-qi26.4's notes; the
  implementation and unit-test coverage are complete, but a before/after harness run against a
  live deployment had not yet been performed as of this ADR.
