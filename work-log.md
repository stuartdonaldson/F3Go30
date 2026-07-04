
## 2026-05-08

### Form Submit Pipeline & Duplicate Handling (F3Go30-vir)

**Completed:**
- Fixed stale trigger issue: `clearFormSubmitTrigger` now removes both `handleFormSubmit_` and legacy `onFormSubmit` triggers
- Made `TEAM_PREFERENCE` optional in header resolution (not all tracker forms have this column)
- Added `RESPONSE_COLUMN_ALIASES` map to handle form question text variations between tracker versions:
  - `GOAL_SELECTION`: "Goal selection" | "What is your goal?"
  - `TEAM_PREFERENCE`: "Team preference" | "Do you want to be on an AO based team..."
- Rewired `onFormSubmitLocked_` into five explicit phases: reuse → dedup → team → tracker write → sort/log
- **Changed deduplication key from EMAIL to F3_NAME** per ADR-008:
  - Allows a PAX to change their email address without creating orphaned rows
  - Keyed same as Tracker (by F3 Name) for consistency
  - Created ADR-008 documenting the decision and trade-offs
- All tests green; deployed to GAS via clasp

**Issues Closed:** F3Go30-vir, F3Go30-yjq

**Key Learnings:**
- Form header text changes between tracker versions — aliases needed for resilience
- Dedup by stable identifier (F3 Name) not email enables workflow flexibility
- Test data with duplicate emails across different F3 names revealed architecture clarity (orphaned Tracker rows when email reused for new name)


Session work
20:25:06 — Updated /work-log skill (v2.0): dual-mode operation with auto-summarize (no arg) and filter-prompt (with arg), added HH:MM:SS timestamps, changed cache-clear suggestion instead of auto-invoke /clear; committed to main

## 2026-05-08 20:39:22

### Summary:
Updated /work-log skill definition iteratively based on evolving requirements: transitioned from inline HH:MM:SS timestamps to full `## YYYY-MM-DD HH:MM:SS` header format; added explicit Summary and Key Learnings sections for structured logging; refined all documentation sections (procedure, success criteria, examples) to model the desired output format.

### Key Learnings:
Iterative refinement of skill design through user feedback produces clearer outputs than attempting to predict all requirements upfront. Skill documentation is most effective when examples demonstrate the exact output format being specified.
## 2026-05-09 13:54:06

### Summary:
Refactored response-sheet column handling around a shared canonical schema and alias-aware table access; updated reminder and reuse email sending to sanitize recipients and single-line name content; fixed nag recipient formatting by preserving display names while normalizing unsupported characters.

### Details:
- Moved shared Responses schema metadata into response_utils.js, including canonical keys TEAM_TYPE, OTHER_TEAM, and NAG_EMAIL plus legacy header aliases.
- Updated libSheets.js to support read-only alias-aware header normalization for table-like sheets and documented explicit migration as a future separate action.
- Updated signupReuse.js and addResponseOnSubmit.js to consume the shared response schema and renamed fields.
- Added send-time sanitization for response-related email recipients and F3 names.
- Fixed nag.js recipient formatting so display names are kept when safe, non-ASCII/unsupported characters are normalized out, and recipient addresses remain valid.
- Added and updated focused tests for response schema resolution, libSheets normalization, signup reuse sanitization, and nag recipient formatting.
- Verified the full Node test suite passes after the refactor and email fixes.

### Key Learnings:
- Historical Google Form prompt drift is better handled as read-only alias normalization in code than as implicit header migration on sheet open.
- MailApp recipient parsing tolerates display names, but non-ASCII or unsupported characters in the display name can break sends unless normalized first.
## 2026-05-09 13:54:19

### Summary:
Refactored response-sheet column handling around a shared canonical schema and alias-aware table access; updated reminder and reuse email sending to sanitize recipients and single-line name content; fixed nag recipient formatting by preserving display names while normalizing unsupported characters.

### Details:
- Moved shared Responses schema metadata into response_utils.js, including canonical keys TEAM_TYPE, OTHER_TEAM, and NAG_EMAIL plus legacy header aliases.
- Updated libSheets.js to support read-only alias-aware header normalization for table-like sheets and documented explicit migration as a future separate action.
- Updated signupReuse.js and addResponseOnSubmit.js to consume the shared response schema and renamed fields.
- Added send-time sanitization for response-related email recipients and F3 names.
- Fixed nag.js recipient formatting so display names are kept when safe, non-ASCII or unsupported characters are normalized out, and recipient addresses remain valid.
- Added and updated focused tests for response schema resolution, libSheets normalization, signup reuse sanitization, and nag recipient formatting.
- Verified the full Node test suite passes after the refactor and email fixes.

### Key Learnings:
- Historical Google Form prompt drift is better handled as read-only alias normalization in code than as implicit header migration on sheet open.
- MailApp recipient parsing tolerates display names, but non-ASCII or unsupported characters in the display name can break sends unless normalized first.

## 2026-05-09 18:15:00

### Summary:
Fixed reuse goals workflow to match by F3 Name instead of email. Downloaded actual Go30 Template and Last Month Tracker data, added realistic test coverage for Crazy Ivan and Little John, updated email template error messages.

### Changes:
- **signupReuse.js**: Changed `getPriorResponse()` lookup from email to F3 Name; added `findLatestResponseByF3Name()` function
- **signupEmail.js**: Updated no-reuse email message to refer to F3 Name instead of email address
- **test_signup_reuse.js**: Added full column headers from actual Last Month Tracker; added realistic test data for Crazy Ivan and Little John; created reuse simulation tests showing what values were reused for each candidate

### Key Learnings:
F3 Names are more stable matching identifiers than email addresses since community members may change email but keep their F3 Name. Header alias resolution was critical — simplified test headers weren't triggering proper column mapping, so using actual spreadsheet headers exposed the real schema. Mock data structure must match lookup key (F3_NAME vs EMAIL).

### Test Results:
All tests pass. Verified reuse works for both candidates:
- **Little John**: Team=Crucible, Who=Best loving father/partner/friend/leader, What=Morning routine with daily plan
- **Crazy Ivan**: Team=Crucible, Who=Highly intentional/purpose-driven/effective HIM, What=Consume <1452 net calories + HOAM/SAVERS by 8:30am

## 2026-05-09 21:29:53

### Summary:
Updated the Go30 reuse flow to preserve the current email address, carry forward the NAG email flag, and safely generate prefilled links without crashing on invalid form choices. Changed response deduplication to mark prior rows as DELETED in the Participation column instead of clearing them, and validated the changes with the local test suite before pushing.

### Key Learnings:
Rows should be tombstoned with an explicit marker when downstream sheets need to ignore them, rather than physically deleting them or blanking the row. Prefilled Google Form responses must be guarded against invalid choice values or the submit trigger can fail before later processing steps run.

## 2026-05-30 17:34:40

### Summary:
Diagnosed and fixed the signup reuse prefilled-form matching bugs. Added Logger instrumentation to the reuse prefill flow, confirmed live that TEAM was being mis-bound to a page break and then to Team type, tightened form-item title matching, and added regression coverage so Team now resolves to the actual Team field. Verified that EMAIL prefill required replacing Google Forms built-in email collection with a normal Email field, then confirmed the reuse flow was working end-to-end in live logs.

### Key Learnings:
Google Forms prefilled URLs are produced from matched form items, not from response-sheet headers directly, so item-title matching must be strict enough to avoid collisions like Team vs Teams or Team vs Team type. Built-in Google Forms email collection does not behave like a normal form item for this prefill flow; switching to a standard Email field made the email reusable and prefillable.

### Test Results:
- Focused validation passed with `node test/test_signup_reuse.js` after each matcher change.
- Live cloud logs confirmed TEAM warnings disappeared and only expected blank OTHER_TEAM and NAG_EMAIL skips remained.
- Created bd issue `F3Go30-q16` to track remaining email-template cleanup work and closed `F3Go30-zof` after live verification.

## 2026-05-30 18:38:52

### Summary:
Implemented tracker-month registration confirmation emails on form submit using the shared signup email template.
Converted copied-response settings email to a dedicated HtmlService template and shared goal-summary helpers.
Documented the submit-flow email behavior in docs/CONTEXT.md and closed bd issues F3Go30-flo and F3Go30-q16 after validation.

### Key Learnings:
The registration month should come from the Tracker sheet start date rather than the current date or spreadsheet name.
Email content builders are shared now, but MailApp.sendEmail still remains at workflow edges rather than behind a single gateway.
## 2026-05-30 21:34:41

### Summary:
Implemented template-based tracker link management in CreateNewTracker. Added `Sheet Template` config support, changed `Links` handling to upsert by `SheetId`, and routed last-month lookup through the template spreadsheet recorded in Config. Updated both tracker-creation paths (`copyAndInit` and `autoGenerateNextMonthTracker`) to write the source template URL into the copied sheet and upsert the source template Links row instead of blindly appending.

### Validation:
Focused JavaScript validation passed with `node test/test_create_new_tracker.js`, `node test/test_utilities.js`, and syntax checks on `script/CreateNewTracker.js` and `script/Utilities.js`. The live verifier update in `test/test_tracker_init.py` was partially adjusted for the new Links schema and `Sheet Template` row, but its Python compile check is still failing due to indentation cleanup not yet finished.

### Key Learnings:
The right shared entry point for `Last Month Tracker` is `initSheets`, but the lookup source must come from `Config -> Sheet Template`; using the active or destination spreadsheet directly would read the wrong Links tab for copied trackers.

## 2026-05-31 09:10:49

### Summary
Diagnosed "reuse last month's goals" feature returning `not-found` on every submission. Added diagnostic logging to `getPriorResponse` (not-found branch) to surface the actual spreadsheet name, ID, row count, and sample names. Used `inspect_spreadsheet.py` to download and inspect the previous tracker (May 2026). Root cause: the Config's "Last Month Tracker" was pointing to the correct spreadsheet, but that spreadsheet's Responses sheet had 0 rows — it was the test template, never populated with actual submissions. No code bug; config data issue resolved by populating the prior tracker with real submissions before testing reuse.

### Key Learnings
- When `not-found` fires in `getPriorResponse`, the tracker reference lookup chain (Config → openSpreadsheetFromReference_) can succeed even when pointing to the wrong copy of a sheet. The diagnostic context (spreadsheet name, rowCount, sampleNames) is essential to distinguish "wrong spreadsheet" from "person not in it".
- URL/ID ambiguity in "Last Month Tracker" Config is already handled by `extractSpreadsheetIdFromReference_`; the real risk is the Config pointing to a template copy with empty Responses rather than the production tracker with actual submissions.

## 2026-05-31 09:21:56

### Summary
Promoted OTHER_TEAM → TEAM in Phase 3 of handleFormSubmit_ when TEAM is blank and OTHER_TEAM is present. Removed the TEAM_TYPE "goal based" guard — the promotion is unconditional on TEAM being empty, which is simpler and also catches the post-reuse case where OTHER_TEAM carries over from last month but TEAM does not. Phase 3 runs after maybeReuseLastMonthsGoals_ so reused data is covered. Writes to both formResponses (in-memory) and the Responses sheet cell.

### Key Learnings
- Promoting OTHER_TEAM → TEAM is most robust without a TEAM_TYPE gate; if TEAM is blank and OTHER_TEAM has a value it should always be promoted regardless of how it arrived.

## 2026-06-22 13:11:47

### Summary:
Diagnostic-only session (no code changes). Root-caused the "raw URLs in auto-generate onboarding email" report and confirmed scope for two further changes. Outcome: three changes specified and ready to implement, all unambiguous.

**1. Raw-URL email — root cause: TinyURL alias collision (F3Go30-7mz).**
Traced via the raw email source + GasLogger NDJSON timeline:
- Confirmed the *entire* email is raw (both body-link `href`s AND the Slack block) — not a Slack-path or HTML-template-substitution issue. `buildSlackMessage_` is a pure concat (verified: short in → short out) and HtmlService `<?= ?>` only HTML-escapes.
- Two `autoGenerateNextMonthTracker` runs fired ~2 min apart on 2026-06-20 for the same month, both deriving the identical deterministic alias `2026-07-F3-Go30a` (`year-month-NameSpace`, no per-spreadsheet uniqueness):
  - 09:03:18 UTC (logged, runId `gaslogger-test`, ss `1wDRlbkv…`) → **claimed** `tinyurl.com/2026-07-F3-Go30a` ✅
  - 09:05:18 UTC (scheduled trigger, unlogged — GAS_LOGGER folder not set, ss `10GZa4wo…`) → alias already taken → retries exhausted/rate-limited → `catch` fell back to **raw** → emailed all-raw message.
- Earlier 05-31 failures were the same mechanism via invalid alias chars (`.` / space): `2026-05-T5.1 Go30`, `2026-06-F3.Go30`. Success case used only a dash (`2026-07-F3-Go30a`).

**2. Sheet visibility — invert `hideInternalSheets_` to an allow-list.**
Per owner: only these tabs stay visible — Tracker, Bonus Tracker, Team Score, HIM Score, Goals by HIM, Goals by AO, Help. Everything else hidden (notably Responses, currently visible; and TrackerDB). Full tab inventory confirmed from `docs/sheet-reference.md`.

**3. Remove PaxDB** sheet from each created tracker (delete during init).

### Planned fix (not yet implemented):
- Add tested helper `buildShortenerAlias_()` in `Utilities.js`: sanitize to `[A-Za-z0-9_-]` + append a fragment of `newSpreadsheetId` for per-spreadsheet uniqueness. Apply at all 4 call sites (copyAndInit + autoGenerate, tracker + form). Closes F3Go30-7mz (AC: aliases unique per created spreadsheet).
- Rewrite `hideInternalSheets_` (CreateNewTracker.js:192) to an allow-list + delete PaxDB; update `test/test_create_new_tracker.js` accordingly.

### Key Learnings:
- Deploy is `manage-deployments.js` → version-stamps `version.js` from `package.json`, then verbatim `clasp push -f` of `script/`. Working-tree `version.js` is `0.0.0`; deployed template pulled clean = matches repo. The migrated copy at `/home/stuar/roots/c-Proj/F3Go30-migrated/` is `APP_VERSION 2.2.1` (matches the email) but byte-identical slack/email code — same latent bug, not a divergent version.
- The MONTH script project (`monthScriptId`) is an older, smaller codebase (has `formManager.js`/`macros.js`, lacks `onboardingEmail.js`/`autoGenerate`) — it does NOT send onboarding emails. The autoGenerate trigger lives on the TEMPLATE.
- GasLogger writes NDJSON to `/mnt/g/My Drive/GAS-Logger/F3Go30/<ms>-<execId>.log`; `F3GO30_TEST_RUN_ID` was left set to `gaslogger-test`, tagging prod runs as test data — worth clearing.
- Silent shortener fallback is a real observability gap: the failing 09:05 run produced raw URLs + sent email but left no structured log (GAS_LOGGER_PARENT_FOLDER_ID unset on that execution).

## 2026-06-22 20:40:19

### Summary:
Implemented and deployed a fix for the raw-URL onboarding email bug, after the initial diagnosis (TinyURL alias collision, bd issue F3Go30-7mz) was disproven by the user's live Apps Script execution log and reverted.

**Real root cause (confirmed from live log, not inferred):** `autoGenerateNextMonthTracker`'s monthly trigger had been installed on a monthly tracker copy instead of only the Go30 Template host. Each spreadsheet `.copy()` gets its own independent bound Apps Script project, and Script Properties (`TINYURL_ACCESS_TOKEN`) are never copied with it — so `shortenUrl` failed instantly with "access token is missing" on every link, and the catch fell back to raw URLs for the whole email. The existing `-1`/`-2` retry counter in `shortenUrl` correctly did NOT retry this (it's not alias-related), so there was no retry-logic bug either.

**Fix shipped:** `isTemplateHost_()` in `script/CreateNewTracker.js`, gated on a new Script Property `IS_TEMPLATE_HOST` (must be set manually on the Template only — properties don't propagate via `.copy()`, making this a reliable host signal). `autoGenerateNextMonthTracker` now aborts and emails Site Q a clear wrong-host error instead of proceeding with missing config.

**Also shipped this session:**
- `hideInternalSheets_` rewritten from a hide-list to an allow-list (`Tracker, Bonus Tracker, Team Score, HIM Score, Goals by HIM, Goals by AO, Help` stay visible; everything else, including `Responses`/`TrackerDB`, gets hidden) and now deletes `PaxDB` outright.
- `GasLogger.js` gained an optional Axiom sink: `flush()` routes exclusively to Axiom when `AXIOM_TOKEN`/`AXIOM_DATASET` script properties are both set (ported from `/mnt/c/dev/GAS-Core`'s `GasLogger.js` pattern), else unchanged Drive-file behavior. Existing `init()`/`log()`/`flush()` API and ~32 call sites untouched. New pure `buildAxiomRows_` helper, unit tested in `test/test_gas_logger.js`.
- `local.settings.json`/`.example` renamed `AxiomToken`/`AxiomDataSet` → GAS-Core's `axiomDataset`/`axiomToken`/`axiomQueryToken` convention; added `query-axiom.py` (ported from GAS-Core) for CLI querying.
- `test/test_create_new_tracker.js` rewritten for the allow-list/PaxDB behavior; `test/test_create_new_tracker.js` and `test/test_gas_logger.js` wired into `npm test` (previously only `test_utilities.js` etc. ran).
- Deployed to TEMPLATE via `npm run push` (v2.2.1) — included the uncommitted `script/go30tools.js` since clasp pushes the whole `script/` dir regardless of git status.

**bd tracking:** F3Go30-7mz closed as invalid premise (comment records the corrected diagnosis); F3Go30-36gl opened and closed for the wrong-host guard fix.

### Key Learnings:
- GAS Script Properties never propagate via `SpreadsheetApp.copy()` — each copy gets an independent bound script project with its own (initially empty) properties store. This is both the root cause of today's bug and the basis of the `IS_TEMPLATE_HOST` fix's reliability.
- Axiom API tokens are scoped per-capability (ingest vs query) even when scoped to one dataset — an ingest-only token returns a clean 403 (`token does not have access to resource: query with action: read`) on query attempts. Querying an empty dataset for a not-yet-ingested field (e.g. `--name`) also fails with `invalid field` until the first event establishes that field in the schema.
- `clasp push -f` is a literal mirror of `script/` onto the target script ID — no git-status awareness, no diffing. Uncommitted files go live exactly like committed ones.
- Never run `find /` (or anything root-anchored) to locate a file the user already told you the path to — this environment mounts several network shares under root; scope searches to the narrowest known directory instead (saved as a standing feedback memory).

## 2026-06-22 22:16:48

### Summary:
Added `GasLogger.run(triggerName, fn)` wrapper to script/GasLogger.js (init + try/finally flush + error logging) plus lazy auto-init in `log()`, replacing the manual init/flush pattern that left several entry points (notably `sendNagEmail`) with early-return paths that silently skipped flush. Wrapped all real Apps Script entry points — `handleFormSubmit_`, `markEmptyCellsAsMinusOne`, `sendNagEmail`, `onOpen`/`initializeTriggers`/`InspireNow`, `copyAndInit`/`reinitializeSheets`/`initializeConfigSheet`/`initializeMonthlyTrigger`/`autoGenerateNextMonthTracker`, `scanTrackers`/`scanAllGo30` — in `GasLogger.run(...)` and converted ~70 raw `Logger.log()` calls inside their call trees to structured `GasLogger.log(tag, data)` calls. Removed the now-dead `_sanitizeLogToken_` helper in go30tools.js. `script/NotificationSBCode.js` left untouched per its existing comment (background/polling functions must use `Logger.log()` directly). All 9 test suites pass.

### Key Learnings:
Apps Script has no execution-lifecycle hook (no `process.on('exit')` equivalent), so GasLogger's accumulated entries can only be guaranteed to flush by wrapping each entry point once — not by auditing every return path inside it. `GasLogger.log()` already calls `Logger.log()` unconditionally regardless of init/flush state, so converting a raw `Logger.log()` call to `GasLogger.log()` is safe even outside a wrapped scope: worst case it behaves identically (visible in Stackdriver only), best case it also persists to Drive/Axiom once flushed.

## 2026-06-23 16:10:00

### Summary:
Resolved the credential mismatch blocking webapp deployment testing. `tools/manage-deployments.js` now sets `CLASP_CONFIG=~/.clasprc-f3go30.json` (via `os.homedir()`) as an explicit `env` override on every `execSync` call, so `npm run push`/`deploy:month`/`deploy:test` no longer depend on whatever clasp credential happens to be active in the shell. Project `CLAUDE.md` updated to document the new path and note the script sets it automatically. Extended `manage-deployments.js` so the `test` target also runs `clasp deploy --deploymentId <id>` after `clasp push -f`, reusing the existing named "TEST_APP" deployment instead of leaving it stale at `@HEAD`. Confirmed the TEST_APP deployment (`AKfycbyGAclL…Ce5Tu`) lives inside the `templateScriptId` project, not a separate test script project — populated `local.settings.json`'s previously-placeholder `testScriptId`/`testSpreadsheetId` with the template's IDs and added `testDeploymentId`. Ran `npm run deploy:test` end-to-end (push → named-deployment update, now @6) and verified both `doGet` and `doPost` against the live `/exec` URL return `{"status":"ok"}`.

### Key Learnings:
- `clasp deploy --deploymentId <id>` updates an existing named deployment in place (same URL) — required for any webapp target; `clasp push -f` alone only updates `@HEAD` and never touches named deployments.
- curl gotcha testing GAS webapps: explicitly passing `-X POST` pins that method through the 302 redirect to `script.googleusercontent.com/macros/echo`, which only accepts GET and returns a misleading "Page Not Found" (actually a 405). Let `-d` imply POST on the first request and omit `-X` so curl naturally downgrades to GET on the redirect.
- `WebApp.js`'s `doGet`/`doPost` are currently stub handlers (log + echo `{"status":"ok"}`) — no action dispatch logic yet; next step for the webapp feature is real request routing.

## 2026-06-24 05:50:00

### Summary:
Fixed clasp credentials properly: discovered `CLASP_CONFIG` was never a real clasp variable (clasp 3.3.0 only reads `clasp_config_auth`, lower-case exact match, bound via `-A, --auth <file>` in `commands/program.js`) — every earlier "successful" test had silently fallen back to the default `~/.clasprc.json`. Reworked `tools/manage-deployments.js` to read a new `claspAuth` field from `local.settings.json` and pass it via `clasp_config_auth`; updated `local.settings.json.example`, `README.md`, `docs/OPERATIONS.md`, `docs/deployment-model.md` to match. Added auto patch-version-bump to every `deploy()` call (`bumpPatchVersion_`, TDD'd) so each push/deploy is uniquely versioned; `release:patch/minor/major` pass `--skip-bump` since `npm version` already bumps there.

Implemented the full HC signup webapp backend (`cmd=signup`) per `docs/signup-webapp-requirements.md`, tracked as F3Go30-bmm2 (supersedes the sign-up half of F3Go30-t90). Pure logic in new `script/signupWebapp.js`, all TDD red/green: `classifyTeam_` (AO/Goal/Other reclassification against live `ListDB`), `findSignupMatch_` (F3 Name+Email anti-enumeration matching), `parseTeamListsFromListDbRows_`/`readTeamLists_`, `trackerHasF3Name_` (mirrors `handleFormSubmit_`'s exact-match dedup), `buildResponseRowFromForm_` (form-to-row mapping, with undefined-skip for partial/feedback-only updates), `parseLinksRows_`/`resolveSignupMonths_` (current/next month resolution, handles duplicate-StartDate Links rows by latest `Date`). Extended `RESPONSE_COLUMN_MAP` with optional `FEEDBACK_RATING`/`FEEDBACK_COMMENT` (mapped to the previously-unused `Constructive Comments` column). Built the GAS orchestration layer (`handleSignupIdentify_`/`handleSignupSave_`/`handleSignupFeedback_`, not unit-testable) and wired `WebApp.js`'s `doGet`/`doPost` to dispatch `?cmd=signup`. Authored `script/SignupApp.html` as a plain vanilla HTML/CSS/JS port of the approved Claude-design mockup (the original `.dc.html`/`support.js` format requires `window.React` and a proprietary runtime — not deployable as a static GAS `HtmlService` file).

Verified live against TEST_APP (which is bound to the live Template spreadsheet, not an isolated copy): `doGet?cmd=signup` renders with real server-injected `ListDB`/`Links` data; `identify` verified read-only safe. `save` was live-tested against `targetMonth:"current"` with a throwaway "ZZZ Test Pax" row — this turned out to write into the **live June tracker that real PAX use**, caught by the user mid-session. Cleaned up via a temporary, tightly-scoped debug endpoint (hardcoded target resolution and literal test name, no client-controlled parameters — an earlier draft with client-supplied `sheetId`/`sheetName` was correctly blocked by the auto-mode safety classifier as an unauthenticated arbitrary-delete surface), verified June fully restored (19 rows in both `Responses`/`Tracker`, matching pre-test state), then removed the debug endpoint entirely and confirmed it's gone from the live deployment.

### Key Learnings:
- clasp 3.3.0's actual auth option is `-A, --auth <file>` bound to env var `clasp_config_auth` (lower-case, exact match via Commander's `option.envVar in process.env`) — verify third-party CLI env vars against the installed package's source, not casual phrasing or a test that merely "looked like it passed" (a wrong env var can silently no-op into a working default file).
- F3Go30's `TEST_APP` deployment shares the live Template spreadsheet — "current month" resolves to whatever tracker is genuinely active right now, not a sandbox. Any live write-path test must target `targetMonth:"next"` only.
- The Claude-design mockup export format (`.dc.html` + `support.js`) is a proprietary preview-tool runtime requiring `window.React`/`window.ReactDOM` — it is not a deployable static artifact and must be manually ported to vanilla HTML/CSS/JS for GAS `HtmlService`, which only serves static files with no build step.
- `buildResponseRowFromForm_` needed an explicit "skip when value is undefined" rule to safely support partial updates (e.g. a feedback-only write must never blank out the F3 Name/team/goals fields it doesn't mention).

## 2026-06-24 15:11:41

### Summary:
Completed the kpe5 (ADR-010 centralized TrackerDB dispatch) epic's critical path — 6/7 children closed, leaving only two deliberately-deferred P3 items (shsx, w6y3). qyk.1: consolidated the separate `Links` sheet into a single SheetId-keyed `TrackerDB` sheet (CreateNewTracker.js writes directly to it; go30tools.js no longer reads a parallel Links sheet, and `_mergeTrackerDbRowsForScan_` stops a rescan from silently dropping rows it didn't touch). qyk.2: added `LastSignupAt`/`TriggersInitializedAt`/`LastMinusOneRunAt`/`LastNagRunAt` lifecycle columns, preserved across rescans via `_carryForwardLifecycleFields_`. qyk.3 folded into qyk.1 (signupWebapp.js/signupReuse.js readers updated to the unified sheet — couldn't ship qyk.1 without it). vr80: added `resolveTrackerDbRowForContextDate_` — the shared TrackerDB date-range lookup, grouping rows by StartDate into ascending active ranges (latest row open-ended), throwing loudly on zero-match or duplicate-StartDate ambiguity. bga1/3sqo: refactored `markEmptyCellsAsMinusOne_`/`sendNagEmail_` off `getActiveSpreadsheet()` onto `resolveTrackerForContextDate()` + `SpreadsheetApp.openById()`. 5bc5: refactored form-submit dispatch — after walking through the Apps Script trigger model with the user (installable vs simple triggers; `.forSpreadsheet()` vs `.forForm()`), kept `.forSpreadsheet()`/`e.range` semantics per the user's explicit minimal-risk call (form-submit is a deliberate low-risk fallback being phased out in favor of the webapp signup path) rather than rewriting onto FormResponse objects; `onFormSubmitLocked_` now derives its spreadsheet via `e.range.getSheet().getParent()`, and `setupFormSubmitTrigger`/`clearFormSubmitTrigger` take an explicit target spreadsheet (scoped by `getTriggerSourceId()`) so centralizing trigger creation never touches another tracker's trigger. 39dp: removed the per-copy "Initialize Triggers" menu item, replaced with Template-only `initializeTemplateDispatchTriggers()`; wired `setupFormSubmitTrigger(newSpreadsheet)` into both tracker-creation paths so each new tracker's trigger installs automatically at creation time — deliberately kept `IS_TEMPLATE_HOST`/`isTemplateHost_()` since it's `autoGenerateNextMonthTracker_`'s unrelated safety guard, not part of ADR-010's daily dispatch. qyk.4/qyk: updated docs/CONTEXT.md, docs/DESIGN.md, docs/OPERATIONS.md to describe the implemented (not planned) state — closed the epic.

Process note: committed in small scoped commits using `git commit -- <pathspec>` throughout, since several touched files (package.json, script/version.js, docs/*) already had substantial unrelated pre-existing uncommitted work from before the session — a careless `git add -A`/`git commit` would have swept that in. One real mistake during this: overwrote `script/version.js` back to HEAD via the Write tool to strip an `npm test` stamping side-effect, not realizing the file had already been showing as modified *before* the session started (likely an earlier stamp, never confirmed) — flagged it to the user immediately rather than silently moving on.

### Key Learnings:
- Apps Script installable triggers (`ScriptApp.newTrigger(...).forSpreadsheet(ss)...create()`) execute using the code of whichever script project calls `.create()`, not the project bound to `ss` — this is what makes "centralize the handler in the Template, but still install one trigger per tracker spreadsheet" actually work. Simple triggers (bare `onFormSubmit(e)`) are the only ones that are truly container-bound; this distinction is easy for someone unfamiliar with GAS to miss.
- `.forSpreadsheet().onFormSubmit()` gives `e.range`/`e.values` (a row reference); `.forForm().onFormSubmit()` gives `e.response` (a FormResponse object, no row reference at all) — these are not interchangeable event shapes, and switching trigger type means rewriting the entire downstream row-reading logic.
- `SpreadsheetApp.copy()` always duplicates the bound script along with the spreadsheet — there is no way to copy a spreadsheet without copying its Apps Script project. ADR-010's "pure data spreadsheet" framing is about behavior (nothing should run from there) not literal code absence; every monthly tracker copy still carries a full, inert duplicate of the Template's code.
- Before any `git commit`, check `git diff --cached --stat` against what you actually intend to commit — `git add <specific files>` followed by `git commit` (no pathspec) will sweep in *any* already-staged content on unrelated files too. Use `git commit -m "..." -- <pathspec>` to commit only the intended paths and leave the rest of the index untouched.

## 2026-06-25 09:47:28

### Summary
Resumed mid-session (session-2026-06-25-smoke-mode-midpoint). Completed remaining tasks from PaxDB refactor + Smoke mode feature: finished rename cleanup, added unit tests for `deletePaxDbRowsBySheetId_`, updated OPERATIONS.md and deployment-model.md for SIT/PROD/Smoke lifecycle, deployed v2.2.21 to SIT, and verified all three smoke-mode behaviors live. Committed as d37aaef.

### Details
- **Task 9 (finish):** Renamed final `copyResponsesToCurrentTracker` references to `applyPaxDbSettingsToCurrentTracker` in `response_utils.js` GasLogger call, `go30tools.js` JSDoc, and `test_go30tools.js` comment
- **Task 10:** Added `deletePaxDbRowsBySheetId_` unit tests; fixed bug — `_updatePaxDB` now accepts optional spreadsheet arg so `deletePaxDbRowsBySheetId_` can pass through the caller's spreadsheet instead of falling back to `SpreadsheetApp.getActiveSpreadsheet()`; added `getMaxRows`/`clearContent` to fake sheet helper
- **Task 11:** `OPERATIONS.md` — added §Environments (SIT/PROD table), §Smoke Mode (activate/teardown/confirm lifecycle), expanded Script Properties table (`SMOKE_MODE`, `SMOKE_TRACKER_ID`, `ADMIN_SHARED_SECRET`); `deployment-model.md` — added SIT→PROD go-live sequence with smoke test gate
- **Task 12:** Deployed v2.2.21 to SIT (`npm run deploy:test`); verified `getSmokeStatus` returns correct environment, `setScriptProperties {SMOKE_MODE:true}` activates smoke mode, `runScanTrackers` returns `smoke_mode_active` error while active, and deactivation restores clean state

### Key Learnings
- `_updatePaxDB` was written with `SpreadsheetApp.getActiveSpreadsheet()` (GAS global pattern) but `deletePaxDbRowsBySheetId_` receives a spreadsheet arg — the mismatch only surfaces in unit tests where the GAS global is absent. Adding an optional arg to `_updatePaxDB` fixes both the test and the production path.
- Fake sheet `clearContent` must splice the rows array, not just zero-fill, or trailing empty rows survive into `getDataRange()` and corrupt read-back assertions.

## 2026-06-25 18:20:00

### Summary
Fixed four issues discovered during smoke test run; added callAdmin tool and deployment ID persistence.

### Changes
- **`script/Utilities.js`** — `prepareOutboundEmailDelivery_`: redirect emails to Site Q when `SMOKE_MODE=true`, same as `emailTestMode`; `[SMOKE]` subject prefix; distinct `smokeMode`/`testMode` flags in return value
- **`script/urlShortener.js`** — sanitize TinyURL alias to `[a-zA-Z0-9_-]` before API call; spaces become hyphens, parentheses and other special chars stripped; fixes alias rejection when NameSpace includes " (Smoke)"
- **`script/CreateNewTracker.js`** — `copySpreadsheetWithoutScript_`: new helper copies sheets individually via `sheet.copyTo()` + recreates named ranges; no container-bound script in tracker copy; `copyAndInit_` and `autoGenerateNextMonthTracker_` both updated to: (a) pre-check folder and template form URL before creating any artifacts, (b) use the new helper, (c) explicitly copy form from template via `DriveApp.makeCopy` + `form.setDestination`, (d) rename auto-created "Form Responses 1" → "Responses"
- **`tools/callAdmin.js`** — new CLI tool; resolves deployment ID and admin secret for env (SIT default, `--env prod`), constructs web app URL, POSTs action payload, follows GAS 302 redirect, prints JSON; moved from `tests/` to `tools/`
- **`tools/manage-deployments.js`** — writes `testDeploymentId` / `templateDeploymentId` back to `local.settings.json` after each deploy so `callAdmin` and other tools can read the ID directly

### Key Learnings
- `spreadsheet.copy()` always includes the container-bound script; the only GAS-native way to avoid this is to create a blank spreadsheet and copy sheets individually with `sheet.copyTo()`, then recreate named ranges separately
- `form.setDestination(FormApp.DestinationType.SPREADSHEET, id)` creates "Form Responses 1" automatically — rename it to "Responses" post-flush
- Pre-checking the template form URL before any artifact is created prevents orphaned spreadsheets on early return
- TinyURL aliases must be `[a-zA-Z0-9_-]`; the GAS script was passing the spreadsheet name directly (spaces, parentheses) which caused silent failures caught by the retry loop but never resolved

## 2026-06-25 16:00:48

### Summary
Fixed Bug 3 (#REF! errors in Goals by HIM on new tracker copies): sheet-index-driven copy logic, onFormSubmit trigger rewrite to separate form destination sheet from Responses. Deployed to SIT v2.2.28. Smoke mode reactivated; waiting on human to run copyAndInit from SIT template to verify fix.

### Details
- Created bd issue F3Go30-v5fw for the Responses column mismatch fix
- Added `TRACKER_SHEET_INDEX_` constant in CreateNewTracker.js (20 sheets, Visible/Hidden/Delete dispositions); filled in from user-updated OPEN.md
- `copySpreadsheetWithoutScript_`: replaced heuristic copy logic with index-driven loop — Responses (Hidden) now copied from template preserving stable column order
- `hideInternalSheets_`: replaced `visibleAllowList` + hardcoded PaxDB delete with index-driven loop
- `copyAndInit_` + `autoGenerateNextMonthTracker_`: delete "Form Responses 1" after `form.setDestination()` instead of renaming — Responses already present from template copy
- `addResponseOnSubmit.js`: new `appendToResponsesSheet_` maps processed form row (form column order) into Responses (template column order) using `buildResponseFieldCopyPlan_`; rewrote `onFormSubmitLocked_` to resolve columns from `e.range.getSheet()`, pass form destination sheet to `maybeReuseLastMonthsGoals_`, run Phase 3 on form sheet, append mapped row to Responses, then dedup
- Tests updated: `hideInternalSheets_` assertions (TrackerDB now Delete, not Hidden); new `appendToResponsesSheet_` test
- All 15 tests pass; deployed to SIT (v2.2.28); old smoke tracker trashed; smoke mode cleared and reactivated

### Key Learnings
- Separating the form destination sheet from the Responses store is the correct architecture: form question order can drift from template column order; the trigger is the reconciliation point, not the sheet name
- `buildResponseFieldCopyPlan_` in response_utils.js was already available and handles the field-by-field mapping cleanly — no custom mapper needed

## 2026-06-25 16:40:36

### Summary
Diagnosed and fixed `copyAndInit` crash during SIT smoke run; added `query_axiom.py` tooling; deployed v2.2.29 to SIT.

### Details
- **Smoke run failure:** `copyAndInit` from the menu produced "Orphaned spreadsheet ID" error. Initial read suggested the Tracker sheet was missing, but inspecting the spreadsheet directly showed it existed.
- **Root cause via Axiom:** Used new `tools/query_axiom.py` to query Axiom logs. Found the real error: `"You cannot delete a sheet with a linked form. Please unlink the form first."` The code calls `form.setDestination()` (which auto-creates "Form Responses 1" linked to the form), then immediately tries to delete that sheet — GAS blocks the delete.
- **Fix:** Added `form.removeDestination()` before the `forEach` delete loop at both occurrences in `CreateNewTracker.js` (manual `copyAndInit` path ~line 319 and auto-generate path ~line 885). The form destination is still routed correctly because `onFormSubmitLocked_` finds the Responses sheet by name, not by the auto-created sheet link.
- **Deployed:** v2.2.29 to SIT.

### Key Learnings
- `form.setDestination()` always creates a "Form Responses 1" sheet linked to the form; GAS will not let you delete that sheet while the link exists — `form.removeDestination()` must precede the delete.
- `tools/query_axiom.py` (new this session) provides fast CLI access to Axiom logs without re-deriving APL syntax each time. Filter with `--name <substring>` or `--since <duration>`.

## 2026-06-25 23:57:18

### Summary
Refactored tracker creation logic to use direct Drive copy (preserves formulas); extracted shared `createTrackerSpreadsheet_()` called by both manual and auto-generate paths; both now send onboarding email. Updated cleanup to unlink and delete forms before trashing spreadsheets. Deployed v2.2.30–31 to SIT.

### Details
- **Tracker refactor (F3Go30-kohs):** Replaced sheet-by-sheet copy with `DriveApp.getFileById(...).makeCopy()` to preserve cross-sheet formula integrity. Extracted 150+ lines into `createTrackerSpreadsheet_(options)` taking a `logFn` callback for notification differences (sidebar vs email). Both `copyAndInit_` and `autoGenerateNextMonthTracker_` now delegate to it; both send onboarding email on success.
- **Form lifecycle fix:** `setDestination()` auto-creates "Form Responses 1" linked to the form. Cannot delete while linked, so now hiding it instead (required for `forSpreadsheet().onFormSubmit()` trigger to work). Removed incorrect `removeDestination()` call from earlier fix.
- **Cleanup teardown:** `cleanupTracker` now unlinks form (`.removeDestination()`), trashes the form, then trashes the spreadsheet. GAS blocks spreadsheet trash while a form destination points at it.
- **Removed:** `copySpreadsheetWithoutScript_()` — no longer used.
- **Bug fix:** `autoGenerateNextMonthTracker_` was passing `formUrl` instead of `formShortUrl` to upsertLinksRow_ for `shortHc` field.
- **All tests pass, deployed v2.2.30 and v2.2.31 to SIT.**

### Key Learnings
- `setDestination(DestinationType.SPREADSHEET, ssId)` auto-creates a new sheet and links the form to it; the trigger system requires that link, so the sheet cannot be deleted. Hiding is the right approach.
- Form lifecycle in tracker cleanup: form must be unlinked before the spreadsheet can be trashed (undocumented GAS constraint).
- Direct Drive copy (`.makeCopy()`) is simpler and preserves formula integrity better than sheet-by-sheet copy with manual named-range recreation.

## 2026-06-26 01:52:00

### Summary
Diagnosed and fixed signup short URL pointing to stale webapp deployment. Root cause: bound script's `ScriptApp.getService().getUrl()` returns bound script deployment ID, not webapp deployment ID—critical distinction when they run under different deployments.

**Fixes:**
- Added deployment URL display to About dialog for debugging bound script execution context
- Created `setWebappUrl` admin action to capture webapp's actual deployment URL
- Updated `ensureSignupShortUrl_()` to read WEBAPP_URL script property instead of trusting `getService().getUrl()`
- Deployed v2.2.33 with fixes; signup URLs now correctly point to current webapp

### Key Learnings
When a Google Apps Script project has both bound script (attached to spreadsheet) and webapp enabled: `ScriptApp.getService().getUrl()` returns the deployment URL of whichever context the code is running in, not a canonical "current" webapp URL. If bound and webapp execute under different deployments (happens with stale execution contexts or separate deploy cycles), URLs will not match. Solution: explicitly store webapp URL as a Script Property when webapp runs; bound script reads from that property. Created design note: **GAS-Core-q2b**.

### Files Changed
- script/WebApp.js — added setWebappUrl admin action
- script/CreateNewTracker.js — updated ensureSignupShortUrl_ to use WEBAPP_URL script property
- script/onOpen.js — added deployment URL display to About dialog (for debugging)


## 2026-06-25 20:28:19

### Summary
Fixed three bugs in signup and tracker creation; restored form-from-spreadsheet-copy pattern; added duplicate tracker detection with expiry rename.

### Changes

**Fix: web app "Other" team not populating TEAM column (script/signupWebapp.js)**
- `buildResponseRowFromForm_` was writing `''` to TEAM when `teamType === 'other'`; the Google Form path has Phase 3 promotion but the webapp path did not
- Changed `setIfMapped('TEAM', ...)` to always write `formData.team` regardless of teamType — custom team name now lands in both TEAM and OTHER_TEAM, matching form path behavior
- Updated `test/test_signup_webapp.js` assertion to expect the promoted value

**Fix: tracker creation form handling (script/CreateNewTracker.js)**
- Root cause: `copySpreadsheetWithoutScript_` era introduced an explicit separate form copy + `setDestination`; this was never cleaned up when we reverted to `makeCopy`
- Result: new tracker had TWO forms, "Tools > Manage form" was broken, and the auto-copied form was "not published" (not accepting responses)
- Fix: removed explicit form `makeCopy` + `setDestination`; reverted to old pattern — `makeCopy` auto-copies the linked form, then `newSpreadsheet.getFormUrl()` accesses it for rename/move/configure
- Added `form.setAcceptingResponses(true)` as defensive guard
- Stopped deleting "Form Responses 1" — it must remain visible for "Tools > Manage form" to work

**Feature: duplicate tracker detection (script/CreateNewTracker.js, script/onboardingEmail.js, script/OnboardingEmailTemplate.html)**
- Before creating any artifacts, `createTrackerSpreadsheet_` checks TrackerDB for an existing row with the same spreadsheet name
- If found: renames the old spreadsheet (Drive file + internal name), its form (Drive file + title), and the TrackerDB entry to `[name] (Expired)` / `[name] HC (Expired)`
- Graceful fallback if old spreadsheet is already trashed
- Expiry notice surfaces in: copyAndInit sidebar (bold amber warning), onboarding email plain text, and HTML email (amber banner)
- Both `copyAndInit_` and `autoGenerateNextMonthTracker_` covered via shared `createTrackerSpreadsheet_` path

### Deployed
v2.2.36 to SIT


## 2026-06-26 03:58:00

### Summary
Automated smoke test workflow and cleaned up custom menu.

**Smoke test automation:** Created `tools/smokeTest.js` to automate the 8-step smoke test sequence (activate mode, create tracker, sign up PAX, verify sheet, pause for human review, teardown). Added `--teardown` flag for manual cleanup. Fixed HTTP timeout handling in `callWebapp.js` (120s) to accommodate slow GAS operations. Ran successful smoke test against SIT.

**Menu cleanup:** Removed test/dev menu items (testFunction, testReuseMenu, reinitializeSheets). Kept essential owner-only items: Copy and Initialize, Initialize Nightly Triggers, Initialize Monthly Trigger, About. Added new "Clear All Triggers" function and menu item.

**Deduplication fix:** Made F3 name deduplication case-insensitive with whitespace trim in both tracker form handler and signup webapp, ensuring identical dedup logic across paths.

**Deployment:** Pushed all changes to SIT (version 2.2.37).

### Key Changes
- `tools/smokeTest.js` — 400+ lines, automated workflow with polling, Axiom error checking, human pause
- `tools/callWebapp.js` — fixed timeout handling with timedOut flag to prevent destroying successful responses
- `script/onOpen.js` — removed 150+ lines of test code, added clearAllTriggers(), cleaned menu
- `script/addResponseOnSubmit.js`, `signupWebapp.js` — case-insensitive F3 name matching

### Next Steps (if any)
Consider manual smoke test run on PROD before go-live once ready.


## 2026-06-25 22:22:04

### Summary
Code review on v2.2.37 changes; fixed all actionable findings before deploy.

**Review findings (8 total, 7 fixed):**

- **Critical — ReferenceError crash (signupWebapp.js):** PaxDB refactor removed `var row` and `var state` from `handleSignupIdentify_` but left two lines still referencing them (`phone: row[state.columns.PHONE]`, `nag: String(row[state.columns.NAG_EMAIL]...)`). Every identify call for a returning PAX would throw at runtime. Fixed by adding a supplemental Responses-sheet lookup (try/catch) for `phone` and `nag` after the PaxDB match — restores both fields without reverting the PaxDB primary lookup.

- **nag.js early-exit returns:** Four bare `return;` in `sendNagEmailForSpreadsheet_` returned `undefined` instead of `0`, inconsistent with the new integer return contract used by `runNagCheck`. Changed all to `return 0;`.

- **clearAllTriggers no pre-confirmation:** The menu item deleted all project triggers before showing any dialog. Added `alert(OK_CANCEL)` pre-confirmation; bails on Cancel. Post-deletion summary alert unchanged.

- **Smoke test only called identify, not save:** Step 5 only did a prefill lookup (`action: 'identify'`) — no PAX row was written. The subsequent Tracker sheet check showed only headers. Split into 5a (identify), 5b (full save with test PAX payload), 5c (sheet verify). Signup write path is now exercised.

- **smokeTest.js typo + silent stderr:** `queryAxisomForErrors_` renamed to `queryAxiomForErrors_`; added `stderr` handler so Python errors (import failures, auth issues) are printed rather than silently discarded.

- **Skipped:** `parseArgs_` duplication between smokeTest.js and callWebapp.js — both functions serve distinct flag sets; only the `--env` fragment is shared, not worth the coupling.

### Key Changes
- `script/signupWebapp.js` — phone/nag supplemental Responses lookup in handleSignupIdentify_
- `script/nag.js` — 4 early-exit `return;` → `return 0;`
- `script/onOpen.js` — clearAllTriggers pre-confirmation dialog
- `tools/smokeTest.js` — save step added, typo fixed, stderr handler added

## 2026-06-25 22:37:16

### Summary
Deployed to SIT (v2.2.42), ran smoke test, discovered and fixed phone/nag prefill bug in webapp identify flow, confirmed fix in v2.2.43.

### Details
- Deployed v2.2.42 to SIT and ran automated smoke test (steps 1–5 passed; teardown deferred for human review)
- Identified bug via manual signup form test: `identify` returned correct WHO/WHAT/HOW/team for matched PAX but phone and nag fields were always blank
- Root cause: `findPaxDbMatch_` (`signupWebapp.js`) built the match object without `phone`/`nagEmail` fields; `handleSignupIdentify_` then fell back to reading those from the current month's Responses sheet (empty for new signups); stale comment claimed "phone and nag are not stored in PaxDB"
- PaxDB confirmed to have `Phone` and `NAG Email` columns (populated by `scanTrackers` / `upsertPaxDbRow_`)
- Fix: added `phone` and `nagEmail` to `findPaxDbMatch_` return object; removed Responses-sheet fallback in `handleSignupIdentify_`; removed stale comment
- Created and closed F3Go30-p8gd; deployed v2.2.43; confirmed via direct API call (`phone: 2067797808, nag: true`) and user verification in form

## 2026-06-26 05:48:00

### Summary
Deployed v2.2.44 to PROD; bootstrapped PROD admin secret; fixed missing WEBAPP_URL post-deploy; ran scan trackers on PROD.

### Details
- **deploy:prod** — pushed 28 files, updated named deployment to v2.2.44
- **templateAdminSecret** — generated random 48-char hex secret, saved to local.settings.json; user manually bootstrapped ADMIN_SHARED_SECRET on PROD via the pre-auth `bootstrapSecret` action
- **WEBAPP_URL fix** — discovered WEBAPP_URL script property was not being set on prod deploys, causing broken signup links; called `setWebappUrl` manually to recover
- **Auto-set WEBAPP_URL** — added `setWebappUrl` call to `manage-deployments.js` `deploy()` function (template target only) so WEBAPP_URL stays in sync after every future prod deploy
- **runScanTrackers** — PROD: 27 scanned, 2 processed, 4 unchanged, 6 tracked, 21 skipped

## 2026-06-26 14:48:08

### Summary
Skip month-choose step when no next-month tracker exists in TrackerDB.

### Details
- Modified `script/SignupApp.html`: extracted save API call into `performSave_(triggerBtn)` shared function
- `infoNextBtn` now checks `MONTHS.next` — if absent, sets `targetMonth='current'` and saves directly, bypassing the choose step
- When `MONTHS.next` exists, behavior unchanged (choose step shown with both month options)
- `saveBtn` delegates to same `performSave_` — no duplicate logic

## 2026-06-27 11:07:47

### Summary
Fixed GAS trigger event bug that was silently breaking both nag email and mark-minus-one daily triggers; added live PaxDB stats refresh at end of mark-minus-one.

### Details
- **Root cause (NAGMAILBUG):** GAS time-based triggers pass a TriggerEvent object as the first argument, not `undefined`. Both `sendNagEmail_` and `markEmptyCellsAsMinusOne_` used `new Date(contextDate || Date.now())` — a TriggerEvent is truthy, so this evaluated to `new Date(eventObject)` → Invalid Date → `resolveTrackerDbRowForContextDate_` threw.
- **Fix:** Guard in all date-normalization sites: `new Date(typeof contextDate === 'string' || typeof contextDate === 'number' ? contextDate : Date.now())`. Also fixed each outer function to pass the normalized `today` (not the raw trigger arg) to its inner `ForSpreadsheet_` helper.
- **Files changed:** `script/nag.js` (3 sites), `script/markMinusOne.js` (3 sites).
- **PaxDB refresh:** Added `refreshPaxDbForTracker_(trackerSpreadsheet, sheetId, startDate)` to `go30tools.js`. Reuses existing `_loadPaxData` + `upsertPaxDbRow_` — no new stat-collection logic. Called from `markEmptyCellsAsMinusOne_` after `-1` marking completes, so PaxDB stays current without waiting for manual `runScanTrackers`.

### Key Learnings
- GAS time-based trigger handlers always receive a TriggerEvent as arg 0 — any `|| Date.now()` fallback is bypassed because the event object is truthy. Pattern: guard on `typeof === 'string' || typeof === 'number'` before passing to `new Date()`.

## 2026-06-29 18:59:12

### Summary
Investigated and fixed PROD nag email incident where real emails were sent despite Email Test Mode = Yes. Cleaned up ManagedConfigSheet API as part of the fix. Fixed 4 pre-existing test failures. Deployed to SIT.

### Details

**Incident investigation**
- Queried Axiom logs: found `target=TEMPLATE, testMode=False` at 17:04 UTC (~10am PDT) — 3 real recipients received nag emails
- Root cause: `nag.js:sendNagEmailForSpreadsheet_` reads the delivery policy from each **tracker's** Config sheet, but `Email Test Mode = Yes` is set in the **template's** Config sheet. Tracker Config sheets don't carry that setting, so it resolved to false.
- Secondary bug: fallback when Config sheet is missing used `[]` (truthy) instead of `null`, preventing the spreadsheet fallback path in `getConfigValue_`.

**Fix — 3 files**
- `script/libSheets.js`: Split `ManagedConfigSheet.getValue()` to return scalar (column B); added `getPair()` for two-column keys (Site Q, Signup HC Form). Config key audit confirmed 4 scalar-only keys and 2 that need both columns.
- `script/Utilities.js`: Updated `getConfigValue_` to call `getPair()` (maintains `{primary,secondary}` contract for existing callers). Added `openAppConfigSheet_(trackerSpreadsheet)` — returns template Config when `IS_TEMPLATE_HOST=true`. Added `readEmailDeliveryPolicyFromSheet_(configSheet)` — uses typed `getValue()`/`getPair()` API.
- `script/nag.js`: Added module bindings for new functions. Fixed `[] → null`. Reads delivery policy via `openAppConfigSheet_` + `readEmailDeliveryPolicyFromSheet_`; passes pre-computed `policy` to `sendConfiguredEmail_`.

**Pre-existing test fixes**
- `test_signup_reuse.js`, `test_utilities.js`: Updated stale label expectations (`NAG Email` → `Send reminder email`; `Who/What/How` → full display phrases) to match `response_utils.js` changes.
- `test_signup_webapp.js`: Updated `trackerHasF3Name_` assertions — function is case-insensitive (trim+lowercase), test expected exact match.
- `test_mark_minus_one.js`: Added missing `getId()` on fake spreadsheet; added `refreshPaxDbForTracker_` no-op stub.

**New test coverage**: `test_nag.js` — tests for `readEmailDeliveryPolicyFromSheet_` (test mode on/off, legacy key, null configSheet) and `ManagedConfigSheet.getValue()`/`getPair()` split.

**Status**: All 15 tests pass. Committed (`03a9762`). Deployed to SIT v2.2.61. Awaiting manual SIT verification (`sendNagEmail` from Apps Script editor), then `npm run deploy:prod`.

### Key Learnings
- When GAS code runs from the template spreadsheet (IS_TEMPLATE_HOST=true), `SpreadsheetApp.getActiveSpreadsheet()` is the template — but functions that open tracker spreadsheets by ID get a different spreadsheet object. Policy/global config must be read from the template, not from the passed-in tracker.
- `[]` is truthy in JavaScript; using it as a "no data" sentinel silently breaks `if (data)` guards that distinguish "data provided" from "go read from spreadsheet".

## 2026-07-01 01:18:23

### Summary:
Built a new PAX-facing daily check-in + dashboard web app (`cmd=checkin`) on branch
`dashboard-tool`, based on the Go30 PAX Scoring Dashboard design reference. Identity reuses
the sign-up F3 Name + Email pair (no password concept exists — ADR-011); team grouping reads
the Tracker's live Team/Goal column rather than an invented roster (ADR-012). Backend
(`script/dashboardWebapp.js`) exposes `identify`/`checkin`/`dashboard` actions and is
unit-tested (`test/test_dashboard_webapp.js`) for column classification, streak/outcome
counting, team grouping, weekly-bonus status, day-segment classification, and rolling-average
computation. Frontend (`script/CheckinApp.html`) renders identify → today/yesterday check-in →
dashboard, with a segmented SVG donut ring (score % + raw score), per-team-tile rings and
sparklines, a 7-day moving-average chart, and day-by-day mini bars on PAX board rows — all
restored via plain SVG/CSS after an initial simplification pass dropped them per user feedback.
Also added `HomeApp.html`, a landing page for the no-cmd `doGet` path linking to sign-up,
check-in/dashboard, and the current tracker spreadsheet (replacing the old bare
`{"status":"ok"}` JSON). All work live-verified end-to-end on SIT — identify/checkin/dashboard
round-trips against a real signed-up PAX (read-only) and the leftover `SmokeTest` PAX
(read+write), plus Playwright screenshots confirming the rendered dashboard and home page.
Three bd issues closed (F3Go30-ln1x, F3Go30-bjxr, F3Go30-m41e); docs (CONTEXT.md, DESIGN.md,
OPERATIONS.md) and two new ADRs updated. Branch not yet pushed or merged.

### Key Learnings:
GAS `HtmlService` templates render inside a nested iframe chain when loaded via the `/exec`
web app URL (`userCodeAppPanel` → a same-origin `/blank` frame) — Playwright selectors must
target `page.frames().find(f => f.url().includes('/blank'))`, not the top-level page or the
first-level iframe, or `waitForSelector` calls silently time out with no useful error.

## 2026-07-01 01:40:19

### Summary:
Extended the PAX check-in dashboard (dashboard-tool branch) with four requested fixes.
Mobile viewport: HtmlService's IFRAME sandbox strips a plain `<meta viewport>` tag, so
`.addMetaTag('viewport', ...)` was added to all three rendered pages (checkin, signup,
home) in `dashboardWebapp.js`/`WebApp.js`. Streak card now shows current streak plus "Best
30d" via a new pure `computeMaxStreak_()` (longest run of 1's, optionally windowed), unit
tested in `test/test_dashboard_webapp.js`. `onOpen.js`'s About dialog now reads the
`WEBAPP_URL` script property instead of `ScriptApp.getService().getUrl()`, which is
unreliable when called from a spreadsheet-menu execution rather than a live web request.
Added date-navigation arrows to the dashboard: `handleCheckinDashboard_` now accepts an
optional `dateISO`, resolves the target month via TrackerDB (`resolveTrackerForContextDate`)
instead of being locked to "current," and always returns the *entire* month's raw day
values (through real "today") in one payload. The client caches that payload per month
(`state.monthCache`) and recomputes streak/day-segments/rolling-average locally for any
day within an already-cached month, so arrow clicks within a month cost no server round
trip; crossing into an unfetched month triggers exactly one new request. Score/weekly
bonuses intentionally stay pinned to the live running total rather than being re-derived
per historical day, since the Tracker's Score column is a spreadsheet formula not safely
reproducible client-side. Added server-side `CacheService` caching (5 min TTL) of each
Tracker sheet's row2/row3/PAX-data read, invalidated immediately on check-in write. Full
existing 13-file test suite plus new tests all pass; changes not yet pushed, deployed, or
live-verified against SIT.

### Key Learnings:
Reusing one "identity resolution" function across both the always-current check-in flow
and the date-scrubbing dashboard (by parameterizing on an already-resolved `monthInfo`
rather than re-deriving "current month" internally) kept the historical-navigation feature
from duplicating the anti-enumeration Responses-matching logic.

## 2026-07-01 13:29:07

### Summary:
Fixed month-boundary bugs in the check-in dashboard (dashboardWebapp.js): yesterday's check-in
status/edit now correctly falls back to the previous month's tracker via new
resolveCheckinDayTarget_ (handleCheckinIdentify_/handleCheckinSubmit_), and the 7-day rolling
average chart now pads its display window across a month boundary with real prior-month day
values (new priorMonthDayValues server field + client-side buildRollingAverageLocal_ in
CheckinApp.html) instead of showing a sparse few-point chart early in a month. Added a WHO/WHAT/
HOW goals reminder to the check-in page, sourced from the already-cached Responses row (no new
caching needed). Bumped small/medium font sizes ~30% larger across CheckinApp.html (largest
stat/ring numbers left unchanged) and made the date-nav arrows bigger/bolder/higher-contrast.
Extended the "About" dialog (onOpen.js) with direct Signup/Dashboard links. All changes verified
live against real SIT data (Crazy Ivan, Little John) and deployed to SIT.

Also fixed the "Invalidate Cache" menu action's scope: discovered each monthly Tracker
spreadsheet is a Drive makeCopy() of the Template, which never copies Script Properties, so a
Tracker copy's script runs against its own empty PropertiesService store — a menu click there
was silently invalidating nothing. New WebApp.js admin action invalidateAllCache runs inside the
actual deployed web app's project (the real cache store) and does a full wipe across all months,
called over HTTP from onOpen.js's menu handler regardless of which spreadsheet it's opened from.

### Key Learnings:
Script Properties are never copied by Drive's makeCopy — only the Template's own script project
ever has WEBAPP_URL/ADMIN_SHARED_SECRET set, so any admin-style action triggered from a monthly
Tracker's own menu/onEdit must go through the deployed web app over HTTP (UrlFetchApp), not touch
PropertiesService.getScriptProperties() locally, or it silently operates on an empty, irrelevant
store. Note: onEdit (CacheInvalidation.js) has this same architectural gap for manual Tracker
edits made outside the web app — flagged for a follow-up fix, not yet addressed.

## 2026-07-01 14:03:04

### Summary:
Polished the checkin/dashboard web app (CheckinApp.html) — bumped all font sizes by 1px across checkin+dashboard views (including responsive overrides and SVG axis labels), replaced the thin/misaligned entity arrows (&larr;/&rarr;) on date-nav-btn with flex-centered inline SVG chevrons, widened the PAX board's F3-name column (78px->117px) and day-mini-cell blocks (4px->6px) by 50%, and centered the day-mini-bar block between the name and score% columns via justify-content:center. Diagnosed and fixed a real perf gap in getPriorMonthTailValues_ (dashboardWebapp.js): it unconditionally called SpreadsheetApp.openById on the prior month's tracker even when the tracker-layout cache and this PAX's PaxCache row were both already hit, so navigating back across a month boundary paid a needless cold spreadsheet open every time. Added a cache-only fast path (new getCachedTrackerLayoutOnly_ helper) that skips the open when both caches hit; confirmed both caches are already correctly write-through invalidated by handleCheckinSubmit_'s "yesterday" write path, so no staleness risk. Added checkinWebapp.priorMonthTail.timing GasLogger entries and unit tests for the new cache-peek helper. Verified live on SIT via Axiom logs: cold call skippedOpen=false/1593ms, repeat calls skippedOpen=true/~344-1437ms. Deployed to SIT (v2.2.82 through v2.2.86) and then to PROD.

### Key Learnings:
PaxCache (PropertiesService, per-PAX row + roster index) and the Tracker-layout cache (CacheService, 6h TTL) were already correctly write-through invalidated for the one write path that can touch a prior month (checking in "yesterday" on day 1 of a new month) — the actual bug wasn't missing caching, it was that getPriorMonthTailValues_ ignored those caches when deciding whether to pay for SpreadsheetApp.openById, always opening the spreadsheet regardless of cache state. Lesson: when investigating "is X cached", check whether the expensive call is gated on the cache result at all, not just whether a cache exists.

## 2026-07-01 17:49:32

### Summary:
Fixed a real cache-invalidation gap in PaxCache: the onEdit simple trigger (CacheInvalidation.js) could never invalidate the shared PropertiesService store because a monthly Tracker spreadsheet is a Drive copy carrying its own independent bound script + PropertiesService, so onEdit ran in the wrong project entirely. Replaced it with a Drive-modtime freshness gate in PaxCache.js (ensurePaxCacheFresh_): DriveApp.getFileById(sheetId).getLastUpdated() is readable cross-project regardless of which script owns the file, so it's compared against a stored asOf on every cache read (memoized per sheetId per execution) and wipes the sheet's cache on any drift. Deleted the now-dead CacheInvalidation.js + its test. Also added setPaxCacheRowsBulk_ (single PropertiesService.setProperties() call) and switched dashboardWebapp.js's resolveCheckinIdentityFull_ off its old per-PAX-row setProperty loop, cutting a full-roster cache rebuild from N+1 PropertiesService calls to 1.

Then built the "Bonus Check In" feature end to end (tracked as F3Go30-yj53): a PAX-facing way to list/add/edit their own Bonus Tracker entries (EHing FNG, Fellowship, Q Point, Inspire) without opening the spreadsheet. User explicitly redirected the initial plan (a new ?cmd=bonus page) to instead extend the existing check-in page, reusing its identity — new script/bonusWebapp.js (validateBonusEntry_, formatBonusRowForClient_, listBonusEntriesForPax_/addBonusEntry_/editBonusEntry_) wired into dashboardWebapp.js's handleCheckinPost_ as bonusList/bonusAdd/bonusEdit actions, no new WebApp.js route. CheckinApp.html gained a header-accessible Bonus section (list + add/edit form, link required client- and server-side for EHing FNG/Q Point/Inspire). Row appends copy the Bonus Tracker's B:E formula columns down from the row above (mirroring signupWebapp.js's Tracker-row-append pattern) since Apps Script's setValues() has no UI-style fill-down. Dates round-trip as local-midnight YYYY-MM-DD strings to avoid a UTC-shift bug. test/test_bonus_webapp.js added; npm test green; docs/CONTEXT.md and docs/sheet-reference.md updated. Live SIT verification (deploy + tools/callWebapp.js + browser walkthrough) still outstanding, pending user go-ahead to deploy.

### Key Learnings:
A Drive-copied spreadsheet's bound script is a full independent copy with its own PropertiesService/script-cache store — any onEdit-based invalidation scheme for a cache that lives in a *different* (e.g. template/deployed-webapp) script project silently no-ops, since the trigger fires in the copy's own project, not the one holding the real store. DriveApp.getFileById().getLastUpdated() is the one signal that's readable identically regardless of which script project is asking, making it the right cross-project staleness gate. Also: PropertiesService.setProperties() collapses a full-roster cache rebuild from O(N) calls to O(1) — worth using anywhere a loop is calling setProperty per row.

## 2026-07-01 18:24:43

### Summary:
Diagnosed a live SIT bug (bonusAdd -> "server_error") reported while testing F3Go30-yj53's new Bonus Check In feature. Root-caused via Axiom (query_axiom.py): the error was "coordinates of the target range are outside the dimensions of the sheet." Confirmed live against the SIT tracker spreadsheet's Bonus Tracker sheet (tools/callWebapp.js getSheet) that it's pre-formatted to exactly 892 rows (matching the sheet's own $G2:$G892 array-formula bound) but was entirely blank in B:E — because CreateNewTracker.js's initSheets() reset the Bonus Tracker with a blanket clearContent() across the whole row2+ range each month, wiping the spilled B2:E2 array-formula anchor along with the PAX-entered columns. With that anchor gone, bonusWebapp.js's addBonusEntry_ still trusted getLastRow() (inflated to 892 by leftover template formatting) to compute the next append row, landing one row past the sheet's real bounds. Fixed both: CreateNewTracker.js now only clears the PAX-entered columns (A, F:I) during the monthly reset, leaving B:E's formula anchor intact; bonusWebapp.js's addBonusEntry_ now scans column A for the first blank row within getMaxRows() (new findNextBonusRow_) instead of trusting getLastRow(), and no longer does the now-unnecessary/buggy copyTo of B:E. editBonusEntry_'s bounds check switched from getLastRow() to getMaxRows() for the same reason. Added regression tests in test_bonus_webapp.js using a mock sheet shaped like the real bug (maxRows=892, no real data). Full suite green; fix not yet deployed to SIT (pending go-ahead).

Also audited every doGet/doPost entry point and installable trigger for consistent error-logging: GasLogger.run() already exists and every true entry point (doGet/doPost, onOpen, form-submit trigger, time-driven triggers, menu items) already uses it. The real gap was in the three inner action-dispatchers (handleSignupPost_, handleAdminPost_, handleCheckinPost_) — each has its own try/catch (correctly, so they can return JSON instead of rethrowing into run()'s handler), but none logged a stack trace, only the error message, which is exactly why the bonusAdd bug needed reverse-engineering from live sheet state instead of just reading the stack. Added GasLogger.logError(tag, err, extra) (always logs message+stack+extra) and switched all three dispatchers to use it. ~20 other best-effort catches (shortenUrlFailed, emailFailed, lockFailed, etc.) still omit stack traces but were left alone as out of scope (non-fatal branches inside already-run()-wrapped functions, not the "did this request 500" signal).

Shipped three CheckinApp.html UI changes on request: (1) swapped the "..." (&hellip;) overflow-menu glyph on the tracker-spreadsheet button for a bar-chart emoji (&#128202;) so it reads as a spreadsheet icon rather than a generic more-menu; (2) reordered the Bonus add/edit form to Date first then Type, defaulted new entries to Fellowship (BONUS_DEFAULT_TYPE_) instead of whatever key happened to be first in BONUS_TYPE_RULES_, and added setBonusWhenRange_() to constrain the date picker's min/max to last-month-1st through this-month-end (client-side only — bonusWebapp.js's validateBonusEntry_ doesn't enforce that range server-side yet, flagged but not changed since it wasn't asked for); (3) removed the static "F3 GO30 / Dashboard" branding and moved the PAX's name/team into the upper-left in its place — headerName now reads "F3 Go30: <name>" (falling back to plain "F3 Go30" pre-identify) with team on the line below, headerIdentity wrapper and its show/hide logic removed since the block is now always present.

### Key Learnings:
When a Sheets range's getLastRow() looks "full of data," check whether that's real content or just leftover formatting from a template — a pre-formatted, formula-spilling sheet (single array formula anchored at row 2, auto-filling hundreds of rows below) will report a large getLastRow() even when every data row is genuinely blank, and code that treats getLastRow()+1 as a safe append point will eventually walk off the sheet's real physical bounds. The actual fix is to scan the identifying column (here, Name) for the first truly-blank cell instead of trusting getLastRow(). Related: a monthly "reset" that does a blanket clearContent() across a full row range will happily wipe a spilled-array-formula anchor sitting in that same range — any sheet reset routine needs to explicitly protect formula-bearing columns, not just the ones with periodic content.
Separately: an outer GasLogger.run() wrapper and an inner hand-rolled try/catch are not redundant when the inner one needs to return a controlled JSON error response (can't let the exception propagate to run()'s rethrow) — but that split means the inner catch is now solely responsible for capturing enough detail (message *and* stack) to diagnose from logs alone; message-only logging in that inner catch is what turned a one-line stack-trace lookup into a from-scratch live-sheet investigation.

## 2026-07-01 21:05:31

### Summary:
Reviewed the previously-drafted Go30-Demo-Script.html against the actual product code (SignupApp.html, CheckinApp.html, bonusWebapp.js) and F3 culture reference docs, and found it materially inaccurate: it invented a PAX-facing "Coach's Note" AI-suggestion box and a "Team Q leader dashboard" with coaching-note controls, neither of which exist anywhere in the check-in/dashboard/bonus web apps (Site Q functionality is spreadsheet/admin-side only). It also used wrong field labels/button text (e.g. "Hit/Miss" instead of the real "✓ Did it / ✗ Didn't do it", generic dashboard tiles instead of the real Month Progress ring / Streak / Total Score+bonus-breakdown / 7-Day Rolling Average / My Team / PAX Board layout). Rewrote it as Go30-Demo-Script.md with corrected copy pulled from the actual HTML/JS, and reframed the narration around real F3 culture (3 Fs, HIM accountability groups, EHing FNG as the highest-weighted bonus type) rather than generic productivity-app language.

Then replaced the markdown's ASCII mockups with real screenshots: built tests/playwright/demo-screenshots.spec.js (new npm script `demo:screenshots`) that drives the live SIT signup/check-in/bonus web apps as a real test PAX ("NoSadClown", team Crucible, using the user-approved WHO/WHAT/HOW example) at a 390×844 mobile viewport, capturing 10 PNGs into docs/references/demo-screenshots/. Hit and fixed two real bugs getting it working: GAS web apps render inside two nested sandboxed iframes, so top-level page.click()/page.fill() silently timed out until every locator was routed through page.frameLocator('iframe').frameLocator('iframe'); and the "created by a Google Apps Script user" interstitial banner needed a longer visibility wait before dismissal or it leaked into the first screenshot. Also caught a flaky first-pass result where the post-save bonus screenshot showed stale dashboard content instead of the updated bonus list — tightening the assertion to wait for the new entry's text (not just the form closing) before screenshotting fixed it on re-run, most likely a render-timing race rather than a real app bug. Updated Go30-Demo-Script.md to reference the real screenshot filenames instead of mockups. Per user decision, NoSadClown's SIT signup and two bonus entries are left in place (SIT already carries other test/smoke PAX rows).

### Key Learnings:
When asked to "review for accuracy" against a codebase, treat every concrete UI claim (button text, field labels, feature existence) as falsifiable and grep/read the actual source before keeping it — a demo script drafted from a general sense of "what a habit-tracking app usually has" will confidently invent plausible-sounding features (coach's notes, leader dashboards) that don't exist, and those are exactly the details a subject-matter reviewer will catch first.
Google Apps Script web apps (doGet HTML service) always render inside a nested double iframe with a dismissible "created by a Google Apps Script user" banner above it — any Playwright automation against a GAS webapp needs page.frameLocator(iframe).frameLocator(iframe) for every locator, and should dismiss/wait-out the banner before the first screenshot, or every top-level selector call will silently time out with no indication that the real problem is iframe nesting rather than a broken page.

## 2026-07-01 21:50:19

### Summary:
Committed a full day's worth of uncommitted work on dashboard-tool (PaxCache invalidation fix, Bonus Check-In feature end-to-end including the Bonus Tracker sheet-reset bug fix, GasLogger.logError, dashboard/check-in UX iterations, deploy-tooling docs/retry logic, and the demo script + live SIT screenshots) as 4 atomic commits, after reverting two version-bump artifacts left over from running `npm test` (test_manage_deployments.js stamps version.js/package.json as a side effect of simulating a deploy — reverted both before committing since neither represented a real, intentional release). Left ~600KB of untracked files alone (Sheet, reference .zip/.html docs, f3-culture.md, regional-events-digest, scratch_shot*.js) per explicit instruction, since they're unrelated to the reviewed diffs and their intended destination is unknown.

Then deployed to SIT (v2.2.66) and ran two verification passes: a full functional pass (re-running the live Playwright demo-screenshots spec against the fresh deployment — signup, check-in, dashboard, bonus-add all green, cross-checked against Axiom logs for the same window with zero errors) and the documented Smoke Mode workflow end to end (activate → createTrackerForMonth for August 2026, which correctly appended "(Smoke)" and honored the SMOKE_MODE property → signed up SmokeTest PAX → verified the Tracker row/formulas via getSheet → cleanupTracker teardown → cleared SMOKE_MODE → confirmed clean via getSmokeStatus). Committed the resulting legitimate version bump (from the deploy, not from npm test) plus refreshed demo screenshots (NoSadClown's bonus/streak state shifted slightly from the second live Playwright run) as a fifth commit.

### Key Learnings:
The CLAUDE.md Smoke Mode quick-reference assumes `targetMonth: "current"` resolves to the smoke tracker, but that's only true when the smoke tracker is created for the month that's actually in progress. If SIT's real "today" already has a live tracker for the current month (as it did here — July 2026), createTrackerForMonth for the next month puts the smoke tracker at `targetMonth: "next"` instead, confirmed by the signup identify response's `months.next.sheetId` matching the new smoke tracker. Check the identify response's `months` object rather than assuming which key maps to the smoke tracker.
`npm test` has a real, byte-visible side effect on the working tree (test_manage_deployments.js stamps script/version.js and — transitively via a shared bump path — package.json's version field) that has nothing to do with the tests actually passing. Before committing after running the local suite, diff version.js/package.json specifically and revert if the values don't match an intentional release — otherwise an unrelated feature commit silently carries a fake version bump.

## 2026-07-02 18:45:02

### Summary:
Reviewed Copilot's caching-strategy feedback against the actual PaxCache.js implementation and found most of it inapplicable (CacheService's 6h TTL is exactly why PropertiesService was chosen; Drive-JSON caching wouldn't be faster) but surfaced one real gap: patchPaxRosterIndex_'s read-modify-write had no lock, risking a lost update under concurrent signups. Fixed by wrapping it in LockService.getScriptLock() (same convention as signupWebapp.js's ensureResponseColumn_), with test/GasLogger mocks added to test_pax_cache.js. Also added Script Properties count/size metrics to the onOpen.js About dialog (scriptPropertiesMetrics_) for ongoing 500KB-quota monitoring.

Extended tools/smokeTest.js from a single-PAX smoke check into a full 3-teams-of-3-PAX signup + check-in + one-bonus-per-type flow, with server-verified assertions (not just ok:true) and a human-review pause listing exactly what can't be checked automatically (Bonus Tracker's spilled-formula columns). Building and running this surfaced a real architectural gap: TrackerDB date-based resolution had no way to disambiguate a smoke tracker from a real tracker sharing the same StartDate — nag/minus-one would throw "ambiguous match," and signupWebapp.js's "latest Date wins" tie-break would silently let a smoke tracker hijack 'current'/'next' routing. Fixed by adding script/SmokeMode.js as a single seam for smoke identity (smokeModeActive_/getSmokeTrackerId_), excluding the smoke row from go30tools.js's date dispatch, and adding an explicit targetMonth: 'smoke' selector (selectTargetMonth_) threaded through both signup and checkin action handlers — reachable only when explicitly requested, never as an implicit fallback. Caught and fixed two bugs this same investigation surfaced: renderSignupPage_ was serializing the smoke tracker's sheetId into the public signup page's HTML (anonymous-visible leak, since getCurrentAndNextMonths_ now always includes a `smoke` key), and tools/smokeTest.js's own check-in step failed with day_column_not_found because runAutoGenerate always dates the smoke tracker at *next* month's start, so "today" was never one of its Tracker day columns.

Deployed the above to SIT and ran the extended smoke test live — signup + team verification passed; check-in failed on the day-column issue, tracked down and explained rather than blindly retried. Mid-session, added a second feature: bonus totals were entirely missing from the check-in page's team/board views. First pass only fixed the #dMyTeam tile grid (renderTeamTile_) via a new buildDashboardPaxRow_(bonusByType) param wired through handleCheckinDashboard_'s per-PAX loop — but the user's actual complaint was about the *other* board renderer, #dPaxBoard's compact all-teams .board-row list, which is a structurally separate code path that also needed buildBonusChipsHtml_ wired in (added as a second, conditional .board-row-bonuses line, hidden when a PAX has zero bonuses). Tracked as bd issue F3Go30-y55y with a scope-correction note recorded once the actual gap was found.

Separately diagnosed an intermittent "Server returned HTTP 404" the user hit right after a fresh SIT deploy: traced it with a raw HTTP request bypassing tools/callWebapp.js's abstraction, confirmed the deployed code matched the local tree exactly (pulled live SIT/PROD code via clasp into scratch dirs and diffed), and reproduced the same failure intermittently succeeding/failing on identical retries seconds apart — consistent with Google's post-deploy propagation window for the executable-API redirect ("echo" URL), not an application bug. User independently verified the bonus-board fix and deployed to PROD.

### Key Learnings:
A smoke tracker sharing a real tracker's StartDate isn't an edge case to guard against — it's the *normal* case, since the smoke tracker must cover "today" for check-in/bonus testing to mean anything. Date-based avoidance (sentinel dates, "just don't collide") doesn't work because dashboard/check-in also chase adjacent (prior/next) month TrackerDB rows for streak continuity and next-month-registration checks — an isolated sentinel-dated tracker has no real neighbors. The fix has to be an explicit selector at the entry point, with the underlying date-resolution logic staying exclusion-aware only for real-dispatch consumers (nag/minus-one) that must never touch test data regardless of what's asked of them.
When a user says "the X board," don't assume from a general codebase skim which of several similarly-named render functions they mean — this session's bonus-chip fix was implemented twice because the first pass (renderTeamTile_/#dMyTeam) matched the label "team board" in a code comment but not the feature the user was actually looking at (#dPaxBoard). Confirming which DOM id/element they're looking at (or asking) before implementing would have caught this in one pass instead of two.
An HTTP 404 immediately after redeploying an Apps Script web app is not automatically a code regression — Apps Script's executable-API response is served via a 302 redirect to a one-time "echo" URL, and that redirect can flake for a short propagation window right after a deployment update. Confirm by pulling the actually-live code via `clasp pull` into a scratch dir and diffing against the working tree, and by retrying the same request a few times, before assuming the deploy broke something.

## 2026-07-03 01:20:00

### Summary:
Reworked the check-in flow's UX per a series of iterative requests: replaced the two one-shot Yes/No check-in buttons with a true tri-state toggle ("I Hit it!" / "Missed it" / "No Check-in", exactly one always visually current), decoupled check-in submission from dashboard navigation (submitCheckin_ no longer auto-chains into loadDashboard_/showStep — "Continue to Dashboard" is now a separate primary button) so updating both today's and yesterday's answer in one visit is no longer a race against auto-navigation. Extended handleCheckinSubmit_ (dashboardWebapp.js) to accept `value: null` as a genuine "clear this day's entry back to unrecorded" write (cell.clearContent()), distinct from the 0/1 states. Made the whole Month Progress tile clickable (not a separate button) to jump back to the live today/yesterday check-in step, always ignoring whatever day date-nav is currently scrubbed to.

Found and fixed a real, pre-existing streak computation bug while redefining "streak" per the user's request: maxStreak30 (and current streak) were computed only from the current month's elapsed days, so early in a month (SIT's July 2 test data) both figures were artificially capped regardless of a real longer streak spanning back into June. Fixed by reaching into the prior month's tail (getPriorMonthTailValues_, the same mechanism the rolling-average chart already used) and windowing both current-streak and best-30-streak identically. A second, more consequential bug surfaced after redeploying: the client-side render was silently ignoring the server's already-corrected streak/maxStreak30 fields and recomputing client-side from only the current month's dayValues every time — the actual root cause of "Little John's streak still seems off" after the first fix shipped. Fixed by adding computeWindowedStreaks_ client-side (mirroring the server's prior-month-tail lookback) and wiring it into renderDashboard_. Verified against live SIT data for Little John by hand (streak=2, maxStreak30=9, confirmed against the raw day-value array) before considering it done.

Iterated the STREAK and TOTAL SCORE tile layouts through several rounds of specific pixel/wording feedback: current streak as the largest, boldest number (best-30 secondary but still emphasized), removed the day-of-month progress bar entirely (streak tile is now streak-only), removed the redundant "CURRENT STREAK" sub-label, split "Best (30d)" onto its own line, and split the Total Score tile's hits/misses/no-check-in text onto three lines with bonus chips moved to a 2-column grid (FE/Ins top row, Q/EH bottom row) below the score number instead of beside it.

Investigated (without implementing) whether an onEdit-style spreadsheet trigger or a sidebar-style PropertiesService queue/poll pattern could speed up or decouple the checkin-then-dashboard-rebuild round trip. Confirmed via research that onEdit triggers (simple or installable) never fire for script-driven SpreadsheetApp writes, killing that idea outright; recorded the investigation and the two actually-viable directions (merge the write+rebuild into one call; warm a shared board cache inline) as ADR-013 rather than bd remember, since the user specifically wants this surfaced automatically next time the question comes up.

Added a check-in/dashboard webapp invitation link to the signup confirmation email and the nag/reminder email (alongside their existing tracker links), and a "try the new sign-up page" invitation wherever an email already links back to the old Google Form. Added one shared resolveWebAppBaseUrl_() helper in Utilities.js, reused via this codebase's existing require+globalThis-fallback pattern so it works under both real GAS and the Node test harness. Verified live on SIT with Email Test Mode on: triggered a real nag send (13 recipients, redirected to Site Q) by temporarily clearing and restoring a real PAX's check-in day using the new tri-state clear feature, and triggered a real new-signup confirmation email — both exercised the new check-in/dashboard link end to end.

### Key Learnings:
A server-side bug fix isn't done until you've confirmed the client actually uses the corrected value — this session's streak fix looked complete after the first deploy (server math verified correct) but the client was silently recomputing its own, still-buggy version from a narrower data slice, discarding the server's fix entirely. "Still seems off" after a deploy is a strong signal to check the render path, not just re-verify the computation.
When a user proposes a queue/trigger/polling architecture for a performance problem, the deciding question is whether the "slow" work is already happening inside a live request the same user is waiting on (in which case there's nothing to detach — just do the extra work in that call) versus work that genuinely needs to happen independent of any single request. onEdit specifically cannot bridge script-driven writes at all, independent of the simple-vs-installable distinction, which only affects execution context/permissions, not what counts as a triggering "edit" event.
Iterative pixel/wording-level UI feedback (streak tile layout across ~6 rounds) is cheap to act on individually but easy to under-verify collectively — running the syntax check + npm test + deploy:sit after every single small tweak this session caught nothing broken, but confirms that batching several such small requests without redeploying in between would have made a later regression much harder to attribute to a specific change.

## 2026-07-03 06:17:13

### Summary:
Revised the website's "How it Works" panel (SignupApp.html) and docs/references/Go30-FAQ-2026-06.md to match current webapp-based reality instead of the pre-webapp, sheet-only/Google-Form world they still described: added the dashboard and the check-in page's chart-icon (📊) link to the underlying spreadsheet as an explicit backup path, corrected the icon description after user correction (it's a chart icon, not "…"), clarified the -1 deadline messaging (10am social deadline plus a short automatic grace window, per user's chosen phrasing), and rewrote the FAQ's recording-scores/bonus-points/signup/reuse-registration answers to describe the current webapps as primary with the spreadsheet as fallback.

Implemented a real scoring-accuracy fix identified during that documentation review: the dashboard's bonus pills (fe/q/ins/eh) were previously read straight off the Tracker sheet's C-F month-to-date columns, which are neither date-scoped (same total shown regardless of which day the date-nav arrows were scrubbed to) nor capped — confirmed via a live SIT formula inspection (added a temporary/kept getSheetFormulas admin action to WebApp.js) that the spreadsheet's own weekly Bonus-column SUMIFS formula does not itself enforce the "1 point per week" cap for Fellowship/Q Point/Inspire that docs and the user both describe as the intended rule. Per user decision, fixed this only in the dashboard (not the spreadsheet formula): added bonusWebapp.js's readAllBonusEntries_/getAllBonusEntriesCached_ (CacheService cache, invalidated on every addBonusEntry_/editBonusEntry_ write) and dashboardWebapp.js's weekOfMonth_ (Sun-Sat periods that naturally clip short at month start/end)/computeBonusPillsAsOf_ (date-scoped, capped)/computeBonusSeriesForPax_ (one pill-set per reported day, for every PAX not just the logged-in one). Wired the new per-day series into CheckinApp.html's memberViewForIndex_ and the self-tile bonus grid, replacing the prior "pinned to today" behavior. Removed the now-dead buildBonusByType_/TRACKER_BONUS_*_COL_ reads and their tests. Updated bd issue F3Go30-y55y's acceptance criteria and left a verification note rather than closing it. Verified live on SIT: two Fellowship entries in the same week still show fe:1 (cap holds); a Q Point entry dated 07-02 is excluded when viewing 07-01 and included when scrubbed to 07-02; board tiles each carry their own bonusByTypeSeries.

### Key Learnings:
Before reimplementing a business rule ("cap bonus points at 1/week") that's described in project docs and repeated by the user, verify it against the live spreadsheet's actual formulas rather than the docs — docs/sheet-reference.md described the cap as "enforced by the capped/uncapped logic," but pulling the real formula (via a new getSheetFormulas admin action) showed the SUMIFS has no cap at all; the intended rule and the shipped formula had silently diverged, and mirroring the docs' description instead of the sheet would have reimplemented behavior nobody had actually verified.
When a change reverses or refines an in-progress bd issue's stated AC (F3Go30-y55y had just recorded "bonus totals are month-to-date, not per-day" as intentional), update that issue's AC explicitly rather than silently coding the opposite behavior or spawning a disconnected new issue — the user's clarifying answer ("month-to-date is true given the date is the context date") showed the original AC wasn't wrong, just ambiguous about which "today."
`bd update --body-file` replaces the description field, not acceptance criteria — use `--acceptance` (via `$(cat file)` command substitution, not `--body-file`) to set AC content, and always `bd show` immediately after any bulk update to confirm the field that actually changed.

## 2026-07-03 09:48:15

### Summary:
Fixed the live "that entry no longer belongs to you" bonus-edit bug reported on SIT/prod: root cause was `editBonusEntry_`/`clearBonusEntry_` trusting a client-held `rowIndex` that goes stale by save time (cross-month moves, manual sheet sorts, or unrelated row shifts). Replaced with `findBonusRowByIdentity_` — locates the row by matching remembered content (Name/Type/When/What/Link) instead of a bare row number, with `rowIndex` demoted to a fast-path hint. Added `LockService`-guarded critical sections to `addBonusEntry_`/`editBonusEntry_`/`clearBonusEntry_` to close a real concurrent-write race (two adds claiming the same "next free row"), and reordered `handleBonusEdit_`'s cross-month move to add-then-clear so a failure partway through leaves a recoverable duplicate rather than losing the entry.

Found and fixed a performance regression I introduced in the same fix: `handleBonusEdit_` was calling the expensive identity-resolution step twice per edit (once for the new month, once for the original) even when both were the same month. Added a cheap month-only pre-check (`resolveBonusMonthOnly_`, local TrackerDB scan only) so same-month edits — the overwhelming majority — pay for exactly one resolution again.

Investigated a separate "Failed to fetch" report using a browser HAR export and found two real, pre-existing (not caused by me) performance issues: (1) the bonus-list endpoint (`listBonusEntriesForPax_`) had zero caching at all, re-reading the Bonus Tracker's full ~890-row pre-formatted extent on every single load — fixed by adding `getAllBonusRowsCached_`, reusing the same CacheService infrastructure already correctly wired for invalidation. (2) `resolveCheckinIdentityFull_` (the dashboard/board view) did a fully uncached full-sheet read of both Responses and Tracker on every single call, regardless of staleness — "nothing touched it in days" turned out to mean "there is no cache for this path at all," not "the cache is cold." Added a new CacheService-backed full-roster cache with two-layer invalidation: explicit write-through in `handleCheckinSubmit_` and `markMinusOne.js` (which previously invalidated nothing), plus `PaxCache.js`'s existing Drive-modtime freshness gate (`ensurePaxCacheFresh_`) extended as a backstop for out-of-band edits.

Also shipped, per user request during live testing: a dashboard date-nav loading indicator + duplicate-request guard (the HAR showed 3 concurrent duplicate `dashboard` POSTs from unguarded rapid clicking), a Site Q contact error banner with a pre-filled mailto link (reads name/email from the Config sheet's "Site Q" row, same source already used for admin emails), and yesterday-checkin status badges (⚠️ before 10am local, Ⓧ red/bold at/after) — placed as an upper-left overlay with a subtle ring-background tint on My Team tiles, and as a fixed-width column between name and daily-progress bar on the Pax Board.

Extended `tools/smokeTest.js` (the only live E2E harness in the repo) with two new steps that previously had zero live coverage: a same-month bonus edit (verifying `editBonusEntry_`'s actual live write path, not just unit-mocked), and a `dashboard` action call with roster/team-shape assertions. Documented in the file header why a true cross-month live test can't be safely added without new production-adjacent surface area (signup's `targetMonth` enum has no way to target an arbitrary second synthetic month) — saved as `bd remember` key `F3Go30-bonus-crossmonth-test-gap` for a future decision rather than building a risky workaround unilaterally.

Deployed through the full-roster caching fix to SIT (v104). All 19 `npm test` suites pass.

### Stopping point / what's next:
- Planned but **not started**: adding a bonus-edit cycle to `tests/playwright/demo-screenshots.spec.js` (the existing live-browser workflow-screenshot spec) — user asked for this alongside the `smokeTest.js` work.
- `tools/smokeTest.js` changes are untested — syntax-checked only (`node -c`), never actually run end-to-end against SIT.
- Open decision needed from Stuart: how (or whether) to add live cross-month bonus-edit test coverage — see `bd remember F3Go30-bonus-crossmonth-test-gap` for the full tradeoff writeup.
- Not yet deployed: `tools/smokeTest.js` changes don't need deployment (local tooling only, calls the already-deployed SIT webapp).

### Key Learnings:
- A GAS web app's `CacheService` caps TTL at 6 hours regardless of how long the underlying data has been stable — "untouched for days" does not imply "still cached" unless the read path was ever wired to a cache at all. Always check whether a slow path has *any* cache before assuming staleness is the cause.
- Browser HAR exports are a much higher-signal debugging tool than server logs alone for GAS web apps specifically, because GAS's POST→302→GET-echo redirect chain and per-request execution timing (`wait` in HAR timings) directly expose server-side execution time per request — cross-referencing HAR timestamps against Axiom's `resolveIdentity.timing` log lines pinpointed the exact double-resolution regression.
- A client-held `rowIndex`/array-position captured at list-load time is inherently unsafe to trust unchanged by save time for anything editable — content-based relocation (matching remembered field values) is the more robust pattern, confining any lock to the actual read-modify-write rather than the user's think-time.

## 2026-07-03 21:03:18

### Summary:
Cleaned up SIT (3 stray smoke trackers from prior session, cleared SMOKE_MODE). Wrote the
bonus-edit cycle addition to tests/playwright/demo-screenshots.spec.js (not yet run). Ran
tools/smokeTest.js against SIT — check-in step failed with day_column_not_found; diagnosed and
filed as bd issue F3Go30-jldr (structural bug, not flakiness). Tore down the resulting partial
smoke tracker. Built and shipped a new CopyTemplate tool per user request: script/CopyTemplate.js
(+ admin action in WebApp.js, unit tests in test/test_copy_template.js, tools/copyTemplate.js CLI
wrapper) that copies the Template spreadsheet (+ bound script) and the N most recent real
monthly trackers into a new Drive folder, then rebuilds that copy's TrackerDB/PaxDB from scratch
using only the copied trackers. Deployed to SIT and live-validated (3/3 trackers, 52/52 PaxDB
rows correctly scoped to the new SheetIds). Documented in docs/OPERATIONS.md §CopyTemplate.
CopyTemplateTest artifacts left in Drive for review, not yet trashed.

### Key Learnings:
TrackerDB/PaxDB live inside the Template spreadsheet itself, so any Drive-level copy of the
Template inherits the *entire* source history (pointing at the old trackers' original SheetIds)
— it has to be explicitly wiped and reseeded from only the newly copied trackers, since
go30tools.js's existing scanTrackers()/_mergeTrackerDbRowsForScan_ path is additive-only and
never drops stale rows. _updateTrackerDB() was previously hardwired to
SpreadsheetApp.getActiveSpreadsheet() (unlike _updatePaxDB, which already took an optional
spreadsheet param) — added the same optional param so CopyTemplate could target the new copy
explicitly rather than whatever spreadsheet the script happens to be bound to at execution time.
Also: SIT's own TrackerDB is not a reliable source for "most recent real trackers" — it mixes
SIT-only test rows with historical rows inherited from when SIT's template was first copied
from PROD; PROD's TrackerDB is the only trustworthy source for that.

## 2026-07-04 05:21:09

### Summary:
Closed out the Playwright demo-screenshots gap flagged in the prior session: added a `headless: true`
override to `demo-screenshots.spec.js`'s `test.use()` block (the suite-wide `playwright.config.js`
sets `headless: false` only for a separate GAS-editor spec that needs a real viewport — this spec
drives the public, no-login PAX signup/check-in/dashboard/bonus webapps and has no such requirement).
Ran it headless end-to-end against SIT; both tests passed and refreshed all 13 demo screenshots in
`docs/references/demo-screenshots/` for documentation/training use.

Deployed to PROD as v2.3.11 (`package.json`/`script/version.js` bumped). This release bundles
everything accumulated since v2.3.6: the bonus-edit content-identity fix and `LockService` guards
around bonus add/edit/clear, bonus-list and full-roster caching fixes, the dashboard date-nav loading
indicator + duplicate-request guard, the Site Q contact error banner, yesterday-checkin status badges,
and the new CopyTemplate tool (`script/CopyTemplate.js`, `tools/copyTemplate.js`,
`test/test_copy_template.js`). Committed and tagged `v2.3.11`.

### Key Learnings:
A per-spec `test.use()` override is the right tool when one spec in a suite has different environment
requirements than the rest (headless-safe public webapp vs. a GAS-editor spec needing a real
viewport) — no need to split into a separate Playwright project/config for a single flag.

## 2026-07-04 09:23:40

### Summary:
Fixed a live PROD bug: dashboard's previous-day nav arrow was permanently grayed out after
the first load. Root cause was in `script/CheckinApp.html`'s `renderDateNav_` — it only ever
managed `dateNextBtn`'s disabled state (today-check); `loadDashboard_` disables both nav
buttons while fetching, but nothing re-enabled `datePrevBtn` afterward, despite a comment
claiming `renderDateNav_` handled it. One-line fix: `renderDateNav_` now also sets
`datePrevBtn.disabled = false`. Deployed to PROD as v2.3.12 and committed (67979e3).

### Key Learnings:
A misleading code comment ("re-enables/relabels the nav buttons via renderDateNav_") masked
that the referenced function only handled one of the two buttons it claimed to — worth treating
comments describing a function's effects as a hypothesis to verify against the actual code,
not as ground truth, especially when tracking down a "button stuck disabled" symptom.
