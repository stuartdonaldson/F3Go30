
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
