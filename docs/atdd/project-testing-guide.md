# Project Testing Guide — F3Go30

Project-specific realization of the universal ATDD principles. Declares only project facts;
every "why" lives in the referenced documents.

**Adoption status.** Installed 2026-09-06 by `$DEVSTANDARD/test-framework/test-bootstrap.md`
Phase 2 (Use Case 1 — Adopt) as a first-pass scaffold, then completed 2026-09-06 by EPIC
`F3Go30-emwk`'s 7 staged beads (all closed) — no placeholder below is still open. The staged plan
that filled them and the Phase 1.5 decisions behind it (17 rows, all approved 2026-09-06) are
retired per `staged-plan` Mode C now that every stage reads complete; `bd show F3Go30-emwk`
(closed) carries the surviving stage roll-up. `docs/atdd/harness-design.md` §9a still names the
bead that closed each row. Nothing in this document changed a test.

**Placement is unmanaged.** `docs/framework/doc-standard.md` carries no placement rule for
testing artifacts, so this file sits at the reference implementation's location, `docs/atdd/`,
verbatim (`test-bootstrap.md` Phase 2 step 2 fallback; plan row 17). Recorded again in the
harness design so the fact is discoverable from either document.

## 0. References (do not restate)

| Document | Owns |
|----------|------|
| `$DEVSTANDARD/test-framework/sdlc-testing-principles.md` | Universal testing principles `T1`–`T25`. |
| `$DEVSTANDARD/test-framework/sdlc-implementation-principles.md` | Universal implementation/lifecycle principles `I1`–`I12`. |
| `$DEVSTANDARD/test-framework/harness-standards.md` | Normative harness conventions `H1`–`H13`. **This project's values, conformance states and waivers live in `docs/atdd/harness-design.md` §9a — not here.** |
| `$DEVSTANDARD/test-framework/test-file-structure.md` | Spec-file conventions applied at spec-file-write time. |
| `$DEVSTANDARD/knowledge-base/adr/ADR-0011.md` | The unit of test obligation is the AC; the five-row disposition ordering; escalation carries a stated reason. |
| `$DEVSTANDARD/knowledge-base/adr/ADR-0012.md` | Establishes the harness-standards layer and its boundary rule. |
| `~/.claude/skills/bd/SKILL.md` §"Disposition on `[TST]` Issues" | The tracker shape a disposition is recorded in — see §9. |
| `~/.claude/skills/implementation-gate/SKILL.md` | The operational pre-implementation gate. |

**Layer rule (`ADR-0012`).** A statement that holds regardless of harness or runner belongs to
`T`/`I`; one that constrains how a harness is built, invoked or reports belongs to `H`; only what
*this project chose* belongs here. This guide may not weaken an `H` standard — it records
conformance, or a waiver under `H5`, and it does so in the harness design's §9a.

## 1. Project identity

- **Project:** F3Go30
- **Platform / language stack:** Google Apps Script (V8) backend (`script/*.js`) driving a
  Google Sheet per monthly tracker plus a Template spreadsheet and its linked Google Form; a
  static PWA front end (`static-pages/src/index.html`, built by `tools/build-static-pages.js`,
  hosted on GitHub Pages) is the only check-in/signup client. Two deployment environments,
  SIT and PROD (project `CLAUDE.md` §Deployment Environments). Logs go to Axiom.
- **Test runner / harness:** three surfaces, no unifying harness package exists.
  - `test/test_*.js` — glob-discovered by `node --test` (never hand-count them; the count moves
    with the glob), using `node:assert/strict`. Two granularities coexist, deliberately:
    - **Per-case (`describe`/`it` from `node:test`) — the convention for any file you touch.**
      Each case is its own execution, so a failure names the behaviour and the `H6`/`H7`/`H8`
      denominators count cases rather than files.
    - **Whole-file** (bare script, top-level assertions) — the original shape, still valid. Files
      migrate to per-case **on touch**, not in one sweep (`F3Go30-emwk.14`); an untouched
      whole-file test is not a defect.
  - GAS globals come from **`test/helpers/gasEnv.js`** (`F3Go30-taag`) — composable fakes for
    `PropertiesService`, `CacheService`, `GasLogger`, `LockService` and `SpreadsheetApp`'s `Ui`,
    either used directly (`makeFakeProperties_()`) or installed as a set (`installGasEnv_({...})`).
    Do not hand-roll a new copy of one of those: extend the helper. Per-test sheet/spreadsheet
    mocks stay local to their file — their shapes are genuinely different per test, which is why
    the helper deliberately does not offer a generic one.
  - `tests/playwright/*.spec.js` (11 specs) — Playwright/Chromium; 10 cross a live boundary.
  - `test/test_gas_logger_axiom.py` (1) — Python, queries the live Axiom service.
  - `test/test_axiom_store.py`, `test/test_activity_health.py` (2) — Python (`uv1` venv + `duckdb`),
    network-free; the local Axiom store and the `--health` report. Run directly; not in the node glob.
- **Platform execution ceiling (if any):** Apps Script enforces a 6-minute ceiling per
  `doPost`/trigger invocation; a `UrlFetchApp` round trip from a test is bounded by it. The
  per-test duration ceiling this project enforces against that is `H4` — declared 2026-09-06
  (`F3Go30-emwk.10`): 60 s for a boundary-crossing tier, 30 s otherwise, one constant
  (`tests/harness/outcomes.js` `DURATION_CEILING_MS`) read by `playwright.config.js` and
  `tools/test-outcome-report.js`; see `docs/atdd/harness-design.md` §9a for the current waiver
  list and what has and has not been measured against it.

## 2. Stack-specific test conventions

Realizes `T2`, `T4`, `T10`.

- **Focused-AC test naming convention:** `test/test_<behaviour-slug>.js`, one file per behaviour
  (e.g. `test_checkin_snapshot_day_boundary.js`, `test_signup_reuse.js`). Measured conformant to
  `H11`: **no** filename or function name in the repo encodes a tracker id (diagnostics
  2026-09-06, `--ticket-pattern "F3Go30-[a-z0-9]+"`, 0 hits). The bead id lives in the file's
  header comment, which is where `H11` wants it. **`describe`/`it` titles are test names for
  `H11` purposes** — a per-case migration must not carry a bead id into a title (one did, and was
  removed, during `F3Go30-emwk.14`'s first cohort); it goes in the header comment like every
  other bead reference.
- **Scenario/journey naming convention:** `tests/playwright/<surface-or-behaviour>.spec.js`.
  The `-live-check` suffix **is not load-bearing and must not be treated as a tier marker** —
  discovery measured it wrong for 5 of 11 specs (see §6 and plan escalation E3). It is
  decoration; the tier comes from the declared marker (`tests/playwright/tiers.js`,
  `F3Go30-emwk.2`).
- **Outcome-classification convention (`F3Go30-emwk.6`):** a test never decides why it failed. No
  spec or node test may `catch`/`try` in order to label a failure as infrastructure — the one
  owning helper is `classifyExecution()` in `tests/harness/outcomes.js`, and a newly seen
  infrastructure failure is fixed by adding a row to its `BOUNDARY_SIGNATURES`, never by a
  per-test escape clause. Retry counts are likewise off-limits to a spec: `RETRY_POLICY` in the
  same module is the only place a retry number exists, and only the live tier may carry one.
  (The node suite is 57 files as of this bead — `test/test_outcome_classifier.js` covers that
  helper; the count of 56 elsewhere in this document is the 2026-09-06 adoption-time measurement.)
- **AC-traceability mechanism:** the AC registry, `test/contract/acRegistry.js` (`F3Go30-emwk.7`,
  2026-09-06) — see §2a. It enumerates the obligations; **per-test tagging and the gap-diff that
  consumes it are `F3Go30-emwk.12`** (deferred, no stage). Membership in the registry therefore
  says what must hold, never that something covers it — do not read coverage out of it yet.
- **AC id format:** `<domain> <behaviour-slug>`, lowercase, one space between the halves, hyphens
  inside each half — `checkin snapshot-day-boundary`, `signup identify-requires-name-and-email`.
  An id is behavioural; the bead lives in the *description*, never in the id, which is what keeps
  `H11` true when ids reach a filename or a report column.
  `assertNoTrackerIdsInAcIds()` in that module enforces it mechanically and
  `test/test_ac_registry.js` runs it in the network-free tier — it is not a convention anyone has
  to remember.
- **Triage-tag format in assertion messages:** `‹placeholder — none declared›`. Node tests pass
  a free-text message to `assert`; Playwright specs use the default expect message. The tag format
  is deliberately still open: it is decided with the emission mechanism (`F3Go30-emwk.12`), since
  a tag with nothing reading it is decoration.
- **BDD convention (if used):** not used. The 60 node files are straight-line scripts;
  `node --test` at file granularity (`F3Go30-emwk.1`) treats each file as one test. The
  `describe`/`it` migration that would make Given/When/Then expressible is explicitly **not**
  part of this adoption — it is a separate, unstaged bead pulled in only when `H4`'s per-test
  ceiling needs sub-file granularity (plan escalation E2).

## 2a. Traceability report

Realizes `T24`.

- **Report format and emission point:** JUnit XML, emitted by both runners (`F3Go30-emwk.4`,
  landed 2026-09-06). `pnpm test` runs `node --test --test-reporter=junit
  --test-reporter-destination=test-results/node-junit.xml` (plus a `spec` reporter to stdout for
  human reading) — `test-results/node-junit.xml`. `playwright.config.js`'s `reporter` array adds a
  `junit` entry writing `test-results/playwright-junit.xml` for whichever project(s) are run.
  `playwright.config.js` sets `outputDir: 'test-results/playwright-artifacts'` deliberately —
  Playwright wipes its `outputDir` at the start of every run, and pointing it at `test-results/`
  itself would delete the node tier's JUnit output that lives in the same folder. Verified against
  a real run: `test-suite-diagnostics.py --junit test-results/node-junit.xml --junit
  test-results/playwright-junit.xml` reports duration concentration, duration budget and failure
  rate as measured values, not `unknown`.
- **Metadata → report-field mapping:** JUnit carries no AC property yet — emission is
  `F3Go30-emwk.12`. What exists today is the *denominator* half: the diagnostics tool reads the
  registry directly, so `ac_ratio` is computed against a real enumeration instead of `unknown`.
  ```
  python $DEVSTANDARD/tools/test-suite-diagnostics.py --root . \
    --junit test-results/node-junit.xml --junit test-results/playwright-junit.xml \
    --ac-list-cmd "node test/contract/acRegistry.js"
  ```
- **Authoritative coverage registry:** `test/contract/acRegistry.js` (`F3Go30-emwk.7`,
  2026-09-06) — **85** acceptance criteria as `AC_REGISTRY` (`{id: description}`, ids behavioural,
  never a bead id), plus a sibling `AC_SELFTEST_FIXTURES` (7 entries) holding the harness's own
  self-test tags. Nothing that computes coverage reads `AC_SELFTEST_FIXTURES`, and `listAcIds()`
  deliberately excludes it: in the reference implementation those tags once lived inside
  `AC_REGISTRY` and inflated the denominator by 27% — 37 nominal ACs against 27 real ones, every
  one of them permanently reported uncovered because no product test ever tags a harness fixture.
  Sourced from the two places obligations actually exist today: the journey charter (§6) and the
  behaviour each `test/test_*.js` file was written to hold. `test/contract/` is also the home of
  the entry-point registry (§7) and of `journeyCharter.js` (`F3Go30-emwk.9`), which joins the two —
  naming, per journey, the AC ids it drains and the entry points it drives. Together they make
  `test/contract/` this project's single contract-shape home for test purposes.
- **Gap-diff step:** **deferred, no stage** (`F3Go30-emwk.12`) — `T24`'s reference implementation is
  not fully ratified upstream and the `T17` half is unbuilt there. Filed as a bead without a
  stage rather than scheduled.

**Deviation from the reference implementation, recorded deliberately** (plan escalation E1):
GActionSheet co-locates its AC registry with a machine-readable contract module
(`scn/contract.py`, generated from `ContractSchema.json`). F3Go30 has no such module — its
contract is prose in `docs/pax-data-model-and-contract.md` — so the registry gets a new home
rather than a contract module to live in. If a contract module is ever extracted, the registry
moves to it.

## 3. Observation surfaces

Realizes `T5`, `T11`.

| Surface | How read | Cost | Observable at integrity checkpoint? |
|---------|----------|------|-------------------------------------|
| Tracker spreadsheet (monthly) | `node tools/callWebapp.js getSheet` (admin route); Sheets UI for a human edit | live; a webapp round trip | yes |
| `TrackerDB` / `PaxDB` / `NamespaceDB` / `Config` (Template-resident) | same admin routes (`getSheet`, `getConfigValue`) | live | yes |
| `PaxCache` (`PropertiesService`) + `CacheService` | only indirectly, through a dashboard/check-in response | live | no — inferred, not read |
| Static PWA DOM | Playwright against `static-pages/src/` served locally, hitting the live `/exec` | live; bounded poll | no — drained by the spec that drives it |
| GAS execution log → Axiom | `tools/query_axiom.py` | live; lagged | no |
| Local Axiom mirror (`data/axiom/`, Parquet) | `tools/query_axiom.py --local --sql` (after `--sync`) | cheap; lags by last sync | no |
| Deployed version stamp | `node tools/callWebapp.js version --cmd version` | cheap | yes |

## 4. Fixture isolation

Realizes `T9`, `T19`.

- **Per-run fixture creation:** two mechanisms exist, and neither is used by the default suite.
  - **Namespace smoke test** — `node tools/smokeTestNamespace.js --env <env> --template <prod|sit>`
    provisions a disposable copy of the Template plus recent trackers, verifies signup/check-in/
    dashboard/bonus end to end against it, and tears itself down (ADR-014; project `CLAUDE.md`
    §Smoke mode workflow). This is the closest thing the project has to `T9` per-run isolation.
  - **Shared live fixture PAX** — most live specs instead reuse a named PAX on the shared SIT
    environment (`NoSadClown` for write paths, `Whiplash` for read-only paths), with an
    idempotent signup rather than a fresh fixture.
- **Run identity / clone naming format:** namespace-provisioned environments are named by
  `smokeTestNamespace.js`; the shared-fixture specs have **no run identity** — a second
  concurrent run of the same spec collides.
- **Shared-store accumulation:** yes, and it is unscoped. SIT's Template, its trackers, `PaxDB`
  and `Config` accumulate across every run. `T19` scoping is **not** implemented: a live spec
  reads the whole roster and asserts against it. `announcement-splash-live-check.spec.js` is the
  documented near-miss — an earlier version overwrote a live human-authored `Announce.<day>`
  Config row; it now captures the original with `getConfigValue` and restores it. That is
  per-spec discipline, not a harness guarantee.

## 5. Contract schema

Realizes `I4`, `I6`.

- **Authoritative machine-readable contract source:** **none exists.** This is a recorded
  deviation, not an omission to be quietly filled: the browser/server wire contract is prose.
- **Authoritative human-readable semantics source:** `docs/pax-data-model-and-contract.md` (§1
  the wire contract action by action, §4 implementation invariants); `docs/sheet-reference.md`
  for spreadsheet column detail; `docs/OPERATIONS.md` §API compatibility with installed clients
  for the compatibility rule a shape change must respect.
- **How tests consume the contract:** they do not. Each of the 60 node files declares the shape
  it needs inline; each Playwright spec hard-codes the fields it reads. There is no drift-fails-
  loudly path — a contract change is caught only where a test happens to restate the old shape.

| Family | Entry-point signature | Completion signal | Output schema |
|--------|-----------------------|-------------------|---------------|
| Check-in | `doPost` `cmd=checkin`, `payload.action ∈ {identify, checkin}` (`script/dashboardWebapp.js`) | JSON response | prose — `docs/pax-data-model-and-contract.md` §1 |
| Signup | `doPost` `cmd=signup`, `payload.action ∈ {identify, save, feedback}` (`script/WebApp.js`) | JSON response | prose — same |
| Admin | `doPost` `cmd=admin`, `payload.action ∈ {…}` — secret-gated, ~30 actions (`script/WebApp.js`) | JSON response | prose — project `CLAUDE.md` §Web app calls |
| Version | `doGet` `cmd=version` | `{ok, version, versionDate, target, deploymentId}` | `script/version.js` stamped constants |
| Sheet artifacts | tracker creation / edit triggers / form submit | row present in Tracker/Responses/`PaxDB` | `docs/sheet-reference.md` |

## 6. Journeys — journey charter

Realizes `T1`, `T15`, `T17`, `T21`, `T22`; satisfies `ADR-0011` §Decision 5.

**This table is the charter** — what a `[TST]` author reads to decide which journey to extend
before creating a new one, and what `test-functional` Step 1 selects a disposition against. A
journey with no "why separate" line is a merge candidate, recorded rather than merged silently.
A `disp:4` (new journey) is justified against this table or not at all.

**The table below is a view of `test/contract/journeyCharter.js`, not a second copy of it** (`I6`,
`F3Go30-emwk.9`). Every journey, entry-point key, AC id, tier and status in it is compared cell by
cell against that module by `test/test_journey_charter_view.js`, which fails loudly on a
disagreement — and just as loudly if this prose is reworded such that a row can no longer be
parsed. Regenerate the counts with `node test/contract/journeyCharter.js --counts`.

**Seeded from what exists** (`test-bootstrap.md` Phase 2 step 5), **joined to the registries at
`F3Go30-emwk.9`.** Every row is an already-built Playwright spec. The AC-ids column names keys of
`AC_REGISTRY` (§2a) and the entry-point column names keys of `ENTRY_POINT_REGISTRY` (§7) — no
placeholder remains, and both columns are checked to exist in their registry rather than read as
prose.

**What an AC id in this table means.** That this journey is the *responsible* call-site for that
obligation — not that a per-test tag proves it (emission is `F3Go30-emwk.12`, deferred). The 34 ACs
named below are a minority of the registry's 85 on purpose: most obligations are held by the
network-free `test/test_*.js` files, which are not journeys. Charter membership is not suite
coverage.

**The entry-point column is the join that makes `ENTRY_POINT_DEFERRED` computed rather than
authored.** `assertDeferralIsComputed()` requires the union of every journey's entry points to
equal the registry's covered set exactly: claiming coverage with no journey driving it, or
retiring a journey without deferring what it drove, now fails in the network-free tier.

**Tier** is the *measured* boundary crossing, from plan escalation E3 — not the filename. Two
grades of live are recorded, and deliberately **not** split into separate tiers yet: the charter
records the distinction so a later `test:prep`/auth-setup stage has something to act on.

There are **12** journeys, of which **11** are tier members and one is a purpose exclusion;
together they drain **34** of the registry's acceptance criteria and drive **14** state-modifying
entry points.

| Journey (spec) | Theme / failure domain | Entry points it is call-site for (`T17`) | AC ids drained | Why separate from each adjacent journey | Tier | Status |
|---|---|---|---|---|---|---|
| `static-signup` | Registration + goal capture through the static front end, cross-origin | `signup.identify` · `signup.save` · `signup.feedback` | `signup identify-requires-name-and-email` · `signup save-persists-goals` · `signup info-step-validates` · `signup team-suggestions-selectable` · `signup team-near-match-prompts` · `signup new-team-joins-roster` · `signup done-url-bookmarkable` · `signup next-month-checkin-link` · `signup feedback-writes-and-rejects-unmatched` | The only signup E2E coverage since DR-04 removed `SignupApp.html`; check-in journeys never create a PAX | live (webapp) | built |
| `static-checkin` | Cross-origin check-in from a genuinely different origin against the live `/exec` | `route.doPost` · `checkin.identify` · `checkin.checkin` · `checkin.bonusAdd` · `checkin.bonusEdit` · `checkin.siteFeedback` | `transport cors-boundary-holds` · `checkin identify-returns-month-state` · `checkin submit-writes-day` · `checkin write-through-overlay` · `dashboard renders-from-cache-then-revalidates` · `bonus live-add-and-edit-via-ui` · `checkin sitefeedback-live-send` | Proves the CORS boundary itself — a header/CORS regression surfaces here and nowhere else. The only journey that drives `route.doPost` as its subject rather than as transport | live (webapp) | built |
| `checkin-advanced-grid` | Whole-month check-in grid: calendar + unified selection panel | `checkin.checkin` · `checkin.clientTelemetry` | `checkin advanced-grid-selection` · `checkin month-grid-request` · `checkin submit-writes-day` · `telemetry live-upload-and-dedupe` | Multi-day selection state is a client-state failure domain the single-day journey cannot reach; it also holds the direct-API write contract (invalid day, out-of-range date, the -1 past-only rule) | live (webapp) | built |
| `checkin-concurrency-live-check` | Cross-day rapid-tap burst; global concurrency cap and the `dataset.saving` flag surviving a re-render | `checkin.checkin` | `checkin concurrency-cap-holds` · `checkin saving-label-recovers` | Concurrency is only observable under real interleaved in-flight POSTs; instruments the network without mocking it | live (webapp) | built |
| `pax-history-reload-live-check` | `PaxCache` history-window rebuild after `invalidateAllCache`; the 30 s script lock against a full roster | `admin.invalidateAllCache` · `checkin.identify` | `dashboard pax-history-window-rebuild` · `dashboard streak-from-server-history` · `paxcache invalidation-clears-related-keys` | Needs a real `SpreadsheetApp` read and a real lock — unreachable from the node suite by construction | live (webapp) | built |
| `scorecard-live-check` | Scorecard render (HIM Ladder + Top Teams) from a real multi-team roster payload | — | `scorecard renders-real-roster-shape` · `scorecard back-returns-to-origin` | Renders from cached dashboard state, so its failure domain is presentation against *real* roster shape, not an endpoint — it is the one journey that drives no state-modifying entry point at all | live (webapp) | built |
| `announcement-splash-live-check` | Announcement splash: real CSS cascade in a real browser | `admin.setConfigValue` | `announce splash-renders-above-content` | The defect class is stylesheet source order — invisible to a synthetic DOM stand-in. Mutates a live Config row and restores it (§4) | live (webapp) | built |
| `tracker-edit-trigger-live-check` | `onEdit` handler against a genuine human Sheets-UI edit | `handleTrackerEdit_` | `tracker edit-trigger-fires-on-human-edit` | `onEdit` never fires for API writes (ADR-013), so no other path can prove it | **live (authenticated Google browser session)** | built |
| `copy-and-init` | `copyAndInit()` driven through the Apps Script editor: new month tracker, short URL, notification | `copyAndInit` | `tracker create-for-explicit-month` | Tracker creation is a destructive/lifecycle domain (`T22` risk order) and is driven from the GAS editor UI — the only journey that runs a menu entry point | **live (authenticated Google browser session)** | built |
| `transport-resilience` | Transport failure handling with real `fetch`, real `AbortController`, real timers; failures injected by routing | — | `transport retries-lost-response` · `transport abort-on-timeout` | The **only** network-free spec. Deliberately cannot fail because SIT is having a bad minute — that is the failure mode it defends against | network-free | built |
| `dashboard-hedged-read-live-check` | Hedged dashboard reads (first-wins, second-wins, deadline) with a real Apps Script response held or never delivered, real `fetch`/`AbortController`, real Chromium | — | `transport hedged-slow-attempt-wins` · `transport hedged-second-attempt-wins` · `transport hedged-deadline-surfaces-error` | The only journey that lets a REAL SIT response arrive late or never. `transport-resilience` is network-free by definition (synthetic bodies, fake clock) and must not depend on SIT; `static-checkin` is a cross-origin check-in journey with no read-latency fault. Reads only (`checkin.dashboard` is read-only exempt), so it drives no state-modifying entry point | live (webapp) | built |
| `demo-screenshots` | Demo screenshot capture for `docs/Go30-Demo-Script.md` | — | — | **Not a tier member — a purpose exclusion.** It produces screenshots headed and asserts nothing a regression run needs (plan E3, following GActionSheet's `doc_export_wip` precedent). Stays runnable via `pnpm run demo:screenshots` | excluded | built |

The `test/test_*.js` files are **not** journeys and are not charter rows: they are focused,
network-free behaviour tests (`T12`), one behaviour per file. They are the network-free tier's
bulk, and they are where most of the registry's 75 ACs are actually held.
`test/test_gas_logger_axiom.py` is a single live check against Axiom, invoked by
`pnpm run test:gaslogger`.

**Merge candidates.** None. The `F3Go30-emwk.9` operator check ran the subset test over all 10
tiered journeys with their real AC ids visible: no journey's AC set is a subset of another's, so
every "why separate" line above still holds against evidence rather than against intent.
`assertNoUnrecordedMergeCandidates()` re-runs that test on every network-free run, and a future
subset pair fails it — the remedy is a `MERGE_CANDIDATES` entry carrying a bead, never a merge,
because consolidation runs under its own disposition and the `H5` resolution order.

### Per-journey invariants (`T18`)

Every journey states what system-wide invariant its checkpoints assert, or states that it asserts
none. "None" is the honest answer for all but one: this project has no checkpoint engine to assert
an invariant at (`docs/atdd/harness-design.md` §1), so a journey's assertions are about the path it
drove, not about the store as a whole.

- `pax-history-reload-live-check` — **asserts one.** After a full `invalidateAllCache`, every
  rebuilt PAX history window is bounded to its declared length and no reported streak exceeds that
  window (the spec's AC1/AC2/AC5/AC6), asserted over the whole roster rather than one fixture. This
  is the only place in the suite where a property is checked across every record rather than the
  record under test.
- `static-signup` · `static-checkin` · `checkin-advanced-grid` ·
  `checkin-concurrency-live-check` · `scorecard-live-check` ·
  `announcement-splash-live-check` · `tracker-edit-trigger-live-check` · `copy-and-init` ·
  `transport-resilience` · `dashboard-hedged-read-live-check` · `demo-screenshots` — **assert none**, explicitly. Each asserts only
  about the PAX, day, row or request it drove. The nearest thing the project has to a whole-store
  sweep is `smokeTestNamespace.js` over a provisioned namespace, which is a tool, not a journey.

## 7. Entry-point coverage matrix

Realizes `T17`; the registry itself realizes `H12`.

**The registry is `test/contract/entryPointRegistry.js`** (`F3Go30-emwk.8`, 2026-09-06). It
replaces the prose enumeration in the project `CLAUDE.md` §Web app calls — exactly the
hand-maintained list `H12` exists to remove — with `ENTRY_POINT_REGISTRY` plus
`ENTRY_POINT_DEFERRED`, GActionSheet's shape including its `DEFERRED` escape hatch, so a known,
named gap keeps the `T17` diff green **by declaration** rather than by omission. Two further maps
make judgement calls auditable instead of prose: `ENTRY_POINT_CLASSES` (which of the six call-site
classes each entry belongs to) and `ENTRY_POINT_READ_ONLY_EXEMPT` (every route, render or menu
item deliberately *not* registered, each with the reason it writes nothing).

The registry holds **49** state-modifying entry points, of which **14** carry a charter-journey
call-site today and **35** are explicitly enumerated as **deferred** (umbrella bead `F3Go30-y8j7`,
partitioned by call-site class into `.1`–`.4`; `.1` — the `cmd=checkin`/`cmd=signup` product
entry points — closed all five of its entries). Each deferral opens with `[backlog]` (a real gap
a bead converts) or `[permanent]` (driving it inside a suite run is destructive or meaningless —
a one-time secret bootstrap, a project-wide trigger teardown, a performance probe).

**The table below is a view of the registry, not a second copy of it** (`I6`). Every number in it
is computed from `ENTRY_POINT_REGISTRY` / `ENTRY_POINT_DEFERRED`, and
`test/test_entry_point_registry_view.js` fails loudly — including if this prose is reworded such
that the numbers can no longer be found — when a cell disagrees with the registry. Regenerate the
numbers with `node test/contract/entryPointRegistry.js --counts`.

| Call-site class | Entry points | Covered | Deferred | Where |
|---|---|---|---|---|
| `cmd=checkin` doPost actions | 7 | 6 | 1 | `script/dashboardWebapp.js` — six covered: `identify`, `checkin`, `bonusAdd`, `bonusEdit`, `clientTelemetry`, `siteFeedback` (F3Go30-y8j7.1); `logout` deferred (node-tested only, no charter-journey call-site yet — F3Go30-1pqo.2) |
| `cmd=signup` doPost actions | 3 | 3 | 0 | `script/WebApp.js` → `script/signupWebapp.js` — all three covered: `identify`, `save`, `feedback` (F3Go30-y8j7.1) |
| `cmd=admin` doPost actions | 25 | 2 | 23 | `script/WebApp.js` — mostly operator/test tooling; registered because it writes, deferred because it is not product surface |
| `doGet` / `doPost` routes | 1 | 1 | 0 | `script/WebApp.js` — `doPost` is the single front door (secret gate + entry log); the four `doGet` routes render or read and are exempt |
| Installable and simple triggers | 7 | 1 | 6 | `handleTrackerEdit_` covered; TeamDB edit (`handleTeamDbEdit_`), auto-generate, minus-one, nag and the two cleanup sweeps deferred |
| Sheet menu items | 6 | 1 | 5 | `script/onOpen.js` — `copyAndInit` covered; the trigger-management items are permanent exemptions |

**The covered set is now computed, not authored** (`F3Go30-emwk.9`). An entry point counts as
covered exactly when some journey in §6 names it, and `assertDeferralIsComputed()` in
`test/contract/journeyCharter.js` fails if the two sets differ in either direction. Running that
join for the first time corrected one entry: `admin.createTrackerForMonth` was carried as covered
by stage 3 on the strength of the charter's prose cell `copyAndInit / createTrackerForMonth`, but
`copy-and-init.spec.js` drives the `copyAndInit` **menu** entry through the GAS editor and never
the admin route, and no other spec calls it. It is now deferred with a reason and a bead, which is
why the covered/deferred split reads 9/34 rather than stage 3's 10/33.

**What happens to an entry point absent from the registry:** it is silently uncovered — the state
`H12` exists to remove. The registry is authored, not extracted (the scope judgement in
`docs/atdd/harness-design.md` §9b), so a new `cmd=` action or trigger added to `script/` without a
registry entry is invisible until someone notices. Mechanical extraction of the trigger and menu
classes from `script/` is the obvious next reduction and is **not** built.

## 8. AC-validation fidelity log

Realizes `T23`, `I11`. Intentionally empty — no feature in this project has invoked the Slice
fidelity tier, and `T23`/`I11` bind forward from this adoption date.

| Feature / AC | Fidelity (spec/slice/hardened) | Justification (required if slice) | Open seams to preserve |
|--------------|-------------------------------|-----------------------------------|------------------------|
| _(none yet)_ | | | |

## 9. Disposition record

Realizes `ADR-0011`. The disposition ordering itself is **not** restated here — it lives in
`ADR-0011`, and the label semantics in `bd/SKILL.md` §"Disposition on `[TST]` Issues".

- **Where a disposition is recorded:** on the `[TST]` bead — the `disp:<n>` label (the enumerated
  half, matchable) plus a `## Disposition` section in the description carrying `Target:`,
  `Basis:`, `Absorbs:`, and on escalation `Reason:`. The carrier exists (this project uses `bd`);
  at Phase 2 discovery time it was measured unused — 0 `[TST]` beads, 0 `disp:` labels. By this
  bead's own close, the tracker holds 7 `[TST]` beads (6 of them filed on 2026-09-06 itself, by
  earlier stages of this same adoption, before this mechanism existed) — see Found, below.
- **Audit command:** `node tools/audit-disposition.js` (`F3Go30-emwk.11`) mechanizes the two ad
  hoc `bd`/`jq` commands from `bd/SKILL.md` §Disposition into one script — same two checks (no
  `disp:` label; more than one `disp:` label or no `## Disposition` section), same closed-value-
  set reasoning. Ported from the reference implementation
  (`../GActionSheet/scripts/audit_disposition.py`) to Node/CommonJS to match this project's own
  `tools/*.js` conventions rather than adding a second scripting language to the audit path.
  `bd --validate` does not see the description section, so the script's own scan of it is
  required — no combination of `bd lint`/`--validate` flags substitutes.
  - `--ids ID,ID,...` audits exactly the named beads — this is what `merge-gate` Step 2.5 passes
    (the `[TST]` beads in scope for the diff under review). Date-blind by design: an id named
    explicitly is checked regardless of when it was created, because the caller already chose the
    scope.
  - `--since DATE` (default: `2026-09-06`, this project's ADR-0011 adoption date) audits every
    `[TST]` bead created on/after that date, tracker-wide — the periodic health check. It
    deliberately does not flag pre-adoption `[TST]` beads: dispositions bind forward, and closed
    `[TST]` items are not re-litigated (below).
  - Prints nothing and exits 0 on a clean scope; prints one line per violation and exits 1
    otherwise. Covered network-free by `test/test_audit_disposition.js` (12 cases, the node suite
    is now 61 files).
- **Gate that verifies it against the diff:** `merge-gate` Step 2.5 / `increment-gate` Step 3.5
  (`ADR-0011` §Decision 4). The audit script above is what Step 2.5 runs mechanically instead of
  hand-typing the `bd`/`jq` commands per invocation.
- **Which journey a disposition is decided against:** the charter in §6, whose source is
  `test/contract/journeyCharter.js` (`F3Go30-emwk.9`). A `disp:4` (new journey) is justified against
  that table's "why separate" column or it is not justified at all — and since every row now carries
  its real AC ids, "extend this journey instead" is a checkable claim rather than a guess. A new
  journey whose ACs turn out to be a subset of an existing one's fails
  `assertNoUnrecordedMergeCandidates()` in the network-free tier.
- **Binding date:** dispositions bind **forward from 2026-09-06**. Closed `[TST]` items are not
  re-litigated (`test-bootstrap.md` Phase 2 §5).

**Found — verified live 2026-09-06, real gaps, not a vacuous pass.** `node tools/audit-disposition.js`
(no args, `--since` default) surfaced 6 genuine violations: `F3Go30-jsrf` and the 5 `F3Go30-y8j7`
family beads (`F3Go30-y8j7`, `.1`–`.4`), every one filed on 2026-09-06 by earlier stages of this
same adoption (stage 3's coverage-backlog epic, stage 5's un-triaged live-spec failure) — before
this bead built the mechanism that binds them. All 6 are correctly in scope under the forward-
binding rule (created on/after 2026-09-06, not pre-adoption) and correctly flagged as `MISSING`.
Left as a tracker-state finding for a human to disposition rather than fixed here — retroactively
inventing 6 dispositions is a judgement call about each bead's actual verification obligation, not
a mechanical step this bead's AC covers. The operator check (a deliberately malformed `[TST]` bead
flagged via `--ids`; a pre-2026-09-06 bead, `F3Go30-th22.3`, confirmed absent from the `--since`
default output) passed on both sides.

**Escalation log** — every `disp:3` and `disp:4` accepted. This is where suite growth becomes a
governed quantity rather than a side effect:

| Work item | Disposition | Artifact created | Reason cheaper dispositions did not serve |
|-----------|-------------|------------------|-------------------------------------------|
| _(empty — no disposition has been recorded yet; see Found, above, for the 6 beads currently owing one)_ | | | |

---
_Filled 2026-09-06 by `test-bootstrap.md` Phase 2 (Use Case 1 — Adopt) and completed the same day
by EPIC `F3Go30-emwk`'s staged execution, against `test-framework` v1.0.0 (`ADR-0011`,
`ADR-0012`). Source: the approved plan, retired per `staged-plan` Mode C — see `bd show
F3Go30-emwk` (closed) for the surviving record; reference implementation
`../GActionSheet/docs/atdd/`._
