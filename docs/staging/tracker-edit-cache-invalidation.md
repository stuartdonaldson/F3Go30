# docs/staging/tracker-edit-cache-invalidation.md

## Scope

Replace (or backstop) PaxCache's per-request Drive-modtime freshness poll
(`ensurePaxCacheFresh_`, `script/PaxCache.js:242-289`) with an installable `onEdit`
trigger that proactively invalidates the cache when a human edits a Tracker
spreadsheet directly in the Sheets UI, instead of every request paying to ask
Drive whether that happened.

### Why this is being looked at

Production timing data pulled from Axiom (`checkinWebapp.resolveIdentity.timing`,
v2.4.1, 2026-07-17) shows the returning-visit path (`resolveFullIdentityFromHandle_`,
`script/dashboardWebapp.js:1088`) paying `freshCheckMs` of 256ms–2057ms per request —
that's `ensurePaxCacheFresh_`'s `DriveApp.getFileById(sheetId).getLastUpdated()` call,
which runs on every request that has a cached roster to validate, hit or miss. It's
a real, measured cost on the request path that a proactive invalidation could
mostly eliminate instead of just cheapen.

### Why this isn't just re-litigating ADR-013

[ADR-013](/adr/013-checkin-dashboard-latency-onedit-rejected.md) already rejected
onEdit-based cache invalidation for the checkin/dashboard *round-trip* latency
problem, for a specific, confirmed reason: **onEdit triggers — simple or
installable — never fire for edits made programmatically via
`SpreadsheetApp`/`Range.setValue()`.** The checkin webapp's own writes
(`handleCheckinSubmit_`'s `cell.setValue(...)`) are exactly that kind of edit, so
no onEdit trigger could ever fire in response to a PAX checking in. That finding
still stands and this proposal doesn't challenge it.

This proposal targets a *different, narrower* case that ADR-013 didn't rule out
and didn't need to: **manual edits made by a human directly in the Sheets UI** —
e.g., a Q hand-correcting a Tracker cell. That's a real onEdit-firing event.
It's also the *only* case `ensurePaxCacheFresh_` exists to catch — every
webapp-driven write already self-invalidates via write-through
(`setPaxCacheRow_dw_`, `markPaxCacheFreshNow_`), per `PaxCache.js`'s own header:
"freshness here comes from write-through invalidation (the webapp's own writes)
plus the Drive-modtime staleness gate below (**manual spreadsheet edits**, and
anything else this webapp didn't itself write through)."

So: ADR-013 is about the checkin round-trip and correctly kills onEdit as a
tool for it. This proposal is about the Drive-modtime poll's cost, and only
proposes onEdit for the slice of invalidation that poll exists for (manual
edits) — a case where onEdit is known to fire. If this proceeds, write it up
as a new ADR that narrows/complements 013, not one that reopens or contradicts
its rejection.

## Why onEdit can reach the shared cache now (it couldn't before ADR-010)

Each monthly Tracker spreadsheet is a Drive copy (`CreateNewTracker.js`'s
`makeCopy`) with its own independent bound script + `PropertiesService` store —
`PaxCache.js:12-17` documents that a *simple* onEdit trigger installed in a
Tracker copy runs in *that copy's* script context and has no route to the
shared store the centrally-deployed webapp actually reads from.

That's solved already, for a different trigger, by the pattern in
`script/addResponseOnSubmit.js`: `setupFormSubmitTrigger(spreadsheet)` calls

```js
ScriptApp.newTrigger(FORM_SUBMIT_HANDLER_)
  .forSpreadsheet(ss)
  .onFormSubmit()
  .create();
```

from the **central** script project. Per that file's own comment: "installable
triggers run using the code of the project that creates them, not the project
bound to the watched spreadsheet, so centralizing this call centralizes the
handler code too (ADR-010)." An onEdit trigger registered the same way —
`.forSpreadsheet(trackerSs).onEdit().create()` from the central script — would
run in the central project's context and could read/write the central
`PaxCache.js` `PropertiesService` store directly.

## Proposed design

**Registration.** Add `setupTrackerEditTrigger_(spreadsheet)` /
`clearTrackerEditTrigger_(spreadsheet)`, mirroring
`setupFormSubmitTrigger`/`clearFormSubmitTrigger` exactly (same
`getTriggerSourceId() === ssId` scoping so clearing one tracker's trigger never
touches another's). Call it everywhere a Tracker is provisioned:
- `CreateNewTracker.js` — new monthly tracker.
- `CopyTemplate.js` — namespace/environment provisioning, which copies the N
  most recent trackers alongside the Template.

**Backfill.** Existing already-provisioned Tracker spreadsheets (current month +
whatever `CopyTemplate.js` keeps warm) need the trigger registered retroactively —
a one-time admin action or loop over `TrackerDB`, not automatic.

**Handler.** Filter to `e.range.getSheet().getName() === 'Tracker'`, then call
the same whole-sheet wipe `ensurePaxCacheFresh_` already calls on a detected
stale modtime: `wipePaxCacheForSheet_('tracker', sheetId)` +
`wipePaxCacheForSheet_('responses', sheetId)` + the `CacheService` key removals
(`go30dash:trackerValues:`, `go30dash:responsesValues:`, `go30dash:bonusEntries:`,
`go30dash:bonusRows:`) — same coarse whole-sheet-not-just-touched-row scope the
Drive-modtime path already uses, so behavior doesn't get *more* correct or
*less* correct, just proactive instead of polled. Then update the `asOf` marker
(`markPaxCacheFreshNow_`-style) so a request arriving right after doesn't
immediately re-trigger a redundant rebuild.

**What it could replace.** If the trigger reliably fires before the next
request lands, `ensurePaxCacheFresh_`'s per-request `DriveApp.getLastUpdated()`
call becomes unnecessary — the cache is already correct by the time anyone
asks. Whether to remove it outright or keep a cheap backstop is one of the
open questions below.

## Open Questions — Resolved 2026-07-17

- **Installable-trigger quota. RESOLVED.** Confirmed via Google's docs: the
  cap is **20 triggers per user per script**, one unified limit (not separate
  per-script/per-user numbers). Live-checked PROD (`listTriggers` admin
  action): currently 5 triggers total (2 `handleFormSubmit_` + 3 clock-based).
  Only 2 form-submit triggers exist today because ADR-010 centralization only
  landed 2026-06-23 — pre-ADR-010 trackers ran their own per-copy scripts,
  invisible to this project's trigger count. Since then, `setupFormSubmitTrigger`
  is called once per new tracker and **never cleared on month rollover** —
  only explicit deletion (`cleanupTrackerArtifact_`) clears it. ADR-014
  already flags this as a live, pre-existing problem ("Teardown has
  historically leaked triggers, eating the per-project trigger cap"). Adding
  a second per-tracker trigger type doubles that leak rate unless paired with
  a real lifecycle policy — see **Trigger lifecycle (new required scope)**
  below, which the quota risk is resolved by, not merely mitigated by.
- **Fire latency. RESOLVED — not a blocking concern.** Google documents no
  timing SLA on installable triggers and no guarantee against queuing under
  load, so a firing-latency window can't be ruled out in principle. But
  every webapp-driven write to a PAX's own data (check-in, signup, bonus
  entry) is already write-through (`setPaxCacheRow_dw_`, `markPaxCacheFreshNow_`)
  and self-invalidating — those writes never depend on onEdit at all,
  onEdit or not. onEdit here only ever needs to catch the rare case of a
  human manually correcting a Tracker cell in the Sheets UI, which is not on
  any user-facing round-trip's critical path (unlike the ADR-013 checkin
  case). A firing-latency window on that path is a "next check-in a few
  seconds later" concern, not a "PAX's own submit sees stale data" concern —
  acceptable as-is. Keep the Drive-modtime poll as a backstop regardless
  (next question), but latency is not a reason to add complexity here.
- **Remove the poll entirely, or keep it as defense-in-depth? RESOLVED — keep
  it, unchanged.** No fire-and-forget guarantee (previous question) means the
  poll stays as the correctness backstop. Note the "skip the poll when a
  fresher onEdit `asOf` already covers it" optimization the doc originally
  floated doesn't save the actual measured cost: `ensurePaxCacheFresh_` still
  has to call `DriveApp.getFileById(sheetId).getLastUpdated()` to know
  whether to skip the wipe — the wipe was already cheap. The real
  `freshCheckMs` cost is the Drive round-trip itself, which only goes away if
  the poll is skipped outright, and that requires more machinery (a
  "trust the trigger fired recently" flag) than currently scoped. Don't
  claim a latency win from this optimization without that extra piece.
- **Backfill mechanism. RESOLVED — direction chosen, not yet detailed.**
  `scanTrackers()` (F3Go30-xj1q.2) already walks TrackerDB rows
  interactively and is the natural vehicle. Add a new admin action in
  `WebApp.js` alongside `listTriggers`/`deleteOrphanedTriggers` that calls
  `setupTrackerEditTrigger_` per currently-active TrackerDB row (bound
  script's own rows) — namespace-copied trackers (`CopyTemplate.js`) get it
  automatically at provisioning time, no backfill needed there.
- **Coverage of "manual edit." RESOLVED — found and corrected a factual error
  in ADR-013.** ADR-013 states onEdit fires "through the actual Sheets UI or
  the Sheets REST API." That's wrong: Google's current docs ("Script
  executions and API requests don't cause triggers to run") and confirmed
  community behavior agree that onEdit — simple or installable — does **not**
  fire for Sheets REST API edits, only for genuine human edits through the
  Sheets UI. ADR-013's actual rejection reason (script-driven
  `SpreadsheetApp`/`Range.setValue()` writes never fire onEdit) still holds —
  that part doesn't change — but its API-edits claim should be corrected if a
  future ADR quotes it. Practically moot for this proposal: grepped the
  codebase, there is no third-party Sheets API integration writing to
  Trackers today. If one is ever added, its edits would **not** be caught by
  onEdit and would still only be caught by the Drive-modtime poll — another
  reason to keep the poll rather than remove it.
- **Wipe granularity. RESOLVED — keep whole-sheet wipe**, per the doc's own
  original lean. No new finding; existing `wipePaxCacheForSheet_` calls are a
  direct fit for the onEdit handler with no extra logic needed.
- **Relationship to ADR-013. RESOLVED — confirmed narrow complement**, not a
  reopening. Write the eventual decision up as a new ADR referencing 013,
  per 013's own consequence note.

## Trigger lifecycle (new required scope, from 2026-07-17 review)

The quota question above is only actually resolved — not just mitigated — if
active triggers are kept bounded going forward. Three lifecycle gaps exist
today, independent of this proposal, and all three become load-bearing once
a second per-tracker trigger type is added:

1. **No automatic cleanup on manual trash.** `cleanupTrackerArtifact_`
   already clears the form-submit trigger (`go30tools.js:725-731`), but only
   when invoked through the explicit `cleanupTracker` admin action or
   `scanTrackers()`'s interactive remove. A tracker spreadsheet trashed
   directly in Drive (bypassing both) leaves its trigger(s) registered
   forever — exactly the leak ADR-014 already flagged. `WebApp.js`'s
   `deleteOrphanedTriggers` action detects this (`DriveApp...isTrashed()`)
   but is manual-only today.
2. **No automatic cleanup on month aging-out.** Nothing currently removes a
   tracker's form-submit trigger (or would-be edit trigger) once it's no
   longer among the "active" months — it only ever gets removed via explicit
   deletion. Decision: fold a trigger-lifecycle sweep into the existing
   nightly cadence (`markEmptyCellsAsMinusOne`'s daily trigger, or a sibling
   nightly step) that clears both triggers for any TrackerDB row older than
   the previous month, and separately clears triggers for any row whose
   spreadsheet is found trashed (reusing `deleteOrphanedTriggers`'s
   detection, run automatically instead of on-demand).
3. **Net effect on quota.** With that sweep in place, steady-state active
   trigger count becomes bounded (~current + previous/next month × 2 trigger
   types, plus the fixed ~5 clock-based triggers), not unbounded — this is
   what actually resolves the quota open question, not just headroom at a
   single point in time.

This lifecycle work is a prerequisite for this proposal, not an optional
follow-up — implement it alongside `setupTrackerEditTrigger_`, not after.
