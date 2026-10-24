# CLAUDE.md — F3Go30

**Tier:** Standard
**Standards:** /docs/framework/doc-standard.md _(read-only — do not edit)_

## Reading Order
1. Current state — `bd prime` (auto-loaded when bd in use)
2. docs/CONTEXT.md — purpose, capabilities, use cases
3. docs/DESIGN.md — architecture, modules
4. docs/OPERATIONS.md — how to run it
5. /adr/ — why key decisions were made
6. /docs/references/ — external document summaries

## Document Map

| Content | Location |
|---------|---------|
| Purpose, capabilities, use cases, glossary | docs/CONTEXT.md |
| Architecture, modules, data model, runtime risks | docs/DESIGN.md |
| Deployment, configuration, failure modes | docs/OPERATIONS.md |
| Current state | `bd ready` |
| Identified work | bd issues |
| Technical decisions | /adr/ |
| Strategic themes | docs/VISION.md _(when created)_ |
| Roadmap, funnel | docs/ROADMAP.md |
| Release notes (user-facing, version-stamped) | docs/CHANGELOG.md |
| Go30 Q tutorial narration script | /docs/references/go30-q-tutorial-script.md |
| Testing conventions, journey charter, dispositions | docs/atdd/project-testing-guide.md |
| Harness `H1`–`H13` conformance, waivers, entry-point registry | docs/atdd/harness-design.md |

## Placement Rules
- New capabilities → docs/CONTEXT.md §Capabilities + use case if actor-driven
- Architecture changes → docs/DESIGN.md + affected diagrams
- Operational changes → docs/OPERATIONS.md
- Resolved decisions → /adr/
- New terms → docs/CONTEXT.md §Glossary
- New risk identified → `bd remember`
- New initiative → docs/ROADMAP.md §Funnel
- New journey, testing convention, or disposition → docs/atdd/project-testing-guide.md
- `H`-standard conformance change or waiver → docs/atdd/harness-design.md §9a
- User/admin-facing change worth announcing → docs/CHANGELOG.md §Unreleased (minor-series level;
  NOT per-deploy/patch/build — see that file's "What belongs here")

## Code Quality

- **No duplicated logic across call sites.** Before adding similar logic to more than one call
  site, check whether it's the same shape each time — extract one shared function and call it
  from each site instead of hand-copying the block. Duplicated logic drifts: a fix, guard, or
  field lands on one copy and gets forgotten in the others.
- **Flag existing duplication you encounter**, even outside the current task's scope. If work
  in one file surfaces near-identical logic already repeated elsewhere, say so and propose
  consolidating it — don't silently work around it.
  (Captured as a lesson-learned in DevStandard, 2026-07-20: no gate or skill currently checks
  for this automatically, so it depends on this standing instruction until resolved upstream.)

## Testing

**Testing: atdd-bdd — $DEVSTANDARD/test-framework/README.md**

Principles (`T1`–`T25`, `I1`–`I12`, `H1`–`H13`) are cited from DevStandard, never restated here.
This project's own testing facts live in two documents:

| Content | Location |
|---------|---------|
| Stack, surfaces, journey charter, entry-point matrix, disposition record | docs/atdd/project-testing-guide.md |
| `H1`–`H13` conformance table, waivers, entry-point registry | docs/atdd/harness-design.md |

Adopted 2026-09-06 as a first-pass scaffold, then carried through EPIC `F3Go30-emwk`'s 7 staged
beads (closed 2026-09-06): `H1`, `H2`, `H4`–`H8`, `H11`–`H13` are `conformant`, `H3` is `declined`
by design, `H9`/`H10` stay `waived` on unstaged bead `F3Go30-emwk.12` (blocked on upstream `T24`
ratification). Dispositions on `[TST]` beads bind forward from 2026-09-06 and are audited by
`node tools/audit-disposition.js` (`docs/atdd/project-testing-guide.md` §9). The approved
adoption plan and its staged execution doc are retired (`staged-plan` Mode C) now that every
stage is complete — the stage boundaries and per-stage findings survive only in `F3Go30-emwk`'s
close reason (`bd show F3Go30-emwk`, closed).
Before writing implementation code, invoke the **implementation-gate** skill (global CLAUDE.md §8).

**`pnpm run test:regression` is the `H13` one-regression-entry-point.** It composes
`test:local` (56 network-free node files + the one network-free Playwright spec) then
`test:live` (the full declared live Playwright tier + the GasLogger/Axiom check) with a real
`&&` gate — `test:live` never opens a live session unless `test:local` is green. Run just one
tier with `pnpm run test:local` / `pnpm run test:live`. (The node tier is 60 files as of
`F3Go30-emwk.8`; it is glob-discovered, so the count moves with `test/test_*.js` — never
hand-maintain it as a list.)

**Every run ends with an outcome summary** — pass / assertion failure / **boundary fault**, the
execution failure rate, the share of wall time spent failing, and the retry count (`H6`/`H7`/`H8`,
`F3Go30-emwk.6`). A *boundary fault* means Google, not this code: the run is still red, but it
says so. Classification lives in exactly one place, `tests/harness/outcomes.js` — **never** add a
`try`/`catch` to a test to label a failure as infrastructure, and never type a retry count into
`playwright.config.js`; add a row to `BOUNDARY_SIGNATURES` or change `RETRY_POLICY` there instead
(retry is live-tier-only and bounded, enforced by `retriesFor()`).

## Maintenance Protocol

Claude does not monitor documents between sessions, detect drift, or update documents
without explicit instruction.

- At session start or phase transition: run `/session-start-check`
- After any code or architecture change: run `/doc-trigger-check`
- To trigger a state review: "review project state before we start"

## Memory System
| System | Scope | Use for |
|--------|-------|---------|
| `bd remember` / `bd memories` | Project-scoped | Project rationale, design decisions, process insights — travels with the repo |
| MEMORY.md (auto-memory) | User-scoped | User preferences, cross-project style conventions |

Do not use MEMORY.md for project rationale. Do not use `bd remember` for user preferences.

## Working
```
bd ready              # available work (unblocked, prioritized)
bd list               # all open issues
bd show <id>          # full issue detail with deps
bd update <id> --claim  # claim and start work (atomic: sets assignee + in_progress)
bd close <id>         # mark complete
/bd-report            # generate bdreport.md (snapshot with graph + narrative)
```

## Shell Safety (Quoted Payloads)

When running shell commands that include human-written text payloads (issue descriptions,
acceptance criteria, notes, markdown), prevent shell expansion by default.

- Use single-quoted heredocs for multi-line payloads: `<<'EOF'`
- Never pass payload text in double-quoted CLI args when content may include backticks,
	`$`, `$(...)`, or backslashes
- Prefer stdin / `--body-file -` for multi-line content instead of inline argument strings
- Do not chain create/update commands with command substitution in the same shell line
	when payload text is present; run verification/read commands separately after writes
- If a command must include literal backticks or `$`, verify they are inside a single-quoted
	heredoc payload, not in shell-parsed argument context

## Reference Summaries

| File | Source Document | Covers |
|------|----------------|--------|
| /docs/references/go30-q-tutorial-script.md | Script.md (original) | Go30 Q onboarding narration — steps to create a new monthly tracker |

## Deployment Environments

Two environments exist. **Default is SIT** unless PROD is stated explicitly.

| Label | Script project | Spreadsheet |
|-------|---------------|-------------|
| **SIT** | `testScriptId` | `testSpreadsheetId` |
| **PROD** | `templateScriptId` | `templateSpreadsheetId` |

Any action that is environment-scoped — deploy, admin webapp POST, log/ query, namespace smoke test, `runScanTrackers`, creating a tracker month, cleanup — must name the environment. If unspecified, assume SIT and proceed. If the user says "prod", "production", "template", or "go live", switch to PROD context and proceed.

Either environment can run a **namespace-provisioned smoke test** — a disposable copy of the Template + a few recent trackers, tested end-to-end and torn down automatically (see §Smoke mode workflow below). This superseded the legacy `SMOKE_MODE` Script Property mechanism (ADR-014; F3Go30-4wv9/i5md.7).

Runtime GAS logs are sent to the Axiom service. Query them with `tools/query_axiom.py`
(`--env sit|prod`, `--since` or `--start/--end`, `--apl "| summarize ..."` for server-side
aggregation, `--format tsv|json|jsonl` for scripts; field names are bare, never `data.`-prefixed).
`tools/activity_log.py` is the human-readable PAX activity narrative built on top of it.
`tools/activity_log.py --health --env <env>` is the periodic aggregate health report (by version
and by week, absolute + %, flags for follow-up) — docs/OPERATIONS.md §Periodic health report.
Axiom keeps only 30 days, so `tools/axiom_store.py` mirrors events into a local gitignored
Parquet store (`data/axiom/`; needs `duckdb` in the uv1 venv): `query_axiom.py --sync --env <e>`, `--local --sql "select ..."`.
`activity_log.py` (narrative and `--health`) syncs then reads it (`--no-sync` skips the network).
PROD kept indefinitely, SIT 30d, PROD `*.timing` rolled up daily after 30d — docs/OPERATIONS.md §Local Axiom store.
## clasp - command line tool for google apps script credentials.
The local.settings.json file claspAuth setting contains the clasp auth credentials file which must be passed in to clasp with the "--auth" arguent or via the "clasp_config_auth" environment variable.

## Developer CLI Tools

### clasp auth (required on every manual clasp command)
Do NOT use bare `clasp` — it silently falls back to wrong credentials. `CLASP_CONFIG` is not a
real clasp variable; only `clasp_config_auth` (lowercase exact match) works.
```
clasp_config_auth=~/.clasprc-f3go30.json clasp <subcommand>
```

### Deploying
This project is pnpm-only (`packageManager` pinned in package.json; `preinstall` refuses a bare
`npm install`). Use `pnpm`, not `npm`, for every script below.

Environment switching is managed by `tools/manage-deployments.js`, which writes `.clasp.json`
before each push. Do not edit `.clasp.json` manually. Both pnpm scripts do a full deploy
(push + named deployment URL update).

**The deploy pipeline itself lives in the shared `gas-deploy` package**, not in this repo
(GAS-Core `packages/gas-deploy/`, pinned by tag in `package.json`). `tools/manage-deployments.js`
here is pure config — targets, the stamper, the ordered pre-push/post-deploy hooks — and
`tools/callWebapp.js` is a thin wrapper over the package's one HTTP client. For deploy
*internals* (auth, deployment-ID resolution, stamping, verification, summary, hook semantics)
read that package's README; changing behaviour means changing the package and cutting a new
`gas-deploy-vX.Y.Z` tag, not editing these two files. Background:
`GAS-Core/best-practices/gas-deployment/RECOMMENDATION.md`.
```
pnpm run deploy:sit    # push to SIT (testScriptId)       — alias: pnpm run deploy:test
pnpm run deploy:prod   # push to PROD (templateScriptId)  — alias: pnpm run push
pnpm run release:patch # bump version + deploy:prod + git push --follow-tags
```
Every deploy ends by printing the standard deploy summary (version, stamp time, full deployment
ID, revision, script project, webapp, static page, spreadsheet links). To see the same summary
for what is *currently* deployed without deploying anything — no push, no `clasp deploy`, no
post-deploy hooks — run:
```
node tools/manage-deployments.js --summary --env sit    # or --env prod
```

**Deploy verification** (gas-deploy RECOMMENDATION.md §3.2, F3Go30-gas-deploy Stage 1c): the
webapp exposes a `cmd=version` route — `{ok, version, versionDate, target, deploymentId}` read
straight from `script/version.js`'s stamped constants, no secret required (works on the
`ANYONE_ANONYMOUS` deployment, before any secret is bootstrapped) —
```
node tools/callWebapp.js version --cmd version --env sit
```
`clasp deploy` exiting 0 only proves a version was *created*, not that the `/exec` URL is
actually serving it (a deployment silently converted to a library, a not-yet-propagated edge, a
push landed under the wrong `clasp_config_auth`, or a named deployment left pointing at an older
revision would all report success under the old check). `pnpm run deploy:sit`/`deploy:prod` run
`assertDeployedVersion` (gas-deploy's `lib/verify.js`) as the mandatory, non-skippable last step
before the summary: it polls `cmd=version` until the reported `version` **and** `target` match what was just
stamped (tolerating the ~5s edge-propagation race), or times out. A mismatch fails the deploy
with a non-zero exit and expected-vs-actual printed — the `target` check is what catches
deploying to the wrong environment — but the summary still prints so the operator can see what
*is* deployed. `--summary` queries `cmd=version` once (no polling — nothing was just deployed)
and flags any divergence from local `script/version.js` (deployed from elsewhere, or a deploy
half-failed).
Before changing a request/response shape on `handleCheckinPost_` / `handleSignupPost_`, read
docs/OPERATIONS.md §API compatibility with installed clients — installed PWA clients update on
their own schedule, so a stale client posting to a new server must keep working.

GitHub Pages (the static front end's real host) has CDN propagation lag after a deploy — the
public URL can still serve the previous build for a while. Before screenshotting/manually
checking the live `f3go30.github.io` page right after a deploy, confirm it has actually
propagated first:
```
node tools/wait-for-static-deploy.js --env sit    # polls until the live page's version stamp matches
```
Not needed before running the checked-in Playwright live-check specs (`tests/playwright/
*-live-check.spec.js`) — those serve `static-pages/src/` from a local throwaway server straight
against the live backend, bypassing GitHub Pages entirely, so they're never stale.

### Web app calls (all environments, all endpoints)
```
node tools/callWebapp.js <action> [--cmd admin|signup|...] [--env sit|prod] [--body '{"key":"val"}']
```
Resolves the deployment ID from the **live** `clasp deployments` list (falling back to the value
recorded in `local.settings.json` when clasp auth is unavailable), so a recreated deployment can
never leave it calling a dead URL. For `--cmd admin` (the default) it also injects the admin
secret — into the POST body only, never argv, never the query string, never printed. Other `cmd`
endpoints (`signup`, `checkin`, `version`) are not secret-gated and never receive it.
Default: `--cmd admin --env sit`.

> **The authoritative enumeration of entry points is `test/contract/entryPointRegistry.js`**
> (`H12`, `F3Go30-emwk.8`), not the prose below. What follows is an operator quick-reference for
> the actions worth typing by hand; the registry is what a coverage check reads, and it also
> records which actions are read-only and which are knowingly uncovered.

Common admin actions: `setScriptProperties`, `cleanupTracker`,
`runScanTrackers`, `getSheet`, `runAutoGenerate`, `createTrackerForMonth`, `copyTemplate`,
`copyProdTrackerToSit`, `teardownEnvironment`, `setContextDate`, `setConfigValue`, `getConfigValue`,
`seedTeamDb`, `renameTeam` (ADR-023 TeamDB roster seed / rename-merge — see docs/OPERATIONS.md
§TeamDB team roster), `closeHcForms` (ADR-024 HC Form retirement — see docs/OPERATIONS.md
§Retiring the HC Form)

- `copyProdTrackerToSit` (F3Go30-956l) overlays a source deployment's current-month tracker's
  `Tracker`/`Bonus Tracker`/`Responses` values onto the target deployment's own current-month
  tracker's same-named sheets in place, one whole column at a time (a column with a formula
  anywhere in it, on either side, is skipped entirely — never deletes/replaces the destination
  sheet, so it's safe with a linked Form; clears data validation on each copied column first) and
  re-syncs `TrackerDB`/`PaxDB`/PaxCache — see docs/OPERATIONS.md §Refreshing SIT's current-month
  tracker with PROD data. Requires
  `sourceTemplateId`; fails if either side has no current-month tracker (never auto-creates one).
  Same PROD refusal as `setContextDate`/`setConfigValue`.

- `setContextDate` (F3Go30-31w5.1) persists a `{ns, contextDate}` override into the ns-resolved
  spreadsheet's Config sheet ("Context Date"), read as a fallback by every webapp entry point's
  "what day is it" resolution (`resolveContextDate_`, go30tools.js) — lets a developer test
  month-boundary fallback deterministically. A request's own `contextDate` field (or, for a
  browser session, a `?contextDate=YYYY-MM-DD` query param on `cmd=checkin`/`cmd=signup`, echoed
  automatically for the rest of that page's requests) always wins over the stored Config value.
  Refuses outright on PROD (`APP_DEPLOY_TARGET === 'TEMPLATE'`) — PROD always uses the real date,
  full stop, since the webapp is deployed `ANYONE_ANONYMOUS`.
- `setConfigValue` (F3Go30-g9bi) writes an arbitrary `{ns, key, primary, secondary}` row into the
  ns-resolved spreadsheet's Config sheet — a generic version of `setContextDate`'s write path,
  for live-testing any Config-driven feature (e.g. `Announce.<day>` splash rows) without
  hand-editing the sheet. Same PROD refusal as `setContextDate`.
- `getConfigValue` (F3Go30-g9bi) reads back a single `{ns, key}` row (`{found, primary,
  secondary}`) — read-only, no PROD guard. Use it to capture a row's current value before a
  `setConfigValue` overwrite in a live-check script, so the script can restore the exact original
  afterward instead of blindly clearing a key that might carry real, human-authored content (see
  tests/playwright/announcement-splash-live-check.spec.js's SAFETY note — an earlier version of
  that script clobbered a live Site-Q-authored announcement this way).

- `runAutoGenerate` creates the tracker for **real-today's month + 1** (it's meant to run a
  few days before month-end via its own time trigger). If it's ever run late — after a month
  has already started with no tracker created for it — it silently creates the *next* month
  instead, skipping the missing one. Check `getSheet`/TrackerDB before relying on it.
- `createTrackerForMonth` creates a tracker for an **explicit** month — use this to backfill a
  skipped month or create one out of band:
  `node tools/callWebapp.js createTrackerForMonth --env <env> --body '{"startDateIso":"2026-07-01"}'`
- To undo a wrongly-created tracker: `cleanupTracker --body '{"sheetId":"<id>","trashSpreadsheet":true}'`
  removes the TrackerDB row + PaxDB rows and trashes the spreadsheet + any linked legacy HC Form.
- `teardownEnvironment` tears down a whole namespace environment provisioned by `copyTemplate`
  (ADR-014 D6): `node tools/callWebapp.js teardownEnvironment --body '{"nameSpace":"<ns>","trashFolder":true}'`
  removes the `NamespaceDB` row first (the safety cut — makes the ns unresolvable immediately),
  then trashes the environment's whole Drive folder (Template copy + every tracker copied
  alongside it) when `trashFolder` is set.

### Smoke mode workflow (run on SIT first; repeat on PROD before go-live)
See docs/OPERATIONS.md §Smoke Mode for the full description. Quick reference:
```bash
node tools/smokeTestNamespace.js --env <env> --template <prod|sit>
```
`--env` (default `sit`) picks which deployment registers/runs the namespace. `--template`
(default `prod`) picks which spreadsheet is copied FROM to build it — `prod` copies PROD's real
Template + recent trackers (`templateSpreadsheetId`), `sit` copies SIT's own Template
(`testSpreadsheetId`) instead. These are independent (ADR-014 D6): the plain default run
registers under SIT but still provisions from **PROD's real data** — pass `--template sit`
explicitly to test against SIT's own Template instead.

Disposes any stale smoke namespace, provisions a fresh one, live-verifies signup/check-in/
dashboard/bonus flows against it, and tears itself down automatically on success (manual
cleanup steps are printed only if a scenario fails).

## Instruction Precedence

- Memory ownership (`bd remember` vs MEMORY.md) is the `bd` skill §Memory Ownership
  (`$DEVSTANDARD/dot-claude/skills/bd/SKILL.md`); it wins over any bd-generated memory line.
