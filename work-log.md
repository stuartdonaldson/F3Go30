
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
