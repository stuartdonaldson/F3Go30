# Project Harness Design — F3Go30

Build specification for this project's test harness. Project facts already stated in
`docs/atdd/project-testing-guide.md` (surfaces §3, fixture isolation §4, contract schema §5,
journey charter §6, entry-point coverage §7, disposition record §9) are cited, not repeated.

**Adoption status.** Installed 2026-09-06 by `$DEVSTANDARD/test-framework/test-bootstrap.md`
Phase 2 (Use Case 1 — Adopt). **F3Go30 has no harness package.** There is no `scn/`-equivalent:
no scenario-author model, no expectation queue, no checkpoint drain, no surface-reader layer, no
report writer. Sections 1–8 of this template describe such a package, so they are recorded as
`not applicable — no harness package exists` rather than filled with invention. §9a (the `H1`–`H13`
conformance table) and §9b (the entry-point registry) are the sections that carry real content —
built out by EPIC `F3Go30-emwk`'s 7 staged beads, closed 2026-09-06; its staging doc is retired
per `staged-plan` Mode C, and `bd show F3Go30-emwk` (closed) carries the surviving stage roll-up.

**Placement is unmanaged.** `docs/framework/doc-standard.md` has no placement rule covering
testing artifacts, so this file sits at the reference implementation's location, `docs/atdd/`,
verbatim (`test-bootstrap.md` Phase 2 step 2 fallback; plan row 17). This is recorded, not
waived — it becomes managed when `doc-standard.md` gains a rule.

## 0. References (do not restate)

| Document | Owns |
|----------|------|
| `$DEVSTANDARD/test-framework/sdlc-testing-principles.md` | `T1`–`T25`. |
| `$DEVSTANDARD/test-framework/sdlc-implementation-principles.md` | `I1`–`I12`, esp. `I6` single-source contract ownership, `I12` one owning helper. |
| `$DEVSTANDARD/test-framework/harness-standards.md` | `H1`–`H13`. **This project's values, conformance states and waivers are recorded in §9a below; the standards themselves are never restated.** |
| `$DEVSTANDARD/knowledge-base/adr/ADR-0012.md` | Establishes the harness-standards layer and its boundary rule. |
| `docs/atdd/project-testing-guide.md` | Project surfaces (§3), fixture isolation (§4), contract schema (§5), journeys (§6), entry-point coverage (§7), disposition record (§9). |
| `bd show F3Go30-emwk` (closed) | The Phase 1.5 plan's decisions and the Pattern D staging doc's stage roll-up both retired into this EPIC's close reason (`staged-plan` Mode C, 2026-09-06) once every stage read complete — the surviving record of *what was decided* and *what ran when*. |

**Authoritative-contract rule (`I6`):** field tables are never restated here. F3Go30 has **no
machine-readable contract source** — see §10 observation 1 and testing guide §5; that absence is
the single largest structural deviation from the reference implementation.

## 1. Scope

- **Scenario-author model this harness implements:** none. There is no Act/Expect/Checkpoint
  vocabulary in this project. Tests assert directly.
- **What this spec produces today:** the `H1`–`H13` conformance record (§9a), the entry-point
  registry declaration (§9b), and the deferred contract observations (§10).
- **What this spec does not contain:** any universal principle (referenced by ID only), and any
  design for a harness package this project has not decided to build. Whether F3Go30 should grow
  one is **not** a question this adoption answers, and no plan row proposes it.

## 2. Package / module layout

`not applicable — no harness package exists`. The three test surfaces (testing guide §1) share no
code. `tests/playwright/live-check-helpers.js` and `tests/playwright/gas-editor-helpers.js` are
the only shared test modules; `test/helpers/` holds the node suite's shared fixture code (see the
third module home below). Nothing declares a build unit.

One shared harness module now exists: `tests/harness/` — `outcomes.js` (the owning outcome
classifier, the single retry policy, `F3Go30-emwk.6`, and the single duration-ceiling policy,
`F3Go30-emwk.10`) and `playwright-outcome-reporter.js` (the Playwright-side execution recorder
that feeds it). It is read by `playwright.config.js`, `tools/test-outcome-report.js` and
`test/test_outcome_classifier.js` — the one place in the project where both runners share code.

A second shared module home now exists: `test/contract/` — `acRegistry.js` (`F3Go30-emwk.7`),
`entryPointRegistry.js` (`F3Go30-emwk.8`) and `journeyCharter.js` (`F3Go30-emwk.9`, the join
between the two), together this project's single contract-shape home for test purposes. Both are plain CommonJS data modules with a `require.main` enumeration entry point,
so each is simultaneously importable by a test and runnable as a CLI (`--ac-list-cmd`,
`--counts`, `--acs`). They are guarded by `test/test_ac_registry.js`,
`test/test_entry_point_registry_view.js` and `test/test_journey_charter_view.js`, which run in the
network-free tier like any other node test — the node suite is 60 files as of this stage (F3Go30-emwk.9 added test/test_journey_charter_view.js).

A third shared module home was added by `F3Go30-taag`: `test/helpers/` — `staticPageExtract.js`
(real client code lifted out of `index.html`) and `gasEnv.js` (composable in-memory Apps Script
services: `PropertiesService`, `CacheService`, `GasLogger`, `LockService`, `SpreadsheetApp`'s
`Ui`). `gasEnv.js` is the reuse answer to the same shape being hand-copied into 22/17/13/7 files
respectively; a test either calls a factory directly or installs a set with `installGasEnv_()`,
which hands back the fakes and a `restore()`. It is fixture code, not contract data, which is why
it lives under `test/helpers/` rather than `test/contract/`.

## 3. Ownership and dependency direction

`not applicable — no harness package exists`. No assertion-ownership split exists to declare,
because there is no session/engine/assertions separation: each node file owns its own assertions,
and each Playwright spec owns its own setup and its own expectations. Stubs are the one part that
is no longer per-file: since `F3Go30-taag` the uniform GAS service fakes come from
`test/helpers/gasEnv.js`, and a file that still hand-rolls them is simply one that has not been
touched yet (migrate on touch, not in a sweep).

## 4. The domain noun object

`not applicable — no harness package exists`. There is no domain-noun object; specs pass raw
payloads and read raw JSON/DOM.

## 5. Support-function catalog signatures

`not applicable — no harness package exists`. The nearest equivalents are operator tools, not
author-facing support functions, and are documented in the project `CLAUDE.md` rather than here:
`tools/callWebapp.js` (one HTTP client for every environment/endpoint, injecting the admin secret
into the POST body only), `tools/smokeTestNamespace.js` (provision → verify → teardown),
`tools/manage-deployments.js --summary`, `tools/wait-for-static-deploy.js`, `tools/query_axiom.py`.

## 6. Surface readers

`not applicable — no harness package exists`. Surfaces are listed in testing guide §3 with how
each is read today; there is no reader layer returning noun-shaped, run-scoped records, and
therefore no `T19` identity scoping (testing guide §4 records the consequence).

## 7. Contract module

`not applicable — no contract module and no machine-readable contract source exist`. See testing
guide §5 and §10 observation 1 below. There is no drift-fails-loudly path today: a contract change
is caught only where a test happens to restate the old shape.

`test/contract/` is **not** a contract module and does not close this gap. It holds three
enumerations *about* the contract — the ACs it must satisfy (`acRegistry.js`), the entry points it
is reachable through (`entryPointRegistry.js`) and which journey is the responsible call-site for
each (`journeyCharter.js`) — not the field names, headers or column indices a contract module would
own. A wire-shape change still breaks nothing here. The directory is where
a real contract module would land if one is ever extracted, which is the reason the registries were
put in it (`F3Go30-emwk.7`, plan escalation E1).

## 8. Expectation / checkpoint engine algorithm

`not applicable — no harness package exists`. No expectation queue, no checkpoint drain, no drain
invariant, no report emission.

## 9. Engine-execution proof

`not applicable — see §8`.

## 9a. Harness-standards conformance

Realizes `ADR-0012`. One row per `H` standard: this project's value or mechanism, and the single
place it lives (`I6` — a number repeated in two files is a defect, not a convention).

**State** is one of `conformant` / `waived` / `not applicable` / `declined`, per
`$DEVSTANDARD/README.md` §Conformance States. There is no `partial`: a standard partially met is
`waived` with the unmet part named. A `waived` row carries an issue id; a `declined` row carries a
reason and a date.

**Recorded 2026-09-06 against the state on branch `scorecards`. This table is a record of current
state, not target state** — each `waived` row flips to `conformant` when the stage that closes it
lands, and each stage's closing step updates its own rows (plan §5 correction C2). Authoring it
early with honest current-state verdicts is the intended use, not a chain break.

> **Issue ids.** Every `waived` row below carries the bead that closes it, filed 2026-09-06 by
> `test-bootstrap.md` Phase 3 under EPIC `F3Go30-emwk` (closed 2026-09-06 — all 7 staged beads
> landed). The staging doc that sequenced them and the approved decisions behind each row are
> retired per `staged-plan` Mode C; `bd show F3Go30-emwk` (closed) carries the surviving stage
> roll-up. Each stage's closing step replaced its own rows' verdicts — this table is where the
> adoption's progress is actually readable.

| `H` | This project's value / mechanism | Single source (file · symbol) | State |
|-----|----------------------------------|-------------------------------|-------|
| `H1` tier gating | **Met (2026-09-06, `F3Go30-emwk.3` + `F3Go30-emwk.5`).** `pnpm run test:local` (56 node files + the one network-free Playwright spec), `pnpm run test:live` (the full declared live Playwright tier, all 9 remaining specs, no hand-picked subset + `test:gaslogger`), `pnpm run test:regression` = `test:local && test:live`, a real gate. Verified: `test:local` completes unattended with `.auth/user.json` absent (exit 0); a deliberately-broken node test fails `test:local` and `test:regression` exits 1 with **no Playwright project ever invoked** (confirmed from the run log — only the printed command line, no `Running N tests`) | `package.json` · `scripts.test:local` / `scripts.test:live` / `scripts.test:regression` | **`conformant`** |
| `H2` failure-first ordering within a tier | **Met (2026-09-06, `F3Go30-emwk.1`).** `pnpm test` now runs `node --test "test/test_*.js"` — one broken file no longer hides the other 55. Verified: same 56-file set before/after (chain vs. glob, diffed programmatically — 0 only-in-chain, 0 only-in-glob); a deliberately-broken file still runs the other 55 (55 pass / 1 fail) and the command exits non-zero | `package.json` · `scripts.test` | **`conformant`** |
| `H3` declared tier markers | **Declined (2026-09-06, `F3Go30-emwk.2`).** Two markers declared in `tests/playwright/tiers.js`: `no_live_session` and `live`, with `live` **by construction as the default** — anything not explicitly listed in `NO_LIVE_SESSION_SPECS` is classified `live`. Verified against all 11 specs: matches the plan's E3 table exactly (1 `no_live_session`, 1 purpose exclusion, 9 remaining `live`, plus `copy-and-init`/`tracker-edit-trigger-live-check` also `live` = 10 of 11 total live). The `-live-check` filename suffix is decoration only — discovery measured it **wrong for 5 of 11 specs** (`static-checkin`, `checkin-advanced-grid`, `static-signup`, `demo-screenshots`, `copy-and-init` all cross a live boundary without the suffix) | `tests/playwright/tiers.js` · testing guide §6 (the classification) | **`declined`** (2026-09-06) — per the approved E3 answer and GActionSheet's precedent: `H3` exists to stop unmarked tests leaking into the *fast* gate, and a live-by-default classification makes that leak directionally impossible — a forgotten marker can only make the live tier slower, never smuggle a live test into the fast gate |
| `H4` duration ceiling | **Met (2026-09-06, `F3Go30-emwk.10`).** `DURATION_CEILING_MS` (`{live: 60000, other: 30000}`, `H4`'s stated defaults, adopted verbatim) is the single source; `ceilingMsFor(tier)` mirrors the live-by-construction rule (`H3`) so any tier not explicitly `no_live_session`/`node` gets the 60 s room. Every run's outcome summary now prints `over ceiling (H4): N (X live > 60.0s, Y other > 30.0s)`, and each over-ceiling execution is listed individually (`OVER CEILING (H4) · tier · Ns · name`) — reported as its own category whether the execution passed or failed, never folded into `counts[PASS]`, which is the whole point (a slow pass is exactly what this exists to stop being invisible). Measured 2026-09-06: node suite (60/60, max 5.7 s total wall), the `no_live_session` Playwright project (5/5, max 25.3 s) and one live spec (`checkin-advanced-grid.spec.js`, 9 distinct tests + 2 retries, max 25.8 s) — **0 over ceiling** in every measured execution. The other 9 live specs (including 4 that already self-declare a longer `test.describe.configure({ timeout })` — `checkin-concurrency-live-check`, `scorecard-live-check` at 120 s, `static-checkin`, `static-signup` at 240 s, predating this bead) were **not measured this session** — a human should run `test:live` in full and re-check this row's evidence before treating "0 over ceiling" as true of the whole live tier, not just the slice measured here | `tests/harness/outcomes.js` · `DURATION_CEILING_MS` / `ceilingMsFor()` / `isOverCeiling()` — read by `playwright.config.js` (`no_live_session` project's `timeout`, replacing the literal `30000` that used to sit there) and by `tools/test-outcome-report.js` (classification + printing) | **`conformant`** |
| `H5` waiver protocol | The table below. **Empty, and correctly so on the evidence measured this session:** every execution measured under `H4` above (74 executions across three sources) came in under its ceiling, so no test has yet been identified as needing a waiver — the `T6` → `T12` → `T21` resolution order has nothing to be tried against. This is not the same claim as "no live test will ever need one": the 9 unmeasured live specs noted in the `H4` row are the ones to check first if a future full `test:live` run finds an over-ceiling execution, at which point the resolution order applies before any row is added below | this section | **`conformant`** |
| `H6` three outcome classes | **Met (2026-09-06, `F3Go30-emwk.6`).** `classifyExecution()` is the single owning helper (`I12`): every execution from both runners passes through it and nothing else classifies — no spec `catch`, no per-test `try`, no ad hoc match in a runner script. Three classes, `pass` / `assertion_failure` / `boundary_fault`, decided on two independent kinds of evidence: a curated `BOUNDARY_SIGNATURES` list (Apps Script error pages, Google quota/authorization errors, socket/DNS/TLS, `net::ERR_*`, navigation timeouts against a Google origin, a non-JSON body where the live contract says JSON) and a **once-per-run boundary probe** (`?cmd=version` on the tier's own deployment) that reclassifies live-tier failures when the boundary itself could not answer. A boundary fault is never converted to a pass and never suppressed — the run still exits non-zero. Verified live (see below) | `tests/harness/outcomes.js` · `classifyExecution` / `BOUNDARY_SIGNATURES` | **`conformant`** |
| `H7` harness-level retry | **Met (2026-09-06, `F3Go30-emwk.6`).** `RETRY_POLICY` in `tests/harness/outcomes.js` is the one place any retry number exists (`I6`); `playwright.config.js` calls `retriesFor(<project>)` for all three projects instead of typing a literal. Bounded (`MAX_RETRIES = 2`) and **live-tier only** — `retriesFor()` throws if a non-live tier is ever given a non-zero count, so the network-free gate cannot start hiding its own flakes. The attempt count is recorded on each result by `tests/harness/playwright-outcome-reporter.js` (Playwright is the only place `result.retry` is observable) and printed per failing execution | `tests/harness/outcomes.js` · `RETRY_POLICY` / `retriesFor()` | **`conformant`** |
| `H8` boundary-fault rate emitted | **Met (2026-09-06, `F3Go30-emwk.6`).** Every run of `pnpm test`, `test:local`, `test:live` and `test:regression` prints the outcome summary — executions, pass / assertion-failure / boundary-fault counts, **execution failure rate**, boundary share of failures, **share of wall time spent on failed executions**, retried-execution count, the probe verdict and the boundary signals that fired — followed by one line per failing execution naming its class, tier and attempt count. It prints on red runs too: `tools/test-outcome-run.js` wraps each runner, always reports, and then exits with the runner's own code untouched (a `&&`-chained report would print only on green; a `;`-chained one would swallow the exit code) | `tools/test-outcome-report.js` (reader) · `tests/harness/outcomes.js` · `summarize()` / `formatSummary()` | **`conformant`** |
| `H9` traceability carries outcome class | Not met, and **deliberately deferred with no stage**: `T24`'s reference implementation is not fully ratified upstream and the `T17` half is unbuilt there, so building the gap-diff here would be building against a moving target | `‹pending›` | `waived` — **`F3Go30-emwk.12`** (`Defer` — filed with no stage; its triggering condition is upstream ratification of `T24`) |
| `H10` AC staleness check | Registry half **landed** (2026-09-06, `F3Go30-emwk.7`): `test/contract/acRegistry.js` holds 75 behavioural AC ids as `AC_REGISTRY`, enumerable one per line (`node test/contract/acRegistry.js`) and consumed by `test-suite-diagnostics.py --ac-list-cmd`, so `ac_ratio` has a real denominator. Harness self-test tags are in the sibling `AC_SELFTEST_FIXTURES` and are read by nothing that computes coverage — the 27%-denominator mistake is designed out, and `test/test_ac_registry.js` fails if they leak back. **Still not met:** nothing emits a per-test AC tag, so no id can yet be shown stale | `test/contract/acRegistry.js` · `AC_REGISTRY` / `listAcIds()` | `waived` — **`F3Go30-emwk.12`** (emission, then the staleness check itself); the registry half is done |
| `H11` behaviour/journey-derived names | **Met.** Measured 2026-09-06 by `$DEVSTANDARD/tools/test-suite-diagnostics.py --ticket-pattern "F3Go30-[a-z0-9]+"`: **0** test filenames or function names encode a tracker id, across all 67 test files. Bead ids live in file header comments, which is where `H11` wants them. Note the invocation matters — the diagnostics' default pattern would not match this project's `F3Go30-xxxx` slugs, so a default run self-reports green vacuously | `test/`, `tests/playwright/` · the naming convention in testing guide §2 | **`conformant`** — the one genuine pass in the Phase 1 diagnostics (plan row 15) |
| `H12` entry-point registry | **Met (2026-09-06, `F3Go30-emwk.8`).** A single machine-readable registry of 49 state-modifying entry points, with 33 explicitly deferred — `test/contract/entryPointRegistry.js`, covering all six call-site classes (testing guide §7). The prose enumeration in the project `CLAUDE.md` §Web app calls is no longer the source. Every deferral carries a reason and a tracking bead (`F3Go30-y8j7`, `.1`–`.4`) and is labelled `[backlog]` or `[permanent]`, so the `T17` diff is green by declaration, not omission. Two sibling maps make the judgement calls auditable rather than prose: `ENTRY_POINT_CLASSES` and `ENTRY_POINT_READ_ONLY_EXEMPT` (16 routes/renders/menu items claimed read-only, each with its reason). Testing guide §7 is now a **view**: `test/test_entry_point_registry_view.js` compares every cell against the registry's own counts and fails if the doc drifts — or if the doc is reworded such that the numbers can no longer be found. **Extended 2026-09-06 (`F3Go30-emwk.9`):** the covered set is no longer authored. `test/contract/journeyCharter.js` names the entry points each charter journey drives, and `assertDeferralIsComputed()` requires their union to equal `ENTRY_POINT_REGISTRY` minus `ENTRY_POINT_DEFERRED` exactly — so a covered claim with no journey behind it now fails in the network-free tier. Running that join corrected one entry (`admin.createTrackerForMonth`, covered on prose that named the admin route while the spec drives the `copyAndInit` menu entry), moving the split from 10/33 to 9/34. **`F3Go30-y8j7.1` (2026-09-06)** then closed all five `cmd=checkin`/`cmd=signup` product-route deferrals with real journey call-sites, moving the split to 14/29. **`F3Go30-1pqo.2`** then added `checkin.logout` (server-side Logout) as a new deferred entry (node-tested, no charter-journey call-site yet), moving the split to 14/32. **`F3Go30-61ln.5`** then added the `tracker-create-without-form-live-check` journey, which drives `admin.createTrackerForMonth` and `admin.cleanupTracker`, moving the split to 16/33. See §9b | `test/contract/entryPointRegistry.js` · `ENTRY_POINT_REGISTRY` / `ENTRY_POINT_DEFERRED` | **`conformant`** |
| `H13` one regression entry point | **Met (2026-09-06, `F3Go30-emwk.5`).** `pnpm run test:regression` is the single named command, composed of the declared tiers (`H1`), cited by project `CLAUDE.md` §Testing. The hand-picked 6-of-11 `regression:sit` spec list is retired, not repointed — replaced outright by the full declared tiers | `package.json` · `scripts.test:regression`; project `CLAUDE.md` §Testing | **`conformant`** |

**Stage 4 (`charter`, `F3Go30-emwk.9`) flipped no row, and that is the correct outcome.** The
journey charter is a `T`-layer artifact (`T1`/`T15`/`T17`/`T21`/`T22`, `ADR-0011` §Decision 5), not
an `H` mechanism: no `H` standard is *about* the charter. What it changed here is the strength of
an already-`conformant` row — `H12`'s covered set stopped being authored and became computed from
the charter, and the row records that. Every remaining `waived` row (`H4`, `H5`, `H9`, `H10`) still
cites its own bead, and none of them was reachable from this stage. Recorded explicitly so a reader
does not have to infer from an unchanged table whether the stage ran.

**Stage 6 (`enforcement`, `F3Go30-emwk.11`) flipped no row, and that is the correct outcome for
the same reason as stage 4.** The disposition record — `tools/audit-disposition.js` plus its
`merge-gate` Step 2.5 wiring — realizes `ADR-0011`, a `T`-layer decision-carrier concern, not an
`H` mechanism: no `H1`–`H13` standard is *about* how a `[TST]` bead's disposition is recorded or
audited. `H9` and `H10` remain `waived`, unreachable from this bead's scope and still citing
`F3Go30-emwk.12` (traceability emission and the AC-staleness check, both blocked on upstream `T24`
ratification per those rows' own text) — neither depends on the disposition mechanism, and this
bead does not touch either. Recorded explicitly, as stage 4's row was, so a reader does not have
to infer from an unchanged table whether the stage ran.

**`F3Go30-emwk.14`/`F3Go30-taag` (REVIEW-260910 stage `test-tier`) flipped no row either, and that
too is correct — but they changed what the `H6`/`H7`/`H8` numbers are *denominated in*.** Under
`node --test`, a whole-file test script is one execution, so the outcome summary counted files.
Migrating a file to `describe`/`it` makes each case its own execution: the first cohort of five
files (`test_pax_cache.js`, `test_script_properties_memo.js`, `test_context_date.js`,
`test_client_version_logging.js`, `test_webapp_version_route.js`) took the node tier from 65
executions to 163 with the same code under test and the same pass/fail set. No `H` mechanism
changed — `classifyExecution()`, `RETRY_POLICY` and the summary printer are untouched — the
population they classify simply got finer, and a failure in a migrated file now names the
behaviour instead of the file. Migration is **on touch**, never a sweep, so the two granularities
coexist indefinitely and a mixed denominator is expected, not a defect.

**Structural finding behind three of the rows above — resolved 2026-09-06 (`F3Go30-emwk.3`).**
`playwright.config.js` used to apply one profile to all 11 specs: `headless: false, storageState:
.auth/user.json, workers: 1, retries: 0, timeout: 120000`. It now defines three projects —
`no_live_session` (headless, no `storageState`, parallel, `retries: 0`), `live` (unchanged heavy
mode, `retries: 1`), `demo` (the purpose exclusion) — built from `tests/playwright/tiers.js`'s
classification, never a hand-duplicated list (`I6`). `playwright.config.js`'s `outputDir` was
moved to `test-results/playwright-artifacts` in the same change: Playwright wipes `outputDir` at
the start of every run, and the default (`test-results/` itself) would have deleted the node
tier's JUnit file living in the same folder (`F3Go30-emwk.4`). This split is what made `H1` and
`H13` (`F3Go30-emwk.5`) reachable; `H3` (`F3Go30-emwk.2`) only needed the marker declaration, not
the config split, and landed independently. `H7` was closed afterwards by `F3Go30-emwk.6`, which
replaced the split's bare `retries: 1` literal with `retriesFor(LIVE)` reading the one declared
policy.

**Operator check for `H6`/`H7`/`H8` — run live, 2026-09-06 (`F3Go30-emwk.6`).** `testDeploymentId`
in `local.settings.json` was temporarily repointed at a non-existent deployment and one live spec
re-run (`checkin-advanced-grid.spec.js`, "page load: TODAY/YESTERDAY visible", which passes green
against the real deployment on the run immediately before). Result: `1 failed`, exit 1, and the
summary read `boundary fault: 1`, `assertion failure: 0`, `execution failure rate: 100.0%`,
`retried executions: 1 (1 extra attempt)`, `boundary probe: UNHEALTHY — sit /exec?cmd=version →
HTTP 404`, `boundary signals: non-json-live-response×1`, with the per-execution line
`BOUNDARY FAULT [non-json-live-response] · live · 2 attempt(s)`. Both evidence paths fired
independently and agreed. `local.settings.json` was restored immediately afterwards and verified
byte-identical to its pre-check copy. The converse was checked the same session: a deliberately
broken node test reported `assertion failure: 1` / `boundary fault: 0` at `1.7%`, with the other
57 files still running and exit 1 preserved.

**Known limitation.** A Playwright failure raised in a `beforeAll` hook is recorded with
`duration = 0` (Playwright attributes hook time to the hook, not the test), so such a run's
"wall time on failed executions" reads `0.0s` while the counts and rate are correct. It
understates the wall-time line only, never the classification.

**Waivers (`H5`)** — a waiver names the test, the observed value, the reason, and an issue id. A
row without an issue id is not a waiver, it is an unrecorded exception:

| Test | Standard waived | Observed value | Reason | Issue id |
|------|-----------------|----------------|--------|----------|
| _(none — every execution measured 2026-09-06 (`F3Go30-emwk.10`) came in under its `H4` ceiling; see that row for exactly what was and was not measured. Nothing has needed the `T6` → `T12` → `T21` resolution order tried against it yet)_ | — | — | — | — |

**Operator check, run this session (`F3Go30-emwk.10`).** The stage's check — confirm the ceiling
appears in exactly one place that both the runner and the report read — was run by grep: `30000`
(the `no_live_session` project's old literal) no longer appears anywhere in `playwright.config.js`;
`ceilingMsFor(NO_LIVE_SESSION)` is the only source, and it evaluates to the same `30000` it replaced
(verified: `pnpm exec playwright test --project=no_live_session` still ran the same 5 tests to
completion with the AC1 test's real 25.3 s duration well inside the unchanged budget — a silent
regression here would have shown as a new timeout, not as a passing run). `tools/test-outcome-report.js`
reads the same export (`isOverCeiling()`) for its printed category. `DURATION_CEILING_MS` itself has
exactly one definition, in `tests/harness/outcomes.js`. `test/test_outcome_classifier.js` covers
`ceilingMsFor()`/`isOverCeiling()`/`summarize()`'s `overCeiling*` fields directly, including the
case a plain outcome-class assertion can't reach on its own: a `passed` execution over its ceiling
must still count as a `pass` in `H6`'s classes *and* separately as `overCeiling` — the two dimensions
are orthogonal, and the test asserts both counts on the same fixture record.

## 9b. Entry-point registry

Realizes `H12`, feeding `T17`. The testing guide §7 coverage matrix is intended to be a **view**
of this list, not a second copy of it (`I6`).

**As built, 2026-09-06 (`F3Go30-emwk.8`).**

- **Registry location and format:** `test/contract/entryPointRegistry.js`. `ENTRY_POINT_REGISTRY`
  (`{key → description}`, 49 entries) plus `ENTRY_POINT_DEFERRED` (33) naming the subset that is
  knowingly uncovered, each with a reason and a tracking bead, so the `T17` gap-diff is green by
  design rather than by omission. Keys are `<class-prefix>.<action>` for routed actions
  (`checkin.checkin`, `admin.teardownEnvironment`) and the bare GAS function name for triggers and
  menu items (`handleTrackerEdit_`, `copyAndInit`) — which is what an operator actually types into
  the Apps Script editor's run-function picker.
- **Two additions beyond the reference shape**, both to stop a judgement call living as prose:
  `ENTRY_POINT_CLASSES` maps every key to one of the six call-site classes, and
  `ENTRY_POINT_READ_ONLY_EXEMPT` (16 entries) enumerates every route, page render and menu item
  deliberately *not* registered, with the reason it writes nothing. An exemption is a claim that a
  call-site is read-only; a claim belongs somewhere auditable (`I6`).
- **The covered set is computed, not authored (`F3Go30-emwk.9`).** An entry point is covered
  exactly when a charter journey names it in `test/contract/journeyCharter.js`;
  `assertDeferralIsComputed()` requires `union(journey entryPoints) === registry \ deferred` in both
  directions, so claiming coverage with nothing driving it, or retiring a journey without deferring
  what it drove, fails the network-free tier. Before that join existed the complement of
  `ENTRY_POINT_DEFERRED` was simply asserted — and its first run found one unearned claim.
- **How the coverage matrix is derived from it:** testing guide §7 is a **view**. Every number in
  its table and its bold prose totals is computed from these two maps, and
  `test/test_entry_point_registry_view.js` compares them cell by cell. It fails on a disagreement,
  and it fails just as loudly if the prose is reworded such that a number can no longer be found —
  a doc that drifts under this check cannot make it go quiet. GActionSheet's own §7 view drifted
  once (32/22 stated against an actual 37/13) before it was guarded; that is the failure mode this
  anticipates, not a hypothetical.
- **What happens to an entry point absent from the registry:** it is still silently uncovered.
  The registry is authored, not extracted, so a new `cmd=` action or trigger added to `script/`
  without a registry entry is invisible. Mechanical extraction from `script/` for the trigger and
  menu classes is the obvious next reduction and is deliberately not built — no bead files it,
  because the classes it would cover are small and stable.
- **Scope judgement, as decided.** `script/WebApp.js` dispatches 27 `cmd=admin` actions. All 21
  that write are registered, and 19 of those are then deferred: "this exists as operator tooling"
  is an argument about coverage priority, not about whether the entry point exists, so it belongs
  in the deferral reason rather than in a decision to leave it out of the enumeration. The
  remaining 6 admin actions (`listTriggers`, `getConfigValue`, `listSheets`, `getSheet`,
  `getSheetHeaders`, `getSheetFormulas`) read only and are in `ENTRY_POINT_READ_ONLY_EXEMPT`.
- **Deferral discipline.** Every deferral opens with `[backlog]` or `[permanent]` and names a
  bead. `[permanent]` entries are the ones where driving the call-site inside a suite run is
  destructive or meaningless — a one-time secret bootstrap, a project-wide trigger teardown, real
  reminder email to real PAX, a performance probe that asserts nothing. `assertRegistryWellFormed()`
  rejects a deferral missing either label or bead id.

## 10. Deferred contract observations

Findings discovered while writing this spec; routed to the contract source rather than resolved
here.

| # | Observation | Route to |
|---|-------------|----------|
| 1 | **No machine-readable contract source exists.** The browser/server wire contract is prose (`docs/pax-data-model-and-contract.md` §1, §4), and each of the 67 test files restates inline whatever shape it needs. There is no drift-fails-loudly path (`I6`): a contract change is caught only where a test happens to restate the old shape. This is the structural reason the AC registry needs a new home (plan escalation E1) rather than living beside a contract module. **Still open after stage 3:** `test/contract/` now exists and holds the two registries, but neither is a contract module — they enumerate obligations and entry points, not field shapes, so a wire-shape change still fails loudly nowhere (§7). | `docs/pax-data-model-and-contract.md`; if a contract module is ever extracted, `test/contract/acRegistry.js` moves to it. |
| 2 | **`T19` run-identity scoping is absent on the live tier.** Most live specs reuse named PAX fixtures (`NoSadClown`, `Whiplash`) on the shared SIT environment and read the whole roster rather than a run-scoped slice, so two concurrent runs of the same spec collide and a roster assertion reads accumulated cross-run state. `announcement-splash-live-check.spec.js`'s capture-and-restore of a live `Config` row is per-spec discipline standing in for a harness guarantee — and an earlier version of that spec did clobber a human-authored announcement. | testing guide §4; filed as `F3Go30-emwk.13` (unstaged) — recorded as a discovery loss per `test-bootstrap.md` Phase 3 step 5, since no plan row covers it. |
| 3 | **Two grades of live exist and are not separated.** Specs needing only the live webapp vs. specs needing an authenticated Google *browser* session (`copy-and-init`, `tracker-edit-trigger-live-check`). Recorded in the charter (testing guide §6, and machine-readable as each journey's `tier` field in `test/contract/journeyCharter.js` since `F3Go30-emwk.9`) rather than split into tiers now, so a later `test:prep`/auth-setup stage has something to act on. | testing guide §6; plan escalation E3. |

---
_Filled 2026-09-06 by `test-bootstrap.md` Phase 2 (Use Case 1 — Adopt), against `test-framework`
v1.0.0 (`ADR-0011`, `ADR-0012`). Conformance table recorded against branch `scorecards`; each
`waived` row flipped when the bead that closed it landed (EPIC `F3Go30-emwk`, closed 2026-09-06 —
its staging doc is retired per `staged-plan` Mode C; the stage roll-up survives in the EPIC's
close reason). Reference implementation consulted: `../GActionSheet/docs/atdd/harness-design.md`._
