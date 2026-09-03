# PAX history window: fix the rollover defect, then retire the duplication

**Contract:** Pattern D — staged execution (`$DEVSTANDARD/doc-framework/planning-guide.md`
§Pattern D is the authority; nothing here restates it).
**Status:** Stage 0 open — beads proposed, awaiting owner confirmation before creation.
**Next Step:** Confirm the bead list in §Stage Zero, create the beads, wire the dependency edges,
then open `rollover-patch` for a 2.6.3 PROD patch.

## What this plan is about

On 1–2 September a PAX with a full August history saw a September dashboard with no history and a
broken 14-day rolling average, while scrolling back to August rendered correctly. The cause is a
stored rolling-history window that was *too short* but still passed the only check the code makes
of it — the check asks whether the window *agrees* with the Tracker row, never whether it *covers*
enough days to be useful. A window truncated to one day at month rollover agrees trivially with a
one-day month, so it is served forever instead of being rebuilt; the same window is unusable for an
August anchor, which is why the past month looked fine. That asymmetry is the signature.

Underneath the defect is a modelling problem. The current month's day values are stored twice —
once in the per-PAX Tracker row cache, once in the tail of the history window — and the code then
reconciles the two copies at read time and re-splits them at the point of use. The defect lives in
that reconciliation, and the same duplication is what makes a dashboard load at rollover expensive:
every PAX whose two copies disagree falls into a per-PAX prior-month read. So this plan fixes the
bug first, makes the fallback cheap second, and then removes the duplicated state that generated
both — which is a down payment on the PaxProfile migration that would have prevented it outright.

## Glossary

| Term | Meaning |
|---|---|
| **history window** | The `go30hist:` PropertiesService entry, `{historyEndDate, days}`, one per `{scopeId, f3Name}` — a trailing run of one-char day outcomes that spans month boundaries. |
| **lead** | The part of a history window that precedes the current month's first day. What the Tracker row cannot supply, and the only part the dashboard actually needs from the window. |
| **overlap** | The part of a history window covering days the current month's Tracker row already holds — duplicated state, and the subject of `history-model`. |
| **coverage** | Whether a window reaches far enough back to serve a 14-day average and a cross-month streak. Distinct from agreement, and currently unchecked. |
| **rollover** | The first days of a new tracker month, when the current month is short and the window is least likely to be adequate. |

## Stage Zero

These beads do not exist yet. Confirm this list, and it is created as written.

| Ref | Proposed bead | Scope, one sentence |
|---|---|---|
| N0 | Stage 0: file the PAX-history plan beads and wire stage edges | Create N1–N6, apply `stage:`/`model:` labels, add the dependency edges the stage order asserts, retire the superseded source doc, close the stale-open `F3Go30-os03`, commit this plan. |
| N1 | BUG: a too-short history window is served instead of rebuilt at rollover | Require coverage, not just agreement, before the early return in `getPaxHistoryWindowValues_`; a window that does not reach before the month start falls through to the backfill. |
| N2 | Client telemetry: dashboard request/response and empty-render census | On every dashboard render emit request-issued and response-received timestamps, rejection state, and the lengths of `dayValues`, `rollingAverage`, `priorMonthDayValues`, plus board row count. |
| N3 | Server telemetry: dashboard cache and backfill counters | Add `trackerFromCache` and a per-load count and duration of prior-month backfill invocations to the `checkinWebapp.dashboard` event. |
| N4 | Hoist the prior-month backfill out of the dashboard roster loop | Resolve the prior month once per request and fetch its layout and rows for the whole roster in one pass, passed into the per-row call the way history entries already are. |
| N5 | Store only the lead: drop the current-month overlap from the history window | Remove the duplicated overlap so the reconciliation check and the read-time re-split both disappear, and an in-month check-in stops rewriting the window. |
| N6 | Design pass: PaxProfile backfill mechanics | Resolve the undesigned batch/verification/rollback gap that blocks `F3Go30-uz9e.5`, so Slice 3 becomes schedulable. |

**Existing beads folded into this plan:** `F3Go30-m732` (joins `prior-month-bulk`),
`F3Go30-uz9e.5` (unblocked by N6, not a member of any stage here), `F3Go30-5c2a` (context for N2 —
its telemetry is what distinguishes a lost response from an empty one), `F3Go30-uz9e.7` (the
existing owner gate on a real datastore; unchanged by this plan).

## Execution order

| # | Stage | Bead | Status | Title |
|---|---|---|---|---|
| 0 | `plan-open` | N0 | ○ | Stage 0: file the PAX-history plan beads and wire stage edges |
| 1 | `rollover-patch` | N1 | ○ | BUG: a too-short history window is served instead of rebuilt at rollover |
| 1 | `rollover-patch` | N2 | ○ | Client telemetry: dashboard request/response and empty-render census |
| 1 | `rollover-patch` | N3 | ○ | Server telemetry: dashboard cache and backfill counters |
| 2 | `prior-month-bulk` | N4 | ○ | Hoist the prior-month backfill out of the dashboard roster loop |
| 2 | `prior-month-bulk` | F3Go30-m732 | ○ | Cache the unthrottled TrackerDB availableMonths read |
| 3 | `history-model` | N5 | ○ | Store only the lead: drop the current-month overlap |
| 4 | `profile-design` | N6 | ○ | Design pass: PaxProfile backfill mechanics |

**Verify:** `bdls --stages` for the roll-up, `bdls --check` for the label/graph audit,
`bdls --goals --stage <name>` before opening one. The tracker is the authority; this table mirrors it.

## Stage roll-up

| # | Stage | Status | Closed | Handoff |
|---|---|---|---|---|
| 0 | `plan-open` | pending | — | — |
| 1 | `rollover-patch` | pending | — | — |
| 2 | `prior-month-bulk` | pending | — | — |
| 3 | `history-model` | pending | — | — |
| 4 | `profile-design` | pending | — | — |

## Stages

### 0 — `plan-open`

**Deliverable:** the beads exist, the order is modelled in the graph rather than asserted here, and
the superseded finding doc is gone.
**Artifacts:** this document; the tracker.
**Why paired:** single boundary bead by construction — this stage is the bead-creation event.
**Operator check:** `bdls --check` reports no errors and `bdls --stages` shows five stages.
**Work-log:** none — folded into `rollover-patch`.
**Must not:** create beads for work this review did not evidence; the roster-loop and model changes
are the only forward work here, and neither is a licence to re-open the sort-invalidation design.

Retire `PLAN-dashboard-perf-2026-09-02.md` in this stage. It is superseded: its blob-storage
rejection was independently verified and holds, and that conclusion belongs in `bd remember`, not in
a root-level plan file; its root-cause section is contradicted by the evidence recorded here.

Close `F3Go30-os03` in this stage. It reads in progress but its work shipped in `ac9ff75`
(2026-08-27) and was verified during this review: `state.board` is the single store, `monthCache`
and `calGridCache` survive only as explanatory comments, `state.monthGrid` is derived rather than
aliased, one value-to-status converter remains, the identity-change reset landed, the calendar's
redundant fetch is skipped when the board already holds the day facts, and its four tests pass.
The one judgment left to the owner is whether an operator look is wanted before closing.

### 1 — `rollover-patch`

**Deliverable:** a 2.6.3 PROD patch in which a rollover-truncated window rebuilds instead of being
served, and in which any future empty dashboard is self-diagnosing from telemetry rather than
needing a live reproduction a month later.
**Artifacts:** `getPaxHistoryWindowValues_`; the `checkinWebapp.dashboard` log event;
`static-pages/src/index.html` dashboard render and API call path.
**Why paired:** all three ship in one patch and one deploy, and the telemetry is worth most on the
same build as the fix — it is what shows whether the fix held at the next rollover.
**Model:** `sonnet` — the analysis is done; these are small, well-specified changes.
**Operator check:** on PROD after deploy, call the dashboard for an affected PAX and assert
`priorMonthDayValues.length` and `rollingAverage.length` against `dayValues.length`; then confirm
one client telemetry record carries the new fields.
**Work-log:** per-stage.
**Must not:** touch the write side. The read-side coverage guard alone fixes the symptom; changing
`advancePaxHistoryEntry_` in the same patch removes the clean before/after that `history-model`
needs, and that function is claimed by stage 3.

**No anti-pairing on the client path.** An earlier draft fenced this stage off from `F3Go30-os03`,
which shares the render path. That was based on a stale in-progress status: its work landed in
`ac9ff75` and stage 0 closes it, so `state.board` is settled ground for the new telemetry to read
from rather than a moving target. There is no other in-flight work in the tracker.

### 2 — `prior-month-bulk`

**Deliverable:** a dashboard load whose cost stops scaling with the number of PAX who need a
prior-month backfill — the mechanism behind the rollover latency, independent of whether it caused
this defect.
**Artifacts:** `getPriorMonthTailValues_`; the `handleCheckinDashboard_` roster loop;
`_readTrackerDbRowsBySheetId_` call sites on the read path.
**Why paired:** N4 and `F3Go30-m732` are the same uncached TrackerDB read seen from two callers.
`F3Go30-m732`'s narrowed scope caches the derived month list for the month-navigation payload, which
does **not** cover the raw row read the prior-month lookup makes — pairing them is what stops that
being fixed twice, in two shapes, for one read.
**Model:** `sonnet`.
**Operator check:** compare the dashboard event's backfill count and duration (shipped in stage 1)
before and after, on a roster with several PAX lacking a stored window.
**Work-log:** per-stage.
**Must not:** introduce a second cache with its own invalidation contract. A request-scoped memo is
in scope; a new persisted cache is not — that is the trap `F3Go30-m732`'s own design note records.

**Order note:** stage 1 fixing correctness makes *more* windows fall through to the backfill path,
so this stage gets hotter as a direct result of the previous one. That is the reason it sits second
and not later, and it is a preference asserted here rather than a dependency in the graph.

### 3 — `history-model`

**Deliverable:** one copy of the current month's day values instead of two — the reconciliation
check and the read-time re-split both stop existing, and an in-month check-in no longer takes a lock
to rewrite a window.
**Artifacts:** `advancePaxHistoryEntry_`; `anchorPaxHistoryValues_`;
`paxHistoryWindowMatchesTracker_`; `buildDashboardPaxRow_`'s window split.
**Why paired:** single bead, deliberately — this changes a stored shape and a write path, and the
plan gains nothing by carrying unrelated work through the same review.
**Model:** `opus` — a stored-shape change with a migration of live entries behind it.
**Operator check:** for a PAX mid-month, confirm the dashboard renders an identical board before and
after, and that a check-in no longer writes the history entry.
**Work-log:** per-stage.
**Must not:** start before stage 1's telemetry has reported from a real rollover or a forced
reproduction. The point of measuring first is to know whether the remaining cost is where this
change would put it.

**Anti-pairing:** never with N1. One session that both fixes the guard and removes the thing the
guard checks leaves no way to attribute the outcome to either.

### 4 — `profile-design`

**Deliverable:** `F3Go30-uz9e.5` becomes schedulable — the migration that removes this whole class
of defect stops being blocked on an undesigned piece.
**Artifacts:** `docs/pax-data-model-and-contract.md` §6; a new ADR if the mechanics warrant one.
**Why paired:** single bead; its output is a design, and its consumer is an existing epic.
**Model:** `opus`.
**Operator check:** read the design against `F3Go30-uz9e.5`'s description and confirm nothing in its
scope is still marked undesigned.
**Work-log:** per-stage.
**Must not:** widen into Slice 3 implementation, and do not pre-empt `F3Go30-uz9e.7` — whether the
backing store becomes a real database is an owner decision that already has a gate.

**Order note:** independent of stages 1–3 and could run at any point after stage 0; it is placed
last because the earlier stages are time-pressured by the next rollover and this one is not.

## Findings carried in from the review

Each carries a disposition, so nothing is left to the reader to track.

- The original finding doc's root cause (sort-driven roster-index invalidation) is **not supported
  by the telemetry it cites** — the counters it reads are incremented only by a different function,
  against the prior month's index. *Disposition: deliberately dropped as a work item; recorded in
  `bd remember` by N0. The sort-invalidation redesign is not scheduled — it re-opens a cross-PAX
  identity-leak defect class and no evidence yet says it is costing anything.*
- The single-blob PaxCache proposal was independently re-verified and the rejection holds, on the
  9KB per-value cap and the write-path lock. *Disposition: `bd remember` by N0; no bead.*
- `F3Go30-5c2a` already root-caused this project's "Couldn't reach the server" symptom to false
  transport failures, which the finding doc read as latency. *Disposition: AC of N2 — the telemetry
  must distinguish the two.*
- PaxCache's PropertiesService store is at roughly 148 of about 500 keys. *Disposition: deliberately
  dropped for now — the 60-day purge bounds it; N5 reduces it as a side effect.*

## Change Log

- 2026-09-02 — dropped the `rollover-patch` anti-pairing after auditing in-progress beads: the only
  one, `F3Go30-os03`, is complete but unclosed, so N0 closes it rather than the plan working around it.
- 2026-09-02 — authored from the dashboard-rollover review. Supersedes
  `PLAN-dashboard-perf-2026-09-02.md`, whose storage-shape rejection is retained and whose
  root-cause section is not.

## BD References

- New, pending confirmation: N0–N6 (see §Stage Zero).
- `F3Go30-m732` — joins `prior-month-bulk`.
- `F3Go30-uz9e.5` — unblocked by N6; not a member of any stage here.
- `F3Go30-uz9e.7` — existing owner gate on a real datastore; untouched.
- `F3Go30-5c2a` — context for N2.
- `F3Go30-os03` — work shipped in `ac9ff75`; status stale, closed by N0. Its `state.board` store is
  what N2's telemetry reads from.
