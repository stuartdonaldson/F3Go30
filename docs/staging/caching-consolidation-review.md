# Caching Consolidation — Code Review

**Date:** 2026-07-17
**Scope:** Every cache and freshness mechanism touching PAX / token data
(PaxCache, dashboard CacheService blobs, bonus CacheService blobs), and the
paths that populate, read, and invalidate them.
**Driver:** The caching design has accreted across several initiatives
(F3Go30-5nfj.3 write-through, 440b.1 telemetry, 440b.2 purge, 440b.4 onEdit,
440b.6 layout cache). The mechanisms overlap inconsistently and the in-code
documentation now contradicts itself. This review defines a single target model
and the ordered work to reach it.

---

## Target model (the principle to converge on)

> Unless we have a positive reason to believe a sheet's cached data is invalid,
> we never open that spreadsheet.

Freshness is driven by exactly **two** mechanisms, and nothing else:

1. **Write-through** — every write this system performs to a PAX's / token's
   data (webapp *and* server-side scripts) patches or invalidates the cache at
   the point of write. No writer leaves the cache to be corrected later by a
   poll.
2. **Installable `onEdit`** — the one thing write-through cannot see is a human
   editing a sheet directly in the Sheets UI. The `onEdit` trigger catches that
   for **all three** PAX-data sheets: **Tracker, Responses, Bonus Tracker**.

The **Drive-modtime poll** (`ensurePaxCacheFresh_`) is **retired** from the read
path. It is the measured 256–2057 ms/request cost
(`checkinWebapp.resolveIdentity.timing.freshCheckMs`, PROD v2.4.1) and, once the
two mechanisms above are complete, it is redundant.

**Accepted residual risk (developer decision, 2026-07-17):** a human manually
edits Tracker/Bonus/Responses and views the webapp in the sub-second-to-seconds
window before `onEdit` fires. PAX data is single-writer per row; this is the only
conflict window and it is acceptable. This decision **supersedes** the "keep the
poll, unchanged" resolution recorded in
`docs/staging/tracker-edit-cache-invalidation.md` (Open Questions, 2026-07-17).

---

## Inventory — what caches exist today

| # | Cache | Backing store | Granularity | Populated by | Invalidated by |
|---|-------|---------------|-------------|--------------|----------------|
| 1 | PaxCache per-PAX row (`kind=tracker`) | PropertiesService `go30pax:` | one PAX row | identity/full reads, check-in write-through | write-through patch; poll wipe; onEdit wipe; nightly purge |
| 2 | PaxCache per-PAX row (`kind=responses`) | PropertiesService `go30pax:` | one PAX row | identity/full reads | signup delete; poll wipe; onEdit wipe; nightly purge |
| 3 | PaxCache roster index | PropertiesService `go30idx:` | one map/sheet | roster rebuild, bulk write | signup patch; poll wipe; onEdit wipe |
| 4 | PaxCache asOf marker | PropertiesService `go30asof:` | one ts/sheet | poll + `markPaxCacheFreshNow_` | — (exists only to serve the poll) |
| 5 | Tracker layout (row2/row3) | CacheService `go30dash:trackerLayout:` | one/sheet | `getTrackerLayout_` | TTL only (21600s); poll/onEdit wipe |
| 6 | Responses layout (header+cols) | CacheService `go30dash:responsesLayout:` | one/sheet | `getResponsesLayout_` | TTL only; poll/onEdit wipe |
| 7 | Tracker full-roster values | CacheService `go30dash:trackerValues:` | whole sheet | *now assembled from #1+#3* | `invalidateFullRosterCache_`; poll/onEdit wipe |
| 8 | Responses full-roster values | CacheService `go30dash:responsesValues:` | whole sheet | full read | `invalidateFullRosterCache_`; poll/onEdit wipe |
| 9 | Bonus entries (pill shape) | CacheService `go30dash:bonusEntries:` | whole sheet | `getAllBonusEntriesCached_` | `invalidateBonusEntriesCache_`; poll/onEdit wipe |
| 10 | Bonus rows (client shape) | CacheService `go30dash:bonusRows:` | whole sheet | `getAllBonusRowsCached_` | `invalidateBonusEntriesCache_`; poll/onEdit wipe |

Four different invalidation vocabularies touch these ten caches
(`invalidateFullRosterCache_`, `invalidateBonusEntriesCache_`,
`wipePaxCacheForSheet_`, `wipePaxCacheAndRelatedCachesForSheet_`) plus TTL, plus
the poll, plus onEdit, plus the nightly purge. That is the fragmentation.

---

## Findings

Each finding maps to a bead (§Bead plan). File:line references are current as of
this review.

### F1 — The Drive-modtime poll is the primary freshness gate and the main cost
`ensurePaxCacheFresh_` (`script/PaxCache.js:288-302`) runs on **every** PaxCache
read that has something cached to validate, calling
`DriveApp.getFileById(sheetId).getLastUpdated()` — measured at 256–2057 ms per
request on the returning-visit path. It is the target of retirement, but it
currently silently backstops three distinct staleness sources (F2, F4a, F4b), so
it cannot be removed until those are closed. → **C6** (gated on C2, C3a, C3b, C4).

### F2 — `onEdit` only covers the Tracker sheet
`handleTrackerEdit_` (`script/TrackerEditTrigger.js:79-95`) returns early for any
sheet whose name ≠ `'Tracker'` (line 82). Manual edits to **Responses** and
**Bonus Tracker** therefore have **no** proactive invalidation — they rely solely
on the poll (F1). This is the load-bearing prerequisite for retiring the poll and
is exactly the user's request: "make sure the Bonus Tracker and Tracker and
Responses sheets all drive updates of the cache." → **C2**.

### F3 — `onEdit` wipes the whole sheet rather than updating the touched row
The handler calls `wipePaxCacheAndRelatedCachesForSheet_` — correct but coarse:
one edited cell discards every PAX's cached row for that sheet, forcing a full
cold rebuild on the next request. The edit event carries the exact range, so the
touched PAX's row could be patched in place (true "drive an update," matching the
write-through model). This is an optimization, not a correctness fix. → **C10**
(optional, gated on C2).

### F4 — Script-driven writers `onEdit` can never see, that the poll silently rescues
`onEdit` does **not** fire for programmatic `SpreadsheetApp`/`Range.setValue()`
writes (ADR-013). Two server-side writers modify PAX-data sheets and are today
kept coherent *only* by the poll:

- **F4a — `markMinusOne.js:117`** (nightly −1 sweep) writes many Tracker cells,
  then calls **only** `invalidateFullRosterCache_` — which clears CacheService
  blobs #7/#8 but **not** the PaxCache per-PAX rows (#1) or roster index (#3)
  that `buildTrackerValuesFromPaxCache_` (`dashboardWebapp.js:719`) actually reads
  the board from. After the nightly sweep, PaxCache tracker rows are stale; only
  the poll wipes them. Fix — **preferred: repopulate, not invalidate.** Since
  this runs nightly off the critical path, take one full Tracker-range read after
  the write and bulk-repopulate the PaxCache rows + roster index + full-roster
  blob (`setPaxCacheRowsBulk_` + `setCachedSheetValues_`), leaving every tracker's
  cache warm and re-verified each night — a self-healing integrity refresh rather
  than a cold wipe. (Caveat: `markMinusOne` currently holds only column A + the one
  threshold-day column in memory, so the repopulate needs that extra full read.)
  **Scope both cached months, not just the marked one:**
  `markEmptyCellsAsMinusOne_` marks exactly **one** tracker per run (the row active
  for `today−2`), but the webapp holds **both** the current-month and prior-month
  trackers cached at once (`getPriorMonthTailValues_`). The reload must refresh both
  months' caches regardless of which single tracker was marked. Acceptable fallback:
  `wipePaxCacheAndRelatedCachesForSheet_(sheetId)` for both months. → **C3a**.

- **F4b — `addResponseOnSubmit.js`** (Form-submit signup handler, fires via the
  centralized `onFormSubmit` installable trigger) writes a new **Responses** row
  (`:308` DELETED marker, plus the new-signup insert) and a new **Tracker** name
  row (`:250`), with **zero** cache invalidation. A warm-but-stale roster index
  (#3) that predates the new PAX will return `-1` for that PAX →
  `resolveCheckinIdentityLean_` reports **"not found"** for a legitimately signed-
  up member. This is precisely the "masking a brand-new signup" hazard PaxCache's
  own header (`PaxCache.js:25-28`) warns about; only the poll currently prevents
  it. Fix: patch the roster index (`patchPaxRosterIndex_`) for the new
  Responses+Tracker rows, and invalidate the affected full-roster/per-PAX caches,
  mirroring `signupWebapp.js`'s existing write-through
  (`signupWebapp.js:614-693`). → **C3b**.

### F5 — Bonus writes invalidate instead of write-through
`addBonusEntry_` / `editBonusEntry_` / `clearBonusEntry_`
(`bonusWebapp.js:313/388/419`) call `invalidateBonusEntriesCache_`, which *deletes*
caches #9/#10 so the next reader pays a full cold rebuild. The user's principle:
pax/token writes should be **write-through**. The writer already holds the new
row's values and its rowIndex — it can patch the two cached arrays in place
(append for add, replace for edit, drop for clear) instead of discarding them. →
**C5** (independent of the onEdit chain).

### F6 — In-code documentation now contradicts itself
`PaxCache.js:11-17` states an `onEdit` trigger "could never invalidate anything"
because it runs in the Tracker copy's own script context. That was true for a
*simple* trigger, but `TrackerEditTrigger.js` (F3Go30-440b.4) installs an
*installable* trigger from the central project that **does** reach the shared
store — the header now asserts the opposite of what the code does two files over.
This stale contract is a direct cause of the "difficult to understand" concern.
Rewrite the PaxCache/TrackerEditTrigger headers (and add a single DESIGN.md
caching section) to reflect the final model. → **C9** (gated on the model
landing, C6/C7) with the anchor decision captured upfront in **C1**.

### F7 — `onEdit` is not provisioned on every live tracker
`setupTrackerEditTrigger_` is called from `CreateNewTracker.js:344` (new months)
only. **`CopyTemplate.js` provisions no edit trigger at all** (nor form-submit),
so namespace/smoke trackers are uncovered; and pre-440b.4 trackers were never
backfilled. Retiring the poll requires onEdit to actually exist wherever a human
might edit. Backfill + lifecycle is already scoped as **F3Go30-440b.5**; add
CopyTemplate provisioning to the same effort. → **C4** (relates to 440b.5).

### F8 — asOf machinery becomes dead weight once the poll is gone
The `go30asof:` marker (#4), `markPaxCacheFreshNow_`, and the per-execution
`paxCacheFreshnessMemo_` exist **only** to make the poll cheap/correct. After C6
they are unreferenced surface area. Remove them to shrink the model. → **C7**
(gated on C6).

### F9 — Audit: Responses layout/header reads on paths that don't consume them
The user flagged historically "reading response header rows in all cases but the
workflow never actually needed it." F3Go30-440b.6 already split the Responses
layout into its own cache (#6) and made spreadsheet open lazy, which addresses
most of this. Remaining audit: confirm no code path forces a Responses
layout/header **live read** (`getResponsesLayout_`) for an action that never uses
`goals`/`email` (e.g. a pure check-in-submit that already carries a resolved
handle). `resolveCheckinIdentityLean_` (`dashboardWebapp.js:762-772`) reads the
layout unconditionally — verify each caller actually needs it, and skip on a
handle fast-path where it doesn't. → **C8**.

---

## Bead plan (dependency-ordered)

Epic: **Caching consolidation — onEdit-driven freshness, retire the Drive-modtime
poll.**

```
C1  ADR + DESIGN: unified caching model, decide poll retirement   (no deps)
      │
      ├─► C2  Extend onEdit to Responses + Bonus Tracker            (blocks C4, C6, C10)
      │        │
      │        ├─► C4  Provision onEdit everywhere (CopyTemplate +   (rel. 440b.5; blocks C6)
      │        │        backfill) + bound trigger count
      │        └─► C10 onEdit per-row patch (optional)               (enh.)
      │
      ├─► C3a markMinusOne → full PaxCache invalidation              (blocks C6)
      ├─► C3b addResponseOnSubmit form path → roster write-through   (blocks C6)
      ├─► C5  Bonus writes → write-through (independent)
      └─► C8  Audit unnecessary Responses layout reads (independent)

C6  Retire the Drive-modtime poll         (needs C2, C3a, C3b, C4, 440b.5)
      │
      └─► C7  Remove dead asOf machinery   (needs C6)
             │
             └─► C9  Doc cleanup: rewrite stale headers, DESIGN §Caching  (needs C6, C7)
```

**Why this order:** C6 (the payoff) is unsafe until every staleness source the
poll silently covers has an explicit owner: manual Responses/Bonus edits (C2),
the nightly −1 sweep (C3a), Form-submit signups (C3b), and onEdit actually
existing on every tracker (C4 + 440b.5). C5 and C8 are independent quality items
that can land in parallel. C7/C9 are cleanup that only makes sense once C6 lands.

See each bead for file-level acceptance criteria.
