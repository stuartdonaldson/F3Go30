# ADR-016: onEdit + Write-Through as the Sole Cache-Freshness Mechanisms — Retire the Drive-Modtime Poll

Status: Accepted

Date: 2026-07-17

## Context

`ensurePaxCacheFresh_` (`script/PaxCache.js:288-302`) runs on every PaxCache
read that has something cached, calling
`DriveApp.getFileById(sheetId).getLastUpdated()` to detect whether a Tracker
spreadsheet changed since it was last cached. Production timing data
(`checkinWebapp.resolveIdentity.timing.freshCheckMs`, Axiom, PROD v2.4.1,
2026-07-17) shows this call costing **256–2057 ms per request** on the
returning-visit path — a real, measured cost paid on every check-in/dashboard
request that has a warm cache to validate.

A full review of every cache and freshness mechanism touching PAX/token data
(`docs/staging/caching-consolidation-review.md`) found ten distinct caches
(PaxCache per-PAX rows, roster index, an `asOf` marker, and six
`CacheService`-backed dashboard/bonus blobs) invalidated through four
different vocabularies (`invalidateFullRosterCache_`,
`invalidateBonusEntriesCache_`, `wipePaxCacheForSheet_`,
`wipePaxCacheAndRelatedCachesForSheet_`), plus TTL, plus the poll, plus onEdit,
plus a nightly purge. That review also found the in-code justification for
keeping the poll (`PaxCache.js:11-17`, and the "keep the poll, unchanged"
resolution in `docs/staging/tracker-edit-cache-invalidation.md`, Open
Questions, 2026-07-17) was written before two changes landed that remove its
premise:

1. **`onEdit` coverage was only partial.** `handleTrackerEdit_`
   (`script/TrackerEditTrigger.js:79-95`) invalidates only the `Tracker`
   sheet; manual edits to `Responses` and `Bonus Tracker` had no proactive
   invalidation and relied solely on the poll.
2. **Two script-driven writers left the cache stale with no onEdit route.**
   `markMinusOne.js`'s nightly −1 sweep invalidated only the CacheService
   full-roster blobs, not the PaxCache per-PAX rows/roster index the webapp
   actually reads from; `addResponseOnSubmit.js`'s form-submit signup path
   performed zero invalidation at all, so a warm roster index could report a
   brand-new signup as "not found."

Both gaps are closed by sibling beads in this epic (F3Go30-o39s.2 extends
onEdit to Responses + Bonus Tracker; F3Go30-o39s.3 and .4 make the nightly
sweep and form-submit signup path coherent) before the poll is actually
removed from the read path (F3Go30-o39s "C6", gated on those plus onEdit
provisioning, F3Go30-o39s "C4"/440b.5). This ADR is the anchor decision those
beads implement against — it decides the target model and that retirement is
correct once its prerequisites land; it does not itself remove any code.

### Relationship to ADR-013

[ADR-013](013-checkin-dashboard-latency-onedit-rejected.md) rejected onEdit as
a tool for the *checkin/dashboard round-trip latency* problem, for a specific
and still-correct reason: onEdit — simple or installable — never fires for
script-driven `SpreadsheetApp`/`Range.setValue()` writes, and the checkin
webapp's own write is exactly that kind of edit. **This decision does not
reopen that finding.** It narrows ADR-013 to a different, adjacent problem:
the Drive-modtime *poll's* cost, and the *manual*-edit case onEdit is known to
fire for (a human correcting a cell directly in the Sheets UI). Every
webapp-driven write to a PAX's own data remains write-through and
self-invalidating, exactly as ADR-013 assumed; onEdit here only ever needs to
catch manual edits, which was never ADR-013's subject.

**Factual correction to ADR-013:** ADR-013 states onEdit fires "through the
actual Sheets UI or the Sheets REST API." That is incorrect — Google's
current documentation and confirmed behavior agree onEdit (simple or
installable) does **not** fire for Sheets REST API edits, only for genuine
human edits through the Sheets UI. ADR-013's actual rejection reason
(script-driven writes never fire onEdit) is unaffected by this correction and
still stands; only the API-edits claim was wrong. See
`docs/staging/tracker-edit-cache-invalidation.md` ("Coverage of manual edit")
for the research trail.

### Relationship to ADR-010 and ADR-014

This decision is only viable because of ADR-010's centralization: an
*installable* onEdit trigger, registered `.forSpreadsheet(trackerSs).onEdit()`
from the Template's central script project, runs in that central project's
context and can reach the shared `PaxCache.js` `PropertiesService` store —
before ADR-010, each monthly Tracker copy ran its own isolated bound script
with no route to the shared cache (`PaxCache.js:12-17`'s original, now-stale,
rejection). ADR-014's namespace-scoped environments (smoke/regional/demo
Template copies via `CopyTemplate.js`) are a second class of spreadsheet this
model must cover: onEdit provisioning must extend to namespace-copied
trackers, not just `CreateNewTracker.js`'s monthly copies, before the poll can
be retired everywhere it currently runs (tracked as F3Go30-o39s "C4",
relating to F3Go30-440b.5).

## Decision

Freshness for all PAX/token-data caches is driven by exactly **two**
mechanisms, and nothing else:

1. **Write-through.** Every write this system performs to a PAX's or token's
   data — webapp-driven and server-side/script-driven alike — patches or
   invalidates the affected cache entries at the point of write. No writer is
   allowed to leave the cache to be corrected later by a poll.
2. **Installable `onEdit`.** The one class of change write-through cannot see
   is a human editing a sheet directly in the Sheets UI. An installable
   `onEdit` trigger, registered from the central Template script (ADR-010),
   catches that for **all three** PAX-data sheets: **Tracker, Responses, and
   Bonus Tracker.**

The **Drive-modtime poll** (`ensurePaxCacheFresh_`) is **retired** from the
read path once its prerequisites land: onEdit covering all three sheets
(F3Go30-o39s.2), the nightly −1 sweep repopulating (not merely invalidating)
PaxCache (F3Go30-o39s.3), the form-submit signup path write-through
(F3Go30-o39s.4), and onEdit provisioned on every live tracker including
namespace copies (F3Go30-o39s "C4"). At that point the poll is redundant: it
exists only to backstop staleness sources this decision assigns explicit
owners to.

### Accepted residual risk

A human manually edits Tracker, Bonus Tracker, or Responses and a request
resolves that PAX's identity or dashboard in the sub-second-to-seconds window
before the corresponding `onEdit` trigger fires and invalidates the cache.
PAX data is single-writer per row, so this is the only conflict window this
model introduces, and it is accepted as a developer decision
(2026-07-17): the measured, guaranteed 256–2057 ms cost on *every* request is
traded for a rare, small, self-correcting staleness window on *some*
requests immediately following a manual edit.

This decision **supersedes** the "keep the poll, unchanged" resolution
recorded in `docs/staging/tracker-edit-cache-invalidation.md` (Open
Questions, 2026-07-17), which was reached before the onEdit-coverage and
write-through gaps above were identified and scoped.

## Consequences

- `docs/DESIGN.md` §Caching documents the ten-cache inventory and this
  two-mechanism rule as the target model; `PaxCache.js`/`TrackerEditTrigger.js`
  header comments are rewritten to match once the poll is actually removed
  (F3Go30-o39s "C9").
- The poll is not removed by this ADR. It stays in place, unchanged, until
  F3Go30-o39s.2/.3/.4/"C4" land; removing it before then would reopen exactly
  the staleness windows (F2, F4a, F4b in the caching-consolidation review)
  the poll currently backstops.
- Once removed, the `go30asof:` marker, `markPaxCacheFreshNow_`, and the
  per-execution freshness memo become dead weight and should be removed
  (F3Go30-o39s "C7") — they exist only to make the poll cheap/correct.
- Any future onEdit-related proposal for the checkin/dashboard round-trip
  itself must still start from ADR-013's decision, not this one — this ADR
  only narrows ADR-013's manual-edit corollary and corrects its factual error
  about REST API edits; it does not revisit ADR-013's core rejection of
  onEdit for script-driven writes.
