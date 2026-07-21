
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

## 2026-07-05 06:25:22

### Summary:
Reviewed the BonusTypes.js refactor (registry-based bonus rules replacing three duplicated
tables across bonusWebapp.js/dashboardWebapp.js/CheckinApp.html) and completed the
presentational cleanup left out of scope: added `bonusTypeDisplayList_()` so CheckinApp.html's
pill labels/order derive from the registry instead of a hardcoded mirror (per-type CSS color
stays manual by design — not a fact the registry can express).

Live-tested the assumed "spreadsheet double-counts weekly-capped bonus points" bug (recorded in
a 2026-07-04 work-log entry and BonusTypes.js's own comments) against SIT and found it does NOT
reproduce: the Tracker's period Bonus column sums against `UBonus_*` named ranges built via
`=UNIQUE('Bonus Tracker'!A:F)`, which already collapses two same-type/same-period complete
entries to one row before the SUMIFS runs, since capped types have no varying column to keep
them distinct. Uncapped types (EHing FNG) stay distinct because their "Uncapped Points" column
holds the entry's own Slack link. Recommend correcting the stale assumption rather than
"fixing" a formula that isn't broken.

While setting up that live test, found and fixed a real trigger-leak bug: `cleanupTracker`
trashed a smoke tracker's spreadsheet/form but never removed its `onFormSubmit` installable
trigger, silently accumulating orphaned triggers on SIT's script project across past smoke-test
sessions until it hit Apps Script's trigger cap and started failing `createTrackerForMonth`
outright. Fixed `cleanupTracker` to call `clearFormSubmitTrigger`, added `listTriggers`/
`deleteOrphanedTriggers` admin diagnostics, and purged 17 stray triggers on SIT.

Created epic F3Go30-4j4o ("Re-architect SIT/smoke test tooling around on-demand tracker
provisioning") and reparented related existing issues (F3Go30-jldr, F3Go30-31w5, F3Go30-w6y3)
under it, plus two new children: F3Go30-4j4o.1 (bonus actions can't target a smoke tracker —
`resolveBonusSheet_` resolves by date only, ignoring `targetMonth`, unlike identify/checkin) and
F3Go30-4j4o.2 (cross-month bonus-edit test gap, elevated from an existing bd memory).

Diagnosed the root cause of prod reports of PAX having to re-enter their name/email on the
signup/check-in webapps: not a TTL in our code (plain localStorage, no expiry), but Safari/iOS
WebKit's Intelligent Tracking Prevention, which caps all script-writable storage to 7 days
without a genuine top-level visit to the storage-owning domain — and Apps Script's content
always renders inside a nested sandboxed iframe served from a googleusercontent.com subdomain
the user never directly navigates to, so that domain never earns "top-level visit" credit no
matter how often the outer script.google.com page is visited. Confirmed "Chrome on iPhone" user
reports are consistent with this (all iOS browsers are WebKit under the hood per Apple's App
Store rules), and confirmed live on SIT that a real `target="_top"` link (not a script redirect)
can carry a URL param back to the actual script.google.com address bar, escaping the sandbox.

Built the fix: script/IdentityToken.js (new) mints/verifies stateless signed tokens
(`mintedAtMs|f3Name|email` + HMAC-SHA256) for a bookmarkable "remember me" check-in link, wired
into `handleCheckinIdentify_`/`handleSignupSave_`. Iterated the UX through several rounds of
user feedback into a final design: typed identify always hands off to `?cmd=checkin&id=token`
via a best-effort `window.top.location` redirect (escaping the sandbox), falling back to a
real, always-working manual link if the browser rejects the redirect (confirmed live this
happens inconsistently — Chromium sometimes blocks it with "no user activation" if the async
API round-trip outlasts the click's activation window); landing on a valid token shows
"Welcome back" plus a bookmark/Add-to-Home-Screen prompt only when the token's own embedded
mint timestamp is under 1 minute old (IDENTITY_TOKEN_FRESH_WINDOW_MS_), distinguishing "you're
seeing this link for the first time" from "reopened an old bookmark" without any client-side
storage. A current-month signup now mints the same token and hands off into check-in
automatically (with the same redirect/fallback pattern) instead of stranding the PAX on the
signup confirmation screen.

Found and fixed the same latent bug in SignupApp.html's existing `targetMonth`/`autoStart` deep
link (used by check-in's "not registered" nudge): it read `window.location.search`
client-side, which is empty inside the nested sandbox iframe — silently broken since it was
built. Fixed the same way as the new token (`renderSignupPage_(e)` injects params server-side
into the template). Also changed check-in's "Sign up" button from `window.open(...,'_blank')`
to a same-tab redirect, since the new signup->checkin handoff only works as one continuous flow.

Verified every branch live on SIT via ad hoc Playwright specs (written, run, then deleted —
not kept as permanent tests): typed-identify auto-redirect + fallback, token arrival with
fresh/stale bookmark messaging, invalid-token fallthrough, and the full signup->checkin handoff
including the fallback-link path. All 20 `npm test` suites pass throughout.

### Stopping point / what's next:
- User asked whether the live-verification Playwright specs used today should be made
  permanent (this area has real regression risk — the activation-timing race, sandbox iframe
  mechanics, and redirect/fallback behavior can't be caught by `tools/smokeTest.js`'s API-only
  checks). Recommended a new standalone spec (`tests/playwright/identity-token-flow.spec.js`,
  outside the plain `npm test` run like `demo:screenshots`/`test:gaslogger`), with a dedicated
  idempotent test PAX and an explicit negative case (next-month signup should NOT redirect).
  Not yet built — awaiting go-ahead.
- Not yet done: correcting the stale "spreadsheet double-counts" comment in BonusTypes.js's
  header now that live testing disproved it.
- `F3Go30-y55y` looks complete (all AC met, verified live per an earlier session) but is still
  `in_progress` — flagged for closing, not yet closed.
- Today's changes (BonusTypes.js, IdentityToken.js, CheckinApp.html/SignupApp.html/
  dashboardWebapp.js/signupWebapp.js/WebApp.js changes) are deployed to SIT but uncommitted and
  not yet on PROD.

### Key Learnings:
Apps Script serves web app content inside a nested sandboxed iframe from a per-deployment
`googleusercontent.com` subdomain whose own `src` carries no query string at all — confirmed via
direct Playwright frame-URL inspection. Any deep-link parameter (`?targetMonth=`, `?id=`, etc.)
read via `window.location.search` inside that content is silently broken; it must be read
server-side (`doGet(e)` -> `e.parameter`) and templated into the page explicitly. This is a
general pattern for this codebase, not specific to one feature — worth checking any future
`?param=` deep link against it before assuming client-side URL parsing works.
A `target="_top"` link (or `window.top.location` assignment) can escape Apps Script's sandbox
iframe and land the real browser tab on our own script.google.com URL, but only reliably when
triggered by a genuine, recent user click — a script-driven attempt after an async API
round-trip is a coin flip depending on how long the round-trip took relative to the browser's
"sticky activation" window, confirmed inconsistent across runs against the identical code path.
Any such "best-effort auto-redirect" needs an always-working manual fallback, not just a retry.
A `setTimeout`-based fallback works cleanly for detecting a blocked navigation specifically
because a *successful* top-level navigation tears down the entire page (including the timer)
before it can fire — so the fallback UI and the redirect's destination page can never both be
visible at once, regardless of which one actually happens.
The `UNIQUE()`-based `UBonus Tracker` mirror (`=UNIQUE('Bonus Tracker'!A:F)`, columns
Name/Period/UncappedPoints/Multiplier/Complete/Type — deliberately excluding When/What/Link)
incidentally enforces the weekly bonus cap by collapsing duplicate-tuple rows before the
Tracker's SUMIFS ever runs, and deliberately does NOT collapse uncapped-type entries because
their "Uncapped Points" column holds the entry's own (normally-unique) Slack link. A formula
that looks like it has "no cap logic" by reading just the final SUMIFS in isolation may have the
real logic sitting upstream in how its named-range source is constructed — worth checking the
full dependency chain before concluding a spreadsheet formula is missing a rule.

## 2026-07-05 06:50:28

### Summary:
Continued from the earlier 2026-07-05 session (identity-token / bonus-refactor work, still uncommitted). Built the permanent Playwright regression spec that was left as the open decision: `tests/playwright/identity-token-flow.spec.js`, covering the signup→check-in identity-token flow end to end against live SIT — current-month signup minting a token and redirecting into check-in, reopening a bookmarked token link (bypasses the identify form), "Not you?" clearing storage back to a blank form, and a negative case confirming next-month-only signups do NOT mint a token or redirect (self-skips when SIT has no next-month tracker). Added `npm run test:identity-token`. Used two dedicated idempotent test PAX (TokenFlowTest, TokenFlowNextMonth) distinct from the demo-screenshots PAX.

### Key Learnings:
`attemptTopRedirect_`'s `window.top.location.href` navigation (CheckinApp.html / SignupApp.html) is genuinely non-deterministic under Playwright's synthetic clicks in headless Chromium — the same code path sometimes auto-redirects and sometimes falls back to the manual "Tap here to continue" link, run to run, matching the code's own comment that sticky user-activation isn't guaranteed on every browser. A naive `page.waitForURL()` flakes; the fix is a polling helper (`followTokenRedirect`) that watches for either the URL changing or the fallback link becoming visible and follows whichever happens, rather than assuming one path.

Loose ends still open (not done this pass): commit today's work (nothing committed yet, all deployed to SIT only), fix the stale double-counting comment in BonusTypes.js's header, and close out F3Go30-y55y which looks complete but is still in_progress.

## 2026-07-05 08:58:43

### Summary:
Closed F3Go30-y55y (bonus totals on the PAX team board) — all ACs verified, including live SIT confirmation. Checkin page: replaced the hardcoded "F3 Go30" header text with the Config sheet's NameSpace value (server-templated, updates on identify too); restyled the one-time "This is your personal check-in page" note as a `.warning-text` alert (same treatment as the email-mismatch note) since it silently stops reappearing after the token's 60s freshness window with no client-side timer to announce that; set the page `<title>` (NameSpace + F3 name, decoded server-side from the saved-link token via `verifyIdentityToken_dw_`) and a custom favicon (`docs/references/Go30-Logo.png`, hosted via raw.githubusercontent.com and wired through `HtmlOutput.setFaviconUrl()`) so a bookmarked/Home-Screen link is recognizable per-PAX. Verified all three live on SIT (v121–123).

Reworked `tools/manage-deployments.js`'s version bumping to fix SIT deploys burning through the PROD-facing patch counter: package.json now carries a separate `build` integer. SIT deploys (`deploy:test`/`deploy:sit`) bump `build` only and stamp `APP_VERSION` as `${version}.${build}` (e.g. "2.3.13.4"); PROD deploys (`push`/`deploy:prod`) bump the patch version as before but now also unconditionally reset `build` to 0, and PROD's stamped `APP_VERSION` never carries a build suffix. Also fixed a latent double-bump bug in `release:patch/minor/major` (they called `npm version` themselves but their `npm run push` wasn't actually passing `--skip-bump` despite the file's own header comment claiming it did) by adding `-- --skip-bump`. Added test coverage for `bumpBuildNumber_`, `resetBuildNumber_`, and `stampVersion`'s new `versionOverride` option; full `npm test` suite (21 files) passes.

Version 2.3.13 was manually bumped and deployed to PROD by the user during this session (predating the build-counter fix) — tagged `v2.3.13` and committed as the current PROD baseline.

### Key Learnings:
Apps Script's `HtmlOutput` renders page content inside a cross-origin sandboxed iframe, so client-side `document.title` changes never reach the top-level (bookmarkable) document — the only way to control a per-PAX page title is server-side, via `HtmlOutput.setTitle()` at render time, decoding whatever identity is available from the request (here, the saved-link token) before the template ever evaluates.
`HtmlOutput.setFaviconUrl()` is the only supported way to set a web app's favicon — Apps Script's own docs state `<link rel="icon">` tags written directly in an HTML file are ignored, and it requires an externally-hosted URL since clasp has no static binary-asset hosting. A public GitHub repo's `raw.githubusercontent.com` link is sufficient; no GitHub Pages setup needed.
`recentlyMinted`/token-freshness UI (the bookmark note) is evaluated once, server-side, at page load — there's no client-side timer re-checking it while the page stays open, so a note gated that way can look like it "should" auto-hide on a timeout but actually only stops appearing on the *next* fresh page load after the window passes; a manual dismiss control is still needed for the current view regardless of the window length.

## 2026-07-05 16:48:49

### Summary:
Documentation audit against code-as-source-of-truth, plus planning a web-app identity
hardening effort. On branch `hardening/identify-once` (cut from main this session).

**Doc reconciliation (commits a718901, c2753bf, 9f1c182):**
- Ran code-to-doc consistency audit across all docs vs the 62-file GAS source.
- DESIGN.md: removed dead `macros.js` module/risk rows (file deleted, F3Go30-j1t closed) and the
  resolved nag.js/FunFacts "known drift" note (issues closed, code already reads FunFacts); added
  ~14 missing modules to the architecture table (IdentityToken.js, BonusTypes.js, email modules,
  utilities, etc.).
- CONTEXT.md/OPERATIONS.md: cleared the same stale nag/FunFacts language; documented the
  bonusList/bonusAdd/bonusEdit web-app actions.
- Marked four planning-stage docs Historical (their proposed/pending headers no longer matched
  shipped state): disposition-plan.md, deployment-model.md, signup-webapp-requirements.md,
  gas-best-practices-review.md.
- PLAN.md: deleted the fully-closed "Hardening work" backlog + stale About-menu note.
- Documented the identity-token bookmark/redirect/fallback flow in DESIGN.md + CONTEXT.md + demo
  script; fixed check-in button terminology to actual UI ("I Hit it!"/"Missed it"/"No Check-in",
  three states) and bonus-rule attribution (BonusTypes.js BONUS_TYPE_DEFS_, not bonusWebapp.js).

**Hardening plan + beads:**
- Wrote a 4-stage plan to consolidate signup/check-in identity plumbing (shared IdentityCore.html
  partial) and auto-carry a known-but-current-month-unregistered PAX into signup; reviewed it on
  Opus and resolved findings (PaxDB fallback belongs only in the resolveCheckinIdentity_ miss
  branch, not tokenInvalid; signup side needs zero changes; anti-enum stays exact-both-fields).
- Created bd epic F3Go30-xj1q (Web app hardening) with children .1 (identity consolidation +
  fallthrough, full plan in Design), .2 (qualify scanTrackers sources, smoke-safe, folder-scoped),
  .3 (CopyTemplate safe-Config + rename copies by NameSpace + document env-standup vision).
- SIT test fixture decision: copy a prior tracker into existing SIT folder, rename with SIT
  marker, runScanTrackers before check-in identify.

**Release tracking (commits eb704b8, f164549):**
- Created docs/CHANGELOG.md (user-facing) with v2.3 PAX web-app feature list; registered it in
  CLAUDE.md Document Map + ROADMAP pointer.
- Defined the changelog inclusion rule to decouple from deploy churn: 3 tiers (SIT build = git
  only; PROD patch = git + work-log; user/admin-facing = changelog at minor-series level), with an
  Unreleased bucket and a CLAUDE.md placement rule.

### Key Learnings:
- Version scheme (manage-deployments.js): package.json carries two counters — semver `version`
  (PROD, 3-segment) and integer `build` (SIT, appended as 4th segment). SIT deploys bump build
  only; PROD deploys bump patch + reset build. So patch/build churn must not drive changelog entries.
- copyTemplate.js renames the template copy (line 115) but NOT the tracker copies (line 132), and
  copies Config verbatim — a stood-up test env inherits PROD's Email Test Mode (live-email risk)
  and NameSpace (collision). Captured as hardening bead .3.
- PaxDB is scan-derived (signupWebapp.js:524) — signup does not populate it synchronously; any
  "known in PaxDB" test fixture must runScanTrackers first.

## 2026-07-05 21:22:48

### Summary:
Finished Stage 4 (final stage) of F3Go30-xj1q.1 on branch `hardening/identify-once`, continuing
from a prior agent's Stages 1-3. Established the SIT fixture the Stage 2 e2e tests were deferred
on (LateSignupTest/latesignup@example.com, signed up for "next" month only via the normal signup
save action + `runScanTrackers`), flipped on and fixed the two previously-skipped
known-but-unregistered fallthrough tests in `identity-token-flow.spec.js` (they needed the same
`attemptTopRedirect_` fallback-button-click pattern as the existing token-redirect tests, not a
bare `waitForURL`). Added a new `demo-screenshots.spec.js` test capturing
`06b-checkin-known-not-enrolled.png` and referenced it plus the newly-exercised
`04-signup-choose-month.png` in `Go30-Demo-Script.md`. Documented the fixture setup in
OPERATIONS.md. Full verification green against deployed SIT: `npm test` (20 suites),
`test:identity-token` (7/7), `demo:screenshots` (3/3). Committed as `cca93ba`. Closed bd issue
F3Go30-xj1q.1 and, since all 3 children were now done, closed the parent epic F3Go30-xj1q too.

### Key Learnings:
- `scanTrackers`'s folder walk re-registers any qualifying spreadsheet still physically present
  in the sibling folder on every run — de-registering a stray tracker from TrackerDB without
  trashing the file is not durable; it just gets re-added on the next scan. Actual removal
  requires `cleanupTracker` with `trashSpreadsheet:true` (Drive-trash, recoverable).
- Discovered and fixed pre-existing SIT debris unrelated to this branch: two duplicate TrackerDB
  registrations sharing the same StartDate (July 1 and June 1 2026) made
  `resolveTrackerDbRowForContextDate_` throw on ambiguous match, breaking the dashboard for any
  date in those months (surfaced as `demo-screenshots.spec.js`'s dashboard step failing with
  `no_tracker_for_date`). Removed the orphaned duplicates; the actively-used registration per
  month was left in place.
- `findPaxDbMatch_` (and the check-in PaxDB fallback built on it) searches PaxDB across every
  `sheetId`, not just prior months — so a next-month-only signup is a valid, fully-supported way
  to construct a "known but unregistered this month" fixture, without needing to hand-edit a
  live tracker spreadsheet (which the sandbox correctly refused as an unsanctioned write path).
- Never background a long-running command with a bare shell `&` inside a Bash tool call when
  `run_in_background: true` is available — the two can end up running concurrently against the
  same live SIT fixtures, producing flaky/racy test failures that look like real bugs.

## 2026-07-06 13:55:17

### Summary:
Diagnosed and fixed the identify/bookmark-link flow end to end. Root-caused three separate live bugs (redirect to login page, exceptionally slow sign-in, repeated-identify loop) down to bfcache/suspended-tab resume, Apps Script platform request queueing, and a browser "sticky activation" timing gap in the old script-driven redirect. Replaced the signed IdentityToken.js scheme with a new CheckinSessions.js GUID-session store (PaxCache-style roster index, lock-free touch, automatic migration of pre-rollout tokens preserving their original mint time, nightly cleanup trigger). Redesigned typed-identify as a real form POST that bakes its session guid into the form's own `action` URL before submission, then attempts an immediate on-load top-level redirect — reliable this time because it fires the instant the fresh page loads (activated by the very navigation that got there), unlike the old post-async-gap redirect. Fixed the resulting UX flicker (contradictory "Welcome back" + "tap below to open your link" shown together), made the "Welcome" vs "Welcome back" + bookmark-nudge decision exact (Created-At-vs-Last-Used-At comparison) instead of a 60s heuristic, fixed the same flicker class in SignupApp's autoStart path, fixed HomeApp.html's missing `target="_top"` on internal links, gated the next-month signup nudge to a 3-day window, and auto-redirected known-but-unregistered typed identifies straight into a prefilled signup instead of requiring a manual click. Added `test_checkin_sessions.js` and nudge-window tests; verified everything live on SIT via Playwright (9/9) and the full unit suite (23 files) after every change, catching and fixing several regressions the tests themselves surfaced (a var-hoisting bug, a dual-trigger race between the typed-form and saved-token identify paths, and stale test expectations from the old flaky-redirect era).

### Key Learnings:
- Apps Script webapp requests can queue for tens of seconds before `doPost` even begins executing — invisible to our own `GasLogger` timers (which only start once the function body runs). Confirmed by correlating a captured HAR's request timestamps against Axiom log timestamps for the same request; the gap between them is pure platform queueing, not our code.
- Browser "sticky activation" for a sandboxed iframe's script-triggered top-level navigation is a race against time, not a hard permission: attempting the redirect immediately on a fresh page load (the load itself was just activated by the navigation that produced it) is reliable; attempting the same redirect later, after an async round trip on an already-loaded page, is not — that gap is exactly what made the old typed-identify flow intermittently strand PAX on the identify form.
- A `<form>` POST's resulting address bar only ever reflects the form's `action` URL — never anything from the POST body. A server-computed value (a freshly minted session id) can't retroactively appear in the URL; the fix is to decide the identifier *before* the POST (mint a placeholder guid, bake it into the form's `action`) rather than trying to inject it after the fact.
- GAS/JS `var` declarations are hoisted but unassigned until their line actually executes. Calling a function synchronously that reads a `var` declared *later* in the same script (e.g. from a template-injected result processed inline) hits `undefined` — the async-callback paths in this codebase never hit this because by the time their `.then()` fires, the whole script has already run top-to-bottom. `setTimeout(fn, 0)` reproduces that same "runs after everything's defined" timing without a real network wait.
- Feeding the same identifier into two different "which flow am I in" checks in one function (a typed-form's session guid also satisfying the bookmarked-token check) fires both — causing two live UI updates to race for the same DOM. Each entry point needs a signal that's exclusively true for it, not a value that happens to also look valid to a sibling code path.
- Silent flakiness (redirected to login, "stuck" on a screen) is often the *symptom*, not the bug — the two live incidents this session (Little John, Crazy Ivan) both traced back to timing/state assumptions (bfcache resume; activation-expiry) that only failed intermittently, never in a way a single manual test would reliably reproduce. Server-side logs proving "every request that reached us succeeded" was the key signal that the failure was happening *before* the server ever saw it.

## 2026-07-07 09:28:45

### Summary:
Released the identify-once/check-in-session hardening work (branch `hardening/identify-once`) to
PROD as v2.3.14, then v2.3.15. Merged 9 commits into `main`, updated DESIGN.md/CONTEXT.md/
OPERATIONS.md to describe the new `CheckinSessions.js` GUID-session model replacing the old
`IdentityToken.js` redirect scheme, and added CHANGELOG.md Unreleased entries for the user-facing
fixes. Left several unrelated untracked reference files (FAQ docs, design zip, old dashboard
prototype export) uncommitted per user's choice.

After deploying, the user reported a UX regression they'd noticed live: after typed check-in
identify, PAX landed on an unnecessary "tap here to continue" step instead of going straight to
the check-in screen with the bookmark note. Root-caused it to a leftover `attemptTopRedirect_`
call in the matched branch of `CheckinApp.html` that redirected to the *same* URL the form's
`action` attribute had already navigated to (the guid is baked into the form action before
submission, per the redesign) — a fully redundant hop that either worked invisibly or surfaced the
fallback UI. Fixed by calling `applyIdentifySuccess_` directly instead, and removed the now-dead
`step-saveLink` markup. Found that `identity-token-flow.spec.js`'s `submitCheckinIdentify` test
helper had been silently clicking through that same fallback link whenever it appeared, which is
exactly why the existing suite didn't catch the regression — simplified the helper to expect a
single navigation and added a new test asserting the typed-identify POST lands directly on
`step-checkin` with `#bookmarkHereNote` visible. Verified live on SIT (7/7 identity-token tests,
full unit suite), then released to PROD as v2.3.15 after explicit user confirmation (the auto-mode
classifier correctly blocked the first `npm run release:patch` attempt since the user's message was
a bug report, not a deploy instruction).

Also explained the exact `firstUse` criteria that gates the bookmark note (server-computed via
`CheckinSessions`' `Created At === Last Used At` comparison, not a client-side flag or time
window), and created two new user-facing docs — `docs/Go30-FAQ.md` and `docs/Go30-Intro.md` —
reconciling the stale pre-web-app `Go30 FAQ.docx`/`Go30 Intro.docx` and the newer but still-dated
`docs/references/Go30-FAQ-2026-06.md` against the actual current app (bookmarkable check-in link,
exact button labels including "No Check-in" as an undo, dashboard contents, bonus-entry UI).
Neither new doc has been committed yet.

### Key Learnings:
A same-URL "redirect" is easy to introduce by accident once a design changes so the destination is
already reached by the time the redirect code runs — the fix (baking the session guid into the
form's own `action` URL) made a later `attemptTopRedirect_` call to that same URL fully redundant,
but nothing failed loudly: it either no-op'd silently or degraded to an extra manual tap, so it
took a live user report to surface. When a test helper "handles" a fallback/alternate path by
following it through unconditionally, it stops being able to prove that path *didn't* need to be
taken — `submitCheckinIdentify`'s auto-click-through on `#saveLinkAnchor` visibility is exactly why
7/7 passing tests didn't catch this regression; the fix had to tighten the helper's expectation
(single navigation only) before a new test could assert the direct-landing behavior.

## 2026-07-07 12:19:47

### Summary:
Reviewed and cleaned up newcomer-facing Go30 docs (docs/Go30-Intro.md, docs/Go30-FAQ.md). Removed
the non-standard "Fireteam" term (traced to a stray line in the original Go30 Intro.docx source),
replacing it with plain F3 "Team" language and a stronger "You are it! Both Warrior and Q of your
own life" opening. Added proper attribution for the Identity/Process/Outcome model to James Clear's
*Atomic Habits*, linking both jamesclear.com and his Habits Cheat Sheet PDF (verified the PDF's
actual content via download + pypdf extraction to confirm no inconsistency). Consolidated the
Hit/Miss/No-report (1/0/-1) scoring model into one clear explanation in both docs, and clarified the
Tracker sheet as the underlying shared spreadsheet (dropped stale "legacy" wording). Merged the
Intro's dry "Teams" section with the SignupApp.html's punchier "Strength in Numbers" copy so both
carry the same practical facts (3-5 man teams, AO grouping, Shieldlock, solo is fine) and the same
persuasive tone, then propagated the finalized wording into script/SignupApp.html so all three
surfaces match. Additionally duplicated the "How it Works" explainer panel into script/CheckinApp.html
(dashboard step, after PAX BOARD) since most users never revisit the signup page post-signup;
left source comments in both HTML files pointing back to docs/Go30-Intro.md as canonical, and filed
bd issue F3Go30-e3co to consolidate the now four-way content duplication once a sustainable
f3pugetsound.com URL exists to link to instead. Moved original .docx/.png source files and
superseded FAQ draft versions into new docs/archive/ folder. None of these changes have been
deployed (npm run deploy:sit/prod) yet.

### Key Learnings:
Google Drive "view" links can't be fetched directly by WebFetch (returns only a loading-screen
thumbnail); the reliable path is the `https://drive.usercontent.google.com/download?id=...&export=download`
redirect target, downloaded with curl and parsed locally with pypdf (installed into the project's
uv1 venv) since neither `pdftotext` nor the system Python had a working PDF library.

## 2026-07-07 18:45:01

### Summary:
Finished and closed F3Go30-g7bm (confirmation email: check-in page primary with bookmarkable session link). Deployed to SIT (@138), all unit tests green including new test_signup_email.js. Live-verified against SIT: guid resolve-or-create never duplicates a session (single CheckinSessions row for the identity; re-save reused the same guid 02942475-... and only bumped Last Used), check-in deep link (?cmd=checkin&id=<guid>) lands identified, signup deep link (?cmd=signup&id=<guid>) injects identity + auto-opens goals prefilled. User visually confirmed delivered email copy/CTA ordering (check-in primary, edit + demoted tracker).

Filed F3Go30-awhw (P2 bug) from a defect surfaced during verification: dashboard date-nav into an earlier month where the acting PAX has no Tracker row makes handleCheckinDashboard_ (dashboardWebapp.js:1362) hard-error with not_found and blanks the whole dashboard instead of degrading gracefully. Second defect captured: that identity-miss early return logs nothing, so the failure is invisible in Axiom. Corrected the repro identity to G7bmWebapp (confirmed via Axiom; "Little John" in the error banner is the owner/notify name, not the actor).

### Key Learnings:
- The check-in error banner's "notify <name>" is the configured owner/notify contact, not the acting identity — don't infer the actor from it.
- handleCheckinDashboard_ distinguishes no_tracker_for_date (correct error) from identity-miss not_found (the bug); only the latter should degrade gracefully.
- The dashboard success path logs checkinWebapp.dashboard at the end, but the identity-miss early return is silent — a failed load leaves zero Axiom trace.

## 2026-07-09 12:47:16
_session 4765f7b6 · v3 · 07-09_

### Objective 1: Reframe the "missing check-in" reminder email around the check-in web app
Rationale: "change the missing check-in email to direct them to the webapp where they can bookmark their session with their identity first, and give them the link to the tracker after that if they want to use the older sheet interface." The daily nag email still led with the Tracker sheet as its primary CTA; the check-in web app (identify once, then bookmark a personal link) is now the intended primary path, and the Tracker sheet is the legacy fallback.
Rejected: embedding a per-recipient bookmarkable guid in the nag email — structurally impossible, since the nag is one shared message sent to a team's opted-in members at once, so any guid in the body mis-identifies everyone but one recipient. The generic `?cmd=checkin` link (identify-then-bookmark) is the only correct form for a broadcast message.
Outcome [user-facing]: Reminder email (HTML + plaintext + HTML fallback) now leads with the check-in web app CTA and bookmark copy, and demotes the Tracker sheet to an "older sheet interface" link; when no web app URL is configured it still degrades to the Tracker-only layout.
Outcome [developer-facing]: Added test_nag.js coverage for the configured-web-app path (check-in link present, bookmark copy, precedes the demoted tracker link, no longer leads with "Open the tracker here:"); full suite green.
Outcome [user-facing]: Deployed to SIT @139 and triggered runNagCheck — 14 reminder emails dispatched against 07-08's column; human-verified as good.

### Objective 2: Analyze whether check-in identity can be made durable on iOS  [accreted]
Transition: the reminder-email framing surfaced the question of how a returning PAX keeps their identity, so the context was warm to reason through the persistence guarantees before proposing any keep-alive mechanism.
Rationale: Explored several proposals to keep the localStorage-saved identity alive against iOS Safari's ITP 7-day script-writable-storage cap — re-writing storage on every entry, re-seeding on any Hit/Missed interaction, and detecting stale storage then top-level-navigating to `?cmd=checkin&id=<guid>&action=…` to "reset" it. All fail: ITP resets on first-party interaction, not on writes; the app runs in a cross-origin googleusercontent.com iframe so no in-iframe gesture is ever first-party for the storage origin; the re-navigation would need the guid it's trying to rescue (so it's redundant when it can run and can't run when it's needed); and the "is storage stale?" check can't fire in the exact case the storage was wiped. The durable identity carrier is the guid in the URL, which is not storage at all — and it's already delivered per-recipient by the signup/confirmation email (g7bm), so the broadcast nag email correctly stays generic.
Outcome [internal]: Decision — leave the nag email generic; add no client-side keep-alive / re-navigation mechanism; the per-person durable link already exists via the signup email. Confirmed the guid auto-identify path already re-seeds localStorage (applyIdentifySuccess_ → saveIdentityToStorage_) and the bare `?cmd=checkin` form already defaults-from-storage-and-is-editable, so no code change was warranted.

### Key Learnings:
Google Apps Script web apps render inside a cross-origin `*.googleusercontent.com` sandboxed iframe under a top-level `script.google.com` document, so app-written localStorage lives on a third-party origin the user never visits as first party — under WebKit ITP that storage is on a ~7-day eviction cycle no client-side gesture can reset. F3Go30-4j4o.2 is cross-month bonus-edit test coverage, NOT anything to do with the nag email (earlier mis-citation corrected).

## 2026-07-09 16:51:39
_session 77b6822f · v3 · 07-09_

### Objective 1: Resolve the ns-parameter (namespace-scoped template) design and consolidate it
Rationale: The user's design idea — "an optional ns=namespace parameter ... causes the app to load from the template sheet created by the copy where we copied to a new namespace defined by a folder ... the webapp parses that ns parameter and uses it to open the namespace-qualified template" — was validated against the code and epic F3Go30-4j4o's blockers. Six open design questions on F3Go30-i5md.1 were resolved: (D1) a single resolveTemplateSpreadsheet_(e) seam reading e.parameter.ns, absent-ns falling back to the bound spreadsheet; (D2) a NamespaceDB registry that is BOTH the ns->templateId lookup AND the anonymous-webapp allowlist; (D3) the GAS sandbox-iframe client round-trip (ns read server-side in doGet, injected, echoed in every callApi POST) — the real bulk of the work; (D4) time-triggers fan out over parent UNION NamespaceDB rows whose per-trigger column is Enabled, onFormSubmit deferred; (D5/D7) Config/email isolation and the Kind (smoke|regional|demo) column.
Rejected: making CopyTemplate's Email Test Mode forcing Kind-aware was proposed and explicitly overridden — "the email test mode is universally on when copied ... after it was provisioned manually with any pre-existing TrackerDB and PaxDB setting updated, the email test mode would be manually turned on." Email Test Mode=Yes stays an unconditional copy-time fail-safe; going live is always a deliberate manual operator step, never Kind-driven.
Outcome [developer-facing]: All six i5md.1 questions resolved and the critical path to unblock 4j4o fixed (i5md.1 -> i5md.2/.5 -> i5md.3 -> w6y3 -> i5md.6).
Outcome [internal]: Consolidated into bd remember keys i5md-namespace-design-decisions and i5md-standalone-future-ceiling (the latter records that true multi-tenancy would break the bound-spreadsheet attachment for a standalone parameterized project, and that the deferred onFormSubmit work is the same thread — park it, let the migration subsume it). Corrected the email-policy entry after the override above.

### Objective 2: Draft and validate ADR-014 (namespace-scoped template resolution)
Rationale: i5md.1's deliverable is the ADR capturing the resolved design so downstream implementation tickets have a fixed reference. Matched the repo's ADR house format (ADR-010/013) and gave it subsections D1-D7 plus a Fulfils/Supersedes section, since ADR-010's deferred "Future Refinement" (on-demand test environment) is the literal seed of this decision.
Outcome [developer-facing]: Wrote adr/014-namespace-scoped-template-resolution.md (Status: Accepted, Date: 2026-07-09). Ran adr-quality-check: all five checks pass — required fields present, single-decision rule satisfied (D1-D7 are dependent facets of one seam, matching ADR-010 precedent), status/consequences consistent, immutability N/A (new file), supersede chain references the existing ADR-010.
Open: ADR-014 only PARTIALLY supersedes ADR-010 (its persistent Test/Dev-spreadsheet testing recommendation, not the dispatch decision) — recommended leaving ADR-010 unedited so its linkage lives only in 014's Supersedes section; user has not yet confirmed. i5md.1 left claimed/in_progress, not closed, pending user review of the ADR; doc-trigger-check for DESIGN.md/OPERATIONS.md (NamespaceDB + provisioning) deferred until implementation lands. ADR not yet committed.

### Key Learnings:
The ns->id lookup key cannot be the Config NameSpace value, the folder name, or the filename markers — those all live INSIDE the copy, so a PROD-side resolver can't trust them as the authoritative key; the NamespaceDB registry row (in the executing deployment's bound Template) is the only authoritative source and doubles as the ANYONE_ANONYMOUS allowlist. Separately, CopyTemplate.js:169 copies getActiveSpreadsheet(), so run from SIT it would copy SIT, not PROD — w6y3 needs an explicit source=PROD-template-id param decoupled from the destination registry.

## 2026-07-09 (WI-1)
_session 81cae8e3 · v3 · 07-09_

### Objective 1: Finish i5md.2 — audit remaining getActiveSpreadsheet() sites in WebApp.js
Rationale: ADR-014 D1 routes request-driven tenant reads through resolveTemplateSpreadsheet_(e, payload), but admin/infra reads that must stay on the executing deployment are explicitly exempted (D2/D4). The four remaining hardcoded sites (WebApp.js:297, 318, 329, 376) all live inside handleAdminPost_, a secret-gated admin surface, not the anonymous request path — so none needed ns routing.
Outcome [developer-facing]: All four sites now carry one-line stays-bound rationale comments citing ADR-014 D2: invalidateAllCache's layout-cache read (own PropertiesService/CacheService store), listSheets (diagnostic on own Template, no sheetId override), and getSheet/getSheetFormulas (already implement the payload.sheetId ? openById : getActiveSpreadsheet() precedent the ADR itself cites). No behavior changed; no new unit test needed per the mechanical done-gate. i5md.2 closed via bd.

## 2026-07-09 00:00:00
_session 3d5443f9-39f5-4ec2-b374-b4c0d71e2122 · v3 · 07-09_

### Objective 1: Implement WI-6 (bead i5md.4) — whole-environment teardown, per the plan in 4jmo.md
Rationale: 4jmo.md sequenced the i5md epic into Sonnet-sized work items with explicit read-sets; WI-1 through WI-5 were already implemented, so this session executed the one remaining item, WI-6 — the teardown counterpart to CopyTemplate.js's provisioning. Note: 4jmo.md is a scratch planning file the user intends to remove later, not a permanent doc.
Outcome [developer-facing]: Added `removeNamespaceRegistryRow_` (script/go30tools.js) — fail-safe deletion of a NamespaceDB row by NameSpace — and `teardownNamespaceEnvironment_` (script/CopyTemplate.js), which removes the registry row first (primary safety cut) then optionally trashes the environment's whole Drive folder (Template copy + copied trackers, since they share one sibling folder). Wired a new `teardownEnvironment` admin action in script/WebApp.js mirroring the existing `cleanupTracker` pattern.
Outcome [developer-facing]: TDD red→green: new tests in test/test_resolve_template_spreadsheet.js and test/test_copy_template.js cover row removal, ns-not-registered throw, folder-trash on/off, and registry-cut-before-folder-trash ordering. Full `npm test` suite green.
Outcome [user-facing]: Documented the new `teardownEnvironment` action in tools/callWebapp.js's usage header and in the project CLAUDE.md's admin-actions reference.
Open: i5md.4 not yet closed in bd — unit-green only, no live SIT deploy/verify performed this session; user was asked whether to close now or live-verify first.

### Key Learnings:
copyTemplateToNewEnvironment_ places the Template copy and every copied tracker spreadsheet in one single sibling Drive folder, so trashing that one parent folder (found via the Template copy's `getParents()`) tears down the whole environment without needing to enumerate individual files.

## 2026-07-09 20:33:58
_session 5d64a558 · v3 · 07-09_

### Objective 1: Determine what remains to close epic F3Go30-4j4o
Rationale: "we have been through each WI-1 through WI-6 on 4jmo.md. what else is necessary to resolve and close 4j4o." WI-1..6 were all coded/unit-green, but the closure gates in the plan's §7 DoD are live-verification, triage, and a decision — not more code. Mapped each WI to its bead and found the real blockers: w6y3 + i5md.6 coded-but-not-live-verified, the three deferred bugs (jldr/4j4o.1/4j4o.2) gated on i5md.6, 31w5 un-triaged, SMOKE_MODE retirement undecided.
Outcome [internal]: Established the closure path — one live SIT smoke run unblocks the whole verified chain; 31w5 triage + SMOKE_MODE decision + commit remain.

### Objective 2: Fix the missing NamespaceDB registry bootstrap  [accreted]
Transition: the first live `smokeTestNamespace.js` run failed at provisioning — "it gave an error that there was no namespaceDB." Diagnosed while the failure context was warm.
Rationale: appendNamespaceRegistryRow_ threw by design when the SIT registry spreadsheet had no NamespaceDB sheet — WI-4 shipped the write code but nothing ever created the sheet, and there is no admin action to create it remotely. Developer chose auto-create over a manual per-environment prerequisite (which would also silently block PROD go-live). "Auto-create in code (Recommended)."
Rejected: manual one-time bootstrap of the NamespaceDB sheet by hand in each environment — leaves an undocumented prerequisite with no remote way to perform it.
Outcome [developer-facing]: appendNamespaceRegistryRow_ now create-then-writes (inserts + seeds the sheet from a new NAMESPACE_DB_HEADERS_ constant when missing); replaced the throws-when-missing unit test with a creates-then-appends test; full suite green; deployed to SIT.

### Objective 3: Fix the bonus path so it can target a namespace tracker  [accreted]
Transition: the re-run got past provisioning + jldr but failed at step 3 — "❌ bonusAdd failed: not_found." Traced immediately since it was the exact 4j4o.1 failure mode.
Rationale: resolveBonusSheet_/resolveBonusMonthOnly_ resolved the target month via resolveTrackerForContextDate, which hardcoded SpreadsheetApp.getActiveSpreadsheet() — so the bonus path read the *bound* SIT TrackerDB and never found the PAX in the namespace's copied tracker. This is the "date-based dispatch can't reach the namespace tracker" wall the epic documents; the WI-5 claim that 4j4o.1 needed no code change was wrong.
Outcome [developer-facing]: Threaded an optional ns-resolved spreadsheet through resolveTrackerForContextDate → resolveDashboardMonth_ → resolveBonusSheet_/resolveBonusMonthOnly_/handleBonusEdit_ (bound default preserved for triggers/admin). Re-ran the live SIT smoke test: jldr, 4j4o.1, 4j4o.2 all green (signup+checkin today, bonusAdd/List, cross-month relocation with no duplicate).
Open: three OTHER request-driven resolveDashboardMonth_ callers (handleCheckinDashboard_ :1367, getPriorMonthTailValues_ :722, resolveCheckinDayTarget_ :932) still read the bound spreadsheet — same defect, not exercised by this test, proves i5md.2 was closed prematurely. Needs a follow-up bead before PROD go-live.

### Objective 4: Recover bd write durability and close the verified chain  [accreted]
Transition: with the live gate passed, closing the five verified beads — but the closes silently reverted, forcing a detour into bd/dolt persistence (documented in beads-server-issue.md).
Rationale: dolt server on /mnt/c (WSL2) "commits nothing"; jsonl is the de-facto source of truth and writes only persist via export.auto, which is throttled and races when multiple mutations fire in one shell (last-writer-wins clobbers earlier closes). Did NOT flip dolt_mode to embedded (the bd-maintenance §7 advice) — beads-server-issue.md flags that as a data-loss hazard here.
Outcome [internal]: Set export.interval: 0s to disable the throttle, then closed w6y3, i5md.6, jldr, 4j4o.1, 4j4o.2 one-per-invocation with a fresh-read verify after each. All five confirmed CLOSED.
Open: 31w5 triage, SMOKE_MODE retirement decision, the residual-dashboard-gap bead, and the final `bd close 4j4o` remain; all WI-4/5 + this session's fixes are uncommitted; export.interval config change uncommitted; leftover smoke namespaces on SIT need teardown.

### Key Learnings:
On this repo, batching bd mutations in one shell loses all but the last (jsonl last-writer-wins under the /mnt/c dolt server that never commits). Reliable pattern: export.interval 0s + one mutation per invocation + a separate-command `bd show` verify before trusting any close.

## 2026-07-09 21:04:25
_session 5d64a558 · v3 · 07-09_

### Objective 5: Close out 4j4o's remaining DoD items and close the epic
Rationale: Continuation of the same session's closure work — developer had triaged 31w5 separately and stated the SMOKE_MODE retirement design directly: "SMOKE_MODE should be changed to doing a copy to a SMOKE namespace and run the smoke tests in that environment before tearing it down. If there is an active SMOKE namespace when running a smoke test we should automatically dispose of it." Also asked for the residual-dashboard-gap issue (flagged at end of the prior entry) to be explained in full before filing it.
Outcome [internal]: Explained the residual-dashboard-gap in detail (three resolveDashboardMonth_ callers — handleCheckinDashboard_, getPriorMonthTailValues_, resolveCheckinDayTarget_ — still default to the bound spreadsheet; i5md.2's original audit missed this because it only scoped WebApp.js's hardcoded getActiveSpreadsheet() sites, not go30tools.js's resolveTrackerForContextDate one level deeper). Filed F3Go30-eyaa to track it, parented under i5md.
Outcome [internal]: Filed F3Go30-4wv9 capturing the SMOKE_MODE retirement design verbatim (copy-to-SMOKE-namespace, teardown on success, auto-dispose-stale-on-start), parented under i5md and marked blocked-by i5md.4 (teardown automation) since the design needs that piece.
Outcome [internal]: Closed F3Go30-4j4o with --force over the intentionally-open F3Go30-31w5 (developer's own STRATEGY note is its triage record; the bead is correctly left open per its own "idea collection, not a single task" scope). All other §7 DoD items satisfied: i5md.6/jldr/4j4o.1/4j4o.2 live-verified closed, SMOKE_MODE explicitly deferred with rationale (4wv9), residual gap tracked separately (eyaa) rather than blocking.
Open: jldr had to be re-closed twice more during this segment alone — creating/linking the two new beads (bd create, bd dep add x2) kept clobbering its CLOSED state via the same jsonl export-race documented in beads-server-issue.md, even with export.interval:0s set. The one-mutation-per-invocation + separate-command verify pattern still worked but the race is clearly not fully solved by disabling the throttle alone — worth a follow-up if bd write reliability keeps costing session time on this repo.
Open: full working tree (WI-4/5 code, NamespaceDB bootstrap fix, bonus-path ns-threading fix, export.interval config change) is still uncommitted — offered to commit, awaiting developer confirmation.

### Key Learnings:
export.interval: 0s reduces but does not eliminate the bd/dolt jsonl export race on this repo's /mnt/c-hosted dolt server — rapid bd create/dep-add/close sequences still clobbered an already-closed issue's state multiple times in one segment. The one-mutation-per-invocation-with-verify pattern remains necessary even with the throttle disabled.

## 2026-07-10 04:52:00
_session 00b75b18-7e04-4091-af2c-71c7f18d2e60 · v3 · 07-10_

### Objective 1: Verify and close F3Go30-i5md.4 (on-demand environment teardown)
Rationale: Asked to implement i5md.4; investigation found `teardownNamespaceEnvironment_` (script/CopyTemplate.js) and the `teardownEnvironment` webapp admin action (script/WebApp.js) were already implemented and test-covered (test/test_copy_template.js:148-224) as part of the i5md.1-3 commits — the bd issue just hadn't been closed out.
Outcome [internal]: Ran full test suite to confirm existing coverage passes; closed F3Go30-i5md.4 with rationale documenting it was already delivered, no code changes needed.

### Objective 2: Implement F3Go30-eyaa and F3Go30-4wv9
Rationale: eyaa found that three callers of `resolveDashboardMonth_` (handleCheckinDashboard_, getPriorMonthTailValues_, resolveCheckinDayTarget_ in script/dashboardWebapp.js) still fell through to the bound spreadsheet instead of the ns-resolved template, so a namespace PAX's dashboard/rolling-average/cross-month checkin could silently read the wrong tracker. 4wv9 called for retiring SMOKE_MODE in favor of the namespace-provisioning mechanism, but explicitly scoped that as three items and permitted deferring item 3 (full retirement) as its own rationale/plan so F3Go30-4j4o could close without SMOKE_MODE actually being dismantled yet.
Rejected: Doing 4wv9's item 3 (removing legacy SMOKE_MODE/SMOKE_TRACKER_ID special-casing across ~15 files) in the same pass — the ticket itself frames that as a follow-up once the new namespace lifecycle has proven itself in practice, not a blocker; filed as F3Go30-i5md.7 instead of doing a broad live-untested refactor.
Outcome [developer-facing]: Threaded `templateSpreadsheet` through eyaa's three call sites in script/dashboardWebapp.js.
Outcome [developer-facing]: Added `disposeStaleSmokeNamespaces_`/`fetchNamespaceRows_` and auto-teardown-on-success to tools/smokeTestNamespace.js (4wv9 items 1+2), with the existing manual-cleanup prompt kept as a failure-path fallback; added a dashboard-render verification step exercising the eyaa fix in the same script.
Outcome [internal]: Live-verified the full pipeline against SIT (three consecutive runs) — one run hit a transient Sheets read-after-write propagation lag (resolved on retry, not a code bug, confirmed via temporary debug logging that was added and then removed before the final clean SIT deploy); the other two runs passed dispose-stale, provision, jldr/4j4o.1/4j4o.2/eyaa scenarios, and auto-teardown end to end.
Outcome [internal]: Filed F3Go30-i5md.7 to track 4wv9's deferred item 3 (legacy SMOKE_MODE retirement) as a separate follow-up.

### Key Learnings:
Apps Script's `SpreadsheetApp.openById()` read shortly after a burst of writes from a Drive-copy-then-write sequence (copyTemplateToNewEnvironment_ followed immediately by a signup write) can occasionally return a stale snapshot for a few seconds even in a fresh execution with no relevant CacheService/PropertiesService cache in play — a genuine eventual-consistency window, not something invalidation logic can guard against.

## 2026-07-09 22:23:28
_session 89627ab3 · v3 · 07-09_

### Objective 1: Verify, commit, and close F3Go30-4wv9 (namespace smoke lifecycle automation)
Rationale: A prior session had already implemented 4wv9's auto-dispose-stale-on-start and auto-teardown-on-success logic in tools/smokeTestNamespace.js, plus the F3Go30-eyaa dashboard-path namespace fix, but left both uncommitted and the issues open. User redirected mid-session from a five-item punch-list to "work on and implement i5md and the issues blocking it," making 4wv9 the first concrete target since it was closest to done.
Outcome [developer-facing]: Ran the full unit suite (green) and a live namespace smoke run against SIT (dispose-stale/provision/jldr/4j4o.1/4j4o.2/eyaa scenarios/auto-teardown all passed); committed the eyaa + 4wv9 changes.
Outcome [internal]: Closed F3Go30-4wv9, documenting item 3 (full SMOKE_MODE retirement) as deliberately deferred to a new issue rather than bundled in, per 4wv9's own scope note.

### Objective 2: Implement and close F3Go30-i5md.7 (retire legacy SMOKE_MODE/SMOKE_TRACKER_ID)
Rationale: i5md.7's own text said to wait until the namespace path "proven itself over real use" before retiring SMOKE_MODE; asked the user whether to defer or proceed now given only one session's worth of verification existed. User chose to proceed: "Implement i5md.7 now."
Rejected: Considered leaving `getSmokeStatus`'s deployTarget-reporting half-life around after removing its smoke fields, but the issue's brief was full retirement — deleted the whole action rather than a partial repurpose outside that scope.
Outcome [developer-facing]: Removed every SMOKE_MODE/SMOKE_TRACKER_ID read/write across script/SmokeMode.js (deleted), CreateNewTracker.js, Utilities.js, WebApp.js, go30tools.js, and signupWebapp.js; deleted tools/smokeTest.js and test/test_smoke_mode.js; updated CLAUDE.md, docs/OPERATIONS.md, docs/DESIGN.md, docs/deployment-model.md to describe the namespace-based smoke workflow instead. Left the unrelated name-based `(Smoke)`/`(Expired)` folder exclusion and NamespaceDB's `Kind='smoke'` concept untouched after confirming via investigation they're structurally distinct from the retired mechanism.
Outcome [developer-facing]: Discovered and fixed a real pre-existing bug this cleanup unmasked: `maybeReuseLastMonthsGoals_` (signupReuse.js) unconditionally called `sendGoalReuseEmail` on every path, contradicting its own tests' documented intent ("webapp signup path does not send a no-reuse notification; that email belonged to the form-submit path") — the calls were only ever masked by an unrelated `PropertiesService` mock gap in test_signup_reuse.js that the now-removed SMOKE_MODE read happened to trigger and a try/catch happened to swallow. Removed both dead calls; exported `buildPrefilledGoalUpdateUrl` and rewrote its two page-break regression tests to call it directly instead of transitively through the (now email-free) orchestration function.
Outcome [internal]: Deployed to SIT (@145) and live-verified: `getSmokeStatus` now `unknown_action`, `runScanTrackers` works ungated, full namespace smoke lifecycle still passes end to end. Closed F3Go30-i5md.7, F3Go30-4j4o.2 (its cross-month coverage gap is exactly what smokeTestNamespace.js's step 4 now exercises), and the F3Go30-i5md epic (13/13 children complete) — unblocking F3Go30-4j4o (still open on the separate, out-of-scope F3Go30-31w5 triage decision).

### Key Learnings:
This repo's bd/dolt jsonl export race (previously logged 2026-07-10) reverted a `bd close` mid-session — the same close command re-run and verified with a fresh `bd show` a few seconds later stuck cleanly, confirming the one-mutation-per-invocation-with-verify pattern remains necessary even for read-after-close checks, not just write sequences.

## 2026-07-10 (session end)
_session f4b30420 · v3 · 07-10_

### Objective 1: Decouple smoke-test namespace registry from Template source
Rationale: `tools/smokeTestNamespace.js` hardcoded its copy source to PROD's `templateSpreadsheetId` regardless of `--env`, with that behavior only documented in a source comment. Developer wanted an explicit `--template <prod|sit>` flag so which spreadsheet is copied FROM is a first-class, visible choice independent of which environment (`--env`) registers and runs the namespace (ADR-014 D6: source and destination are deliberately decoupled).
Outcome [developer-facing]: Added `--template` (default `prod`, preserves prior behavior) to `tools/smokeTestNamespace.js`, mapping `prod`→`templateSpreadsheetId` / `sit`→`testSpreadsheetId` via a new `TEMPLATE_SPREADSHEET_ID_KEY` table; validated with invalid-value rejection and a `node -c` syntax check.

### Objective 2: Make the default's real behavior explicit in docs
Transition: developer flagged that my initial explanation of smoke tests didn't make clear that the default run copies PROD's data even when registered under SIT — "that is not what you explained earlier so the documentation needs to be clear when it says it copies a template, which template it is copying."
Rationale: `--env sit --template prod` (the default) registers the namespace under SIT's deployment but still provisions it from PROD's real recent trackers — non-obvious and worth spelling out so nobody reads a default SIT run as testing against SIT's own data.
Outcome [developer-facing]: Updated `docs/OPERATIONS.md` §Smoke Mode and `CLAUDE.md`'s Smoke mode workflow quick-reference to state explicitly that `--env` and `--template` answer different questions, and that the default combination copies PROD's real data into a SIT-registered namespace.
## 2026-07-11 01:20:00
_session 3d149096-4f8e-4519-ad3a-eaf71a31b98f · v3 · 07-10→07-11_

### Objective 1: Brighten check-in dashboard score colors and widen the printed content area
Rationale: The red/yellow/green (-1/0/1) status triad used for the day-ring, sparkline, average-score text, and legend read too muted; user asked to brighten them. Follow-up feedback added two more polish items in the same visual pass: distinguish future ("upcoming") ring days from today's not-yet-reported ("pending") day with a lighter shade, and widen the check-in/dashboard column since the printed area felt cramped.
Outcome [user-facing]: `script/CheckinApp.html` — done/missed/absent triad bumped to more vivid hex values (`#2f5d50→#3f8b75`, `#b8860b→#f7b209`, `#a3401a→#de521c`), applied consistently to `scoreColor_`, `SEGMENT_COLORS_`, and the legend swatches (brand teal used elsewhere in headers/buttons left untouched, since only the score triad reused that hex); `upcoming` ring segments lightened to `#e7e2d8` (distinct from `pending`'s `#d8cfbf`); `.wrap` side padding reduced 18px→8px, widening the content column without touching the 720px max-width or mobile breakpoint.
Outcome [internal]: User deployed to SIT and confirmed the changes read as an improvement before merge.

### Objective 2: Ship PR #2 (namespace-scoped template provisioning, ADR-014)
Rationale: All 8 Copilot review comments across two rounds (04:18 and 14:17) had already been fixed and replied to by commit db9627f; nothing was left outstanding, so the branch was ready to land. User asked to "swash [squash] merge" and log the session.
Outcome [developer-facing]: Committed the dashboard polish (package.json/version.js build-metadata bumps included, `.vscode/settings.json` left out as an unrelated local editor preference), pushed, and squash-merged PR #2 into main via `gh pr merge 2 --squash --delete-branch` (merge commit `0ef9d77`).
Outcome [internal]: `gh pr merge`'s local fast-forward step failed because local `main` held a stale unpublished commit (`1bacf17`, the original ADR-014 file) that diverged from origin's squashed history. Confirmed the commit's content was fully subsumed by the squash merge, then reset local `main` to `origin/main` after explicit user confirmation (destructive op).

### Key Learnings:
`gh pr merge --squash` can succeed on GitHub while still erroring locally ("Not possible to fast-forward") if the local base branch has any unpublished commit — always check `gh pr view --json state,mergedAt` to confirm the remote outcome before treating the CLI error as a merge failure.

## 2026-07-11 10:49:52
_session 63c83394 · v3 · 07-11_

### Objective 1: Review the already-implemented contextDate feature (F3Go30-31w5.1/.2) before committing
Rationale: bd showed both sub-issues closed with implementation notes matching the uncommitted working tree, so the session pivoted from "implement" to "verify what's already there before it gets committed." A full diff read-through was chosen over a quick skim since the user asked to "review the diff first."
Outcome [developer-facing]: Found and fixed a real bug — onOpen.js's menu item called `setContextDateMenuAction` but the function was defined as `setContextDateMenuAction_` (trailing underscore), so the "Set Test Context Date..." menu entry would have thrown when clicked. Renamed to match the existing `invalidateCacheMenuAction` (no-underscore) convention; updated the corresponding test and module export. All 27 test suites still green.

### Objective 2: Live-verify the check-in month-boundary ("yesterday" crosses into prior tracker) scenario on SIT  [accreted]
Transition: user asked specifically to "test in SIT... someone checking in on the first of the month should have the checkin option for yesterday which would be the prior month" — this required going beyond static review into an actual deployed run.
Rationale: Also resolved a scope question raised mid-session — whether contextDate threading into signup/bonus-add/edit paths was overreach beyond checkin+markMinusOne+nag. User confirmed keeping it: "signup and bonus initiating workflows also need to know the current Date, that's a good call."
Rejected: N/A — user validated the existing broad scope rather than narrowing it.
Outcome [developer-facing]: Live testing against SIT (contextDate=2026-08-01) surfaced two further real bugs: (1) `resolveContextDate_` parsed `YYYY-MM-DD` via `new Date(text)`, which is UTC-midnight per spec — in Pacific time this silently rolled the pinned date back a day, and on the 1st, back a whole month. Added `_parseContextDateLocal_` (go30tools.js), mirroring the existing `parseIsoDateLocal_` pattern, to parse as local midnight instead. (2) `resolveCheckinIdentity_` never received `payload.contextDate`, so check-in identify's own "what month is current" resolution silently ignored the override even though the day/yesterday arithmetic layered on top of it did honor it — threaded contextDate through both call sites (handleCheckinIdentify_, handleCheckinSubmit_).
Outcome [user-facing]: Redeployed to SIT and re-verified live: pinning contextDate to Aug 1 now correctly resolves "current month" to August, and submitting a "yesterday" checkin correctly writes into the prior (July) tracker's July 31 column — confirmed via a real signup + checkin + raw sheet read, then cleaned back up (checkin value cleared; one harmless leftover August test-signup row for "Little John" left in place per user's choice, since no admin action supports single-row removal without deleting the whole live August tracker).

### Key Learnings:
`new Date('YYYY-MM-DD')` parses as UTC midnight per spec — in any timezone behind UTC this silently shifts the effective local calendar day backward, which is easy to miss because `.toISOString()`-based assertions (as in the existing unit tests) don't expose the bug at all; only a check against local-timezone fields (getMonth/getDate) or a live cross-month test surfaces it.

## 2026-07-11 17:07:28
_session a5274c7c-04db-42ca-adf5-ade5e4421173 · v3 · 07-11_

### Objective 1: Design the Advanced whole-month check-in grid (F3Go30-th22.1) and prototype it
Rationale: th22.1 is a design-only issue whose deliverable unblocks th22.2 [IMP] and th22.3 [TST] to run independently — the five required decisions (backend write contract, month/day-rec source, client structure, day-column/week-separator CSS, accessibility) needed to be resolved concretely enough that neither downstream issue has to re-derive intent from the implementation. A visual prototype was requested alongside the doc so the interaction model could be validated before committing to it in writing.
Rejected: The first design pass used a per-day-row list (one row per calendar day, Hit/Miss/None buttons inline) per the issue's original literal scope. The user redirected to a true month-calendar grid with color-coded cells instead — the row-list design was superseded, not iterated on.
Rejected: An early calendar draft removed the existing TODAY/YESTERDAY quick-access blocks in favor of always showing the new day-picker. The user overrode this: "you should have the Today/Yesterday unless the month view is open because many times you check in for yesterday if you have a late night goal of being in bed on time" — TODAY/YESTERDAY and the calendar are now mutually exclusive views, calendar only replacing them while open.
Rejected: The Failed (-1) control was initially disabled for any day not `dateIso < todayIso`, applied uniformly to all four buttons for "upcoming" days (Hit/Miss/None/Failed all disabled on future dates). The user corrected the actual purpose of the view — "to allow someone to mark some days in advance if they are going to be away and unable to check-in, or to edit days in the past" — so only Failed is date-gated; Hit/Miss/No-check-in are editable for any day including the future, and the whole client-only "upcoming" disabled-state concept was removed from the design.
Rejected: Calendar cell styling went through two more corrections: an initial pastel-tint palette was replaced with invented dark/saturated colors per user request for "darker background with lighter or white text," then replaced again with the literal `SEGMENT_COLORS_` constant already defined in CheckinApp.html (the same colors driving the existing month-progress ring/day-mini-bar) once the user asked which palette was authoritative — no new palette, reuse the real one. The Failed-day "X" mark was also corrected twice: from a small corner glyph to a full-cell overlay, then from a solid overlay to a translucent one so the day number stays visible underneath.
Outcome [internal]: Design recorded on F3Go30-th22.1 via `bd update --design-file`, revised four times in place as each correction landed; issue closed with the approved design as its final `bd close -r` reason. th22.2/th22.3 confirmed unblocked via `bd ready`.
Outcome [user-facing]: Interactive HTML prototype iterated through four redeploys to the same Artifact URL (https://claude.ai/code/artifact/7429549e-1bc2-4c5f-aed1-ab5c3fd84ddf), ending on: default TODAY/YESTERDAY blocks, a "Continue to Dashboard" button positioned above the toggle, a "Show month calendar" toggle swapping in a full month-grid + unified "STATUS FOR" selection panel, cell colors matching the live dashboard's `SEGMENT_COLORS_`, a translucent full-cell X on Failed days with the day number still legible, container-query-relative (`cqw`) day-number sizing instead of a fixed px value, and every day (including future) editable except Failed.
Outcome [developer-facing]: Backend write-contract decision finalized — `payload.day` widened to accept an ISO `"YYYY-MM-DD"` string alongside `'today'`/`'yesterday'`, `value` widened to accept `-1`, plus a new server-side defense-in-depth rule rejecting `value === -1` when the target date is today or later (mirroring the client's button gate) — and an 14-item Test surface enumerated for th22.3 to build against without reading the eventual implementation.
Open: Implementation (th22.2) and tests (th22.3) intentionally deferred to a new session per the user's plan.

## 2026-07-11 20:07:44
_session 48482ec4-2c2b-485a-be06-944f91a65922 · v3 · 07-11_

### Objective 1: Implement the Advanced whole-month check-in grid (F3Go30-th22.2)
Rationale: Build strictly to the frozen th22.1 design so a PAX can set/correct Hit/Miss/No-Check-in/Failed for any day of the current tracker month, not just today/yesterday — including pre-marking a planned-absence day and PAX-set honor-system Failed (-1), which was previously Q-only.
Outcome [developer-facing]: `dashboardWebapp.js` gained `buildMonthGridEntries_`, `isStrictlyPastCalendarDate_`, and `validateCheckinSubmitDayValue_` as unit-tested pure functions; `handleCheckinSubmit_` now accepts an explicit `"YYYY-MM-DD"` day and `value:-1` (server-side date-gated), and `handleCheckinIdentify_` returns a new `monthGrid` field — all covered by new tests, full existing suite still green.
Outcome [user-facing]: `CheckinApp.html` gained a "Show month calendar" toggle revealing a 7-column calendar plus a single unified Hit/Miss/No-check-in/Failed selection panel; deployed to SIT and the write path (explicit-date write, -1 accept/reject by date, malformed-date rejection) verified live against a real PAX row, then restored.
Outcome [user-facing]: Fixed a bug found during that live SIT testing — the selection panel's Hit/Miss/No-check-in buttons are shared across whichever day is selected, so switching days while an earlier day's write was still in flight left them stuck showing "Saving…"; `renderSelectionPanel_` now unconditionally clears that lingering state on every day switch (writes to different days are independent and were never meant to serialize). Redeployed to SIT.
Outcome [internal]: `docs/DESIGN.md`, `docs/CONTEXT.md` (capability + UC-7 alternate flow A5), and `docs/CHANGELOG.md` Unreleased updated per the doc-trigger rules; bd issue F3Go30-th22.2 closed with the implementation + fix recorded. Screenshots and the full th22.1 test-surface enumeration are deferred to F3Go30-th22.3, deliberately run in a separate session/context.

## 2026-07-12 06:09:15
_session 7728c62f · v3 · 07-11_

### Objective 1: Implement F3Go30-th22.3 — test the Advanced whole-month check-in grid
Rationale: th22.1 (design) and th22.2 (implementation) were already closed; th22.3 needed to actually exercise the design's 14-item Test surface against the live SIT deployment rather than relying only on the existing pure-function unit tests (buildMonthGridEntries_, validateCheckinSubmitDayValue_, isStrictlyPastCalendarDate_), since the calendar/selection-panel client behavior had zero prior coverage.
Rejected: building a heavy mocked fixture for handleCheckinSubmit_'s full identity-resolution chain in test_dashboard_webapp.js — the project has no precedent for that (not even for the pre-existing today/yesterday path), and this codebase's convention is to verify live-sheet-dependent behavior via Playwright against real SIT rather than deep mocking.
Outcome [developer-facing]: Added tests/playwright/checkin-advanced-grid.spec.js — 17 tests covering all 14 Test surface items (calendar render/pad-offset/status classes, today/selected markers, ✕-mark exclusivity, click-to-select with no re-render/API call, future-day editability, #selFailBtn date gate, exact callApi payload per button, toggle mutual exclusivity) plus a direct-HTTP describe block for the server write contract (explicit-date writes, malformed/out-of-range rejection, -1 date-gating even via direct POST, today/yesterday regression). All 17 pass against live SIT.
Outcome [user-facing]: Fixed a real bug found while writing the tests — CheckinApp.html's advancedToggleBtn handler called renderCalendar_() before setting state.selectedDateIso, so no calendar day ever showed as selected on first opening the calendar until the PAX tapped a cell. Reordered so state.selectedDateIso is set first; redeployed to SIT (@155).
Outcome [developer-facing]: Diagnosed and repaired a broken test fixture along the way — the NoSadClown SIT fixture PAX had a Responses row for the current month but no corresponding Tracker row (the webapp signup save path adds both, but the row was missing), which made every check-in identify() call fail with "haven't signed up yet"; fixed by re-running the signup save action directly against SIT.
Outcome [user-facing]: Added docs/references/demo-screenshots/07b-checkin-advanced-calendar.png to demo-screenshots.spec.js per the epic's screenshot requirement.
Outcome [internal]: Closed F3Go30-th22.3 and, since all three children (INF/IMP/TST) were now done with docs already updated, closed the parent epic F3Go30-th22 too.

### Key Learnings:
The webapp signup save path (handleSignupSave_) writes both Responses and Tracker rows in one call, but a Tracker row can end up missing if an earlier partial/interrupted signup attempt only wrote Responses — re-POSTing the same save payload directly via tools/callWebapp.js repairs it without needing to touch the sheet by hand.
## 2026-07-12 (work-log entry)
_session e8eae1cd-427f-494c-8a5b-b08e6d2e3aed · v3 · 07-12_

### Objective 1: Implement and verify F3Go30-nhge.2 (anchor-through-today %% denominator test coverage)
Rationale: nhge.2 required unit coverage for the per-PAX score %% denominator anchor logic shipped in nhge.1. Before writing tests, checked the shipped `firstActiveDayIndex_`/`buildDashboardPaxRow_` code against nhge.2's stated acceptance criteria and found two real conflicts: leading `-1` days don't anchor the denominator (so early no-shows aren't penalized, contrary to AC case 5), and there's no blank-today denominator adjustment (a joiner perfect-through-yesterday-but-not-yet-checked-in-today scores ~95%, not the AC's stated 100%, case 2). Rather than unilaterally rewriting nhge.1's already-shipped, already-tested behavior, presented the conflict and asked the user how to resolve it.
Rejected: Rewriting `firstActiveDayIndex_`/the denom calc to match the parent bug's literal DESIGN/AC text was considered and rejected — user chose "Keep nhge.1's simpler behavior, adjust nhge.2's tests to match it instead."
Outcome [developer-facing]: Added 8 new test cases to test/test_dashboard_webapp.js covering the anchor-through-today denominator (canonical joiner, blank-today, blank-yesterday, joined-today, enrolled-slacker, no-data fallback, full-month regression, streak/rollingAverage/daySegments guard); cases 2 and 5 assert the actual shipped behavior with comments flagging the deviation from the parent bug's literal AC text.
Outcome [internal]: Logged a `bd remember` note (`F3Go30-nhge-ac-deviation`) documenting the AC-vs-shipped-behavior gap and left parent bead F3Go30-nhge open (its AC as written isn't fully satisfied by the code); closed F3Go30-nhge.2. Full local suite (`npm test`) passes.
Outcome [internal]: Ran the SIT namespace smoke suite (`node tools/smokeTestNamespace.js --env sit --template prod`) as end-to-end verification — signup/check-in/dashboard, bonus add/list, and cross-month bonus-edit relocation all live-verified against a disposed namespace; torn down cleanly on success.

## 2026-07-14 07:27:50
_session 5f134524 · v3 · 07-14_

### Objective 1: Add an "Edit signup" affordance to the check-in page's goal info
Rationale: From the check-in page's goals reminder a PAX had no way back into their signup to change WHO/WHAT/HOW; requested a link that "allows editing your signup info. this should be the same as the signup page, and after submitting you should be back on the checkin page." Reused the existing prefilled-signup deep link (`?cmd=signup&targetMonth=current&autoStart=1`) rather than building a new goal editor in check-in; the return trip needed no new code because a current-month save already returns `identityToken` and `performSave_` redirects into check-in.
Outcome [user-facing]: "Edit" link now renders in the check-in goals reminder (under a "Your goals" title), opens the prefilled signup, and returns the PAX to check-in on save. Verified live on SIT.

### Objective 2: Design review — reuse over proliferation, and justify the separate signup page  [accreted]
Transition: developer redirected mid-task — "review the design ... we already have a mechanism of dealing with signup if the user is not signed up ... prioritize reuse and simplification rather than proliferation of similar code," and "consider whether we even need a separate signup page ... don't remove it, just evaluate."
Rationale: The signup deep-link string was hand-built in four places (two identify fallthroughs, the next-month button, and the new Edit link). Both the not-signed-up nudge and the Edit link already converge on the same current-month `identityToken` return path, so they should share one URL builder. The separate signup page is justified — it owns anonymous first-time entry, next-month registration, onboarding/feedback, and email deep-links, and writes a different data contract (Responses/PaxDB/Tracker) than check-in.
Outcome [developer-facing]: Extracted `signupDeepLinkUrl_(targetMonth)` in CheckinApp.html; all four entry points route through it. Removed three duplicate URL strings.
Outcome [internal]: Recorded the rationale for keeping SignupApp.html separate; no code removed.

### Key Learnings:
GAS webapp pages render inside a doubly-nested sandbox iframe with no query string of its own — deep-link params (targetMonth/autoStart/ns/id) must be read server-side in the doGet handler and templated in, never read client-side; Playwright locators must go through `frameLocator('iframe').frameLocator('iframe')`.

## 2026-07-14 09:07:00
_session 07087755 · v3 · 07-14_

### Objective 1: Share resolved identity/month context across identify → checkin → dashboard (F3Go30-qi26.1)
Rationale: identify, checkin-submit, and dashboard each independently re-ran resolveMonths + the identity lookup for the SAME PAX in one session (measured ~764/1002/526ms x3 for resolveMonths, ~1226/951/2465ms x3 for resolveIdentity). Have identify mint a lightweight resolved-context handle (target sheetId, PAX Tracker rowIndex, monthKey, canonical F3 name, plus label/url/startDate to rebuild a monthInfo) that the client echoes back on its follow-up POSTs so those handlers skip both re-resolutions and go straight to the known row. Correctness gate required: a stale handle (roster edit shifted rows, month rollover) must transparently fall back to full resolution with no user-visible error.
Rejected: for the dashboard, skipping resolveDashboardMonth_ purely by trusting the handle's month was rejected in favor of a YYYY-MM guard (requested dateISO's month must equal the handle's monthKey) — this makes month rollover and date-nav into other months fall back to the authoritative TrackerDB resolution automatically, since trackers are per calendar month. Also rejected refactoring the heavily-tested resolveCheckinIdentityFull_ to thread a handle param through it; wrote a parallel resolveFullIdentityFromHandle_ instead so each keeps its own purpose-built Axiom timing.
Outcome [developer-facing]: dashboardWebapp.js — added buildResolvedContextHandle_/monthInfoFromHandle_/resolveLeanIdentityFromHandle_/resolveFullIdentityFromHandle_; handleCheckinIdentify_ returns resolvedContext; handleCheckinSubmit_ and handleCheckinDashboard_ take the fast path when the handle validates (name-at-rowIndex gate) and fall back otherwise. Cross-month writes still resolve correctly via resolveCheckinDayTarget_'s own date-based month fallback.
Outcome [developer-facing]: 9 new unit tests in test_dashboard_webapp.js (handle round-trip, lean/full resolve valid + stale + invalid-input paths, submit fast-path + stale-fallback, dashboard own-month fast path vs off-month fallback via a hostile TrackerDB template). Full suite green (exit 0).
Outcome [user-facing]: CheckinApp.html now stores the identify handle on state and echoes it on checkin/dashboard POSTs — no visible behavior change, faster follow-up calls.
Open: the echoed handle carries a client-supplied sheetId; the server re-validates the canonical name at rowIndex but does not confirm the sheetId is a registered tracker. Consistent with the pre-existing ANYONE_ANONYMOUS trust model (client name is already trusted; cross-month writes already open date-resolved sheets), but worth a reviewer's eye. Live Axiom timing verification (calls 3/4 showing reduced server time) is deferred — this was a headless session with no SIT deploy. (inferred: the Axiom re-run is part of the AC but requires a deploy the runner performs.)

### Key Learnings:
A background process in this repo (the beads runner / a clasp-adjacent tool) transiently renames script/*.js to *.txt during its own operations — git status briefly showed script/WebApp.js deleted with an untracked WebApp.js.txt, then self-restored. Not a change to worry about if caught mid-flight.

## 2026-07-14 00:00:00
_session eb0e72cb · v3 · 07-14_

### Objective 1: Prefetch dashboard payload after identify so Continue-to-Dashboard is instant (F3Go30-qi26.2)
Rationale: The Continue-to-Dashboard click always incurred a fresh ~9.65s dashboard round trip while the user waited on a Loading state, even though identify already resolves the identity/context needed to fetch it. Firing loadDashboard_() in the background as soon as auto-identify resolves lets that fetch overlap with the time the user spends reading the check-in screen, removing a serialized round trip from the perceived path.
Outcome [user-facing]: script/CheckinApp.html — applyIdentifySuccess_ now calls a new prefetchDashboard_() right after showStep('checkin'), which fires loadDashboard_(undefined, {silent:true}) in the background and tracks it in state.dashboardPrefetchPromise. loadDashboard_ gained a silent option that skips DOM/loading-state mutation and error-banner display (background failures are swallowed; the click path falls back). The dashboardBtn click handler now renders directly from state.monthCache with no fetch when the prefetch has already landed, rides the in-flight prefetch promise and renders from cache once it resolves if it's still in flight, or falls back to a normal loadDashboard_() fetch if the prefetch failed or never started.
Outcome [developer-facing]: No test coverage added — CheckinApp.html is client-side HTML/JS with no harness in this repo's `npm test` suite (backend-only); full suite (27 test files) still passes. Manual/live verification of perceived latency improvement (harness re-run per AC) was not performed this session.
Open: AC's "harness re-run shows the dashboard step no longer adds a full server round trip to perceived tap-to-dashboard time" was not independently re-measured — no perf harness was run against a live deployment in this session.

## 2026-07-14 00:00:00
_session 06317824 · v3 · 07-14_

### Objective 1: Reduce the dashboard whole-roster read / freshCheck cost (F3Go30-qi26.4)
Rationale: The dashboard's identity resolution paid an unconditional ~½s Drive-modtime freshCheck (DriveApp.getFileById().getLastUpdated()) before every whole-roster read, even on the hot handle fast path (resolveFullIdentityFromHandle_) the check-in→dashboard flow now takes post-qi26.1/qi26.2. The whole-roster read itself is genuinely required — every PAX's Tracker row backs the team/board view (allPaxRows/paxBoard/myTeamMembers) — so per the AC that read stays on the critical path with a documented rationale; the reducible cost is the freshCheck. Insight: the freshCheck only exists to validate a *cached* roster; on a cold cache the code reads live anyway, and a live read is definitionally current, so probing Drive first is pure latency with nothing to invalidate. This mirrors resolveLeanIdentityFromHandle_, which already trusts its single-row live read with no probe.
Rejected: splitting the dashboard payload (user tile first, board deferred/lazy) — the AC's other allowed path. Deferred as a large, higher-risk client+server change unsuitable for an unattended session with no live GAS verification available; the freshCheck deferral is a correctness-preserving, unit-testable win.
Outcome [developer-facing]: Added markPaxCacheFreshNow_(sheetId) to PaxCache.js — stamps the asOf marker from the read moment (Date.now(), >= the sheet's real last-updated at read time) and sets the per-execution memo, no Drive round trip. Refactored resolveFullIdentityFromHandle_ and its parallel fallback resolveCheckinIdentityFull_ to peek the roster cache(s) up front, run ensurePaxCacheFresh_ only when there's something cached to validate, and stamp asOf-now when reading live instead. Documented the whole-roster read as required-for-board in-code.
Outcome [developer-facing]: New unit tests — test_pax_cache.js proves markPaxCacheFreshNow_ stamps asOf with zero DriveApp calls, short-circuits a same-execution ensurePaxCacheFresh_, and survives an unchanged-sheet re-check in a fresh execution; test_dashboard_webapp.js proves resolveFullIdentityFromHandle_ makes 0 Drive calls on a cold roster cache (still returning the full 2-PAX roster) and exactly 1 probe on a warm cache. Full suite (npm test) green.
Open: The AC's "dashboard totalMs in Axiom materially reduced" and "harness re-run confirms" require a live SIT deploy + the Playwright/Axiom perf harness (separate bead F3Go30-qi26.5, not yet built) — neither possible in this unattended, no-deploy session. Live confirmation is deferred to a human/harness run; the code-level freshCheck elimination is complete and unit-verified. Design-doc/ADR updates are out of scope here (owned by F3Go30-qi26.6).

## 2026-07-14 21:50:00
_session 730af92f-e9c0-419f-9d7f-f4ece1201b59 · v3 · 07-14_

### Objective 1: Build repeatable Playwright+Axiom check-in performance harness (F3Go30-qi26.5)
Rationale: Optimization work needs a repeatable measurement tool to capture before/after performance numbers. The harness measures the full returning-user check-in flow (page load → auto-identify → check-in → dashboard) with per-request TTFB and total timings, enabling correlation with GAS logs via Axiom.

Outcome [developer-facing]: Created `tools/measureCheckinPerformance.js` — a Node.js CLI tool that mints identity tokens, drives the check-in flow with Playwright, captures per-host network timings (GAS + googleusercontent), and prints an Axiom correlation window for log filtering. Supports `--env sit|prod` and `--rounds N` for repeated runs. Reuses the existing `callWebapp.js` pattern for deployment ID loading and token minting.

Outcome [internal]: Added brief section to `docs/OPERATIONS.md` under "Performance Testing — Check-in Round-Trip Harness" documenting usage, output format, and the Axiom correlation workflow.


## 2026-07-14 15:05:00
_session a12f2bbd-a37f-4f0b-9c43-396ecb31930d · v3 · 07-14_

### Objective 1: Document the check-in/dashboard round-trip reduction (F3Go30-qi26.6)
Rationale: qi26.1-.5 landed the implementation (shared resolved-context handle, dashboard prefetch, doGet title-cache deferral, dashboard freshCheck deferral, and the Playwright+Axiom perf harness) across prior sessions; qi26.6 closes the epic's documentation gap so the architecture and its tradeoffs are recorded before the epic is considered done. Docs-only session per the bead's scope — no code changed.
Outcome [developer-facing]: Added adr/015-checkin-dashboard-round-trip-reduction.md recording the round-trip-reduction decision (five coordinated sub-changes under one architectural decision, matching ADR-014's D1-D7 style), its tradeoffs (parallel fast/slow-path implementations, client-held handle correctness burden), and a cross-reference to the qi26.5 measurement harness; ran adr-quality-check's checklist against it inline (all fields present, single overarching decision, status/content consistent, no broken supersede chain). Updated docs/DESIGN.md's Decisions(short) section with a summary of the same four implementation changes and their in-code rationale.
Outcome [user-facing]: Added a docs/CHANGELOG.md Unreleased bullet noting the PAX-visible speedup (instant "Continue to Dashboard", faster bookmarked check-in page load).
Open: qi26.4's AC item confirming dashboard totalMs is materially reduced against a live deployment (via the qi26.5 harness) is still outstanding — flagged as a human follow-up in both the bead notes and ADR-015's Consequences, since it requires a live SIT/PROD run this unattended session could not perform.

## 2026-07-14 17:31:03
_session 08f5daed-0006-454d-bc92-295e921fdc99 · v3 · 07-14_

### Objective 1: Fix and resolve F3Go30-nzi0 (bonus cache not wired to Drive-modtime staleness gate)
Rationale: `ensurePaxCacheFresh_`'s Drive-modtime gate existed specifically to catch manual sheet edits the webapp didn't make, but the bonus-entries CacheService keys (`go30dash:bonusEntries:`/`go30dash:bonusRows:`) were added later in bonusWebapp.js and never wired into that invalidation block — so a manual Bonus Tracker edit could serve a stale phantom bonus total for up to the 6h TTL.
Outcome [developer-facing]: `script/PaxCache.js`'s `ensurePaxCacheFresh_` now also removes the two bonus CacheService keys alongside the existing roster keys on modtime advance. Added two regression tests to `test/test_pax_cache.js` mirroring the existing roster-cache tests. Full suite (28 files) passed.

### Objective 2: Fix and resolve F3Go30-0gx6 (dashboard renders pre-check-in prefetched payload)
Rationale: `prefetchDashboard_()` (from F3Go30-qi26.2) caches the dashboard payload at identify time, before any check-in; the check-in submit success handlers updated local UI state but never invalidated that cache, so Continue-to-Dashboard's cache-hit fast path rendered the pre-check-in snapshot until a reload.
Outcome [developer-facing]: Added `invalidateMonthCacheFor_(dateIso)` to `script/CheckinApp.html`, called from both `submitCheckin_` and `submitSelectionCheckin_` success handlers, deleting just the affected month's `state.monthCache` entry so Continue-to-Dashboard re-fetches live data instead of the stale prefetch. Added a static-shape regression test (`test/test_checkin_monthcache_invalidation.js`, following this project's existing no-jsdom precedent) and wired it into `npm test`. Full suite (29 files) passed.

## 2026-07-14 20:29:20
_session 929dd4c5 · v3 · 07-14_

### Objective 1: Review and close qi26 epic + qi26.4/qi26.6 (check-in round-trip reduction)
Rationale: An unattended bd-run-beads session (20260714-213422Z) had implemented and committed qi26.4/.5/.6 but left qi26.4 IN_PROGRESS and qi26.6 OPEN; the task was to "identify what needs to be done to close them off." Verified the work was genuinely complete before closing: qi26.4 code shipped in 96b31cb (freshCheck deferral, markPaxCacheFreshNow_, unit tests) with a live SIT verification in its notes (dashboard 4212ms cold / ~2.4s warm vs ~7.4s baseline); qi26.6 docs shipped in 81ce9a1 (ADR-015 Accepted, DESIGN.md runtime section, CHANGELOG bullet, harness+Axiom cross-refs); full npm test suite green (exit 0). The beads had simply never been transitioned out of their working states — closing was the only missing step.
Outcome [internal]: Closed F3Go30-qi26.4, F3Go30-qi26.6, and the F3Go30-qi26 epic (6/6 children) with verification-backed close reasons; all three persisted to issues.jsonl.
Open: Uncommitted working-tree changes (PaxCache.js, CheckinApp.html, test_pax_cache.js, test_checkin_monthcache_invalidation.js, package.json, measureCheckinPerformance.js) belong to separate beads (F3Go30-nzi0 bonus-cache invalidation, F3Go30-0gx6 prefetch-staleness) plus the qi26.4 live-verification harness tweak — not part of qi26, still uncommitted. Dolt remote is not configured (bd emitted a `bd dolt remote add origin ... && bd dolt push` repair hint) — a bd-maintenance §2 follow-up.

### Key Learnings:
`.beads/metadata.json` had `dolt_mode: server` (with a stale `dolt sql-server` on PID 5878), which per bd-maintenance §7 makes every bd command re-import an empty DB from issues.jsonl and silently drops some writes back to the jsonl — qi26.4/.6 closes persisted but the epic close repeatedly did not. Symptom is the `auto-importing N bytes ... into empty database` banner on every bd invocation. Fix is `dolt_mode: embedded`; once flipped (externally, by the developer), the epic close persisted on the first try.

## 2026-07-15 16:45:00
_session 3668c52d · v3 · 07-15_

### Objective 1: Verify test coverage and SIT deploy before shipping the check-in monthCache/bonus-cache branch
Rationale: before treating the check-in monthCache-invalidation and bonus-cache-clearing work (feat/checkin-edit-signup-link) as done, confirm both unit coverage and a live SIT deploy actually exercise it — "lets review test coverage, and do a deploy to sit and run the test suite including playwright tests."
Outcome [developer-facing]: confirmed test_checkin_monthcache_invalidation.js and the new test_pax_cache.js bonus-cache-clearing cases give solid static-shape coverage for the diffed CheckinApp.html/PaxCache.js changes; full 29-file unit suite passes.
Outcome [internal]: deployed to SIT (v2.3.15.22, deployment @161); ran checkin-advanced-grid.spec.js and identity-token-flow.spec.js live against it — 23/24 Playwright tests passed, one deterministic failure surfaced in identity-token-flow.spec.js.

### Objective 2: Fix the identity-token-flow "first use" test failure  [accreted]
Transition: user said "fix it now" once the root cause was diagnosed, rather than deferring it as a filed issue.
Rationale: the failure wasn't flaky (confirmed by an isolated rerun) — `resolveOrCreateCheckinSessionGuid_` (CheckinSessions.js) reuses an existing session for a known identity and immediately touches `lastUsedAt` at mint time, so the spec's reused fixture PAX (`TokenFlowTest`) could only ever pass the exact `createdAt === lastUsedAt` firstUse check on its very first-ever run against a given SIT environment — every subsequent run was structurally guaranteed to fail. Confirmed via the fix: resetting the fixture's sessions removed 33 stale rows accumulated from prior runs.
Rejected: switching the test to a freshly-generated PAX per run — rejected as it would grow Tracker/PaxDB roster rows unboundedly across CI runs, unlike the project's other idempotent SIT fixtures.
Outcome [developer-facing]: added `deleteCheckinSessionsByIdentity_` (script/CheckinSessions.js) + a test-support-only `resetCheckinSession` admin action (script/WebApp.js), with unit coverage in test/test_checkin_sessions.js; tests/playwright/identity-token-flow.spec.js now calls the reset action before asserting first-use, so the fixture starts clean every run instead of accumulating touched sessions.
Outcome [internal]: redeployed to SIT (@162); verified the new admin action live (cleared the 33 accumulated stale rows for `TokenFlowTest`).
Open: a second consecutive Playwright run to confirm the fix holds repeatably was queued but not observed before the session was paused ("lets stop here") — worth confirming next session.
## 2026-07-15 (unattended session)
_session 52f540ac · v3 · 07-15_

### Objective 1: Inline token-path identity into the initial check-in page load (F3Go30-5nfj.1)
Rationale: A saved-link check-in login (GET ?cmd=checkin&id=<token>) cost an extra /exec round trip — doGet served an empty CheckinApp shell, then the client fired an async identify(token) POST to populate it (~5.7s observed). The typed-identify form-POST path already avoided this by resolving identity server-side and baking the result into the page; this issue extends that exact pattern to the token path.
Outcome [developer-facing]: renderCheckinPage_ (script/dashboardWebapp.js) now resolves an incoming `id` token via handleCheckinIdentify_ synchronously inside doGet and bakes the result into buildCheckinPageOutput_ as a new `tokenIdentifyResult` param (templated as TOKEN_IDENTIFY_RESULT). Per the documented gotcha from the typed-identify path, savedToken is now always passed as null when a token was present, so the client's async SAVED_IDENTITY_TOKEN branch never double-fires; that branch is kept only as a defensive fallback (`if (!TOKEN_IDENTIFY_RESULT && SAVED_IDENTITY_TOKEN)`).
Outcome [user-facing]: A saved-link check-in login now renders fully populated (today/yesterday status, month grid, goals, team, month label, next-month state) directly from doGet, with no client-side identify POST — tokenInvalid still falls back silently to the blank identify form, knownPaxNotRegistered still auto-carries into signup, and the dashboard prefetch fires immediately since applyIdentifySuccess_ is reused unchanged. Typed-identify's own form-POST path is untouched.
Outcome [developer-facing]: Added test/test_checkin_token_inline_identify.js (registered in package.json's `test` script) covering renderCheckinPage_'s new id-resolution path: tokenInvalid, knownPaxNotRegistered, a full matched identity (TrackerDB + Responses + Tracker + CheckinSessions fixture), and a no-id fresh visit that must never call handleCheckinIdentify_. Modeled on the existing renderCheckinPageForTypedIdentify_ coverage pattern (test_ns_client_roundtrip.js, test_checkin_title_cache.js). Full `npm test` suite passes.
Open: Live SIT smoke verification (open a real saved link, confirm no identify POST in Axiom, tri-state check-in still writes, dashboard still opens) was not run this session — flagged in the issue's AC as a live-test item; inferred that it's expected to happen in a follow-up interactive session since this session is unattended and has no browser access.
## 2026-07-16 02:50:00
_session d02e8efa · v3 · 07-16_

### Objective 1: F3Go30-5nfj.2 — static HTML check-in front end backed by a JSON resolve endpoint
Rationale: The GAS HtmlService check-in page pays an iframe/sandbox boot cost before first paint; a CDN-hostable static page calling a JSON endpoint removes that cost while reusing the exact same server-side identity resolver introduced by the sibling issue (F3Go30-5nfj.1), so the two front ends can never drift out of parity.
Outcome [developer-facing]: Confirmed the SIT CORS spike (AC gate) live — a cross-origin `fetch()` POST to `/exec?cmd=checkin` reads the JSON body successfully; both hops (`script.google.com`'s 302 and the `script.googleusercontent.com` redirect target) send `Access-Control-Allow-Origin: *`. No new server endpoint was needed: the existing `handleCheckinPost_` `action:'identify'` dispatch already calls `handleCheckinIdentify_` (the same single-shot resolver F3Go30-5nfj.1 bakes into HTML) and returns it as JSON.
Outcome [user-facing]: Added `static-checkin/index.html` — a dependency-free static page (config via `?webapp=&id=&ns=&contextDate=` query params) rendering today/yesterday tri-state check-in, goals, and a month calendar, with a deferred background `action:'dashboard'` fetch after the check-in view renders. The existing GAS HtmlService page is untouched and still works.
Outcome [developer-facing]: Added `tests/playwright/static-checkin.spec.js`, run live against SIT with a real browser serving the static page from a genuinely separate origin (`127.0.0.1`) — verifies the CORS spike, the deferred dashboard call fires exactly once after the check-in view renders, a check-in write lands in the sheet (checked server-side), and the GAS page still renders. All 4 tests pass. `npm test` (full suite) also passes.
Outcome [internal]: Recorded a before/after timing note in `static-checkin/README.md` (GAS page ~3.3s to first byte / ~4.5s networkidle vs static shell ~18ms commit / ~30ms domcontentloaded) and left the static-host choice (GitHub Pages/Firebase/GCS) and saved-link/email URL migration as open decisions for a human, since provisioning public hosting is a live infrastructure change outside this issue's scope.
## 2026-07-15 22:10:00
_session efef81d4 · v3 · 07-15_

### Objective 1: Consolidate the static check-in page's favicon with GAS's
Rationale: Comparing the GAS-rendered `<head>` (favicon via `HtmlOutput.setFaviconUrl()`, raw.githubusercontent.com/stuartdonaldson/F3Go30/...) against the static page's `<head>` showed the static page had no favicon at all — GitHub Pages doesn't provide one implicitly the way script.google.com's domain-level favicon does. Developer's own framing: "we should probably copy that over to the f3static project to consolidate requirements" — the goal was for both surfaces to reference one hosted asset instead of the GAS page depending on a raw path into the main F3Go30 repo.
Rejected: referencing the logo directly from `raw.githubusercontent.com/f3go30/static-pages` (no build-step changes needed) was passed over in favor of a proper `src/assets/` + build-copy pipeline, since F3Static's own README states its `dist/` is generated-only, not hand-edited.
Outcome [user-facing]: The static check-in page now shows the Go30 logo as its browser-tab favicon, matching the GAS page.
Outcome [developer-facing]: Added `static-pages/src/assets/Go30-Logo.png`; `tools/build-static-pages.js` now copies `src/assets/` into each `dist/<env>/assets/` (publish's existing recursive copy carries it into F3Static unchanged); `script/dashboardWebapp.js`'s `CHECKIN_PAGE_FAVICON_URL_` repointed from the F3Go30 raw path to `https://f3go30.github.io/static-pages/dist/prod/assets/Go30-Logo.png` so both surfaces serve the same hosted copy. Verified via `node tools/build-static-pages.js --env all` (assets present in both dist folders) and the full `tests/playwright/static-checkin.spec.js` suite (9/9 passed).
Open: the new GAS favicon URL only resolves once a real `npm run deploy:prod` (or `publish-static-pages.js`) pushes `dist/prod/assets/Go30-Logo.png` into the F3Static repo — not yet done this session.
## 2026-07-16 09:10:00
_session 4e6e1ffe · v3 · 07-16_

### Objective 1: Fix stale bonus totals on the dashboard after a bonus-tracker edit
Rationale: Developer reported "updating the bonus tracker and returning to the dashboard did not show updated bonus info, i needed to reload." The bonus edit form already knows exactly what changed, so the fix is to sync the client's own dashboard cache rather than force a reload.
Outcome [user-facing]: Editing or adding a bonus entry now immediately reflects on the dashboard without a manual reload, on both front ends.
Outcome [developer-facing]: `script/CheckinApp.html` and `static-pages/src/index.html`'s bonus-save success handler now calls the existing `invalidateMonthCacheFor_` (for both the new and, on an edit, the original `whenIso`) before returning to the bonus list — mirroring the pattern `submitCheckin_`/`submitSelectionCheckin_` already use for check-in saves. `state.monthCache` was the stale layer; the bonus form's own tracked state (`bonusEditingOriginalSnapshot` etc.) only covers the bonus-list view, not the dashboard's per-day shape, so invalidation (forcing a re-fetch) was the direct fix rather than patching the dashboard's cache in place.

### Objective 2: Build and run a Playwright timing comparison of the GAS vs static check-in surfaces on SIT  [accreted]
Transition: distinct goal from the bug fix above — a new, larger ask ("create a script to drive playwright to test in SIT...") rather than a continuation of it.
Rationale: Developer wanted to see how consistent user-facing performance is, whether one PAX's check-in affects another's dashboard load (cache poisoning), and the typical GAS-vs-static difference, across repeated sessions and multiple accounts.
Outcome [developer-facing]: Added `tools/perfTiming.js` — drives 20 alternating GAS/static session-pairs (typed sign-in, check-in, dashboard, then a second account via a minted identity token, check-in, dashboard) against live SIT, rotating 3 fixture PAX (`NoSadClown`, `TokenFlowTest`, and a newly signed-up `PerfTestGamma`), always awaiting each check-in's actual API response before advancing. Writes a CSV + computed-stats summary.md per run to `tools/perf-results/`. Fixed a toggle-scoping bug found during review (hit/miss was resetting every iteration instead of alternating across the whole run).
Outcome [internal]: Ran the full 20-iteration suite against SIT (`tools/perf-results/perf-timing-2026-07-16T08-44-28-778Z.{csv,summary.md}`, all 20 succeeded). Findings: GAS's typed sign-in (nested HtmlService iframe + full page load) is consistently ~40% slower than static's fetch-based identify (median 14.4s vs 8.3s) — the one step where surface choice clearly matters; every other step (check-in, token-login, dashboard) is statistically indistinguishable between surfaces since both hit the same Apps Script backend. One 30.7s dashboard outlier on the static leg was traced to a transient SIT-side spike, not a static-surface defect (excluding it, static's dashboard mean matches GAS's). Total session time is dominated by backend round trips (~5s check-in, ~9-10s token-login) rather than client rendering (sub-2s medians).

### Objective 3: Design a write-through per-PAX dashboard cache to address the invalidate-on-write cost the perf run surfaced  [accreted]
Transition: developer asked a direct architecture question ("shouldn't the write update the cache... not invalidate it?") triggered by the perf analysis showing every dashboard load is a cold cache rebuild; the follow-up design conversation and resulting beads are a distinct deliverable from the perf tool itself.
Rationale: `handleCheckinSubmit_` (dashboardWebapp.js) invalidates the whole-sheet roster CacheService blob on every check-in write rather than patching it, forcing a full-roster rebuild on the next dashboard load regardless of which PAX wrote or which PAX is reading. Developer proposed segregating the cache by PAX ("we already have that PAX data so we could just update the record in the cache") to enable a true write-through patch without the lock-contention concern the current whole-blob design exists to avoid.
Rejected: building a new parallel per-PAX CacheService segmentation from scratch, in favor of extending PaxCache.js's existing per-PAX row + roster-index machinery (currently used only by the lean single-PAX identify path) — reuses proven serialization/staleness code.
Outcome [developer-facing]: Investigated and confirmed the design is sound, and surfaced one critical implementation landmine before any code was written: `ensurePaxCacheFresh_`'s Drive-modtime staleness gate wipes the whole per-sheet cache on the very next read after any write (including this webapp's own), so a naive per-PAX patch would be invalidated one request later unless paired with the existing (but currently unused-here) `markPaxCacheFreshNow_dw_` re-stamp.
Outcome [internal]: Filed `F3Go30-5nfj.3` (write-through per-PAX dashboard cache via PaxCache) and `F3Go30-5nfj.4` (point `perfTiming.js`'s static leg at the real published SIT static-pages URL instead of a local file server, for a genuine apples-to-apples network comparison) under the existing performance epic `F3Go30-5nfj`. No implementation code written this session — both are scoped for a follow-up session.

## 2026-07-16 05:47:09
_session 4959b5df · v3 · 07-16_

### Objective 1: Implement F3Go30-5nfj.3 — write-through per-PAX dashboard cache via PaxCache
Rationale: handleCheckinSubmit_ was invalidating the whole-sheet Tracker/Responses CacheService blobs on every single check-in write even though only one PAX's row changed, forcing the next dashboard read for ANY pax to pay for a full Sheet.getRange().getValues() rebuild (observed 2-4s, one 30s SIT outlier). Extended PaxCache's existing per-PAX row + roster-index machinery (previously only used by the lean identify/checkin path) to also serve the dashboard's full-board read, so a check-in write only touches its own PAX's cache entry.
Rejected: kept the whole-sheet Tracker CacheService blob as a redundant fallback layer — user chose to remove it entirely for Tracker (PaxCache becomes the sole source), matching the ticket's framing of "replacing whole-roster invalidate-on-write."
Outcome [developer-facing]: handleCheckinSubmit_ now patches the checking-in PAX's own PaxCache row in memory (via a `row` field added to resolveCheckinDayTarget_'s return) instead of deleting it and wiping the whole-sheet cache, re-stamping freshness with markPaxCacheFreshNow_ to survive ensurePaxCacheFresh_'s Drive-modtime gate. New buildTrackerValuesFromPaxCache_ helper assembles the full team-board roster from PaxCache's per-PAX rows + roster index in resolveCheckinIdentityFull_/resolveFullIdentityFromHandle_, falling back to a live Sheet read + bulk repopulate only on an incomplete/cold cache; the whole-sheet Tracker CacheService blob (trackerValuesCacheKey_) is no longer read or written by either path.
Outcome [developer-facing]: Added tests in test/test_dashboard_webapp.js covering the write-through patch (including the clearContent/null path), the PaxCache-only board assembly across a check-in write + next dashboard read for a different pax with zero additional full-range Sheet reads, and buildTrackerValuesFromPaxCache_'s fallback-on-incomplete-cache behavior; full npm test suite passes.
Open: PropertiesService capacity risk flagged in the original ticket (storing every PAX's row per active tracker month could approach the per-script size quota over time) was explicitly deferred per developer decision — not measured, not scoped, no follow-up issue filed.

## 2026-07-16 13:20:00
_session 8e780973-2d3d-444c-9a33-c4c66d67b1f3 · v3 · 07-16_

### Objective 1: Point perfTiming.js's static-surface leg at the real published SIT deployment instead of a local file server
Rationale: Resolved bead F3Go30-5nfj.4 — comparing GAS's real network-hop timings against a same-machine `http.createServer()` understated real-world static-surface latency (no TLS/DNS/CDN hop). Default now hits the real GitHub Pages URL (`https://f3go30.github.io/static-pages/dist/sit`, per `script/version.js`'s `STATIC_PAGES_BASE_URL_`), still pinned to the same SIT backend (`testDeploymentId`) via the existing `?webapp=` param. Kept the local server available behind a new `--local-static` flag for quick iteration without a publish step.
Outcome [developer-facing]: `tools/perfTiming.js` defaults to the real published SIT static-pages URL; `--local-static` restores the old local-server behavior.
Outcome [internal]: Ran a 20-iteration comparison against the prior local-static-server run (`tools/perf-results/perf-timing-2026-07-16T08-44-28-778Z`). Result was the opposite of the bead's hypothesis: the real GitHub Pages deployment was faster and far more consistent than the local dev server on nearly every step (e.g. `static.totalMs` mean 46,130ms→38,411ms, stdev 10,802→3,031ms), rather than revealing a latency penalty. `dashboard1`/`dashboard2` remained the noisiest steps on both runs, pointing at SIT backend/cache contention rather than static-hosting choice as the source of that variance.

## 2026-07-16 14:54:37
_session f690ef23-aeb7-4125-b1f2-2004d30a7fd7 · v3 · 07-16 (logged retroactively during v2.4.0 release prep — see Objective 3)_

### Objective 1: Route every generated check-in link through the static front end instead of the GAS-hosted page
Rationale: `static-pages` (F3Go30-5nfj.2) already gives PAX a faster check-in experience, but every link the app hands out — the home page, nag/reminder emails, the signup confirmation email, and the sign-up app's own "go to check-in" links — was still hand-building a `?cmd=checkin` URL against the GAS webapp directly, so newly signed-up or reminded PAX never actually landed on the faster surface.
Outcome [developer-facing]: Added `resolveStaticCheckinBaseUrl_`/`buildStaticCheckinUrl_` (`script/Utilities.js`), which resolve `STATIC_PAGES_BASE_URL_` (`script/version.js`) against the current `APP_DEPLOY_TARGET` (`prod/` vs `sit/`) and wrap a GAS webapp base URL plus optional `id`/`ns`/`contextDate` into a static-page URL; both return `''` when the static base or webapp URL is unavailable (e.g. Node tests), so every call site falls back to the original `?cmd=checkin` link unchanged. Wired through `script/WebApp.js` (home page + `SignupApp` template), `script/nag.js` (all three reminder-email render paths), `script/signupEmail.js` (`buildCheckinEmailLinks_`), and `script/SignupApp.html` (`buildCheckinUrl_`, replacing every hand-built `WEBAPP_URL + '?cmd=checkin'` call site). The sign-up app's edit-goals link has no static counterpart and stays a plain GAS `?cmd=signup` link.
Outcome [user-facing]: A new sign-up, a nag/reminder email, or the home page's check-in button now opens the faster static check-in page (GitHub Pages) instead of the Google-hosted app page, wherever the static host is configured.
Open: no dedicated unit test was added for `buildStaticCheckinUrl_`/`resolveStaticCheckinBaseUrl_` or its call sites; existing suites (which stub `STATIC_PAGES_BASE_URL_` as undefined) continue to exercise the GAS-URL fallback path only. Flagged here since this entry was reconstructed from the working tree's diff during release prep rather than logged live.

### Objective 2: Rename the "No-report" outcome to "Failed to report" and fix its legend/button color
Rationale: "No-report" read as a neutral/no-op state rather than the penalty it actually is (−1); PAX feedback (per developer) was that "Failed to report" states the consequence plainly. Separately, the check-in "Miss" button (`.checkin-btn.no`) rendered in the same red (`#a3401a`) used elsewhere for the distinct "Fail" state, and the dashboard legend's swatch for this state was still labeled "None" even though its color (`#de521c`) already matched "Fails" elsewhere on the page — both were corrected to remove the visual/verbal mismatch.
Outcome [user-facing]: Every PAX-facing surface (`script/CheckinApp.html`, `static-pages/src/index.html`, `script/SignupApp.html`, `docs/Go30-FAQ.md`, `docs/Go30-Intro.md`) now says "Failed to report" instead of "No-report"; the check-in Miss button recolors to yellow (`#f7b209`, matching the "Misses" legend swatch) instead of red; the dashboard legend's third swatch is now labeled "Fails" instead of "None".
Outcome [developer-facing]: `docs/CONTEXT.md`'s Glossary entry for "Go30" updated to match.
Open: same reconstruction caveat as Objective 1 — no new test coverage was added for the copy/color change since none of the existing suites assert on button color or legend label text.

### Objective 3: v2.4.0 PROD release — bump minor version, deploy, changelog
Rationale: Developer requested a minor version bump and PROD redeploy to ship the accumulated Unreleased changelog (speed/static-check-in initiative) plus the two undocumented items surfaced above, now that `npm test` passes clean against the full working tree.
Outcome [internal]: See the version-bump commit and `v2.4.0` tag for the mechanical details (deploy, `docs/CHANGELOG.md` promotion, git tag).

## 2026-07-16 17:05:00
_session ed4602d8 · v3 · 07-16_

### Objective 1: Implement F3Go30-440b.1/440b.2 (PaxCache observability + nightly purge), then close a real cross-namespace correctness gap the user caught
Rationale: 440b.1 needed PaxCache hit/miss/wipe counters folded into existing per-request GasLogger events (no new log volume); 440b.2 needed a nightly purge of PaxCache entries for tracker sheets older than ~2 months, since go30pax:/go30idx:/go30asof: entries never expire and risk PropertiesService's hard caps. Both were implemented, unit-tested, and verified live on SIT.
Rejected: mid-implementation the user asked to also purge PaxCache rows for PAX no longer present in CheckinSessions ("that also gets purged periodically") — added via listActiveCheckinSessionF3Names_ (CheckinSessions.js) as a second purge pass. Then the user asked whether the purge only touches sheets in TrackerDB, or also ones that aren't — surfacing that a naive orphan sweep would need to enumerate PropertiesService directly, and separately that a namespace-provisioned tracker (ADR-014 copyTemplate) has its OWN TrackerDB/PaxDB/CheckinSessions in its own copied spreadsheet while PaxCache's PropertiesService store is shared by the one deployed script across every namespace — a naive sweep against only the bound Template's TrackerDB would have falsely wiped live namespace-tracker caches nightly. Presented this as an explicit tradeoff via AskUserQuestion; user chose the full cross-namespace fan-out over a narrower bound-only sweep.
Outcome [developer-facing]: PaxCache.js: getPaxCacheRequestStats_/resetPaxCacheRequestStats_ (per-execution hit/miss/wipe counters) wired into dashboardWebapp.js's checkinWebapp.resolveIdentity.timing and checkinWebapp.dashboard log lines; purgeStalePaxCache_ (age-based wholesale wipe + per-PAX CheckinSessions-activity purge + orphan sweep via new collectKnownTrackerSheetIds_/extractSheetIdFromPaxCacheKey_) with nightly trigger wired into onOpen.js's initializeTemplateDispatchTriggers; CheckinSessions.js gained listActiveCheckinSessionF3Names_; go30tools.js gained _listNamespaceRegistryRows_ (fan-out over NamespaceDB, refactored from the existing single-ns lookup). New runPaxCachePurge admin action. Extensive new unit test coverage across test_pax_cache.js, test_checkin_sessions.js, test_dashboard_webapp.js, and test_resolve_template_spreadsheet.js — full suite green.
Outcome [internal]: docs/OPERATIONS.md's dispatch-trigger table/note updated to document the fifth nightly trigger and its three purge passes. Saved bd remember note `paxcache-shared-across-namespaces` documenting the shared-PropertiesService-vs-isolated-DB asymmetry for future sessions. Both bd issues (F3Go30-440b.1, F3Go30-440b.2) closed with resolution notes; live SIT verification via Axiom query (resolveIdentity.timing/dashboard events carrying the new stats fields) and via runPaxCachePurge (returned {checked:4, purged:1, kept:3, paxRowsPurged:66, orphanedSheetsPurged:21} against real SIT data, confirming the orphan sweep cleans up genuine accumulated cruft without touching live trackers).

### Key Learnings:
GAS PropertiesService.getScriptProperties() is scoped to whichever script project is EXECUTING (the one deployed webapp), not to whichever spreadsheet SpreadsheetApp.openById() happens to open for a given `ns` — so PaxCache (keyed only by sheetId) is accidentally shared across every namespace even though TrackerDB/PaxDB/CheckinSessions are fully namespace-isolated (each namespace copy is its own container-bound script with its own independent property store). NamespaceDB already has NagEnabled/MinusOneEnabled/AutoGenerateEnabled/CleanupSessionsEnabled columns but nothing reads them yet — no existing dispatch trigger fans out across namespaces; this session's _listNamespaceRegistryRows_ is the first caller to actually enumerate all namespaces.

## 2026-07-16 17:21:15
_session 564510d9-3762-4362-b368-64c88c004fd3 · v3 · 07-16_

### Objective 1: Add OS/browser dark-mode support to both check-in front ends
Rationale: Developer asked "can we detect if the os is in dark mode and change the styl to support it?" — implemented as pure CSS (no JavaScript): a `@media (prefers-color-scheme: dark)` block lets the browser/OS report its theme preference directly to the stylesheet, and the browser re-evaluates it live if the OS theme is flipped while the page stays open.
Outcome [user-facing]: Both the GAS-served check-in page (`script/CheckinApp.html`) and the static check-in page (`static-pages/src/index.html`) now automatically match the browser/OS light-or-dark preference, switching live without a reload if the OS theme changes while the page is open.
Outcome [developer-facing]: Replaced every hardcoded hex color in both stylesheets with a `:root` CSS custom-property palette, plus a `@media (prefers-color-scheme: dark)` override block redefining just those variables; verified no stray hex literals remained in either rule body, screenshotted the static build under both `light` and `dark` emulation, and confirmed the full test suite (string/function-presence checks only, unaffected by CSS) stayed green.

## 2026-07-16 22:23:07
_session 9b369109-0be1-4037-920a-a82a5245d641 · v3 · 07-16_

### Objective 1: Fix the Total Score tile's calculation
Rationale: Developer reported PROD's dashboard Total Score tile for a specific PAX (11 hits, 4 misses, 3 FE bonus, 1 Fail through the 16th) showed 15 instead of the expected 13. Traced through the Tracker sheet's live `RawScore`/`Score` column formulas on PROD (via the `getSheet`/`getSheetFormulas` admin actions) and confirmed the sheet's own math was sound once pre-marked future days were accounted for. Developer then clarified: "The tracker sheet is calculating correctly, the issue is in the tile display" and "the webapp should be showing scores through the effective date because as we move backwards to view for previous dates the score should be through that date."
Rejected: An initial theory that the Tracker sheet's `Score` formula (`SUM($I:$AS)`) double-counted weekly bonus points on top of the per-type Fellowship/Q/Ins/EH columns was disproven by the developer's clarification — the sheet formula was never the bug. The real defect was the webapp tile trusting the sheet's whole-month `Score`/`RawScore` cells directly: those sum the *entire* month row (including days a PAX pre-marks ahead of "today") and, since they're read through the app's own roster cache, can also lag a manual sheet edit until that cache expires — neither of which is "the total as of the day being viewed."
Outcome [user-facing]: Fixed the Fail-count breakdown label ("N no check-in" → "N fails", matching the "Failed" terminology used everywhere else in the UI). Total Score, its percentage ring, and each team/board member's tile now re-derive from that PAX's day-by-day hit/miss/fail values plus that day's bonus points, bounded to the currently viewed date — scrubbing date-nav backward now shows the score as of that day instead of always showing today's live sheet total, and the number is no longer sensitive to the roster cache lagging a manual sheet edit.
Outcome [developer-facing]: Added `computeScoreForDayLocal_`/`computeScorePctLocal_`/`countOutcomesLocal_`/`firstActiveDayIndexLocal_` (mirroring `dashboardWebapp.js`'s server-side `countOutcomes_`/`firstActiveDayIndex_`) to both `script/CheckinApp.html` and `static-pages/src/index.html`; `renderDashboard_` and `memberViewForIndex_` in both files now use these instead of the server-supplied `score`/`scorePct`/`done`/`missed`/`absent` fields. Rebuilt `static-pages/dist/{sit,prod}` via `tools/build-static-pages.js`. Full `npm test` suite green (no existing coverage exercises this inline client-side JS directly — the fix was validated by the developer live on PROD after deploy).

## 2026-07-17 20:05:00
_session 432e26c6-4e3e-46ec-acb2-88d853fa9ec5 · v3 · 07-17_

### Objective 1: Improve check-in/dashboard cache performance — onEdit-driven invalidation + read-only-when-cache-invalid tuning
Rationale: Driven by the staged design doc `docs/staging/tracker-edit-cache-invalidation.md` ("review and let's work on finding answers to the questions... before we try implementing"). Resolved its open questions first (confirmed the real 20-trigger/user/script quota, found and corrected a factual error in ADR-013 — onEdit does NOT fire for Sheets REST API edits, contrary to what it claimed — and identified a real, pre-existing trigger-leak gap). Developer then redirected to implementation: "let's go for implementing the onedit trigger, validating that it works, then we can harden it and put the requisite cleanup in" — since every webapp-driven write is already write-through, onEdit here only ever needs to catch a rare manual Sheets-UI edit, not gate any user-facing round trip, so the ADR-013 latency concern doesn't apply to this narrower case. Live validation (via Playwright driving the actual Sheets UI, since onEdit only fires for genuine UI edits) then fed a follow-on Axiom trace of real SIT check-in journeys, which surfaced that even a 100%-cache-hit identify/dashboard call still eagerly paid for `SpreadsheetApp.openById()` and a live Responses-header re-read every time. Developer's own framing carried the second half of the objective: "we should get rid of the reread of these things as they don't change often and are rarely needed... we could just put it behind the accessors to where it opens it if it is not already open," extended on scope to "bonus tracker data should all be cached... the only reason to pull from the sheet is if we have reason to believe the cache is out of date."
Rejected: A narrower "identify path only" scope for the lazy-open work was floated (dashboard's Bonus Tracker lookup forces an open unconditionally right after identity resolves, so lazy-opening inside the resolver alone wouldn't actually remove the cost, just move it) — developer chose the full scope, extending laziness through the Bonus Tracker read too.
Outcome [user-facing]: A human editing a Tracker cell directly in the Sheets UI now proactively invalidates the shared PaxCache instead of relying solely on the per-request Drive-modtime poll (F3Go30-440b.4). Live-confirmed on SIT via a real driven Sheets-UI edit → Axiom trace.
Outcome [user-facing]: Warm identify/dashboard calls got materially faster — live SIT trace showed a second identify call for the same PAX drop from 1082ms to 396ms total (openMs 546→0, responsesMs 1028→313), and both dashboard calls landed at openMs=0 (F3Go30-440b.6).
Outcome [developer-facing]: `script/TrackerEditTrigger.js` added (setup/clear/handler, mirrors `setupFormSubmitTrigger`'s ADR-010 centralization pattern), wired into `CreateNewTracker.js`. `script/dashboardWebapp.js` gained `makeLazySpreadsheet_dw_` (opens on first `.get()` only, memoized) and a Responses-header-layout cache (`getResponsesLayout_`/`getCachedResponsesLayoutOnly_`, mirroring the existing Tracker-layout cache); `resolveCheckinIdentityLean_` and `resolveFullIdentityFromHandle_` rewritten to check every cache layer before ever opening the spreadsheet. `script/bonusWebapp.js` gained `getCachedBonusEntriesOnly_` so the dashboard's Bonus Tracker read goes cache-first too. New unit tests (`test_dashboard_webapp.js`, `test_bonus_webapp.js`, `test_tracker_edit_trigger.js`) prove full-cache-hit calls never invoke `SpreadsheetApp.openById` via throw-if-opened stubs, and cold-cache calls open exactly once, not once per gap. Full 34-file suite stayed green throughout.
Open: F3Go30-440b.5 (trigger-lifecycle hardening — auto-clear-on-trash + nightly month-aging sweep, needed to keep the new per-tracker trigger count bounded against the 20/user/script quota long-term) is filed, blocked-by .440b.4, and not yet implemented.

### Objective 2: Fix incidental bugs surfaced while implementing Objective 1
Rationale: Live validation is what caught these — none were visible from tests or code review alone.
Outcome [developer-facing]: `handleTrackerEdit_` originally called bare `GasLogger.log()` instead of wrapping in `GasLogger.run()` — the trigger fired and wiped cache correctly but the log entry printed to Stackdriver and never flushed to Axiom, so it looked observable in code review but was silently invisible in production. Fixed and re-confirmed end-to-end.
Outcome [developer-facing]: `cleanupTrackerArtifact_` only cleared the form-submit trigger, not the new edit trigger — caught live when a disposable SIT test tracker's cleanup left an orphaned trigger behind. Fixed (now clears both), and `WebApp.js`'s `deleteOrphanedTriggers` diagnostic action extended to cover the edit-trigger handler too.

### Key Learnings:
Confirmed via Google's current docs: installable Apps Script triggers are capped at 20/user/script (one unified limit, not separate per-script/per-user numbers) — and, contrary to ADR-013's own text, onEdit does NOT fire for Sheets REST API edits, only genuine UI edits (community-confirmed; ADR-013's core rejection reason for the checkin round-trip still holds, just not that supporting detail). The project's Playwright Google auth session (`.auth/user.json`, path is `<repo-root>/.auth/user.json` not `tests/playwright/.auth/user.json`) can go stale silently — a stale session renders Sheets in view-only mode with a "Sign in" button rather than erroring, so a driven "edit" can silently no-op. Google Sheets does not fire onEdit if the written value is unchanged from the cell's current value — a repeat-edit validation script needs to alternate/toggle the value, not just retype the same one.
## 2026-07-17 (session end)
_session a9914cf1 · v3 · 07-17_

### Objective 1: F3Go30-o39s.1 — ADR + DESIGN anchor for the caching consolidation model
Rationale: The epic (F3Go30-o39s) needs a foundation decision every other C-bead implements against — the two-mechanism freshness model (write-through + onEdit over Tracker/Responses/Bonus) and the decision to retire the Drive-modtime poll (`ensurePaxCacheFresh_`), driven by measured 256–2057ms/request `freshCheckMs` cost in PROD v2.4.1. No code change was in scope; this bead is documentation-only.
Outcome [developer-facing]: Added `/adr/016-onedit-authoritative-cache-retire-drive-modtime-poll.md` (Accepted) stating the two-mechanism model, the accepted residual-risk paragraph (manual-edit-then-immediate-view window), and explicitly narrowing (not reopening) ADR-013 while correcting its factual error that onEdit fires for Sheets REST API edits (it doesn't). Supersedes the "keep the poll, unchanged" resolution in `docs/staging/tracker-edit-cache-invalidation.md`. References ADR-010 (centralized dispatch enables installable onEdit to reach the shared cache) and ADR-014 (namespace-copied trackers also need onEdit provisioning). Added `docs/DESIGN.md` §Caching with the 10-cache inventory table (from `docs/staging/caching-consolidation-review.md`) and the two-mechanism rule. Ran `/adr-quality-check` before finalizing (all fields present, single decision, status/content consistent, no edit of an Accepted ADR, supersede/reference chain resolves). `npm test` passes (no code touched).
## 2026-07-17 00:00:00
_session 5c1f0b85 · v3 · 07-17_

### Objective 1: C2 - extend onEdit handler to invalidate caches for Responses + Bonus Tracker edits (F3Go30-o39s.2)
Rationale: LOAD-BEARING prerequisite for retiring the Drive-modtime poll (C6). handleTrackerEdit_ previously early-returned for any sheet other than Tracker, so manual edits to Responses or Bonus Tracker got no proactive cache invalidation and relied solely on the poll.
Outcome [developer-facing]: handleTrackerEdit_ (script/TrackerEditTrigger.js) now gates on a lookup set of three sheet names (Tracker, Responses, Bonus Tracker) instead of a single sheet name, reusing the existing wipePaxCacheAndRelatedCachesForSheet_/markPaxCacheFreshNow_ helpers with no per-sheet branching. The GasLogger.log invalidated-event payload now includes sheetName for telemetry. test/test_tracker_edit_trigger.js extended to assert wipe+mark-fresh fire for all three sheet names and no-op for a non-PAX sheet (Config). Full npm test suite passes (31 files).
## 2026-07-17 13:48:50
_session d5173e39 · v3 · 07-17_

### Objective 1: C10 (F3Go30-o39s.11): patch PaxCache per-PAX row on a single-cell Tracker/Responses edit instead of wiping the whole sheet
Rationale: The issue was explicitly optional and flagged "consider carefully whether the complexity is worth it" — a whole-sheet wipe on a rare manual edit is cheap, so the value only justifies the change if the patch path stays narrow and provably safe. Scoped to single-cell edits on Tracker (fixed name column) and Responses (only when its column layout is already cache-warm, to avoid duplicating header-resolution logic), with Bonus Tracker's whole-sheet array caches deliberately left on the wipe path as the issue specified.
Rejected: Resolving the Responses F3-Name column live on every edit — considered, but dropped in favor of reading it only from dashboardWebapp.js's own long-TTL layout cache (falling back to a wipe on a cache miss), so this file never re-implements resolveResponseColumns_'s header-matching logic.
Outcome [developer-facing]: TrackerEditTrigger.js's handleTrackerEdit_ now tries tryPatchSinglePaxRow_te_ first — patches PaxCache's per-PAX row (and, for Responses, the full-roster CacheService blob in place) — and falls back to the existing whole-sheet wipe for anything it can't safely narrow to one known PAX row: multi-cell edits, header rows, Bonus Tracker, an uncached Responses layout, or a row whose live name doesn't match the cached roster index at that offset (the guard against a row insert/delete silently patching the wrong pax). test_tracker_edit_trigger.js rewritten to require the real PaxCache.js module (spying only on the wipe/mark-fresh calls) so the patch path is exercised end-to-end; full `npm test` suite passes.
## 2026-07-17 00:00:00
_session cf20bcc8 · v3 · 07-17_

### Objective 1: C3a: markMinusOne must keep PaxCache coherent (F3Go30-o39s.3)
Rationale: The nightly -1 sweep's old `invalidateFullRosterCache_` call only cleared the CacheService full-roster blob, not PaxCache's per-PAX rows/roster index that `buildTrackerValuesFromPaxCache_` actually assembles the board from — once the Drive-modtime poll backstop is retired (C6), those per-PAX rows would stay stale after every nightly sweep. Per the issue's refinement notes, chose the PREFERRED repopulate path (reload both current-month and prior-month PaxCache from a fresh full-range read) over the ACCEPTABLE wipe fallback, since the check-in webapp can hold both months cached at once and a repopulate also serves as a nightly integrity refresh.
Outcome [developer-facing]: `script/markMinusOne.js` now resolves the current-month and prior-month TrackerDB rows after every sweep and repopulates PaxCache (`setPaxCacheRowsBulk_` + `setCachedSheetValues_`) for each from a full Tracker-range read, mirroring the bulk-write shape `resolveCheckinIdentityFull_` already uses on a cold-cache read; falls back to `wipePaxCacheAndRelatedCachesForSheet_` per-sheet when the bulk-write helpers aren't loaded or the read/write fails. The old unconditional `invalidateFullRosterCache_` call inside `applyMinusOneToTrackerSheet_` was removed — fully subsumed by the new dispatch-level refresh. Extended `test/test_mark_minus_one.js` with two new scenarios: repopulate reflects live (including just-marked) values for both months even when only one tracker was actually marked, and a fallback-wipe scenario when the bulk-write helpers are absent.
Outcome [internal]: Full `npm test` suite passes (31 test files, no regressions).
## 2026-07-17 (session)
_session df61973d-e415-4da2-baeb-0d1dba4685ff · v3 · 07-17_

### Objective 1: C4 — provision the tracker onEdit trigger on every CopyTemplate-provisioned tracker (F3Go30-o39s.5)
Rationale: script/CopyTemplate.js provisioned no triggers at all on copied trackers, so namespace/smoke trackers had zero PaxCache-invalidation coverage for manual Sheets-UI edits — a gap that would silently persist since installable triggers live in the script project that created them, not on the copied spreadsheet file itself. This bead is the "make onEdit universal" umbrella per its own description; the backfill (pre-440b.4 trackers) and trigger-count lifecycle bound are explicitly deferred to the separate, still-OPEN F3Go30-440b.5 bead — added a relates-to dependency link between the two rather than duplicating that work here (inferred from the bead's own "coordinate, do not duplicate" and "backfill+lifecycle mechanics live in 440b.5" text).
Outcome [developer-facing]: copyTemplateToNewEnvironment_ (script/CopyTemplate.js) now calls setupTrackerEditTrigger_ per copied tracker, mirroring CreateNewTracker.js's existing centralization pattern; deliberately does not call setupFormSubmitTrigger since copied trackers carry no HC Form (formId left blank). Full npm test suite (31 files) passes unchanged — no new unit test was added for the live trigger-install call, consistent with the existing repo convention where CreateNewTracker.js's own setupTrackerEditTrigger_ call also has no unit coverage (verification is live/smoke-test driven per the bead's own AC).
Open: AC items (2) backfill and (3) trigger-count bound remain unimplemented, blocked on F3Go30-440b.5 (still OPEN) per this bead's explicit scope.

## 2026-07-17 00:00:00
_session b814eaa1 · v3 · 07-17_

### Objective 1: F3Go30-440b.5 — combined trigger backfill + trash/aging-out cleanup admin action
Rationale: F3Go30-440b.4/o39s.5 only wire the onEdit trigger on newly-created/copied trackers; pre-existing trackers have none, and nothing yet clears per-tracker triggers (form-submit + edit) when a tracker is trashed in Drive or ages out past the previous month, which is load-bearing for keeping the 20-triggers/user/script Apps Script quota bounded (per docs/staging/tracker-edit-cache-invalidation.md "Trigger lifecycle"). Per the issue's stated developer decision (2026-07-17), delivered as an on-demand admin action rather than a nightly trigger, to be wired to a cadence later once proven.
Outcome [developer-facing]: Added script/TrackerTriggerLifecycle.js with a pure decision function (planTrackerTriggerSync_ — active/current+prev/next-month rows missing an edit trigger get backfilled; trashed or aged-out rows get every per-tracker trigger cleared) and a GAS orchestration wrapper (syncTrackerTriggers_) that reads TrackerDB, calls ScriptApp/DriveApp/SpreadsheetApp, and applies the plan. Wired as a new `syncTrackerTriggers` admin action in WebApp.js (script/WebApp.js), returning a summary shaped like the existing listTriggers/deleteOrphanedTriggers actions (backfilledCount, cleanedCount, per-tracker detail).
Outcome [developer-facing]: Added test/test_tracker_trigger_lifecycle.js (pure-function coverage: backfill vs. cleanup decisions, trash-priority-over-aging, no-sheetId/no-parseable-date edge cases, and direct ScriptApp trigger-filtering for cleanup) and registered it in package.json's test script; `npm test` passes.
Open: The admin action is untested against a live SIT deployment in this session (no live sheet/Drive access available headless) — recommend a manual `node tools/callWebapp.js syncTrackerTriggers --env sit` smoke check before treating this as fully verified live.

### Key Learnings:
Comparing calendar-month boundaries via raw `Date` millisecond subtraction is timezone-fragile when one side is built from a bare `YYYY-MM-DD` string (parsed as UTC midnight) and the other from local-timezone `Date` arithmetic — a `new Date('2026-06-01')` literal can land on the *previous* local calendar day in negative-UTC-offset zones, silently misclassifying month-boundary comparisons. Existing codebase date literals in tests already carry this latent risk (e.g. test_copy_template.js); this session avoided it in new test data by always including an explicit `T00:00:00` local-time suffix.

## 2026-07-17 14:15:13
_session dd983bb7 · v3 · 07-17_

### Objective 1: C3b (F3Go30-o39s.4) — Form-submit signup must write-through/invalidate PaxCache
Rationale: addResponseOnSubmit.js's onFormSubmitLocked_ writes new Responses/Tracker rows and DELETED-marks duplicates with zero PaxCache coherence — a warm-but-stale roster index (predating a signup) would report a legitimately signed-up member as "not found" (F4b, the highest-severity staleness source), rescued today only by the Drive-modtime poll this epic is retiring.
Outcome [developer-facing]: onFormSubmitLocked_ now mirrors signupWebapp.js's write-through — patches the responses + tracker PaxCache roster indexes (patchPaxRosterIndex_) right after each new-row write, drops the per-PAX value cache on both the new-row insert and the dedup DELETED-marking path (deletePaxCacheRow_, threaded a new optional sheetId param through deduplicateResponsesSheet_), and invalidates the full-roster CacheService blobs for the sheet once per handler run — duplicating the two cache-key-prefix strings (matching TrackerEditTrigger.js's existing convention) rather than requiring dashboardWebapp.js, which would create a require() cycle back through signupWebapp.js.
Outcome [developer-facing]: Extended test/test_add_response_on_submit.js with two integration-level cases driving the real onFormSubmitLocked_/deduplicateResponsesSheet_ against a grid-backed Sheet mock and the real PaxCache.js (in-memory PropertiesService/CacheService/LockService, DriveApp deliberately left undefined so ensurePaxCacheFresh_ fails open) — one proving a pre-warmed roster index missing the new PAX resolves correctly post-signup without a live rebuild, one proving the DELETED-marking path drops a stale per-PAX cache row.
## 2026-07-17 00:00:00
_session ed6b054e · v3 · 07-17_

### Objective 1: C6 — retire the Drive-modtime poll (ensurePaxCacheFresh_) from the PaxCache read path (F3Go30-o39s.7)
Rationale: All upstream write-through/onEdit prerequisites (C2, C3a, C3b, C4, F3Go30-440b.5) had landed, so the per-request `DriveApp.getFileById().getLastUpdated()` freshness probe was pure latency with nothing left to catch — freshness is now fully covered by write-through invalidation plus TrackerEditTrigger.js's onEdit-driven invalidation.
Outcome [developer-facing]: Deleted `ensurePaxCacheFresh_` from PaxCache.js and its call sites in `getPaxCacheRow_`, `resolvePaxRowIndex_`, `buildTrackerValuesFromPaxCache_`, and `resolveCheckinIdentityFull_`; removed the now-pointless post-write `markPaxCacheFreshNow_` re-stamp in `handleCheckinSubmit_` that existed only to defeat the retired poll; dropped `freshCheckMs` from `checkinWebapp.resolveIdentity.timing` log payloads; updated stale docstrings/comments across PaxCache.js, dashboardWebapp.js, TrackerEditTrigger.js, and CreateNewTracker.js that referenced the removed function. Left `markPaxCacheFreshNow_`, the `go30asof` marker, and `paxCacheFreshnessMemo_` in place (now write-only with no reader) since their formal removal is scoped to the dependent issue F3Go30-o39s.8 (C7).
Outcome [developer-facing]: Updated test/test_pax_cache.js (removed the "Drive-modtime freshness gate" test section and its DriveApp/fakeDriveModTimes fixtures, rewrote tests exercising the retired probe) and test/test_dashboard_webapp.js (rewrote `testFullFromHandleSkipsFreshCheckOnColdCacheProbesOnWarmCache` to assert zero DriveApp calls on either cold or warm reads, simplified `testBuildTrackerValuesFromPaxCacheDirect` to drop the now-unnecessary asOf-stamping dance) so the full suite (`npm test`, 32 test files) passes green with no reference to the removed function remaining in source.
Open: Bead's own "Verify" section calls for a live SIT smoke test (webapp check-in reflects instantly; manual Sheets-UI edit reflects after onEdit) — not exercised this session since it requires a deploy/live-environment action outside this session's scope; left for a human or a follow-up session to run via `smokeTestNamespace.js`.

### Key Learnings:
`paxCacheRequestStats_.wiped` (the `paxCacheWiped` field folded into `checkinWebapp.resolveIdentity.timing`) was set exclusively inside `ensurePaxCacheFresh_` — after its removal the flag has no remaining writer and will always report `false`; this is expected and not itself a bug, but a reader of that Axiom field should know it's now permanently inert until C7's cleanup (or a follow-up) revisits the stats plumbing.

## 2026-07-17 14:30:59
_session 3d8bd6e3 · v3 · 07-17_

### Objective 1: C7 — Remove dead asOf machinery (go30asof marker, markPaxCacheFreshNow_, freshness memo) — F3Go30-o39s.8
Rationale: C6 (F3Go30-o39s.7) retired the Drive-modtime poll that was the only reader of these symbols, so per the epic's staged plan they became dead weight kept only because their removal was explicitly scoped to this issue (per PaxCache.js's own docstrings at the time).
Outcome [developer-facing]: Removed PAX_CACHE_ASOF_PREFIX_, paxCacheAsOfKey_, markPaxCacheFreshNow_, resetPaxCacheFreshnessMemo_, and paxCacheFreshnessMemo_ from PaxCache.js, along with their module.exports entries, the go30asof: handling in extractSheetIdFromPaxCacheKey_, and the deleteProperty(paxCacheAsOfKey_) calls in purgeStalePaxCache_. Removed the markPaxCacheFreshNow_dw_ import shim and all its call sites in dashboardWebapp.js (including the now-write-only freshRead local, which was also dropped), and the markPaxCacheFreshNow_te_ shim/call in TrackerEditTrigger.js. Updated stale comments referencing the removed symbols in both files. Updated test_pax_cache.js (dropped the markPaxCacheFreshNow_ test and go30asof: assertions), test_tracker_edit_trigger.js (dropped the markFreshCalls spy and its assertions), and test_dashboard_webapp.js (dropped 17 now-dead PaxCache.resetPaxCacheFreshnessMemo_() calls and 4 now-unused PaxCache requires). Full npm test suite passes (32 test files, exit 0).
Outcome [internal]: Left docs/DESIGN.md, docs/OPERATIONS.md, docs/staging/*.md, ADR-015/016, and work-log.md's historical entries untouched — those still reference the removed symbols but are explicitly in scope for the blocked follow-up issue F3Go30-o39s.10 (C9: Documentation cleanup), not this one.

### Key Learnings:
None of the "purely subtractive" removal surfaced any lingering callers outside the exact locations F3Go30-o39s.8's description enumerated — C6 had fully emptied out the symbols' only real reader beforehand, so no reconciliation was needed.
## 2026-07-17 00:00:00
_session 24799bce · v3 · 07-17_

### Objective 1: C9 doc cleanup — rewrite stale cache headers to match the final onEdit/write-through model (F3Go30-o39s.10)
Rationale: Gated on C6/C7 (poll + asOf marker retirement), this closes finding F6 — self-contradicting documentation was a root cause of the epic's "hard to understand" concern. PaxCache.js's header already described the final two-mechanism model correctly (no edit needed there); the remaining stale spots were TrackerEditTrigger.js's header (still framed as a "narrow complement" to a poll-backstopped model) and docs/DESIGN.md's §Caching section (still listing the poll and `go30asof:` marker as live, 10-row cache table).
Outcome [developer-facing]: Rewrote TrackerEditTrigger.js's header to state it's now the sole onEdit-freshness mechanism across all three PAX-data sheets, with no poll fallback. Rewrote docs/DESIGN.md §Caching to drop the retired poll/asOf marker from the caching-surface table (10 rows → 9) and describe the two-mechanism model as shipped, not pending. Also corrected docs/OPERATIONS.md's nightly-purge description, which still listed `go30asof:` as a Script Properties prefix `purgeStalePaxCache_` purges — confirmed via grep that PaxCache.js no longer references `go30asof` at all. Swept dashboardWebapp.js/bonusWebapp.js/markMinusOne.js/addResponseOnSubmit.js for stale `ensurePaxCacheFresh_`/backstop language; none found (dashboardWebapp.js's one "backstop pattern" comment refers to an unrelated cache-miss-fallback pattern, left as-is).
Outcome [internal]: `npm test` run clean, all suites passing (doc-only change set, no code touched).
## 2026-07-17 00:00:00
_session a8f69588 · v3 · 07-17_

### Objective 1: C5 — write-through the cached bonus arrays instead of invalidating (F3Go30-o39s.6)
Rationale: addBonusEntry_/editBonusEntry_/clearBonusEntry_ previously called invalidateBonusEntriesCache_ on every write, deleting both the pill-shape (go30dash:bonusEntries) and client-shape (go30dash:bonusRows) caches and forcing the next reader to pay a full cold rebuild — the exact cost those caches exist to avoid. The writer already has enough (rowIndex, f3Name, validated payload) to construct both cached shapes directly, matching this epic's write-through-not-invalidate principle used elsewhere in the caching consolidation (PaxCache write-through, C3b).
Outcome [developer-facing]: Added buildBonusCacheShapes_ (constructs the pill-shape entry and client-shape row from the write's own inputs, deriving `complete` from validateBonusEntry_'s already-enforced link-required rule rather than a sheet re-read) and patchBonusCaches_ (patches go30dash:bonusRows by rowIndex match for add/edit/clear, and go30dash:bonusEntries by nameNorm+type+dateIso content match for edit/clear since that cache carries no rowIndex; any miss, collision, or ambiguous match falls back to invalidateBonusEntriesCache_ for both keys). Wired into all three write paths inside their existing LockService sections. Extended test/test_bonus_webapp.js with cache-hit-after-write tests (sheet read stubbed to throw, proving no reread) for add/edit/clear, plus a fallback-to-invalidate test for a rowIndex collision.
## 2026-07-17 21:45:00
_session 0618e91d · v3 · 07-17_

### Objective 1: C8 — audit and eliminate unnecessary Responses layout/header live reads (F3Go30-o39s.9)
Rationale: The user had flagged historically "reading response header rows in all cases but the workflow never actually needed it." F3Go30-440b.6 had already fixed the handle-fast checkin-submit path; this issue traced every remaining caller of `resolveCheckinIdentityLean_`/`resolveCheckinIdentity_` to confirm none still forced a wasted Responses read. Found two: `handleCheckinSubmit_`'s no-handle fallback and `resolveBonusSheet_` (bonus list/add/edit) both resolve identity/write without ever consuming `identity.goals` or `identity.emailMismatch`, yet paid for the per-PAX Responses row fetch + WHO/WHAT/HOW/EMAIL extraction on every call. The Responses *layout* read itself (cheap 1-row header) stays unconditional for all callers — it's what builds the roster-index match that proves `matched`, a security property (server-side re-derivation of identity) that can't be skipped even for these two paths.
Rejected: Considered switching bonus/submit-fallback to Tracker-only matching (mirroring the handle-based fast paths) to eliminate the Responses read altogether, but `resolveBonusSheet_`'s own header comment establishes the Responses match as a deliberate anti-spoofing re-derivation (client-supplied name is never trusted) — changing that would be a security-semantics change outside this audit's scope, not a caching cleanup.
Outcome [developer-facing]: Added a `needGoals` parameter (default `true`) to `resolveCheckinIdentityLean_`/`resolveCheckinIdentity_`; when `false` the per-PAX Responses row fetch and goals/email-mismatch computation are skipped entirely while `matched`/`trackerRow`/`targetSs` resolve unchanged. `handleCheckinSubmit_`'s fallback and `resolveBonusSheet_` now pass `false`; `handleCheckinIdentify_` (the only consumer of goals/emailMismatch) keeps the default. Findings + rationale appended to `docs/staging/caching-consolidation-review.md` under a new "C8 findings" subsection. Added `testResolveCheckinIdentityLeanNeedGoalsFalseSkipsResponsesRowRead` to `test/test_dashboard_webapp.js` asserting the per-PAX row read is skipped and `goals`/`emailMismatch` come back `undefined`. Full `npm test` suite passes (31 files, no failures).

## 2026-07-17 22:30:00
_session 4486cf44 · v3 · 07-17_

### Objective 1: Verify bead F3Go30-f5kk's checkin lazy-load assumption
Rationale: The bead questioned whether "render checkin form first, populate dashboard lazily" was actually working or just appeared to load all at once by coincidence.
Outcome [developer-facing]: Confirmed correct by design — `applyIdentifySuccess_` (CheckinApp.html) calls `showStep('checkin')` before `prefetchDashboard_()`, and for the common token/typed-identify paths, identity itself is now resolved server-side inside the same `doGet` (F3Go30-5nfj.1), so there's no client-visible identity round trip left to stagger. Recommended closing f5kk as resolved-by-design, referencing qi26.1/qi26.2.
Outcome [internal]: Evaluated the developer's follow-up idea of rendering the checkin form/Hit-Miss buttons live before identity confirms, for faster perceived load. Recommended against it — identity is already resolved up front for nearly all traffic, and pre-identity interaction risks a PAX tapping Hit/Miss before discovering they need to re-register.

### Objective 2: Diagnose real check-in/dashboard performance on SIT  [accreted]
Transition: Developer asked to pull actual recent SIT check-in timings for "Little John" to build a step/duration table — a concrete empirical follow-up to the lazy-load discussion, not the same question.
Rationale: Wanted to know exactly where time goes in a real dashboard load, "in particular things that might take time," including cache-read counts.
Rejected: Developer's own proposal — combine all PAX rows into a single JSON blob per sheet (`cache:sheetId`) instead of per-PAX keys. Benchmarked at ~26ms read (vs ~45ms for a full-store `getProperties()`) but requires `LockService` + read-modify-write on checkin writes (~100ms+, serializing every PAX's Hit/Miss against every other PAX's). Developer's own reasoning: "pax updates are sparse enough I am not worried about contention" for per-key writes, but a shared blob key would make contention real since "many users could be updating simultaneously."
Outcome [internal]: Axiom trace of a real dashboard call showed `resolveIdentityMs`/roster-build cost dominated by `buildTrackerValuesFromPaxCache_` (dashboardWebapp.js) looping `getPaxCacheRow_` once per PAX — 24-25 individual `PropertiesService.getProperty()` RPCs. Built a temporary diagnostic (`benchmarkPropertiesService` admin action + `benchmarkPaxCacheReads_`, PaxCache.js) and measured on real SIT data: 24x `getProperty()` loop ≈ 618ms avg vs one `getProperties()` bulk call ≈ 45ms avg (~13x) vs single blob read ≈ 26ms — confirming per-call RPC overhead, not payload size, is what dominates.
Outcome [internal]: Worked out the full check-in-submit write scenario using real `openMs` telemetry — `SpreadsheetApp.openById()` (median ~286ms, tail to 7s) dominates total request cost far more than the ~50-100ms PaxCache write-through choice, and confirmed `handleCheckinSubmit_`'s per-PAX write-through has no lock and no onEdit backstop (ADR-013: script-driven writes never fire onEdit) — a narrow, accepted race window for the same PAX submitting from two sessions concurrently.

### Objective 3: Ship the getProperties() bulk-read fix  [accreted]
Transition: Developer explicitly requested the change once the benchmark justified it: "make the getProperties() swap in buildTrackerValuesFromPaxCache_."
Rationale: Get the ~13x read speedup for dashboard roster assembly without touching the write path's per-key structure (which the contention discussion in Objective 2 established must stay unlocked/per-key).
Outcome [developer-facing]: Added `getPaxCacheRowsBulk_` (PaxCache.js) — same hit/miss stats and deserialize behavior as `getPaxCacheRow_`, backed by one `getProperties()` call. `buildTrackerValuesFromPaxCache_` (dashboardWebapp.js) now uses it instead of a per-PAX loop; write-through (`setPaxCacheRow_dw_`) untouched. Full `npm test` suite passes.
Outcome [user-facing]: Deployed to SIT (v2.4.1.11) and verified live via Axiom — `resolveIdentityMs` dropped from a 420-1957ms range to 83-137ms, `totalMs` for a warm dashboard call dropped to 837ms, with `paxRowHit`/`paxRowMiss` telemetry confirmed still accurate through the new bulk path.
Open: Whether to remove the temporary `benchmarkPropertiesService` admin action now, or keep it for a PROD comparison first — not decided before session end.

### Key Learnings:
Apps Script's `PropertiesService` has no selective bulk-get API — only `getProperty(key)` (one) or `getProperties()` (the entire store, no key filter). A single `getProperties()` call measured ~13x faster than N individual `getProperty()` calls for a 24-key roster, showing per-call RPC overhead dominates over payload size at this scale (18KB whole-store fetch was still much faster than 24 small individual fetches).
`onEdit` installable triggers never fire for script-driven `SpreadsheetApp` writes (only real human edits in the Sheets UI) — confirmed via TrackerEditTrigger.js's own header comment (ADR-013) — so any webapp write path's cache write-through is the *only* mechanism keeping PaxCache correct after that write; there is no backstop.
## 2026-07-17 23:45:41
_session 175471cf-32a1-463c-95a8-ef787c52ae12 · v3 · 07-17_

### Objective 1: F3Go30-5nfj.5 — fix checkin-write/dashboard-prefetch race, add localStorage instant-paint for the static check-in entry point
Rationale: The checkin write race caused a real reported symptom — click Hit, advance to dashboard, see stale data — that persisted until an unrelated nav happened to force a refetch. Root cause: `applyIdentifySuccess_`'s background `prefetchDashboard_()` could still be in flight when a PAX submitted a check-in; the old fix (`invalidateMonthCacheFor_`) was a no-op against a not-yet-cached month, and the prefetch then landed afterward and unconditionally overwrote `state.monthCache` with a payload predating the write. Separately, the static (`static-pages/src/index.html`) check-in entry has no server-pre-rendered identity the way `script/CheckinApp.html`'s `doGet` does, so every load blocked on the `identify` network round trip before showing anything.
Outcome [user-facing]: Implemented client-side write-through caching (`applyOwnDayWrite_`/`patchOwnDayIntoPayload_`/`revertOwnDayWrite_`, mirroring the server-side PaxCache/bonus-cache write-through pattern already documented in docs/DESIGN.md) in both `script/CheckinApp.html` and its `static-pages/src/index.html` mirror — verified byte-for-byte identical logic in both files, no drift. Added a 14-day-TTL `localStorage` snapshot (`go30CheckinSnapshot:v1`) with reconciliation (`reconcileWithLocalWrites_`, `applyIdentifySuccess_`'s new `preserveView` option) to `static-pages/src/index.html` only, so a returning visit on a saved link paints the check-in step instantly instead of blocking on the identify round trip, then reconciles against the live response (any write made this pageview wins) once it lands; a revoked/stale token clears the stale snapshot and falls back to the blank identify form.
Outcome [developer-facing]: Updated `test/test_checkin_monthcache_invalidation.js` to assert the new write-through contract in place of the old invalidate-on-write assertions. Added 4 new Playwright scenarios to `tests/playwright/static-checkin.spec.js` covering the race fix and the snapshot feature; verified live against SIT — 13/13 `static-checkin.spec.js` and 17/17 `checkin-advanced-grid.spec.js` pass, `npm test` green (32 files).
Outcome [internal]: Close-out pass: confirmed no drift between the two mirrored files' write-through functions; added one clarifying comment in `static-pages/src/index.html`'s `runIdentityBootstrap_` (`knownPaxNotRegistered` branch) explaining an intentional show-then-hide `showStep` sequence that otherwise reads like a mistake. Extended `docs/DESIGN.md`'s qi26.2 Dashboard prefetch bullet with a new "Client-side write-through (F3Go30-5nfj.5)" sub-bullet. Added a `docs/CONTEXT.md` §Core Capabilities bullet documenting the static front end's localStorage instant-paint behavior, which previously had no doc coverage at all (the static entry point itself, F3Go30-5nfj.2, was never documented there either — out of scope to backfill fully this session). Re-ran `npm test` and the Playwright specs against a fresh SIT redeploy after the comment edit; both green.
Open: Not yet closed in bd — still needs human/live-verification confirmation per this project's `backlog` skill close rules.

## 2026-07-18 13:16:19
_session 175471cf-32a1-463c-95a8-ef787c52ae12 · v3 · 07-18_

### Objective 1: F3Go30-5nfj.5 follow-up — fix three race/state bugs found via live manual testing, then ship to PROD
Rationale: After the initial implementation (see the prior 2026-07-17 23:45:41 entry) passed all automated live-SIT checks, the developer manually exercised the static check-in page on SIT and found three real bugs the automated scenarios hadn't caught, all in the same reconciliation code path (`applyIdentifySuccess_(res, {preserveView: true})`, called when a live `identify` response lands after a localStorage-snapshot instant paint).
Outcome [user-facing]: (1) Fixed the live identify reconciliation unconditionally calling `showStep('checkin')` and resetting `state.monthCache`/re-firing `prefetchDashboard_()`, which yanked the PAX back to the check-in step (and clobbered the already-correct dashboard cache) if they'd navigated to the dashboard before the background reconciliation landed — all three now gated behind `!opts.preserveView`. (2) Moved the `#checkinSyncingNote` "syncing" indicator out of `#step-checkin` into the persistent header (`.header-right`) so it stays visible regardless of which step is showing — it had been invisible during the exact scenario it exists to cover (viewing the dashboard while the background identify call is still in flight). (3) Fixed `state.locallyWrittenIso` being recorded only inside the checkin write's own `.then()` (after its round trip completed) instead of synchronously alongside `applyOwnDayWrite_` — a fast-resolving background `identify` call could reconcile and persist a stale pre-write value into the localStorage snapshot before the write's own response landed, which then only self-corrected on a THIRD page load. All three fixes verified live against SIT (14/14 `static-checkin.spec.js`, including a new regression test for fix (3); 17/17 `checkin-advanced-grid.spec.js`; `npm test` green) before being folded into the same uncommitted changeset as the initial implementation.
Outcome [user-facing]: Per the developer's follow-up suggestion, generalized the syncing indicator from a single-purpose boolean (toggled only around the one background identify call) to a reference-counted `pendingRequestCount_` wired into the shared `callApi()` helper itself — the indicator now reflects ANY outstanding request (checkin writes, dashboard loads, bonus actions, not just the reconciliation identify), and correctly stays visible across overlapping concurrent requests instead of only tracking one call site. Verified live against SIT, 14/14.
Outcome [internal]: **Incident** — discovered during a routine pre-release check that PROD (`templateScriptId`'s active deployment) was already serving an unreviewed, uncommitted v2.4.2 build (`clasp deployments` showed `@40 - v2.4.2 GO30-APP`), evidently from one of this session's background implementation agents running `npm run push` (this repo's alias for `--deploy-template`, i.e. a PROD deploy) instead of the instructed `npm run deploy:sit` — a real, unauthorized production push mid-session. Flagged to the developer immediately; developer reviewed it directly and authorized proceeding. Superseded by deploying the fully-tested code as the real v2.4.2 release (`npm run deploy:prod -- --skip-bump`, keeping the version number the accidental push had already landed on rather than bumping again) — PROD deployment `@41` is now the reviewed, correct build.
Outcome [developer-facing]: Added a `docs/CHANGELOG.md` §Unreleased entry (user/admin-facing framing: instant dashboard reflection of a just-made check-in, the static page's instant-paint-on-return-visit with its syncing indicator, and correct fallback on a revoked saved link).
Open: Consider whether background/subagent-driven deploy steps in this project should be restricted from ever invoking `npm run push`/`deploy:prod` without an explicit, separately-confirmed instruction — the naming (`push` reads as an innocuous generic action) appears to be what led an agent into the unauthorized PROD deploy.

### Key Learnings:
This project's `npm run push` is an alias for `--deploy-template` (a real PROD deploy), not a generic "push my changes" command — a name that reads as harmless to an agent that hasn't internalized the project's SIT/PROD distinction. Any agent given deploy instructions in this repo must be told the exact command (`npm run deploy:sit`) and warned off `npm run push`/`deploy:prod` explicitly, since the command name alone doesn't signal its blast radius.

## 2026-07-18 08:52:00
_session c0ba2c37 · v3 · 07-18_

### Objective 1: bd hygiene — cross-check open beads against work-log/commits and close what was actually finished
Rationale: Developer asked to check specific beads (o39s, 5nfj, 440b, f5kk, xqz3, e3co) against work-log/commit history for missed close-outs, since completed work sometimes isn't reflected in bd state.
Outcome [internal]: Closed F3Go30-o39s (epic, 11/11 children complete — caching consolidation), F3Go30-5nfj.5 and its parent epic F3Go30-5nfj (shipped in v2.4.2, commit 4548efd, verified live on SIT), and F3Go30-f5kk (work-log from 2026-07-17 had already concluded resolved-by-design but was never closed). F3Go30-rmh (form-submission test harness) closed/rejected per developer instruction — project is moving away from the Google Form. F3Go30-xqz3 and F3Go30-e3co confirmed still genuinely open at that point (see Objectives 2 and 3).

### Objective 2: Implement F3Go30-e3co — consolidate duplicated "How it Works" content  [accreted]
Transition: Developer asked a follow-up design question about e3co (hosting the content on the static-pages site like the checkin page) immediately after the bd cleanup pass identified it as still open; the question turned into "let's take this approach and implement it."
Rationale: The four-way content duplication (docs/Go30-Intro.md, script/SignupApp.html, script/CheckinApp.html panels — Go30-FAQ.md turned out not to be a literal duplicate, confirmed out of scope) had been drifting since 2026-07-07. Design decisions made via AskUserQuestion during the implementation-gate AC pass: docs/Go30-Intro.md stays the hand-edited canonical source (not a generated copy); the hosted static page needs no SIT/PROD split (no server calls, no version dependency); the SignupApp/CheckinApp panels keep their interactive expand/collapse UX rather than becoming outbound links (developer: "keep expand/collapse, just de-duplicate the source"); the two panels' small contextual text differences are normalized to identical wording rather than building a templating layer, dropping SignupApp's dynamic `howCheckinLink` insert as the one accepted behavior loss.
Rejected: An initial simpler plan (replace both panels with an outbound link to the hosted page) was rejected by the developer as a UX regression for a quick mid-checkin reference — the interactive in-place panel was kept, with de-duplication happening at the generation layer instead.
Outcome [developer-facing]: Added a marker-delimited canonical fragment to docs/Go30-Intro.md; new tools/sync-how-it-works.js extracts it and injects it into both GAS panels and writes static-pages/src/how-it-works.html; tools/build-static-pages.js copies that page unchanged into dist/sit and dist/prod; tools/manage-deployments.js's deploy() now runs the sync before every clasp push. New test/test_sync_how_it_works.js (7 assertions) added to npm test; full suite green. static-pages/README.md documents the new page/pipeline.
Outcome [internal]: docs/CONTEXT.md was deliberately NOT expanded to document the static entry point/how-it-works page — that backfill gap predates this session (flagged but out of scope in the prior 5nfj.5 work) and doc-trigger-check confirmed this change has no user-visible content difference, so it doesn't meet the CHANGELOG/CONTEXT.md bar.
Open: F3Go30-e3co left open pending a live SIT visual check (panel renders/expands correctly, no leftover JS error from the removed howCheckinLink wiring, the new how-it-works.html URL serves) per this project's backlog-skill close rules.

### Objective 3: Fix F3Go30-xqz3 — document mid-month patch procedure  [accreted]
Transition: Developer pointed at the earlier bd-cleanup finding (xqz3 was left open because its documentation AC wasn't met) and asked to go ahead and update docs/OPERATIONS.md.
Rationale: On investigation, xqz3's original AC ("document updating monthScriptId/monthSpreadsheetId, run npm run deploy:month") described a deploy mechanism that no longer exists — F3Go30-shsx (closed 2026-06-24, per ADR-010) had already retired the 'month' clasp target entirely, since the Template became the sole runtime container and monthly tracker copies have no bound script left to patch. Writing docs for the originally-specified workflow would have documented something false.
Outcome [developer-facing]: Added a "Mid-month patch procedure" paragraph to docs/OPERATIONS.md §Deployment §Model clarifying the actual current path (deploy:sit → deploy:prod, same as any other change, takes effect immediately) with a pointer to docs/deployment-model.md for the retired mechanism's history.
Outcome [internal]: Closed F3Go30-xqz3 — release-sequence AC was already satisfied by the routine v2.4.2 release (tag v2.4.2, version.js stamped TEMPLATE); documentation AC satisfied by the corrected OPERATIONS.md paragraph rather than the stale original wording.

### Key Learnings:
F3Go30-shsx/ADR-010 retired the 'month' clasp deployment target on 2026-06-24 — any older bd issue or doc referencing `monthScriptId`/`npm run deploy:month` predates that and should be re-verified against current deployment-model.md before being acted on literally.

## 2026-07-18 15:04:11
_session 9bdc64d9 · v3 · 07-18_

### Objective 1: Bake a per-env GAS /exec URL into the static check-in page at build time
Rationale: A PROD user hit a `405 Not Allowed` opening the static check-in page — the cause was a bare page URL with no `?webapp=` param, so `WEBAPP_URL=''` and the page had no backend to call. Discussion weighed passing `?webapp=` vs baking the URL in; the developer pushed back on the param having any real upside: "isn't the canonical definition of an env is that it is everything for sit or for prod? Even the static pages get updated with a deployment especially because they have actual code in them." Confirmed in-code that every caller passes `ScriptApp.getService().getUrl()` — exactly one backend per env — and that smoke tests vary only `?ns=` on the same /exec URL, so the param's supposed flexibility was moot. Landed on a hybrid: bake a per-env default, keep `?webapp=` as a still-honored override. "lets ignore the webapp parameter for now as some people have already bookmarked and it's just redundant" — so the param was kept working (not removed) but no allowlist/validation was added.
Rejected: putting the URL in version.js — it's GAS server-side code the browser-served static page can't read; the correct injection point is build-static-pages.js stamping index.html, mirroring the existing STATIC_BUILD_VERSION_ placeholder. Value sourced from local.settings.json deployment IDs (same source callWebapp.js uses), one source of truth.
Outcome [user-facing]: A bare or bookmarked static check-in URL now resolves to its env's baked backend instead of a dead 405 page; older bookmarks carrying the redundant `?webapp=` param still work (param overrides the baked default).
Outcome [developer-facing]: tools/build-static-pages.js refactored to export pure `stampSource_`/`execUrlForEnv_`, guarded `main()` with `require.main`, and now stamps a second `STATIC_WEBAPP_URL_` placeholder per env (throws loudly on a missing deployment ID). Added test/test_build_static_pages.js (6 unit tests) wired into `npm test`. Verified: dist/sit baked URL matches the SIT /exec seen in Axiom logs, dist/prod gets the template /exec, unbuilt src stays null so Playwright/local (which pass `?webapp=` explicitly) are unaffected. Tracked as F3Go30-6bl6.
Open: not yet deployed — dist regenerates + publishes to F3Static on the next `npm run deploy:sit`/`deploy:prod`; docs (docs/DESIGN.md / OPERATIONS.md) describing the `?webapp=` mechanism not yet re-checked via /doc-trigger-check.

## 2026-07-19 20:31:59
_session c5da2880 · v3 · 07-19_

### Objective 1: Determine whether PAX "Chicken Fried" was a new signup or a first webapp use
Rationale: A PROD signup-looking event on 7-19 was ambiguous — the question was whether the PAX registered that day or had been participating already and merely used the webapp for the first time.
Outcome [internal]: Answered from Axiom + live sheets: already registered for July, 7-19 was first webapp use. Decisive evidence was `signupWebapp.save {mode:"update"}` and `upsertPaxDbRow_ {created:false}`, corroborated by a Tracker row already carrying Jul 1–18 marks. Two traps recorded: the Responses `Timestamp` is re-stamped on every update (signupWebapp.js:612), and the "currently participating" field is computed EXCLUDING the target month, so its "No" meant "first Go30 month", not "new this month".

### Objective 2: Make the activity-log SIGNUP label say what it actually means  [accreted]
Transition: the investigation only resolved because the report's `[SIGNUP]` line had to be manually traced back to its source event; the developer's "make the label change so it's more clear" followed directly from that friction, while the event semantics were still loaded.
Rationale: `[SIGNUP]` was rendered from `signupWebapp.identify` — the form's PaxDB prefill LOOKUP, a read that happens whether or not anything is saved. The event that actually distinguishes new from returning (`signupWebapp.save`, mode insert|update) was never reported, and `matched:false` lookups were dropped entirely.
Outcome [developer-facing]: tools/activity_log.py now reports `[SIGNUP LOOKUP]` (both outcomes), `[SIGNUP NEW]` / `[SIGNUP UPDATE]` from the save mode, and `[SIGNUP EMAIL]`; folds "first Go30 month" vs "returning" in from `findMostRecentPaxRecordForName_.done.found` via a new per-execId index. Verified against live PROD data, not a test — no unit-test harness exists for tools/*.py.
Outcome [developer-facing]: script/signupWebapp.js stamps `f3Name` on the three `signupWebapp.save*` log calls, since the save runs in its own execution and cannot be joined to the identify by execId. Until deployed, the report infers the name from the nearest lookup and marks it `~`. Tracked as F3Go30-xxy4.
Open: the GAS-side `f3Name` stamp is committed but undeployed — takes effect on the next deploy:prod.

### Objective 3: Scope making the static check-in page an installable PWA  [accreted]
Transition: asked directly after the label fix, as a forward-looking question about the two front ends the investigation had just exercised.
Rationale: The product's failure mode is a PAX forgetting to check in, not latency — so a home-screen icon is the only intervention that plausibly moves the metric. Deliberately phased because cost concentrates in the service worker while benefit concentrates in the icon, and they separate; Phase 1 ships installable with NO service worker, and a measurement gate decides whether Phase 2 is justified. Several corrections materially shaped the design. On environments: "wouldn't the different env be different installs" — correct, and it exposed a real defect, since SIT and PROD are different PATHS on the SAME origin, so the two installs share one localStorage bucket and the proposed durable token would leak across them. On sharing: "I thought it opened full screen ... and you don't get browser controls" — correct, and it reframed the URL-token question, since an installed iOS app cannot read its own URL at all.
Rejected: `docs/staging/` placement (framework deletes staging docs once work enters beads, which conflicts with iterating on the doc); passkeys/WebAuthn for the bearer-token problem, on cost — ES256 assertion verification inside Apps Script is disproportionate at 21–32 PAX.
Outcome [developer-facing]: docs/pwa-design.md — problem, constraints, four intent-stated Mermaid diagrams, per-env storage namespacing, offline outbox, phasing with a measurement gate, a security-posture section, and a longer-term storage/tenancy vision section. ROADMAP §Funnel gained the PWA plus the database-migration and tenant-model themes.
Outcome [developer-facing]: Epic F3Go30-833s with 12 children, phase-ordered by dependency so `bd ready` cannot surface the service worker before the adoption gate is answered; plus standalone F3Go30-ah3v (CSP/referrer meta) and F3Go30-giqm.
Outcome [internal]: F3Go30-giqm records a PRE-EXISTING gap found while scoping — no node test reads static-pages/src/index.html at all, so the static check-in page's client invariants are asserted only by a live Playwright spec that needs a deployed SIT.

### Objective 4: Decide that signup moves to the static origin  [accreted]
Transition: forced by the developer spotting a hole in the standalone analysis — "isn't the edit goals link directing out to the signup gas entrypoint" — which turned a UX footnote into an architectural decision.
Rationale: Three flow-critical paths navigate the top-level document cross-origin to the GAS signup page, so an installed app is replaced by script.google.com mid-flow. Worst is the `knownPaxNotRegistered` auto-redirect, which fires on identify at a month boundary and ejects a returning PAX before they ever reach the dashboard. The fix is cheap because it needs NO server work: `handleSignupIdentify_` already returns months/aoList/goalList on both paths — the complete set of SignupApp.html's server-injected template vars. A further correction fixed the migration framing: "Using static pages, I would expect ?cmd=signup to still work" — `?cmd=signup` is a URL contract both origins should honour, not a GAS address, which collapses link migration into a base-URL swap with the query string preserved.
Rejected: a separate static signup.html (same-origin and in-scope, so it opens inside the standalone window where iOS has no back button, and it would need its own identity handoff); and suppressing the ejection only when installed, as work the real fix immediately deletes.
Outcome [developer-facing]: ADR-018 — the static origin is the primary signup front end, implemented as a step inside index.html; SignupApp.html demoted to availability fallback [term corrected 2026-07-20 — see the correction entry at the end of this log], with its retirement explicitly left undecided to keep the record to one decision.
Outcome [developer-facing]: Issues F3Go30-833s.9 (static signup UI), .10 (emails), .11 (link migration), .12 (test parity). ADR Consequences amended pre-commit on the developer's instruction — "lets put test migration in rather than discover it later" — recording that handler tests are front-end-neutral while identity-token-flow.spec.js and the SignupApp.html client-invariant tests need static twins as definition of done.

### Key Learnings:
Mermaid could not be rendered locally (no CLI in repo or on the box), so all four diagrams are unverified until GitHub renders them.
An installed PWA is exempt from Safari's 7-day ITP storage eviction — that eviction is currently acting as an accidental security control on abandoned browsers, so installing lengthens credential lifetime rather than shortening it.

## 2026-07-19 12:00:00
_session d6e972f4 · v3 · 07-19_

### Objective 1: Persist the check-in token to localStorage with ?id fallback (F3Go30-833s.1)
Rationale: Per docs/pwa-design.md sections 5/5.1, an installed PWA icon launches start_url = "./" with no ?id token, so without a persisted token an installed app forces a typed re-identify on every cold start -- worse than the bookmark it replaces. This was the blocking prerequisite issue for the PWA epic (F3Go30-833s), gating manifest/icon work (F3Go30-833s.2) and sign-out (F3Go30-833s.7).
Outcome [user-facing]: static-pages/src/index.html now persists identityToken to localStorage on every successful identify (applyIdentifySuccess_), namespaced per deployment via a hash of the baked WEBAPP_URL (TOKEN_STORAGE_KEY_) so SIT and PROD installs -- same origin, different paths -- cannot read each other's token. On boot, ?id in the URL still wins when present; otherwise the persisted token is used to reach the existing snapshot fast-paint path. clearCheckinSnapshot_ (already called on a server-rejected/stale token) now also clears the stored token, falling back cleanly to the typed identify form. The "Not you?" link (sign-out) clears the token too.
Outcome [developer-facing]: Added hashString_/saveTokenToStorage_/loadTokenFromStorage_/clearTokenFromStorage_ helpers alongside the existing IdentityCore snapshot helpers in index.html.
Open: The playwright spec tests/playwright/static-checkin.spec.js was not run to completion in this session (timed out locally, likely a browser-launch/env issue unrelated to this change) -- npm test (the required gate) passes; live-browser verification of the new token persistence path is still worth doing before this is treated as fully verified.

## 2026-07-19 00:00:00
_session 64baa272 · v3 · 07-19_

### Objective 1: Ph1 — bring signup into the static page over the cmd=signup JSON API (F3Go30-833s.9)
Rationale: Three flow-critical paths in `static-pages/src/index.html` navigated the TOP-LEVEL
document cross-origin to the GAS signup page — the goals "Edit" anchor, the "Sign up" buttons
(`openSignup_` via `window.top.location.href`), and the auto-redirect on a `knownPaxNotRegistered`
identify. On an installed iOS home-screen app each hands the PAX off to Safari; the third is the
worst, firing on identify at a month boundary so a returning PAX is ejected before ever reaching
the dashboard. Decided in ADR-018 / docs/pwa-design.md §7: signup becomes a **step of the page
that already knows who the PAX is**, not a second static page — in-page there is no navigation
and therefore no identity handoff to build. Server work was genuinely zero: `handleSignupPost_`
already dispatches identify/save/feedback as JSON, and `handleSignupIdentify_` already returns
`months`/`aoList`/`goalList` on both matched and unmatched paths, which is everything
`SignupApp.html` gets as server-injected template variables.
Rejected: porting `SignupApp.html`'s `attemptTopRedirect_` along with the rest of the inlined
`IdentityCore.html` plumbing. It exists to break a GAS page out of its HtmlService sandbox iframe;
the static page IS the top-level document, so the only thing it could do there is navigate the
installed app away. Omitted deliberately, with an in-file note saying why, so it isn't
reintroduced as "shared plumbing".
Rejected: leaving `CMD_` a page constant. `?cmd=signup` and `?cmd=checkin` reach different server
dispatchers, and one page now drives both — signup actions would have landed in the check-in
dispatcher and failed as `unknown_action`. `callApi()` took an optional per-call `cmd` instead,
defaulting to `CMD_`, so every pre-existing check-in call site is untouched.
Outcome [user-facing]: Signup, goal editing, and the month-boundary "not registered yet" path all
complete without leaving the static page. `?cmd=signup` on the static URL now opens directly on
the signup step, honouring `targetMonth` and `autoStart` — the same param vocabulary GAS takes, so
a signup link migrates between origins as a base-URL swap. The GAS `SignupApp.html` path is
byte-for-byte unchanged and stays live as the availability fallback [term corrected 2026-07-20 — see the correction entry at the end of this log].
Outcome [developer-facing]: `cmd` now carries two distinct meanings on the static origin (page
routing via `PAGE_CMD_` vs API dispatcher via `CMD_`/`callApi`'s third arg); both are documented at
their declarations and in the new DESIGN.md decision entry. Added `state.checkinReady` so the
signup step can tell whether there is a resolved check-in to offer a way back to — notably false
on exactly the month-boundary path.
Outcome [internal]: DESIGN.md decision entry and a CHANGELOG §Unreleased bullet added; `npm test`
green (34 suites, unchanged — the suite is front-end-neutral and reads `script/*`, not the static
page).

### Key Learnings:
Verifying this needed a browser, and `npm test` cannot provide it: no node test reads
`static-pages/src/index.html` at all (pre-existing gap, tracked as F3Go30-giqm), and the existing
Playwright signup specs drive the GAS origin — after this change they exercise the FALLBACK path,
so a green run there is not evidence the static signup works. Verified instead with a throwaway
Playwright harness serving `static-pages/src` against a stubbed cmd=signup/cmd=checkin API: 21
checks across all four entry paths, each asserting the main frame never leaves the local origin.
Left in /tmp deliberately — the durable E2E twin is F3Go30-833s.12's scope, which this bead blocks.

## 2026-07-19 21:32:26
_session 46a3a570 · v3 · 07-19_

### Objective 1: Client-level test coverage for static-pages/src/index.html (F3Go30-giqm)
Rationale: Four node tests already assert client-side invariants (NS_/CONTEXT_DATE_ declaration order, callApi echo, month-cache write-through) against the GAS HTML sources (CheckinApp.html/SignupApp.html/IdentityCore.html), but none read static-pages/src/index.html — the static check-in page's "faithful port" of the same client logic — so a regression there only surfaces in the live-browser Playwright spec, which doesn't run in npm test. Issue was deliberately sequenced after F3Go30-833s.9 (which restructured the same file) to avoid building the harness twice.
Outcome [developer-facing]: Added test/test_static_page_client_invariants.js, wired into `npm test`. Asserts NS_/CONTEXT_DATE_ are declared before callApi is defined and are echoed in its body; invalidateMonthCacheFor_/applyOwnDayWrite_/submitCheckin_/submitSelectionCheckin_ write-through-before-callApi and revert-on-failure behavior (mirrors test_checkin_monthcache_invalidation.js); and two documented client-vs-GAS divergences per AC 3 — the static page's callApi takes a per-call `cmd` override (one page drives both check-in and signup dispatchers) where IdentityCore.html's callApi does not, and the static page omits attemptTopRedirect_ entirely (already the top-level document, unlike the GAS sandboxed iframe) while IdentityCore.html still defines and uses it.
Outcome [internal]: Full `npm test` suite passes (36 test files including the new one).
## 2026-07-19 00:00:00
_session 3ab40b90-016b-437e-a640-9bbde9818cdf · v3 · 07-19_

### Objective 1: Ph1 static signup test parity — E2E twin and client invariants (F3Go30-833s.12)
Rationale: F3Go30-833s.9 made the in-page signup step in static-pages/src/index.html the PRIMARY signup UI (ADR-018), but only identity-token-flow.spec.js's GAS SignupApp.html fallback had E2E coverage — the demoted path had more test coverage than the primary one. AC 4 was scoped by the F3Go30-90l5 decision (SignupApp.html sunset) to a holding action: retain identity-token-flow.spec.js unchanged rather than deepen it.
Outcome [developer-facing]: Added tests/playwright/static-signup.spec.js, following static-checkin.spec.js's local-static-server-against-live-SIT precedent, covering new signup, returning-PAX edit (with server-side verification and fixture-value restore), and the month-boundary knownPaxNotRegistered auto-redirect-in-place path (reusing identity-token-flow.spec.js's existing LateSignupTest fixture read-only, per its own "don't re-run signup unless re-establishing" note). Every test tracks the page's `load` event count and asserts it stays at 1, directly asserting AC 2 (no top-level navigation during signup).
Outcome [developer-facing]: Extended test/test_static_page_client_invariants.js with two new static-shape assertions confirming runSignupIdentify_ and performSignupSave_ both route through callApi(...,'signup') — ties the existing NS_/CONTEXT_DATE_-echo invariant explicitly to the signup step's own call sites (AC 3), not just the shared callApi function in the abstract.
Outcome [internal]: Added `npm run test:static-signup` script mirroring the existing `test:identity-token` convention.
## 2026-07-19 21:41:42
_session b890c24e-d79e-4ba1-aa23-2369b189b9b4 · v3 · 07-19_

### Objective 1: Point signup confirmation/reuse emails at the static signup page (F3Go30-833s.10)
Rationale: ADR-018/§7 moved primary signup into the static front end; the emails PAX actually receive still minted bare GAS `?cmd=signup` links, so the emitted email links needed to move too, with the GAS URL kept working as a fallback for anyone holding an old link.
Rejected: Implementing AC2 ("advertised/shared signup link — Slack, Q handoff — is updated") in this same issue. F3Go30-833s.11's own body explicitly states it is "Distinct from F3Go30-833s.10, which is only the signup emails," and separately owns exactly those emitters (WebApp.js template.signupUrl, buildSignupSlackMessage_'s caller, CheckinApp.html's GAS signup redirects) plus the TinyURL re-pointing / GAS-arrival-redirect work AC2 would otherwise require. (Inferred) Treated .11's scope note as authoritative over .10's own AC2 text to avoid duplicate/colliding work, and recorded that decision in the bd issue notes rather than silently dropping the AC.
Outcome [developer-facing]: Added `buildStaticSignupUrl_` (script/Utilities.js), mirroring `buildStaticCheckinUrl_`'s fallback semantics (static GitHub Pages host + `cmd=signup` when `STATIC_PAGES_BASE_URL_` is configured, `''` otherwise). `signupEmail.js`'s `buildCheckinEmailLinks_` now builds `editGoalsUrl` through it, falling back to the prior bare `webAppBaseUrl + '?cmd=signup'` construction when the static host isn't configured — satisfying AC3 (old GAS links keep working) as a side effect of the fallback contract.
Outcome [user-facing]: Signup confirmation/reuse emails' "Update my registration" link now opens the static signup page instead of the GAS-hosted one, once `STATIC_PAGES_BASE_URL_` is deployed.
Outcome [developer-facing]: Added test/test_static_signup_url.js (new, wired into `npm test`) exercising the helper's configured/unconfigured/opts branches, and a static-configured case in test/test_signup_email.js proving both email links resolve to the static front end. Full `npm test` suite passes.
Open: AC2 (advertised Slack/Q-handoff signup link) is deliberately left to F3Go30-833s.11, which now has `buildStaticSignupUrl_` available to consume at its listed call sites.

## 2026-07-20

Session: 15ba2c01-1a61-4666-bd85-b8da27efeb87

Objective: Split the PWA epic's Phase 1 into two independently shippable deliverables, and correct a terminology error that had begun propagating into code.
Rationale: Phase 1 bundled the static signup migration with installability, but only the latter feeds the GATE (.4) that measures install adoption — so the signup work was silently delaying the gate clock. Separately, the developer challenged the premise that SignupApp.html is a "zero-install fallback": the static page already is the install-free path, since it is an ordinary GitHub Pages document and installing only adds a home-screen icon. Nothing about declining to install requires the GAS UI.
Outcome [developer-facing]: Labels phase-1a-signup / phase-1b-install replace the blanket phase-1. Chain is .1 -> .9 -> giqm -> .12, with .1 a shared foundation both tracks need. F3Go30-giqm was sequenced AFTER .9 on the developer's correction — the harness reads index.html source and .9 restructures that file, so building it first would build it twice.
Outcome [developer-facing]: F3Go30-90l5 recorded the SignupApp.html sunset decision (posture: scheduled for removal, not permanent) and closed; execution split into F3Go30-wjpu, gated on .11 complete plus a month of real static-signup use in PROD — the precondition ADR-018 already stated.
Outcome [developer-facing]: CORRECTION — "zero-install fallback" replaced with "availability fallback" throughout. The term was wrong and overstated the GAS front end's value enough to justify maintaining a duplicate signup UI indefinitely. What the GAS page actually provides is narrower: a second origin if the static host is unreachable, plus the legacy-link route for already-distributed ?cmd=signup URLs, which .11 resolves into a query-preserving redirect (the route, not the rendered page). Corrected in adr/018 (in place, with an Errata section, as it was accepted the same day with nothing yet built against it), docs/pwa-design.md, docs/DESIGN.md, script/WebApp.js, script/Utilities.js, static-pages/src/index.html, and test/test_signup_link_migration.js.
Outcome [internal]: The two earlier work-log occurrences (the ADR-018 entry and the .9 entry) were corrected in place rather than left standing, on the developer's instruction that a fresh scan must always turn up accurate and self-consistent information. Both carry an inline marker pointing here. This is a deliberate exception to the log's append-only property, recorded so the exception is visible rather than silent.
Outcome [developer-facing]: F3Go30-xwqe created — a documentation pass for phase-1a. bd-run-beads.py's session prompt mandates claim/implement/test only and says nothing about docs, and no phase-1a bead carried a doc AC, so the migration would otherwise have landed with DESIGN.md/CONTEXT.md/OPERATIONS.md/CHANGELOG.md describing signup as GAS-primary.
Open: F3Go30-833s.11's headless session was cut off mid-bead by an account spend limit (not a code fault), leaving its new test/test_signup_link_migration.js orphaned — written and passing, but never wired into package.json's test script. Wired in by hand here. Worth checking for the same failure mode after any interrupted bd-run-beads run.

## 2026-07-20 06:35:44
_session cff6b67c-a18e-49af-bdc0-801c1029c27f · v3 · 07-20_

### Objective 1: Root-cause and fix the cross-PAX identity leak (F3Go30-a2hq)
Rationale: "fix a2hq". The P0 opened by the previous session's first live run of static-signup.spec.js: identify returned one PAX's f3Name and team alongside another PAX's email. The bead carried two hypotheses (a Responses name collision, a stale PaxCache roster entry) explicitly marked NOT CONFIRMED; both turned out wrong. Actual cause: handleSignupSave_ appends the new PAX at the bottom of Tracker, patches PaxCache's name->offset roster index with that offset, then calls sortTrackerSheet_ — which reassigns every offset the index just cached. Nothing invalidated it, and programmatic sorts never fire onEdit, so TrackerEditTrigger.js's invalidation never applied. The SIT data matched exactly: StaticSignupTest appended at offset 22 then sorted up to 5 (team Crucible); NoSadClown has a blank team, sorts last, and landed in the vacated offset 22 — which is also why the response carried team=''.
Rationale: A second poison carrier was found during verification and had not been predicted: after the wrong-row live read, setPaxCacheRow_ wrote that row back under the REQUESTING pax's own name key, which outlives an index rebuild. Proven by the first post-fix staleBind log reporting foundAtRowIndex=5 — the correct offset — meaning the index had already recovered and only the row entry was still wrong. A fix purging only the index would have looked green while still leaking.
Rejected: fixing invalidation at the three sortTrackerSheet_ call sites (signupWebapp handleSignupSave_, addResponseOnSubmit Phase 5, WebApp.js admin sortTracker). All three share the exposure and signup patches the index immediately before sorting, so a call-site fix is easy to write in the wrong order; the invalidation went into the sort itself.
Outcome [user-facing]: identify no longer returns one PAX's identity under another's email, and handleCheckinSubmit_ can no longer write a check-in into the wrong PAX's row (it writes at the same rowIndex+4). Verified live on SIT: the original failing token now returns StaticSignupTest / staticsignuptest@example.com / Crucible.
Outcome [developer-facing]: Two-layer fix in commit e7dfd66 — sortTrackerSheet_ drops the Tracker roster index for its spreadsheet (per-PAX rows deliberately kept: a sort moves rows without changing contents and those entries are name-keyed); trackerRowBelongsToPax_dw_ + purgeStaleTrackerBind_dw_ added to dashboardWebapp.js, with resolveCheckinIdentityLean_ retrying once against live data after purging both carriers and resolveCheckinIdentityFull_ re-deriving from a live read. The handle-based resolvers already carried this gate — the two resolvers identify actually uses did not, and that asymmetry is what let the leak ship.
Outcome [developer-facing]: Two regression tests, each verified to FAIL without its own fix (test_dashboard_webapp.js fails with actual 'Bystander' vs expected 'Newbie' — the same shape as the live defect; test_add_response_on_submit.js asserts the roster index does not survive a sort). npm test green; static-signup 3/3 (was 2/3); static-checkin 14/14; identity-token-flow still exactly 6 failed, unchanged and pre-existing (F3Go30-bkxg).
Outcome [developer-facing]: Mismatches now log checkinWebapp.resolveIdentity.staleBind with the PAX and the offset it was wrongly sent to, so the guard doubles as a detector — the only forward-looking evidence trail available, since after the fact a mis-targeted check-in value is indistinguishable from a legitimate one.
Outcome [internal]: AC 4 settled for SIT — no check-in write was mis-targeted (zero checkinWebapp.checkin events for that PAX across a 7d scan, and its Tracker row is blank; the failing E2E stopped at the welcome assertion before checking in). invalidateAllCache run anyway (wiped 81, layoutCleared 4). F3Go30-a2hq closed.
Outcome [internal]: F3Go30-x2vd filed (P1, depends on a2hq) for the PROD rollout, which is deliberately NOT done here — PROD is an explicitly-stated action per CLAUDE.md, and the sequencing matters: deploy THEN invalidateAllCache, or the old code repopulates a stale index on the next signup.
Open: PROD still runs the defective code. 30d of PROD traffic is 1 signupWebapp.save (mode=update, no row insert) and 9 check-ins, all runId=gaslogger-test, so real exposure looks low — but it is not provably zero and cannot be settled from logs written before the guard existed.

### Objective 2: Trace the defect back to the o39s.4 write-through fix  [accreted]
Transition: the developer recalled having raised offset-caching previously — "I recall that i had raised this issue sometime back about remembering row offsets in the cache, and you agreed, and made it so when we added a pax and hence sorted and changed offsets, that we would refresh the cache at that time. Is this a different case?" — which is a fidelity check on whether the fix just shipped was re-fixing something already fixed.
Rationale: The recollection was accurate and the answer was no, not a different case: F3Go30-o39s.4 (commit e87a5bc) added exactly that patchPaxRosterIndex_ write-through, and it is the line sitting immediately above the sortTrackerSheet_ call. But it addressed PRESENCE ("a warm-but-stale roster index would report a legitimately signed-up member as not found"), not POSITION. The two fail in opposite directions: missing produces a loud, safe, self-correcting not-found; moved produces a silent wrong-row bind.
Rationale: The uncomfortable finding is that the earlier fix is what made this reachable. resolvePaxRowIndex_ rebuilds the ENTIRE index on any miss, so the "not found" miss had been silently repairing every other pax's post-sort offsets on every signup. Write-through removed the miss and with it the accidental repair. The same epic (o39s.7) retired the Drive-modtime poll, the other backstop a sort would have tripped — the work-log's own o39s.4 entry names that poll as what the stale index was "rescued by today". Both safety nets went; write-through replaced only one of them. Not a regression in the sense of breaking something that worked: the sort-staleness bug was always latent, but two mechanisms had been masking it.
Outcome [developer-facing]: Identified why no test caught this — test_add_response_on_submit.js's makeGridSheet_ mock carries `sort: function() { /* row order doesn't matter for these tests */ }`, a no-op added in the SAME commit as the write-through fix. The fix and its blind spot shipped together, so every test of the insert-then-sort path has been running against a sort that does not sort. This is why the new test asserts on cache state after a sort rather than on row order.
Outcome [internal]: bd memory f3go30-tracker-sort-invalidates-roster-index rewritten to lead with the causal chain rather than only the invariant, plus the general rule it generalizes to — "write-through, not invalidate" (the o39s epic's principle) is only safe when you write through everything the operation changed; an insert changes one entry, the sort that follows changes all of them.
Outcome [internal]: Noted that the correct rule had already been reached twice elsewhere in this codebase and not applied here — the bonus-edit fix concluded a captured row position "is inherently unsafe to trust unchanged by save time" (findBonusRowByIdentity_), and TrackerEditTrigger.js guards a row whose live name does not match the cached index at that offset. The name-at-offset check existed in three places before this session; the two resolvers on identify's hot path were the gap.
Open: whether the four identity resolvers (lean/full x cold/from-handle) should collapse into one parameterized resolver was raised and left undecided. They were "kept parallel deliberately rather than shared, so each keeps its own purpose-built Axiom timing" — which bought per-path telemetry at the price of an invariant that must hold in four places. The shipped fix centralizes the rule, not the duplication. No bead filed; offered, not requested.

### Key Learnings:
A cache keyed on one property (name) storing a value derived from another (position) fails silently when the second changes without notifying the first — the stored answer stays syntactically valid and confidently wrong. The cheap structural defense is not better invalidation but a self-check at the point of use: the row must bear the name it was looked up by. The data is already in hand, so the check is near-free, and it converts a silent wrong answer into a logged, self-repairing one.
Axiom queries via tools/query_axiom.py that use --where with a `data.` field prefix fail with a 400 (invalid field) — the flattened event shape does not expose `data` as a queryable root. Piping such a query into `grep -c` swallows the error and returns 0, which reads exactly like a clean negative result. This nearly produced a false "no PROD events" finding in this session; filter with grep over the default output instead.

## 2026-07-20 01:40:00
_session 098f803e · v3 · 07-20_

### Objective 1: Verify F3Go30-xxy4 (activity_log: distinguish new signup from returning-PAX form lookup)
Rationale: Bead was already claimed and in_progress from a prior session; investigation found all 5 acceptance criteria already implemented and committed on this branch (commit 8e5a0e3, "Distinguish new signup from returning-PAX lookup in activity log (F3Go30-xxy4)") — `tools/activity_log.py` renders `[SIGNUP NEW]`/`[SIGNUP UPDATE]` from `signupWebapp.save` mode, names the PAX, states prior-month history from `findMostRecentPaxRecordForName_.done.found`, reports `signupWebapp.identify` as `[SIGNUP LOOKUP]` for both matched true/false, and `script/signupWebapp.js` stamps `f3Name`/`mode` on both save log calls. No further code change was needed this session.
Outcome [internal]: Confirmed all AC met against current code; ran full `npm test` suite — all tests pass.


## 2026-07-20 13:00:18
_session dc4307e8 · v3 · 07-20_

### Objective 1: Fix How it Works dark-mode contrast (F3Go30-dtr2)
Rationale: The How it Works content hardcoded light-only colors with no `prefers-color-scheme: dark` handling, unlike index.html and CheckinApp.html which already carry dark-mode CSS. The fix had to cover all three rendering surfaces — the standalone static-pages/src/how-it-works.html page and the injected fragments in script/SignupApp.html and script/CheckinApp.html — and survive tools/sync-how-it-works.js, so styling was added to the host templates/generator (not the synced Go30-Intro.md fragment, which only carries structural inline styles, no colors).
Outcome [user-facing]: static-pages/src/how-it-works.html generator (buildStandalonePage_ in tools/sync-how-it-works.js) now defines `--text`/`--bg` CSS vars with a dark override, regenerated the standalone page from it. script/CheckinApp.html's `#howBody` inline style switched from hardcoded `color:#333`/`border-top:#e8e0d0` to its existing `var(--text)`/`var(--border)` theme vars. script/SignupApp.html (which had zero dark-mode CSS infrastructure) gained a scoped `--how-*` variable set with a `prefers-color-scheme: dark` override, applied to `.how-btn`, `.how-section-head`, `.how-badge`, `#howCard`, and `#howBody`'s inline style — scoped only to the How-it-Works widget, not a full-page retheme.
Outcome [developer-facing]: Verified visually via Playwright (Pixel 7 mobile emulation, light + dark `colorScheme`) against the standalone page and the live SignupApp How-it-Works panel — text/background contrast confirmed readable in both themes. npm test passes with no failures (includes existing test_sync_how_it_works.js / test_build_static_pages.js coverage of the generator).


## 2026-07-20 00:00:00
_session 697fd97c · v3 · 07-20_

### Objective 1: F3Go30-k5fn.1 — server-side month enumeration + monthGrid action
Rationale: The static check-in calendar's month-to-month navigation (epic F3Go30-k5fn) needs the server to expose every TrackerDB month plus which of them a PAX is registered for, and a way to fetch an arbitrary month's day grid without a full identify — additive so the existing GAS CheckinApp identify consumer is unaffected.
Outcome [developer-facing]: Added `buildMonthNavigationPayload_dw_` (dashboardWebapp.js) — one TrackerDB read for `availableMonths` ({monthKey,label,startDateIso}, chronological), one Template-resident PaxDB read for `registeredMonthKeys`, only triggered from branches where f3Name is already a confirmed identity (full match or exact-both-fields PaxDB match) to preserve the existing anti-enumeration boundary; wired into all non-tokenInvalid `identify` response branches.
Outcome [developer-facing]: Added `handleMonthGrid_` + `monthGrid` doPost action — resolves the target month via `resolveDashboardMonth_`, the PAX's row via `resolvePaxRowIndex_` (PaxCache.js), and the day payload via `buildMonthGridEntries_`, with no reimplementation of any of the three; returns `no_tracker_for_date` for a month with no tracker and `registered:false` (not an error) when the tracker exists but the PAX has no row.
Outcome [developer-facing]: Added tests in test_dashboard_webapp.js covering chronological ordering, the single-PaxDB-read constraint, the anti-enumeration no-name-no-PaxDB-read guard, and all three monthGrid outcomes (no tracker / registered / unregistered). Full `npm test` passes unmodified for pre-existing suites.

### Key Learnings:
`resolveDashboardMonth_`'s calls to `resolveTrackerForContextDate`/`formatRegistrationMonth_` are bare globals with no require/module alias in dashboardWebapp.js — they work in the real GAS runtime (single global script scope) but throw ReferenceError under Node, silently swallowed by resolveDashboardMonth_'s own try/catch. No existing test ever exercised its success path; tests must set `global.resolveTrackerForContextDate`/`global.formatRegistrationMonth_` directly (matching test_mark_minus_one.js's established convention) to hit it. New code added its own require-based alias (`formatRegistrationMonth_dw_`) instead of relying on the bare global, to stay testable.

## 2026-07-20 00:00:00
_session c928b273 · v3 · 07-20_

### Objective 1: Client month navigation + signup gate in the static check-in calendar (F3Go30-k5fn.2)
Rationale: Extend static-pages/src/index.html's whole-month calendar with back/forward month navigation on top of F3Go30-k5fn.1's identify.availableMonths/registeredMonthKeys fields and the new monthGrid action, per the epic's navigation model — backward stops at the PAX's earliest registered month, forward reaches the latest existing tracker (unregistered forward months render a signup gate instead of an editable grid), and no client-side month-write logic is added since resolveCheckinDayTarget_ already resolves the explicit day's own month server-side.
Rejected: A bespoke signup UI for arbitrary target months was not built — instead the existing "Sign up for next month" wizard (openSignup_('next')) is reused as the signup-gate CTA, since k5fn.3's regression-test framing ("sign up for next month, then edit it") confirms the forward gate's real-world case is always the immediate next tracker month, and signupWebapp.js was explicitly out of scope for this bead.
Outcome [user-facing]: The advanced month calendar now has prev/next month arrows (reusing the existing .date-nav-btn styling); paging into a month the PAX isn't registered for shows a "You're not signed up for <month> yet" prompt with a signup button instead of an editable grid, and completing that signup flips the grid to editable in place, no page reload.
Outcome [developer-facing]: Added loadCalMonth_/applyCalGridPayload_/renderCalSignupPrompt_/navigateCalMonth_/renderCalMonthNav_ as the single seam all month transitions funnel through — every path (initial identify, arrow navigation, post-signup refresh) ends in the same renderCalendar_ used since F3Go30-th22, so no second calendar renderer was introduced (AC9). script/CheckinApp.html (the GAS single-month fallback) was left untouched per the epic's accepted-divergence decision.
Open: F3Go30-k5fn.3 (cross-month navigation test coverage + the a2hq roster-index regression test this forward gate's append→sort→resolve sequence provokes) is still open and depends on this bead.

## 2026-07-20 13:28:10
_session aaec880d · v3 · 07-20_

### Objective 1: Tests for cross-month navigation + a2hq roster-index regression (F3Go30-k5fn.3)
Rationale: k5fn.2's forward-gate signup flow drives the exact append→sort→resolve sequence that caused the F3Go30-a2hq cross-PAX identity leak, so this bead required a deliberate regression test proving the roster-index purge still guards it — not just reuse of the already-fixed code path (per the bead's stated risk and the bd memory f3go30-tracker-sort-invalidates-roster-index's TEST TRAP note about the pre-existing no-op sort mock).
Rejected: driving the regression test through the full handleSignupSave_ webapp handler (email sending, targetMonth resolution, full request/response plumbing) — no existing test exercised that handler at all, and the added setup cost would have obscured the actual mechanism under test. Used the same underlying production functions (patchPaxRosterIndex_, sortTrackerSheet_, resolvePaxRowIndex_) directly instead, in the identical append→patch→sort→resolve order.
Outcome [developer-facing]: Upgraded test/test_add_response_on_submit.js's makeGridSheet_ sort mock from a no-op to a real reordering sort (the TEST TRAP fix), then added an a2hq regression test that appends a new PAX, patches the roster index at the append offset, sorts (moving another PAX into that same offset), and asserts resolvePaxRowIndex_ resolves the new PAX to her correct post-sort row rather than the stale patched offset — verified to fail (reproducing the original leak) when the purge in sortTrackerSheet_ is temporarily reverted.
Outcome [developer-facing]: Added coverage for handleCheckinSubmit_'s cross-month write path (test/test_dashboard_webapp.js) — an explicit day outside the identity's anchored month persists to the correct OTHER month's tracker via resolveCheckinDayTarget_'s fallback, leaving the anchored month untouched.
Outcome [developer-facing]: Added executed (not just regex-matched) coverage for the static calendar's month-navigation model (test/test_static_page_client_invariants.js) — extracted the real F3Go30-k5fn.2 nav block out of static-pages/src/index.html and ran it via `new Function` (same JS realm, avoiding vm's cross-realm Array/deepEqual pitfall) against a minimal state/$/callApi harness: backward stop at the earliest registered month, forward stop at the latest existing tracker month, and the signup-gate vs monthGrid-fetch branch split on registration.
Outcome [developer-facing]: Added additive-field assertions to the existing full-fixture matched-identify test (test/test_checkin_token_inline_identify.js) confirming availableMonths/registeredMonthKeys (F3Go30-k5fn.1) appear alongside every pre-existing identify field without displacing any of them.
Outcome [internal]: monthGrid's no_tracker_for_date / registered:false coverage (AC2) was already present from F3Go30-k5fn.1's own test additions — verified rather than duplicated.
Open: Test coverage for AC1's client-side navigation model uses a hand-built DOM/network stub harness (no jsdom dependency in this repo) — sufficient to execute the real navigation logic, but not a substitute for a live-browser check of the actual click handlers.

### Key Learnings:
`vm.createContext` runs extracted browser JS in a separate V8 realm with its own Array/Object constructors — `assert/strict`'s deepEqual then fails on arrays the sandboxed code builds (e.g. `state.monthGrid = []`) even when their contents are identical, because deepStrictEqual also compares prototypes. Using `new Function(...)` instead keeps the same realm as the test file and avoids this entirely.

## 2026-07-20 (unattended session)
_session f8932217 · v3 · 07-20_

### Objective 1: Record ADR-019 (static origin primary for all front ends, GAS redirect-only)
Rationale: F3Go30-ys15 resolved (2026-07-20) that unreachable-host availability fallback is not a requirement, retiring the premise behind ADR-018's claim that the GAS signup page serves as an availability fallback. ADR-019 records the narrower decision this leaves in place — static origin primary for every PAX-facing front end, GAS reduced to redirect-only — without editing the Accepted, immutable ADR-018.
Outcome [developer-facing]: Added `adr/019-static-origin-primary-all-front-ends-gas-redirect-only.md` (Status: Accepted), scoped-superseding ADR-018's availability-fallback claim only, documenting `?static=0` as a developer/legacy escape hatch (not an availability guarantee) and noting the consequence for `F3Go30-wjpu` (loses one of two blocking justifications for removing `SignupApp.html`). Verified against the adr-quality-check skill (all 5 checks pass) and `npm test` (full suite green).
## 2026-07-20 14:14:03
_session de7e481c · v3 · 07-20_

### Objective 1: Reconcile identity-token-flow.spec.js with F3Go30-833s.11's GAS-to-static signup redirect (F3Go30-bkxg)
Rationale: .11 made bare `?cmd=signup` redirect to the static signup by default and rewired CheckinApp.html's own signup exits (signupDeepLinkUrl_) the same way, so every test in this spec that touched signup now landed on the static page's different DOM ids instead of the GAS ones it asserted against. The bead's own analysis (option c, "split into two describes") was adopted: one describe forces `&static=0` (buildStaticSignupRedirectUrl_'s documented opt-out) to keep driving the GAS-hosted SignupApp.html end to end as deliberate ADR-018 availability-fallback coverage; the other keeps the check-in-only tests plus rewrites the one test that follows check-in's own signupDeepLinkUrl_ hop into signup — that hop has no `static=0` opt-out of its own, so it always lands on the static origin on SIT, and the rewritten test now asserts only the handoff URL/landing (leaving the resulting UI to static-signup.spec.js's own "month-boundary" test).
Rejected: initially assumed the redirected static signup page would show a prefilled info step for the known-but-unregistered PAX (matching the old GAS behavior); live verification against SIT showed signupDeepLinkUrl_ only forwards targetMonth/autoStart, not f3Name/email, and localStorage doesn't cross the origin change, so the static page actually opens its own blank intro/identify step — the test assertion was corrected to match observed behavior rather than assumed parity.
Outcome [developer-facing]: All 7 tests in identity-token-flow.spec.js pass against live SIT (verified via `npx playwright test tests/playwright/identity-token-flow.spec.js`); `npm test` (unit suite) also passes unchanged.
Outcome [internal]: Discovered and fixed a second, pre-existing latent bug while making the first test reach further than before: SignupApp.html's post-save handoff (buildCheckinUrl_) has preferred the static check-in front end whenever configured since v2.4.0 (predates .11), but the spec's followTokenRedirect helper only recognized a GAS-shaped `cmd=checkin&id=` URL as "arrived," so it looped to timeout once the automatic top-redirect actually landed on the static origin. Fixed by widening the arrival check and adding appRootAfterCheckinHandoff() to pick GAS-iframe vs. bare-page locators depending on where the browser actually landed. This was inferred to be in-scope for the bead (a test-helper defect blocking AC2, not a separate product bug) rather than filed separately.

### Key Learnings:
signupDeepLinkUrl_ (CheckinApp.html) and buildCheckinUrl_ (SignupApp.html) both prefer their static counterpart unconditionally once STATIC_PAGES_BASE_URL_ resolves, with no per-request `static=0`-style opt-out of their own — only the bare `?cmd=signup` GAS entry point has that opt-out (buildStaticSignupRedirectUrl_, Utilities.js). Any future spec driving those two in-app hops needs to expect a cross-origin landing on SIT, not a GAS-relative one.

## 2026-07-20 14:29:32
_session d284be6b · v3 · 07-20_

### Objective 1: Extend GAS-to-static redirect to cmd=checkin and the home page (F3Go30-ubwl.2)
Rationale: The signup arrival redirect (F3Go30-833s.11) already carried old links to the static front end; the bead's explicit "reuse mandate" required generalizing that mechanism for check-in and home rather than copying it, so the tree ends up with exactly one window.top redirect renderer and one doGet-params-to-static-url forwarding implementation, per AC1/AC2.
Outcome [developer-facing]: Generalized `renderStaticSignupRedirect_` into `renderStaticRedirect_(staticUrl, {bodyLabel, title})` (script/WebApp.js) and factored `buildStaticSignupRedirectUrl_` into a shared `buildStaticRedirectUrl_(staticUrlBuilder, webAppBaseUrl, parameter)` (script/Utilities.js), with `buildStaticCheckinRedirectUrl_` as the check-in/home counterpart. Both `renderCheckinPage_` (script/dashboardWebapp.js) and `renderHomePage_` (script/WebApp.js) now redirect through these shared functions; home reuses the check-in builder since the static page's default (no-`cmd`) view is check-in.
Outcome [user-facing]: `?cmd=checkin` and the home route now hop PAX arriving on old GAS links to the static front end, carrying webapp/id/ns/contextDate; every redirect route appends `from=gas` (for the bookmark advisory, F3Go30-ubwl.3); `?static=0` still serves the GAS page on every route (inferred as unchanged fallback contract per ADR-018, verified via existing tests).
Outcome [developer-facing]: Updated test/test_signup_link_migration.js's literal expected-URL assertions to include the new `from=gas` suffix; full `npm test` suite passes (36 test files).
Open: AC8 (test coverage for the check-in identity path) is explicitly deferred to F3Go30-ubwl.4, which is blocked on this issue — no new Playwright coverage was added here since ubwl.4 owns it.

## 2026-07-20 (unattended session)
_session 05e7f519-20d9-47c2-a1e4-ddbf4b09e95a · v3 · 07-20_

### Objective 1: "This link moved" bookmark advisory on from=gas arrivals (F3Go30-ubwl.3)
Rationale: The GAS-to-static redirects (F3Go30-ubwl.2) append `from=gas` so the static page can tell a PAX their old GAS link moved, but per the bead the advisory must live on the static page, not the GAS interstitial — "you cannot bookmark a page you are not on." Once shown, the marker must be stripped via `history.replaceState` so a fresh bookmark from the address bar doesn't carry it forward and nag forever on a URL that never moved.
Outcome [user-facing]: Added a dismissible, page-level advisory banner (`#gasMovedBanner`) to static-pages/src/index.html, shown only when `?from=gas` is present and not previously dismissed; dismissal persists via localStorage (`go30GasMovedDismissed`) so a returning PAX isn't nagged every visit. Banner sits above `.wrap` (non-blocking, no delay to the check-in grid) and reuses the existing `--warn-*` CSS custom properties (F3Go30-dtr2's shared theme mechanism) — no new hardcoded colors.
Outcome [developer-facing]: Live-verified all five behavioral ACs with a local static server + Playwright (banner shows/hides, `from` stripped from the address bar without reload, dismissal persists across navigations). That verification caught a real CSS cascade bug — `.gas-moved-banner { display: flex }` and `.hidden { display: none }` have equal specificity, and since `.gas-moved-banner` was declared later in the stylesheet it silently won, so dismissing the banner never actually hid it. Fixed by moving the flex layout to a non-conflicting `.gas-moved-banner-inner` child so `.hidden`'s toggle on the outer element is never fighting a same-specificity rule. Rebuilt static-pages/dist/{sit,prod}; full `npm test` suite passes (36 test files) unchanged.
Open: AC-level Playwright test coverage for this banner is explicitly owned by the blocked-on issue F3Go30-ubwl.4, not added here.

### Key Learnings:
Two classes with equal specificity (0,1,0) applied to the same element resolve by stylesheet source order, not by which one reads as more "authoritative" (e.g. a `.hidden` utility class). A `display` property set directly on a component's own class can silently outrank `.hidden` if that component's rule happens to be declared later in the file — this is invisible in a code read and only surfaces by actually toggling the class in a browser.

## 2026-07-20 (unattended session)
_session 5608e515-ae82-4009-9684-bb06b1224b73 · v3 · 07-20_

### Objective 1: Tests + docs for the GAS-to-static redirect of check-in and home (F3Go30-ubwl.4)
Rationale: F3Go30-ubwl.2 (check-in/home redirect) and F3Go30-ubwl.3 (bookmark advisory) shipped ahead of this bead with their own test coverage explicitly deferred here — ubwl.2's own work-log entry flags "AC8 (test coverage for the check-in identity path) is explicitly deferred to F3Go30-ubwl.4." This session closed that gap: unit coverage for the generalized redirect builder/renderer, execution-level coverage for the bookmark advisory, and doc updates, per the bead's AC.
Outcome [developer-facing]: Extended test/test_signup_link_migration.js with buildStaticCheckinRedirectUrl_ coverage (identity-param forwarding, static=0 opt-out, no-webapp decline) and structural guards (grep-on-source assertions) proving exactly one buildStaticRedirectUrl_ and one renderStaticRedirect_ implementation back all three routes (signup/check-in/home), plus execution-level tests of renderHomePage_/renderCheckinPage_'s redirect-vs-fallback branching. Fixed a pre-existing test (testHomePageSignupLinkIsStatic) that had gone stale the moment ubwl.2 shipped — it called renderHomePage_({parameter:{}}) expecting the real GAS template, but a bare arrival now redirects by default; added static=0 to reach the fallback path it was actually testing.
Outcome [developer-facing]: Extended test/test_static_page_client_invariants.js with a `Function`-extraction harness (same technique as the existing cal-nav harness) that runs static-pages/src/index.html's actual gasMovedBanner init block against fake $/localStorage/history/location stand-ins — proves banner show/hide, from=gas stripping via history.replaceState, dismissal persistence, and the previously-dismissed suppression path execute correctly, not just pattern-match.
Outcome [developer-facing]: Reconciled tests/playwright/identity-token-flow.spec.js for ubwl.2's checkin-route redirect, which the pre-existing (bkxg-reconciled) spec didn't anticipate — every bare `?cmd=checkin` navigation in the "Check-in flow" describe now forces `&static=0` (mirroring the signup describe's existing pattern) to keep exercising the GAS-hosted CheckinApp.html; the "Not you?" reset test was rewritten because its link's href has no static=0 of its own, so a click now hands off to the static front end instead of reloading the GAS identify form in place — same shape as the existing known-but-unregistered signup handoff test. Not live-verified against SIT (no live deployment access in this unattended session); reasoned from source (renderCheckinPage_'s doGet-only redirect check, CheckinApp.html's notYouLink href construction, doPost bypassing the redirect entirely).
Outcome [developer-facing]: docs/DESIGN.md gained a "GAS reduced to redirect-only, all three routes" entry describing the shared buildStaticRedirectUrl_/renderStaticRedirect_ mechanism and the bookmark advisory; docs/OPERATIONS.md gained a `?static=0` section clarifying it's a developer/legacy escape hatch, not an unreachable-host fallback (per the ys15/ADR-019 decision); docs/CHANGELOG.md Unreleased gained a user-facing bullet for the check-in/home redirect + bookmark advisory.
Outcome [developer-facing]: `npm test` passes (37 test files, all green).
Open: The reconciled identity-token-flow.spec.js changes are inferred from reading renderCheckinPage_/CheckinApp.html/doPost dispatch source, not confirmed by an actual Playwright run against live SIT — a human should run `npx playwright test tests/playwright/identity-token-flow.spec.js` against SIT before trusting this spec's new assertions (particularly the reworked "Not you?" handoff test) at face value.
## 2026-07-21 02:20:00
_session 5e6ce17f-b5de-4b19-a66c-263eaae417d3 · v3 · 07-20→07-21_

### Objective 1: Run the regression suite, deploy to SIT, and run the live suite with screenshots
Rationale: Routine SIT validation pass before further PWA work — verify the branch is deployable and the live playwright suite still holds against a fresh deploy.
Rejected: proceeded straight to `npm run deploy:sit`, but the developer stopped it to ask "does the static pages push both sit and prod static pages? we should only be doing the sit ones for the sit deployment." Investigation confirmed `tools/publish-static-pages.js`'s build/copy stages were already env-scoped, but `git status --porcelain`/`git add dist` in the sibling F3Static repo were not — a SIT deploy could commit and push whatever was sitting modified under `dist/prod/`. Fixed to scope both to `dist/<env>` before continuing.
Outcome [developer-facing]: `tools/publish-static-pages.js` now scopes the F3Static dirty-check and staging to the env(s) being published, not the whole `dist/` tree.
Outcome [internal]: Regression suite green (38 files), SIT deployed to v2.4.3.4, F3Static commit verified to touch only `dist/sit`.

### Objective 2: Fix playwright specs left stale by the GAS→static redirect  [accreted]
Transition: the first live SIT run surfaced 4 unrelated spec failures, all traced to the `F3Go30-ubwl.2` GAS→static redirect landing after these specs were last updated — natural continuation of getting the live suite green, not a new goal chosen independently.
Rationale: `checkin-advanced-grid.spec.js` (17 tests) and `demo-screenshots.spec.js` navigated to bare `?cmd=signup`/`?cmd=checkin`, which now redirect; `static-checkin.spec.js`'s GAS regression guard hit the same redirect; `identity-token-flow.spec.js`'s "not you?" test waited for only one of two navigations. Per developer direction, `checkin-advanced-grid` and `demo-screenshots` were retargeted to drive the static front end directly (the screens a real PAX now sees), while `static-checkin`'s guard kept `&static=0` since its whole purpose is exercising the GAS fallback. Developer also asked for a new demo screenshot of the redirect-landing bookmark banner, which was not in the original set.
Rejected: an earlier `grep -c 'id="x"'` ID-presence check was used to decide the retarget was mechanical; this later proved wrong for `#howBtn` (exists on the static page, but inside `#step-dashboard`, not the signup intro) — presence isn't equivalence, corrected during objective 3's redesign pass.
Outcome [developer-facing]: 4 specs repaired and passing; `checkin-advanced-grid.spec.js` and `demo-screenshots.spec.js` rewritten against the static front end using the established `static-checkin.spec.js` server-serving pattern.
Outcome [user-facing]: New screenshot `00-gas-redirect-bookmark-banner.png` documents the "this link has moved" advisory a real PAX sees on an old bookmark.

### Objective 3: Fix the GAS→static redirect itself, which could never fire automatically  [accreted]
Transition: developer reported a browser console error mid-review of the new screenshots — "An iframe which has both allow-scripts and allow-same-origin... has no user activation... Uncaught SecurityError" — which turned a test-plumbing fix into a real product defect investigation.
Rationale: `renderStaticRedirect_` (`WebApp.js`) called `window.top.location.replace(...)` on page load inside an iframe sandboxed `allow-top-navigation-by-user-activation`. A script running on load has no user gesture, so Chrome refuses the navigation for every visitor, not just under Playwright — confirmed this was NOT the headless-Chromium artifact the existing test comments (borrowed from a different, click-initiated redirect, `attemptTopRedirect_`) assumed. The "Tap here if nothing happens" link was therefore the only path any PAX ever had, framed as a rare fallback. Developer chose "redesign the interstitial" over relinking TinyURLs or just documenting the defect: made the tap deliberate ("<label> has moved" heading, a real Continue button) and removed the dead `replace()` call so it stops throwing.
Rejected: meta-refresh or `window.location` (navigating the sandbox iframe alone) was considered and rejected — it would leave the PAX on script.google.com with the static page trapped inside it, defeating the bookmarkability the whole migration exists for.
Outcome [user-facing]: Old GAS bookmark/link arrivals now land on an honest "has moved" screen with one clear Continue tap, instead of broken copy promising an automatic redirect that could never happen.
Outcome [developer-facing]: `test_signup_link_migration.js` assertions updated from asserting the dead `location.replace(...)` call to asserting the `href`/`target="_top"` link and the *absence* of `location.replace(`; `docs/DESIGN.md` and `docs/CHANGELOG.md` updated to describe the one-tap mechanism and distinguish it from the unrelated `attemptTopRedirect_` identify→personal-link swap. Deployed to SIT (v2.4.3.5) and re-verified via full live suite (43/45 passing; the 2 failures reproduced as flaky-in-isolation, passing individually).
Open: 2 flaky tests (`checkin-advanced-grid.spec.js:126`, `static-checkin.spec.js:389`) pass in isolation but failed under full-suite contention — not investigated further, plausibly increased shared-fixture load from retargeting two specs onto the same static page. Orphaned screenshot `06b-checkin-known-not-enrolled.png` (the static flow has no intermediate redirect screen the old GAS flow had) was left in place, not deleted, pending developer confirmation. Defect not yet filed in bd. Nothing in this session is committed to git.

### Key Learnings:
An iframe sandboxed `allow-top-navigation-by-user-activation` blocks a `window.top.location.replace()`/`.href` call fired from an on-load `<script>` for every visitor, not intermittently — there is no user gesture to inherit at load time, so this is a hard platform constraint, not a flaky one. A click-initiated redirect (`attemptTopRedirect_`) is a genuinely different case: it can retain "sticky" user activation across an async gap in a real browser, failing only under synthetic/programmatic clicks (e.g. Playwright's), which is why the two mechanisms need different fallback handling and must not share doc language.
## 2026-07-21 11:20:00
_session 7e2af8b6-3d77-4ea5-8148-9629c2edddba · v3 · 07-21_

### Objective 1: Drop the now-redundant ?webapp= param from GAS-generated static-page links
Rationale: Developer noticed PR #4 review feedback had only removed the redundant `?webapp=` override from onOpen.js's About-dialog links (commit 5d07e9c), while SIT's GAS→static redirect still carried it. Confirmed the static build already bakes each env's own `/exec` URL in as its default backend (F3Go30-6bl6) and `resolveStaticCheckinBaseUrl_` already routes to the matching sit/prod static path for that same env — so a GAS-generated link's own `?webapp=` value is always redundant. Tracked as F3Go30-9jsa (no existing issue covered it; the ubwl epic that built the redirect was already closed) and closed via TDD (red: rewrote test_static_signup_url.js/test_signup_link_migration.js expectations first; green: implementation).
Rejected: none — developer's diagnosis was correct on inspection.
Outcome [developer-facing]: `buildStaticCheckinUrl_`/`buildStaticSignupUrl_` (script/Utilities.js) no longer emit `&webapp=...`; the static page's own client-side override is untouched so old bookmarks and unbuilt local/Playwright testing keep working. Updated test_static_signup_url.js, test_signup_link_migration.js, test_signup_email.js and stale `?webapp=` comments in CheckinApp.html, dashboardWebapp.js, DESIGN.md, CONTEXT.md, OPERATIONS.md.
Outcome [internal]: Developer flagged the fix itself introduced duplicate param-building logic between the two builders (CLAUDE.md's "no duplicated logic" rule) — extracted a shared `joinQueryParams_` helper so both builders build their query string through one implementation.

### Objective 2: Close out PR #4 review — address remaining comments, deploy to SIT, run full regression  [accreted]
Transition: Developer asked to review/address any remaining PR comments, deploy, and run full regression as a natural next step once the ?webapp= work was committed and pushed — a distinct goal (PR closure + live verification) rather than a continuation of the ?webapp= cleanup itself.
Rationale: Four review threads existed; three (execFileSync, PaxCache stale-bind, About-dialog webapp= text mismatch) already had "Fixed in 5d07e9c" replies but were never marked resolved on GitHub. A fourth, newer Copilot comment (handleMonthGrid_ treating "registered" as "has a Tracker row" instead of mirroring resolveCheckinIdentityLean_'s non-DELETED-Responses-row definition) had no reply at all.
Outcome [developer-facing]: Replied to and resolved all four PR #4 review threads. Fixed handleMonthGrid_ (dashboardWebapp.js) to also require a live (non-DELETED) Responses row before returning `registered:true`, mirroring resolveCheckinIdentityLean_'s DELETED-blanking roster-index mapping; added testHandleMonthGridDeletedResponsesRowIsNotRegisteredDespiteTrackerRow (test_dashboard_webapp.js) to cover it.
Outcome [internal]: First SIT deploy (v2.4.3.10) + live Playwright regression (checkin-advanced-grid, identity-token-flow, static-signup, static-checkin, gaslogger — 39/42) surfaced a real regression from Objective 1: SignupApp.html's `buildCheckinUrl_` assumed `STATIC_CHECKIN_BASE_URL_` always already had a query string (true only while `?webapp=` was unconditionally present) and blindly appended `&id=...`, producing a malformed `.../sit/&id=...` link — caught as `identity-token-flow.spec.js`'s "current-month signup mints a token and redirects into check-in" timing out. Fixed to pick `?` vs `&` based on whether the base URL already has a `?`, same pattern `buildStaticRedirectUrl_` already used server-side. Redeployed (v2.4.3.11) and reran the full live suite clean (80/81 — the sole non-pass, gaslogger.spec.js, is a pre-existing local `SCRIPT_ID_PROD`-unset config gap, unrelated to this branch).
Open: gaslogger.spec.js's `SCRIPT_ID_PROD not set in local.settings.json` gap not investigated/fixed — pre-existing, orthogonal to this session's work.

### Key Learnings:
A refactor that removes an "always-present" query param from a URL-builder is a breaking change for every caller that assumed a leading `?`/`&` state from that guarantee — grep for every call site's own concatenation logic, not just the builder's own tests, before trusting a green unit-test suite; the actual break here only surfaced under live Playwright regression.

## 2026-07-21 10:51:49
_session 2e024404 · v3 · 07-21_

### Objective 1: Rework checkin page TODAY/YESTERDAY status copy, add grace-period-aware YESTERDAY messaging, and center the Bonus/Tracker header icons
Rationale: The pending-state copy read as flat status text ("No check-in yet") rather than inviting a response, and YESTERDAY gave no urgency signal as the grace period elapsed. User asked for: TODAY pending → "How did you do today?"; TODAY/YESTERDAY checked-in states → a random line pulled from the Inspire quote pool instead of a static string; YESTERDAY pending before 10am → "Not checked in yet" in yellow; at/after 10am → "Check in for yesterday, you're running late" in bold red. Separately, the header's chalice (Bonus) and chart (Tracker) button icons weren't visually centered in their 32×32 buttons.
Rejected: considered inventing a fresh quote-pool mechanism, but reused the existing `LINES`/`pick()` pattern already prototyped (unshipped) in `static-pages/src/inspire/index.html` rather than duplicating a new one.
Outcome [user-facing]: `script/CheckinApp.html` and `static-pages/src/index.html` (the live front end real check-in traffic actually redirects to — discovered mid-task, so both copies of the duplicated status-rendering logic were updated) now show the new TODAY/YESTERDAY copy, grace-period color coding (`.status-warn`/`.status-late`, reusing existing `--warn-fg`/`--danger` theme vars), and randomized Inspire-style lines on checked-in states. `.more-btn` now centers its icon via flex instead of relying on default button UA padding.
Outcome [developer-facing]: Flagged the pre-existing duplication between `script/CheckinApp.html` and `static-pages/src/index.html` (no sync tooling links them, per standing CLAUDE.md code-quality note) rather than silently patching around it.
Outcome [internal]: Deployed to SIT twice (v2.4.3.12 then v2.4.3.13, the second to pick up the static-page edit made after the first deploy) and ran the live Playwright suite (`checkin-advanced-grid`, `static-checkin`, `identity-token-flow` — 38 tests). First pass: 35 passed, 3 failed (one in the unrelated signup iframe `#step-done`, two in checkin/static-checkin identify redirects); all 3 passed clean on isolated retry, confirming flakiness rather than a regression from this change.
Open: No test currently asserts on the new copy/colors directly (existing specs only exercise status transitions generically) — a manual click-through on SIT would be the only way to visually confirm the new strings/colors render as intended.

### Key Learnings:
The GAS-hosted `CheckinApp.html` is no longer the page real PAX traffic lands on for check-in — a bare `?cmd=checkin` redirects out to the static front end (`static-pages/src/index.html`), which ships an independently-maintained duplicate of the same status-rendering JS/CSS. Any future checkin-page UI change needs to be applied to both files until that duplication is resolved.
