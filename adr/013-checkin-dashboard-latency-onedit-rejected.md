# ADR-013: Checkin/Dashboard Latency — onEdit Trigger Rejected, Recommend Single-Call Merge and Shared Board Cache

Status: Accepted
Date: 2026-07-02

## Context

The checkin web app (`script/CheckinApp.html`, `script/dashboardWebapp.js`) currently does two sequential round trips when a PAX submits a checkin answer: `handleCheckinSubmit_` writes one cell, then the client chains into `loadDashboard_()`, which calls `handleCheckinDashboard_` — a full rebuild of the team board that iterates every PAX row (`buildDashboardPaxRow_` + `buildBonusByType_` per member, streak computation, rolling averages). Each call is an independent, stateless Apps Script execution (no shared process between them); the second call re-resolves month/identity from scratch and re-scans every row even though only one cell changed.

Two architectural alternatives were considered for hiding or removing this latency:

1. **Reactive cache invalidation via an onEdit-style spreadsheet trigger.** The sidebar's existing progress-notification pattern (`script/NotificationSBCode.js` — a long-running execution writes to a `PropertiesService`-backed queue, guarded by `LockService`, while the client polls) suggested a similar model: install a trigger that reacts to a checkin cell changing and refreshes a shared cache independently of the web app's request/response cycle.
2. **Collapsing/optimizing the existing synchronous request path** instead — since the checkin submission is already a live execution with everything it needs to also return fresh dashboard data.

This project already has one documented, related dead end: `PaxCache.js:12-17` records that a *simple* onEdit trigger was tried for cache invalidation, and failed because each monthly Tracker is an independent Drive copy with its own isolated bound script/`PropertiesService` store — a trigger installed there had no route to the shared cache the deployed webapp actually reads from. ADR-010's centralization (all execution now runs from the Template's bound script, dispatching by `TrackerDB` lookup) removes that specific obstacle — an *installable* "On edit" trigger, created by and owned by the centralized Template script (`ScriptApp.newTrigger(fn).forSpreadsheet(copyId).onEdit().create()`), would run in the Template's context and could reach the shared store.

That reopened the idea, but a more fundamental fact killed it on further research: **onEdit triggers — simple or installable — do not fire for edits made programmatically via `SpreadsheetApp`/`Range.setValue()`.** They only fire for edits made through the actual Sheets UI or the Sheets REST API. The checkin webapp's write (`cell.setValue(payload.value)` in `handleCheckinSubmit_`) is exactly a script-driven edit, so no onEdit trigger — regardless of ownership or installation method — would ever fire in response to a PAX checking in through the web app. Confirmed by direct research 2026-07-02.

Separately, the sidebar's queue/poll pattern (detached long-running execution + client `setInterval` polling) is designed for genuinely long, multi-stage, admin-invoked jobs (e.g. `copyAndInit_`, minutes long, worth narrating progress on). It doesn't fit the checkin case at all: the checkin POST is *already* a live, synchronous execution triggered by the exact user who wants the result — there's nothing to detach or poll for, since the same request can just do the extra work and return it directly. Introducing a queue/trigger here would add real machinery (job IDs, per-session queue namespacing, lock contention) to solve a problem that's already solvable with a plain merged call.

Scale note: at current usage (20-40 users, 1-2 sessions/day, 2-3 minutes each), `LockService`/`PropertiesService` contention concerns that would matter at higher concurrency are not a practical constraint either way.

## Decision

Do not pursue onEdit-trigger-based cache invalidation for the checkin/dashboard flow — it cannot work, since script-driven cell writes never fire onEdit events. Do not pursue a queue/polling background-worker pattern for this flow either — the work is already being done inside a live, synchronous, user-initiated request with no need for detachment.

If checkin/dashboard latency is revisited, the two viable, not-yet-implemented directions are:

1. **Merge the two round trips.** Have the checkin submit action perform the cell write and return the rebuilt dashboard payload from the same `doPost` execution, instead of two separate `callApi` calls (`checkin` then `dashboard`) from the client. Removes one full Apps Script execution and one redundant identity/month resolution per checkin. This benefits only the PAX who just checked in — their own next screen loads faster.
2. **Warm a shared board-level cache inline.** Have `handleCheckinSubmit_` update a shared cache (extending the existing `PaxCache.js` per-PAX pattern to board-level data) synchronously, in the same execution, right after the cell write — no trigger needed, since the write path is already live. Unlike (1), this benefits *other* PAX too: whoever next opens their dashboard within the cache's freshness window reads a warm cache instead of triggering a fresh full-roster row scan (`identity.trackerValues.forEach` in `handleCheckinDashboard_`), even if they didn't just check in themselves.

These two are independent and stack: (1) shortens the checking-in PAX's own path; (2) shortens everyone else's subsequent dashboard loads.

## Consequences

- No trigger-based infrastructure (queues, `LockService`-guarded properties, installable onEdit) is needed or planned for this flow.
- Future work on checkin/dashboard latency should start from options (1) and (2) above rather than re-deriving and re-rejecting the onEdit idea.
- If Google ever changes onEdit semantics to fire for script-driven edits, this decision's core rejection reason would need re-verification before revisiting — a new ADR should supersede this one rather than silently reopening the idea.
- Neither optimization is implemented as of this ADR; both remain candidate future work, not committed scope.
