# ADR-017: Celebration Report-Once State Persists as a Tracker-Sheet Column

Status: Accepted

Date: 2026-07-18

Implementation: F3Go30-koqf

## Context

A planned feature adds celebration / encouragement moments to the check-in flow
(goal-hit, streak tiers, halfway, bonus, personal-best; and gentle bounce-back
messaging on a miss). To fire each celebratory milestone **exactly once** — and
not re-fire it every time the SPA re-renders, the PAX reopens the app, or they
toggle a day across a threshold — the server needs a durable **report-once**
record per PAX per month.

Detection itself needs no stored history: a milestone fires iff the *current
check-in write* moves the PAX from not-earned to earned (a write-transition
diff of streak/count, both computable from the Tracker row already in hand). The
only genuinely new state is the report-once guard that survives toggling and
retries. The question this ADR settles is **where that guard lives.**

### Candidates evaluated

1. **Trailing column on the Tracker sheet** (chosen).
2. **Cache-only slot in the PaxCache row** — extend the cached array with a
   bitmask element that has no backing sheet column.
3. **Separate `PropertiesService` key** (`go30celeb:{sheetId}:{name}`) — a
   dedicated property, not in the sheet and not in the row-cache array.
4. **Column on the Responses sheet** (alongside WHO/WHAT/HOW goals, mirroring
   the `FEEDBACK_RATING`/`FEEDBACK_COMMENT` optional-column precedent).

### Why cache-only is broken (rules out candidate 2)

Under the current data model the PaxCache row **mirrors the sheet row** —
identical width and indices — which is what makes write-through a same-index
patch (`handleCheckinSubmit_` builds `patchedRow = target.row.slice()` and stores
it). A bitmask slot with no backing sheet column is therefore **erased on the
next live re-read**, and live re-reads are routine, not exceptional:

- PaxCache **never caches a miss** — a miss re-reads the row live (no extra
  slot).
- `TrackerEditTrigger` **invalidates on any manual edit** → next read is live.
- The **60-day nightly purge** and any roster rebuild → re-read live.

On a cache miss `target.row` is a fresh sheet read with no celebration element,
so the report-once guard would be wiped precisely by the mechanisms
[ADR-016](016-onedit-authoritative-cache-retire-drive-modtime-poll.md) canonizes.
Anything that must survive has to be sheet-backed; the cache is a disposable
write-through mirror of the sheet, never a system of record.

### Why not the Responses sheet (rules out candidate 4)

`handleCheckinSubmit_` **deliberately never loads the Responses row**: it passes
`needGoals=false`, and the F3Go30-o39s.9 audit ("F9") records that "submit never
reads identity.goals/emailMismatch (only the tracker row/day column below), so
this fallback skips the per-PAX Responses row fetch entirely." Homing the
bitmask in Responses would force the submit path to re-load the Responses sheet,
resolve its column map, read the row, and write through a second cache — on
**every check-in**, since the current mask is needed to detect a crossing. That
directly reverses a documented hot-path optimization.

### Why not a separate PropertiesService key (rules out candidate 3)

A dedicated `go30celeb:` property survives cache-row refreshes and could ride the
existing nightly purge, but it is not sheet-backed (vanishes if the property
store is wiped), is invisible for debugging, competes for the ~500-key / 500 KB
`PropertiesService` budget PaxCache already contends with, and adds a *separate*
`getProperty` read on the submit path — whereas a Tracker column is already
present in `target.row`.

### Why the Tracker trailing column is nearly free

- **The read is already paid for.** `handleCheckinSubmit_` holds `target.row`
  (the full pre-write Tracker row) and `target.col`; the current mask is
  `target.row[celebCol]` and the day-values for the crossing diff are in that
  same row.
- **The write rides existing write-through.** The handler already sets the day
  cell and stores `patchedRow` via `setPaxCacheRow_dw_('tracker', …)`; the
  bitmask adds one cell `setValue` plus `patchedRow[celebCol] = mask` before the
  same call.
- **No positional disruption.** `classifyTrackerColumns_` claims only
  Date-headed and `'Bonus'`-headed columns from index 8 onward and ignores
  everything else, so a trailing `Celebrations` header is invisible to the
  day/bonus logic and does not shift `TRACKER_FIXED_COLUMN_COUNT_` (8) or the
  day-origin. It is a plain-value cell, so it passes the handler's
  `cell.getFormula()` guard (unlike the formula-driven B–H columns).

## Decision

Celebration report-once state is persisted as a **single trailing integer
column** on the **Tracker** sheet, header `Celebrations` in row 3, one cell per
PAX row, holding a **bitmask** (one bit per milestone; e.g. `go30`, `half`,
`bonus`, `pb`, `streak7`, `streak14`, …). Canonical bit constants are defined in
implementation.

- **Detection** is a write-transition diff in `handleCheckinSubmit_`: compute
  pre/post streak+count from `target.row`'s day values, compare against the
  stored bitmask, and `OR` in any newly-crossed bits.
- **The persisted cell is the cumulative bitmask** — the report-once /
  toggle / retry guard.
- **The check-in response returns only the newly-earned list**
  (`celebrations: [<codes crossed this write>]`) — that is what drives the
  client animation; the client already awaits this response in `submitCheckin_`.
- **The cache copy is the automatic mirror**, not a separate store: patching
  `patchedRow[celebCol]` before the existing `setPaxCacheRow_dw_` keeps the
  mirror consistent, exactly as the day cell already does.

### Relationship to ADR-016

This decision *depends on* ADR-016's model: the celebration cell is written
through at the point of write, identical to the day cell, and is therefore
self-invalidating. It introduces no new freshness mechanism. The cache-only
rejection above is a direct corollary of ADR-016 — the mirror is rebuilt from
the sheet, so only sheet-backed state is durable.

## Consequences

- **`CreateNewTracker.js`** emits the trailing `Celebrations` header (row 3)
  when generating a Tracker.
- **Tracker layout resolution** gains a small `findCelebrationCol_(row3)` header
  scan, cached alongside the existing row2/row3 layout.
- **`handleCheckinSubmit_`** (`dashboardWebapp.js`) gains the read → diff →
  `OR` → single-cell write → `patchedRow` patch, and returns
  `celebrations: [...]`.
- **Client `submitCheckin_`** (`static-pages/src/index.html`) reads
  `res.celebrations` and fires the animation.
- **Legacy months** whose Tracker predates the column: `findCelebrationCol_`
  returns not-found → the write is skipped and celebrations simply do not
  persist for those months. Accepted; no backfill.
- **Miss / bounce-back messaging** is *not* report-once state — it is derived
  live from the current streak/count and needs no persisted bit; it is out of
  scope for this column.
- The bitmask adds no measurable store-budget or purge burden: it is one cell
  in a sheet that is already the month and is torn down with the tracker.
