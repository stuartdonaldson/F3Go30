# Design Review — F3Go30, 2026-08-04

Point-in-time review of design documents, architecture, and code. Not a standing document:
findings graduate to bd issues, ADRs, or `docs/DESIGN.md` and this record becomes history.

**Update 2026-08-04 (same day):** DR-01, DR-02, and DR-03 addressed — see each finding's
"Resolution" subsection. Summary: DR-01 fixed in code + tests (`script/PaxCache.js`,
`script/dashboardWebapp.js`, `script/markMinusOne.js`) and live-verified in SIT (deployed,
namespace smoke test, and a direct `runMinusOneCheck` admin call all exercised the new scoped
`go30hist:` key with no errors). DR-02 resolved as recommendation (b):
`adr/020-namespace-trigger-fanout-deferred.md` records the D4 fan-out as deferred and supersedes
that one ADR-014 claim. `docs/DESIGN.md` (cache table + a new namespace-trigger paragraph) and
`docs/OPERATIONS.md` (`CopyTemplate` step 5 + a new Failure Modes row + the purge description)
updated accordingly. DR-03 closed not-a-bug after live investigation against SIT: `BonusTypes.js`
and the sheet agree — no weekly cap on EHing FNG anywhere. The apparent disagreement was
`UNIQUE()`-based duplicate-Slack-link collapsing, working as intended; a related visibility gap
(no save-time notice for a reused link) is filed as low-priority hardening (`F3Go30-6faz.1`). No
code change, no deploy.

**Update 2026-08-04 (later same day):** DR-04 addressed — on explicit human instruction, executed
as a **full removal** rather than the recommended "extend scope + wait out the soak trigger."
`script/SignupApp.html`, `script/CheckinApp.html`, and `script/IdentityCore.html` are deleted;
`adr/021-gas-rendered-pages-removed.md` supersedes ADR-019's `?static=0` claim. `F3Go30-wjpu`
closed; `F3Go30-zcxc` (DR-10) closed obsolete as a direct consequence. DR-06 partially resolved
(triplication → duplication) as a side effect. Live-verified in SIT: deployed, full namespace
smoke test end to end, and both `?cmd=signup`/`?cmd=checkin` redirects confirmed live to preserve
every query param. See each finding's own "Resolution" subsection for detail.

**Baseline reviewed**
- Working tree at `b2669f3` + 5 uncommitted files (`package.json`, `script/version.js`,
  `static-pages/src/index.html`, `tools/callWebapp.js`, `work-log.md`)
- bd: 45 open (27 ready, 18 blocked), 297 closed
- `npm test`: 47 suites, all passing
- Docs: `CONTEXT.md`, `DESIGN.md`, `OPERATIONS.md`, ADR-001…019

**Scope excluded:** live behaviour against SIT/PROD (no environment-scoped runs made),
Playwright suites, performance measurement.

---

## Findings summary

| ID | Severity | Area | Finding | Tracking |
|----|----------|------|---------|----------|
| DR-01 | **P0** | Data / multi-tenancy | `go30hist:` PaxCache key omits sheet/namespace scope — collides across namespaces | **RESOLVED 2026-08-04** |
| DR-02 | **P0** | Architecture / docs | ADR-014 D4 trigger fan-out is Accepted but unimplemented | **RESOLVED 2026-08-04 — ADR-020** |
| DR-03 | ~~P1~~ | Correctness | EHing FNG weekly cap: `BonusTypes.js` and the Tracker formula disagree | **CLOSED not-a-bug 2026-08-04 — F3Go30-fkox** |
| DR-04 | **P1** | Backlog hygiene | GAS-page removal is decided, but the execution bead covers `SignupApp.html` only | **RESOLVED 2026-08-04 — full removal, ADR-021** |
| DR-05 | **P2** | Error handling | Non-JSON GAS responses reach the PAX as a raw JSON parser message | new — still open |
| DR-06 | **P2** | Maintainability | Scoring logic is triplicated: server + two clients | **PARTIALLY RESOLVED 2026-08-04** — now server + one client; explicit-mirror doc note + generalized test-vector table still open |
| DR-07 | **P2** | UI / accessibility | Uncommitted chart change hardcodes a non-theme-aware colour | working tree — still open |
| DR-08 | **P2** | Maintainability | 65 lines of hand-repeated module-shim boilerplate across 15 files | new — still open |
| DR-09 | **P3** | Documentation | Transient handoff artifacts committed at repo root | new — still open |
| DR-10 | **P3** | Backlog hygiene | `F3Go30-zcxc` should close as obsolete rather than be fixed | **CLOSED obsolete 2026-08-04 — F3Go30-zcxc** |

---

## DR-01 — `go30hist:` history key omits namespace scope

**Severity:** P0 · **Type:** defect · **Area:** `script/PaxCache.js`

### Observation

`paxHistoryKey_` (`script/PaxCache.js:627`) builds `'go30hist:' + normalize(f3Name)`. Every
other PaxCache key includes the sheet: `paxCacheRowKey_` is
`'go30pax:' + kind + ':' + sheetId + ':' + name` (`PaxCache.js:74`).

PropertiesService belongs to the **executing script project**, not to the spreadsheet a request
resolved via `resolveTemplateSpreadsheet_` — already recorded in the
`paxcache-shared-across-namespaces` memory. `TrackerDB`, `PaxDB`, and `CheckinSessions` are
namespace-isolated because each namespace copy carries its own sheets; the `go30hist:` store is
not, because its key carries no discriminator.

`tools/smokeTestNamespace.js` defaults to `--template prod`, provisioning a namespace from
**PROD's real Template and recent trackers** — with real PAX names. A smoke check-in for
`Little John` therefore writes the exact key PROD's dashboard reads.

### Impact

The history window drives `streak`, `maxStreak30`, `rollingAverage`, and `priorMonthDayValues`
(`dashboardWebapp.js:2248` `buildDashboardPaxRow_`).

- **Bounded:** `paxHistoryWindowMatchesTracker_` (`dashboardWebapp.js:2354`) validates the
  window against the live Tracker row wherever the two overlap, and rebuilds on mismatch. The
  current month's portion therefore self-heals.
- **Unbounded:** the **prior-month lead** — `priorMonthLead` at `dashboardWebapp.js:2265`, which
  feeds `rollingAverage` and the pax-detail chart for every board member — is never validated
  against anything. A foreign namespace's leading days are consumed as if real.
- **Thrash:** while two namespaces are concurrently live, each rebuild clobbers the other's
  entry, so the cache never stays warm and the `wouldRegress` guard (`dashboardWebapp.js:2365`)
  fires against a sibling namespace's anchor rather than a stale read of its own.

### Recommended solution

Scope the key the way every other PaxCache key is scoped:

```js
function paxHistoryKey_(scopeId, f3Name) {
  return PAX_HISTORY_PREFIX_ + scopeId + ':' + paxCacheNormalizeName_(f3Name);
}
```

`scopeId` should be the resolved template spreadsheet id (the namespace's identity, stable
across that namespace's monthly trackers) — **not** the tracker `sheetId`, which changes every
month and would defeat the cross-month window that is the whole point of this cache.

Threaded through: `getPaxHistoryEntry_`, `setPaxHistoryEntry_`, `getPaxHistoryEntriesBulk_`,
`setPaxHistoryEntriesBulk_`, `advancePaxHistoryDay_`, and their `_dw_` call sites in
`dashboardWebapp.js` (`2346` `getPaxHistoryWindowValues_`, `2043` in `handleCheckinSubmit_`).

**Secondary benefit — retires a workaround.** The purge pass at `PaxCache.js:556` exists
*because* these entries carry no sheetId: "they carry no sheetId, so neither the tracker-age
passes nor the orphan sweep above can see them at all", forcing a bespoke fourth pass reaped off
the CheckinSessions activity signal. A scoped key lets the existing orphan sweep see them.

**Migration:** none required. Unscoped legacy keys simply miss; `getPaxHistoryWindowValues_`
rebuilds from the Tracker on a miss, and the existing purge pass reaps the orphans. No
backfill, no dual-read window.

**Tradeoff:** one more parameter on six functions, and the scope id must be in hand at every
call site. It already is — every one of them resolves a template spreadsheet or `monthInfo`
first.

### Resolution (2026-08-04)

Implemented as recommended, plus the documented secondary benefit (orphan sweep now sees
`go30hist:` entries too):

- `paxHistoryKey_` and all six threaded functions (`getPaxHistoryEntry_`,
  `setPaxHistoryEntry_`, `getPaxHistoryEntriesBulk_`, `setPaxHistoryEntriesBulk_`,
  `advancePaxHistoryDay_`, plus `extractSheetIdFromPaxCacheKey_`) now take/parse an explicit
  `scopeId` (`script/PaxCache.js`). `collectKnownTrackerSheetIds_` also now includes the bound
  spreadsheet's own id — needed once `go30hist:` scopeIds could equal that id (the parent
  Template's own requests, absent an `ns`).
- All `dashboardWebapp.js` call sites pass `paxHistoryScopeId_dw_(templateSpreadsheet)` — a
  guarded wrapper around `templateSpreadsheet.getId()` so a scope-id lookup can never abort an
  otherwise-successful request (`templateSpreadsheet` is always a resolved `Spreadsheet` in
  production; the guard exists for defense only).
- `markMinusOne.js`'s write-through now passes the **bound/active** spreadsheet's id as
  `historyScopeId` — matching `resolveTrackerForContextDate`'s own no-arg default — since ADR-020
  confirms this trigger has no per-namespace fan-out to resolve a different scope from yet.
- The nightly purge's fourth pass is now scoped to the bound spreadsheet's own `go30hist:`
  entries only (previously namespace-blind, so it could reap another live namespace's window on
  its own inactivity signal); the third pass (orphan sweep) now also wipes a torn-down namespace's
  `go30hist:` entries via a new `wipePaxHistoryForScope_` helper.
- Tests: 9 new/rewritten cases in `test/test_pax_cache.js` (cross-namespace isolation on
  get/set/bulk-read, fourth-pass scope boundary, orphan-sweep now covering `go30hist:`) plus every
  existing history test in `test_pax_cache.js`/`test_dashboard_webapp.js`/`test_mark_minus_one.js`
  updated to the new signatures. All 47 suites pass (`npm test`).
- **Live-verified in SIT**, 2026-08-04: deployed (`npm run deploy:sit`); ran the full namespace
  smoke test (`node tools/smokeTestNamespace.js --env sit --template sit`) end to end —
  signup → check-in write-through → dashboard render → bonus add/list → cross-month bonus
  relocation, all against a disposable namespace — with no errors on the second attempt (the
  first two attempts hit the pre-existing, already-documented deployment-propagation race
  described in `tools/callWebapp.js`'s own non-JSON-response guard, unrelated to this change —
  server-side logs for those attempts show the underlying signup/check-in actions completed
  successfully; only the HTTP response was a stray redirect page). Also ran `runMinusOneCheck`
  directly against SIT to exercise `markMinusOne.js`'s new `historyScopeId` wiring outside the
  namespace smoke path — completed cleanly, confirmed via Axiom logs.

---

## DR-02 — ADR-014 D4 trigger fan-out is Accepted but unimplemented

**Severity:** P0 · **Type:** design/code inconsistency · **Area:** ADR-014, trigger modules

### Observation

ADR-014 D4 (`adr/014-namespace-scoped-template-resolution.md:47-50`) decides that the four
time-based triggers — `sendNagEmail`, `markEmptyCellsAsMinusOne`,
`MONTHLY_AUTO_GENERATE_HANDLER_`, `cleanupStaleCheckinSessions` — **fan out** over
`{parent bound Template} ∪ {NamespaceDB rows whose per-trigger column = Enabled}`, each
namespace wrapped in its own try/catch, parent processed first.

The schema half is built. `NAMESPACE_DB_COLUMNS_` declares all four columns
(`go30tools.js:36-39`); `_parseNamespaceRegistryRow_` parses them into
`nagEnabled`/`minusOneEnabled`/`autoGenerateEnabled`/`cleanupSessionsEnabled`
(`go30tools.js:899-902`); `_upsertNamespaceRow_` writes them (`go30tools.js:1032-1035`).

The consumer half does not exist. `script/nag.js`, `script/markMinusOne.js`,
`script/CreateNewTracker.js`, and `script/CheckinSessions.js` contain **zero** references to
`NamespaceDB` or to any of the four flags. No fan-out loop exists anywhere in the codebase.

### Impact

Latent today, because the only namespaces that exist are smoke environments that live for
minutes. It becomes a silent correctness failure the day the seam is used as ADR-014 §76
explicitly intends — a regional or demo tenant. That tenant would get:

- no nightly −1 marking (missed days never recorded, scores permanently wrong)
- no nag emails
- no monthly auto-generation (no tracker for the next month)
- no stale check-in-session cleanup (unbounded sheet growth)

…with no error, because nothing is looking. The ADR reads as though this works, so a future
maintainer registering a tenant has no reason to check.

### Recommended solution

Choose one — both are acceptable; the failure mode is the gap between them, not either state.

**(a) Implement it.** One shared helper, not four hand-written loops:

```js
// go30tools.js
function forEachTriggerScope_(flagName, fn) { /* parent first, then Enabled ns rows,
                                                 each in its own try/catch */ }
```

Each trigger entry point becomes `forEachTriggerScope_('nagEnabled', function (ss) { ... })`.
This is the one shape that satisfies both the ADR's isolation contract and this repo's
no-duplicated-logic standard — four hand-copied fan-out loops would drift on the first fix.
Requires the four trigger bodies to already be spreadsheet-parameterised; `markMinusOne` and
`nag` are (ADR-010 dispatch), `autoGenerate` and `cleanupStaleCheckinSessions` need checking.

**(b) Record it as deferred.** ADR-014 is Accepted and immutable, so it cannot be edited — a
superseding ADR scoped to D4 only (the exact pattern ADR-019 used against ADR-018) records that
fan-out is deferred and the four columns are reserved-not-live. Cheaper, and honest.

**Recommendation: (b) now, (a) when a non-smoke namespace is actually registered.** Nothing
today needs the behaviour, and implementing an unexercised fan-out loop against the 6-minute
trigger cap buys risk without buying function. What is not acceptable is leaving an Accepted
ADR asserting behaviour the code does not have.

### Resolution (2026-08-04)

Implemented option (b). `adr/020-namespace-trigger-fanout-deferred.md` supersedes ADR-014's D4
fan-out claim only (ADR-014 itself is untouched, per its own immutability — same pattern
ADR-019 used against ADR-018), records the four opt-in `NamespaceDB` columns as
reserved-not-live, and states the trigger to implement (a real `regional`/`demo` tenant
registered with a fan-out column Enabled). Passed `/adr-quality-check`.

Also corrected the two places outside the ADR that read as though this already worked:
`docs/OPERATIONS.md`'s `CopyTemplate` walkthrough (step 5 previously said "an operator enables
them manually per D4" with no caveat that doing so has no effect) and its Failure Modes table
(new row); `docs/DESIGN.md` gained a short paragraph on namespace-scoped triggers, cross-
referencing ADR-020, since the file previously said nothing about trigger fan-out at all.

No code change — nothing to live-verify beyond confirming the four trigger entry points still
behave exactly as before (they do; this finding changed no code path, only what the ADR/docs
claim about them).

---

## DR-03 — EHing FNG weekly-cap disagreement

**Severity:** P1 (currently P2) · **Type:** defect · **Tracking:** F3Go30-fkox — **CLOSED,
not a bug (2026-08-04)**

Already well documented on the bead, with live evidence from SIT (2026-07-27). Recorded here
only to argue the priority.

`BonusTypes.js` marks `EHing FNG` as `weeklyCap: false` — the only uncapped type — and the
server-side pill computation honours it. The Tracker sheet's per-type column formula appeared to
cap it at one entry per period. Two numbers in a single dashboard payload disagreed, and the one
that counted for standings was the sheet's.

**Why this review called it P1, not P2 (superseded below):** a wrong number visible to a PAX
today, on the screen the whole product exists to render, with no workaround and no error looked
indistinguishable from a real defect. The investigation below found it wasn't one.

### Resolution (2026-08-04) — code is correct; no defect

Live investigation against SIT (`getSheetFormulas`/`getSheet` admin actions, against both the
Template and the exact tracker the bug cited, `1vucQTzYmmNd1bYVwtqQQD53aUFHgOc1ZUqbzpH9HKLI`)
found the sheet and the code **agree** — there is no weekly cap on EHing FNG in either place.

What actually happened: `UBonus Tracker` is `=UNIQUE('Bonus Tracker'!A:F)`. `Bonus Tracker`'s
`C` column ("Uncapped Points") echoes the Slack Link (column I) as the value that makes an
uncapped-type row distinct from another. The two "capped" EH entries on the reported tracker —
for both Little John and NoSadClown — turned out to share the **identical Slack link** per set.
`UNIQUE()` correctly collapsed those into one counted row. That's not a weekly cap; it's the
sheet correctly declining to double-count what looks like the same evidence submitted twice. A
genuinely distinct EH entry (a different Slack link) is never capped, on either side.

**Decision (Stuart, 2026-08-04):** the sheet is correct as-is. `BonusTypes.js`'s
`weeklyCap: false` needs no change. Not a priority to alter the dedup behaviour itself.

**What is real, and deferred:** the PAX gets no visible signal when a reused link doesn't add to
their score — the same class of gap the F3Go30-833s.16 "does not count" notice covers for
weekly-capped types, just not triggered here. Filed as low-priority hardening, not urgent:
`F3Go30-6faz.1` (Validate Slack Link uniqueness on Bonus Tracker submission), under a new
`F3Go30-6faz` (Data-integrity hardening) epic.

No code change shipped; no deploy was required. `F3Go30-fkox` closed as not-a-bug with the full
trace in its comment.

---

## DR-04 — GAS-page removal is decided; the execution bead covers only `SignupApp.html`

**Severity:** P1 · **Type:** backlog gap · **Tracking:** F3Go30-wjpu

### Observation

The posture is **already settled and does not need re-deciding.** F3Go30-90l5 (closed
2026-07-20) records the human decision that the GAS-rendered UI is scheduled for removal, with
a deliberate soak trigger; ADR-019 then generalises the posture to every PAX-facing front end:
"No PAX-facing flow is entitled to a working GAS-rendered page as a fallback. Rendering it
after this decision is a matter of not deleting the capability outright, not of a live
requirement to keep it correct."

The gap is narrower than the posture. Both 90l5's decision text and `F3Go30-wjpu`'s SCOPE are
written **`SignupApp.html`-only** — they predate ADR-019, which extended the same reasoning to
check-in and home. ADR-019's own Consequences section names only `F3Go30-wjpu`. So the larger
duplicate has no execution bead:

| File | Lines | Removal tracked |
|------|-------|-----------------|
| `script/SignupApp.html` | 603 | F3Go30-wjpu |
| `script/CheckinApp.html` | 2,332 | — |
| `script/IdentityCore.html` | 109 | — |

### Impact — the cost of the soak period, measured

75 of the 76 functions in `CheckinApp.html` also exist in `static-pages/src/index.html`
(~2,300 duplicated lines of PAX-facing logic). Every check-in, dashboard, bonus, or calendar
change is made twice until the trigger fires.

This review found a **live instance of the resulting drift in the working tree**: the
rolling-average chart fix at `static-pages/src/index.html:2583` (minimum bar height, line
colour) was not applied to the byte-identical `buildAvgChartSvg_` at `CheckinApp.html:1575`.

The existing mitigation — `test/test_client_streak_display.js` asserting the same behaviour
against *both* files — is the right instinct but covers one function of seventy-five.

### Recommended solution

Three changes, all small; none reopens the decision.

1. **Extend `F3Go30-wjpu`'s SCOPE** to `CheckinApp.html` + `IdentityCore.html` under the same
   already-stated trigger, or file a sibling bead depending on the same trigger. Prefer
   extending: the two removals share prerequisites, share the keep-the-route constraint, and
   splitting them invites the check-in half being forgotten again.
2. **State the trigger as a date.** "One full tracker month of static use after .10/.11 reach
   PROD" is unambiguous but requires reconstruction to evaluate. ADR-019 was accepted
   2026-07-20; recording a concrete review date (≈ 2026-09-01, after August closes as the first
   full static month) makes the trigger checkable at a glance.
3. **Do not deepen investment in the duplicated surface until then.** Already the standing
   guidance from 90l5 ("fallback coverage is a HOLDING ACTION"); DR-07 and DR-10 are direct
   applications of it.

**Tradeoff of removal:** `?static=0` stops being able to render anything, so the developer
escape hatch ADR-019 preserved becomes route-only. Acceptable — ADR-019 already states it is
not a PAX-facing guarantee — but it should be named in the removal bead rather than discovered
afterwards.

### Resolution (2026-08-04)

**Full removal executed same day**, on explicit human instruction to skip the remaining soak
period rather than apply the recommended "extend scope, keep waiting" sequence — the posture was
never in question, only the timing, and the duplicated-surface cost (measured above) was judged
to outweigh the value of waiting out `F3Go30-wjpu`'s trigger date.

- `script/SignupApp.html`, `script/CheckinApp.html`, and `script/IdentityCore.html` deleted
  outright (2,332 + 603 + 109 = 3,044 lines removed).
- `WebApp.js`/`dashboardWebapp.js`: `renderSignupPage_`/`renderCheckinPage_` now redirect to the
  static front end unconditionally (no more `?static=0` bypass, no more template-rendering
  fallback); a new minimal `renderStaticUnavailable_` covers the one remaining edge (static host
  unconfigured — practically Node-test-only). `buildCheckinPageOutput_`,
  `renderCheckinPageForTypedIdentify_`, and the `formIdentify=1` doPost branch (the removed
  page's real-form-POST sandbox-escape mechanic) are gone with them. The now-orphaned
  `getCachedCheckinSessionTitle_`/`cacheCheckinSessionTitle_` title-cache mechanism
  (`CheckinSessions.js`) — which existed solely to give the removed template a personalized
  `<title>` without a sheet open — was removed too rather than left as dead weight.
  `?cmd=signup`/`?cmd=checkin`/`?cmd=admin` `doPost` (the static front end's own JSON API
  backend) is unchanged, per F3Go30-wjpu's own scope note.
- **ADR-021** supersedes ADR-019's `?static=0`-escape-hatch claim (the only claim affected;
  ADR-019's core "static origin primary, GAS redirect-only" decision stands). `docs/DESIGN.md`
  (module table + the two decision-history bullets that described the interim state),
  `docs/OPERATIONS.md` (`?static=0` section rewritten to describe the removal), and
  `docs/pwa-design.md` (non-goals, architecture diagram, §7 decision journal) updated to stop
  describing removed capability as live. `docs/CHANGELOG.md` was deliberately **not** touched —
  by its own stated inclusion rule ("a PAX or Site-Q would notice and care"), this change has no
  PAX-visible symptom: old bookmarks already redirected before today, only the fallback render
  path and its opt-out are gone.
- **Tests:** `test/test_checkin_title_cache.js`, `test/test_ns_client_roundtrip.js`,
  `test/test_context_date_client_roundtrip.js`, and `test/test_checkin_token_inline_identify.js`
  retired outright — each asserted only against the removed GAS templates or a doGet
  optimization (server-side identify-token pre-resolution) that had nothing left to bake into;
  their coverage was already subsumed by `test_static_page_client_invariants.js` (client-side,
  static-only) and `test_signup_link_migration.js` (server-side redirect preserves every param).
  `test_signup_link_migration.js`, `test_checkin_monthcache_invalidation.js`,
  `test_static_page_client_invariants.js`, `test_bonus_save_notice.js`, and
  `test_client_streak_display.js` updated to drop GAS-template assertions and, where the same
  behavior lives on in the static page, repointed at it instead. `test_checkin_sessions.js`
  dropped the now-dead title-cache assertions and its supporting fake-cache scaffolding.
  `tests/playwright/identity-token-flow.spec.js` retired outright — both its describes drove
  GAS-hosted iframe UI end to end via a `&static=0` escape that no longer exists, and its real
  coverage (bookmarkable token, "not you" reset, known-but-unregistered handoff, next-month
  no-token behavior) was already independently duplicated by `static-checkin.spec.js` and
  `static-signup.spec.js` against the static front end. `static-checkin.spec.js`'s own
  "Existing GAS HtmlService check-in page still works unchanged" describe (which also depended
  on `&static=0`) was removed for the same reason. `checkin-advanced-grid.spec.js` and
  `demo-screenshots.spec.js` needed only header-comment corrections — both already drove the
  static front end exclusively. `tools/sync-how-it-works.js` (invoked on every clasp push) no
  longer syncs into the two removed files. All 44 `npm test` suites pass.
- **Accepted coverage gap:** the static page's own "Not you?" reset link has no dedicated
  Playwright test (identity-token-flow.spec.js's version existed specifically because the GAS
  cross-origin/sandboxed-iframe hand-off was fragile; the static page's equivalent is a
  same-document, same-origin click with no comparable fragility) — judged low-risk enough not to
  block this removal on a new spec.
- **Live-verified in SIT**, 2026-08-04: `npm run deploy:sit` succeeded (cache invalidation +
  static-pages publish both completed cleanly). Full namespace smoke test
  (`node tools/smokeTestNamespace.js --env sit --template sit`) run end to end against a
  disposable namespace — signup → check-in write-through → dashboard render → bonus add/list →
  cross-month bonus relocation → teardown — with no errors on the successful attempt, confirming
  the `?cmd=signup`/`?cmd=checkin` redirect-only `doGet` routes and their unchanged `doPost` JSON
  API both work against the deployed code. Three attempts were needed to get there, none pointing
  at this change's own code path: the 1st timed out client-side mid-provisioning; the 2nd
  surfaced the server-side cause — 15 orphaned `onEdit` triggers, accumulated from earlier smoke
  runs, tripping Apps Script's per-project trigger quota — cleared via the existing
  `deleteOrphanedTriggers` admin action; the 3rd hung client-side again during provisioning even
  though the namespace had in fact registered successfully server-side (confirmed via a direct
  `getSheet` read on `NamespaceDB`) — a slow-response/propagation characteristic of the
  Drive-copy-heavy `copyTemplate` action, not a regression. The 4th attempt completed cleanly
  start to finish. Also separately verified: an old `?cmd=signup`/`?cmd=checkin` GAS-origin
  request still redirects to the static front end with `id`/`ns`/`contextDate`/`targetMonth`/
  `autoStart` intact (unit-tested in `test_signup_link_migration.js`, confirmed live via direct
  `curl` requests against the SIT deployment, params round-tripping into the rendered
  `renderStaticRedirect_` interstitial's `Continue` link exactly as built).
- **Full live-browser Playwright pass against the SIT deployment**, same day: `static-checkin.spec.js`
  (16/17 — the one failure is a pre-existing route-mock/reload timing flake in the update-banner
  test, unrelated to this change), `static-signup.spec.js` (3/3), `checkin-advanced-grid.spec.js`
  (17/17), `demo-screenshots.spec.js` (4/4, including the redirect-banner test that exercises this
  change's `renderStaticRedirect_` path directly). 40/41 individual tests green across every
  remaining spec that drives the deployed webapp. Two of these runs needed a retry after an
  initial batch hit the same GAS-deployment-propagation slowness noted above (a "Checking…"
  spinner that never resolved / an outright "unable to open the file" response) — both cleared on
  retry a few minutes later, consistent with propagation rather than a code defect.
  `tests/playwright/identity-token-flow.spec.js` (retired) and the removed
  `static-checkin.spec.js` GAS-regression describe were not run, since neither exists anymore.
- `F3Go30-wjpu` closed; `F3Go30-zcxc` (DR-10) closed obsolete as a direct consequence — see that
  finding's own resolution below.

---

## DR-05 — Non-JSON GAS responses surface as a raw JSON parser message

**Severity:** P2 · **Type:** defect · **Area:** `dashboardWebapp.js`, `static-pages/src/index.html`

### Observation

`GasLogger.run` logs and **rethrows** (`script/GasLogger.js:296-303`). Any exception escaping a
handler's own try/catch therefore escapes `doPost`, and Apps Script answers with an HTML error
page under an HTTP 200.

In `handleCheckinPost_` (`dashboardWebapp.js:599-607`), two calls sit **outside** the try:
`JSON.parse(e.postData.contents)` (guarded separately) and
`resolveTemplateSpreadsheet_(e, payload)` (not guarded — it opens the bound spreadsheet and
reads `NamespaceDB`, either of which can throw on quota or transient Drive failure).

Client-side, `callApi` (`static-pages/src/index.html:1066-1071`) calls `res.json()` on a 200.
On HTML that throws a `SyntaxError`, which is not flagged `isTransport`, so it bypasses the
F3Go30-313u retry path and lands in the server-error banner verbatim — a PAX sees
`Unexpected token '<' ... is not valid JSON`.

This failure mode is already acknowledged elsewhere in the working tree: the uncommitted
`tools/callWebapp.js` change adds exactly this guard for the CLI, for exactly this reason
(deployment-propagation race returning the static-redirect interstitial). The PAX-facing client
has no equivalent.

### Recommended solution

Two independent fixes; do both.

- **Server:** move `resolveTemplateSpreadsheet_` inside `handleCheckinPost_`'s try so an ns
  resolution failure returns `{ok:false, error:'server_error'}` like every other failure.
  Apply the same check to `handleSignupPost_`.
- **Client:** in `callApi`, replace `res.json()` with a text-then-parse that converts a parse
  failure into a transport-class error — same class the F3Go30-313u work already defined, so it
  gets the friendly banner and, for whitelisted read actions, the single bounded retry. That is
  the correct classification: a body that isn't JSON means the request never reached its
  handler.

Per DR-04, apply the client fix to `static-pages/src/index.html` only, not to
`IdentityCore.html` (see DR-10).

**Note (2026-08-04):** DR-04's full removal (not the originally-recommended scoped extension)
deletes `IdentityCore.html` outright, so this caveat is now moot rather than merely
unnecessary — there is no second copy left to apply the client fix to. DR-05 itself remains
open (not addressed by this pass) and now targets `static-pages/src/index.html` only, with no
second-file caveat to track.

---

## DR-06 — Scoring logic is triplicated

**Severity:** P2 · **Type:** maintainability

`computeStreak_`, `computeMaxStreak_`, `buildDaySegments_`, `buildRollingAverage_`,
`countOutcomes_`, and `firstActiveDayIndex_` exist in `dashboardWebapp.js` **and** as `*Local_`
twins in both `CheckinApp.html` and `static-pages/src/index.html` — three implementations of
the rules that decide what a PAX's score is.

**Recommended solution:** DR-04 removes one third of it on the existing schedule; no separate
action needed there. What remains after that is a genuine server/client split, inherent to
rendering optimistically before the server answers — not duplication to be eliminated. It
should be made explicit rather than left implicit:

- state in `docs/DESIGN.md` that the client twins are a deliberate optimistic-rendering mirror
  with the server authoritative;
- drive both from one shared table of test vectors, so a divergence fails a test rather than
  reaching a PAX. `test/test_client_streak_display.js` already establishes the both-files
  assertion pattern — generalise it to the full set of six rather than adding per-function
  copies.

### Resolution (2026-08-04)

DR-04's removal of `CheckinApp.html` lands the "one third removed" half of this recommendation:
the triplication is now a **duplication** (server + one client, not two), which is what this
finding itself called "a genuine server/client split, inherent to rendering optimistically
before the server answers — not duplication to be eliminated." `test/test_client_streak_display.js`
was updated in the same pass to drop the now-removed `CheckinApp.html` half of its both-files
loop (it now asserts against `static-pages/src/index.html` alone). The remaining
recommendation — stating the deliberate-mirror relationship explicitly in `docs/DESIGN.md` and
generalizing the test-vector table to the full set of six functions — is **not** addressed by
this pass; it stays open as a smaller, single-client-facing version of the original finding.

---

## DR-07 — Uncommitted chart change hardcodes a non-theme-aware colour

**Severity:** P2 · **Type:** defect (uncommitted) · **Area:** `static-pages/src/index.html`

The working-tree diff changes the rolling-average line and its point markers from `#2f5d50` —
the value of the `--brand` custom property — to `#2fe0e0`, a bright cyan matching no token in
either palette. The page defines a complete light/dark system via custom properties
(`static-pages/src/index.html:20-100`), which the SVG builders bypass entirely: `SEGMENT_COLORS_`
(line 2485) and the axis labels (`#888`) are also hardcoded.

Against the light theme's `#f8f4ea` background, `#2fe0e0` will read as neon and is unlikely to
meet contrast expectations for a data line.

The `MIN_BAR_HT_` change in the same hunk is sound and well-commented — a zero-height bar at the
midline for `missed` (v=0) was genuinely invisible.

**Recommended solution:** define a themed pair (`--chart-line` light/dark) and read it via
`getComputedStyle(document.documentElement).getPropertyValue(...)` at render time, as the rest
of the page's theming does. Extend to `SEGMENT_COLORS_` and the axis labels while in the file —
they have the same defect and the same fix. Run `/accessibility-audit` before committing.

Per DR-04, do not mirror this into `CheckinApp.html`.

---

## DR-08 — Hand-repeated module-shim boilerplate

**Severity:** P2 · **Type:** maintainability

Apps Script has no module system, so every file that must be `require`-able from Node tests
carries the shim:

```js
var X_dw_ = (mod && mod.exports) ? require('./mod.js').X : (typeof globalThis !== 'undefined' && globalThis.X);
```

65 occurrences across 15 files; `dashboardWebapp.js:17-191` is ~60 of them — 175 lines before
the first line of logic. The pattern is correct; the repetition is the cost.

**Recommended solution:** one helper, e.g.
`gasRequire_('PaxCache', ['getPaxCacheRow_', 'setPaxCacheRow_', …])` returning a bound object,
collapsing each file's preamble to one call per dependency. Low risk (mechanical, fully covered
by the existing suite), but touches every module — schedule it deliberately, not opportunistically
inside a feature change.

Separately, `dashboardWebapp.js` at 2,819 lines carries four responsibilities: page render,
check-in, dashboard assembly, and bonus orchestration. Extracting the bonus orchestration is the
cleanest seam (`bonusWebapp.js` already exists to receive it). Not urgent, but it is the
most-edited file in the repo.

---

## DR-09 — Transient handoff artifacts at repo root

**Severity:** P3 · **Type:** documentation hygiene

`4jmo.md`, `OPEN.md`, `fix-this-stuff.txt`, `NAGMAILBUG.md`, `beads-server-issue.md`,
`DOCKER-CONCEPT.md`, `DOCKER-CONCEPT-V2.md`, `debug.log` — session handoff notes and scratch
investigations, some untracked, dating from June onward. `CLAUDE.md`'s Document Map has no slot
for any of them, and their content is either superseded by beads or belongs under `docs/`.

**Recommended solution:** per file — delete (superseded by a bead), move to `docs/` (still
useful reference; `DOCKER-CONCEPT-V2.md` is a real design artifact), or add to `.gitignore`
(`debug.log`). Then run `/document-structure-audit` to confirm nothing else is orphaned.

---

## DR-10 — `F3Go30-zcxc` should close as obsolete

**Severity:** P3 · **Type:** backlog hygiene · **Tracking:** F3Go30-zcxc

`IdentityCore.html`'s `callApi` lacks the timeout/retry hardening F3Go30-313u gave the static
copy. The bead itself already anticipates this: *"P3 because these GAS-hosted pages are the
demoted fallback on a sunset path. If that sunset lands first, close this as obsolete."*

Under DR-04, `IdentityCore.html` is inside the removal scope. Fixing it means hand-copying
transport logic into a file scheduled for deletion — precisely what 90l5's "holding action"
guidance says not to do.

**Recommended solution:** add the dependency on the extended `F3Go30-wjpu` and close as
obsolete when that lands. If the removal trigger slips past 2026-10-01, revisit.

### Resolution (2026-08-04) — CLOSED obsolete

`F3Go30-wjpu` landed same-day (DR-04), taking `IdentityCore.html` — the file this bead would
have hardened — with it. `F3Go30-zcxc` closed obsolete with a note pointing back to DR-04/ADR-021;
no transport-logic hand-copy was ever written into the removed file.

---

## What is working well

Recorded because a review that lists only defects misrepresents the system.

- **ADR discipline is genuinely strong.** 19 records, supersession chains intact and correctly
  scoped (ADR-019 supersedes exactly one claim of ADR-018 and says so), rejected alternatives
  documented with the evidence that killed them. ADR-019's account of why the scripted
  `window.top.location.replace` could never have worked is a model of the form.
- **Cache correctness reasoning is unusually rigorous.** The write-through/onEdit two-mechanism
  model (ADR-016), the nine-cache table in `DESIGN.md`, and the "derive after the write, never
  from the pre-write snapshot" rule — with both observed failures (F3Go30-xg8f, F3Go30-s1a5)
  named at the call site — are better than this class of system usually gets.
- **The test suite is load-bearing, not decorative.** 47 suites; pure functions extracted
  specifically to be testable without spreadsheet fixtures
  (`validateCheckinSubmitDayValue_`, `buildRollingAverage_`, `firstActiveDayIndex_`).
- **Secret handling is correct.** Admin secret in the POST body only, never the query string;
  `buildWebAppRequestLog_` explicitly excludes `postData.contents` with the reason stated inline.
- **Deliberate non-extraction is documented.** `showApiError_` was left page-specific with a
  line-by-line justification. Knowing when *not* to deduplicate is the harder half of the
  standard.

---

## Recommended sequence

1. ~~DR-01~~ — scoped history key. RESOLVED 2026-08-04.
2. ~~DR-03~~ — resolved not-a-bug on investigation; no change needed.
3. ~~DR-02~~ — superseding ADR recording D4 as deferred (option b). RESOLVED 2026-08-04 — ADR-020.
4. ~~DR-04~~ — RESOLVED 2026-08-04, executed as full removal (not the scoped extension this
   sequence originally recommended) — ADR-021. ~~DR-10~~ closed obsolete as a direct consequence.
5. **DR-05** — server guard and client parse classification. Still open; now targets
   `static-pages/src/index.html` only (no `IdentityCore.html` second copy to also fix).
6. **DR-07** — themed chart colours before committing the working tree. Still open.
7. **DR-09** — hygiene, any time. Still open.
8. **DR-06** (partially resolved — triplication is now duplication), **DR-08** — the surface
   DR-04 was expected to shrink before these landed is now smaller; both still open.
