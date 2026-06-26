Results of work last session OPEN.md 2026-06-25 16:04:03

All code changes are committed and deployed to SIT (v2.2.28).

What's done:
- TRACKER_SHEET_INDEX_ drives both copy and hide/delete logic — no more hardcoded lists
- Responses is now copied from the template (Hidden), preserving template column order
- "Form Responses 1" is deleted after setDestination instead of being renamed
- onFormSubmitLocked_ resolves columns from the form destination sheet, then maps the processed row into Responses column order via new appendToResponsesSheet_, then deduplicates Responses
- All 15 tests pass

Waiting on you: Open the SIT template spreadsheet and run Extensions → Go30 Admin → Create New Tracker (the copyAndInit menu item) to create a new smoke tracker. Once it's created, run:

node tools/callWebapp.js getSmokeStatus --env sit

to get the smokeTrackerId, then continue from step 5 in OPEN.md which is below in this file

in other session, script/SignupApp.html was updated with additional details on 'How it works' which should go in the next commit stage.
in another session, we reverted and went back from copySpreadsheetwithoutScript to simply copying the spreadsheet, and living with the bound script being bound to the new spreadsheet.  We also refactored `copyAndInit_` and `autoGenerateNextMonthTracker_`.
in another session we made trash cleanup connected forms.

# Open Work — F3Go30

_Saved 2026-06-25 for context handoff. Delete this file when work is complete._

---

## Current State

Smoke test re-run pending. Old smoke tracker trashed and smoke mode reactivated on SIT.
Bug 3 fix deployed to SIT (v2.2.28). Waiting for human to run `copyAndInit` from SIT template.

**SMOKE_MODE:** active on SIT  
**SMOKE_TRACKER_ID:** null (cleared — new tracker not yet created)  

---

## Bugs Found During Smoke Test

### Bug 1 — `getSheet` always read template, ignored `sheetId` (FIXED, deployed)
`getSheet` used `getActiveSpreadsheet()` regardless of payload. Now accepts optional `sheetId`.

### Bug 2 — `autoGenerateNextMonthTracker_` ignored smoke mode (FIXED, not committed)
Did not write `SMOKE_TRACKER_ID` or append ` (Smoke)` to nameSpace. Fixed in current diff.

### Bug 3 — `#REF!` errors in Goals by HIM in new tracker copies (ROOT CAUSE IDENTIFIED, NOT FIXED)
Root cause: `copySpreadsheetWithoutScript_` excludes Responses from the copy. Instead,
`form.setDestination()` creates a fresh Responses sheet with form-question column order.
The form's question order has drifted from the template Responses column order:

**Template Responses (14 cols) vs new tracker Responses (13 cols):**

| Col | Template | New Tracker (form order) |
|-----|----------|--------------------------|
| 1 | Timestamp | Timestamp |
| 2 | Email Address | Email Address |
| 3 | Are you currently participating in Go30? | Are you currently participating in Go30? |
| 4 | F3 Name | F3 Name |
| 5 | Team type | **Team** ← swapped |
| 6 | Team | **Team type** ← swapped |
| 7 | Goal or other team name | Goal or other team name |
| 8 | WHO do you ultimately want to become? | WHO do you ultimately want to become? |
| 9 | WHAT is your Go30 Challenge? | WHAT is your Go30 Challenge? |
| 10 | HOW are you going to be successful this month? | HOW are you going to be successful this month? |
| 11 | Cell Phone Number | Cell Phone Number |
| 12 | NAG email? | NAG email? |
| 13 | Constructive Comments | **Success Story** ← shifted |
| 14 | Success Story | _(missing)_ |

Goals by HIM references Responses by column position (letter), so swapped/missing columns
cause `#REF!`.

**Agreed fix:**
1. Copy Responses from the template as-is (remove exclusion from `copySpreadsheetWithoutScript_`)
2. Keep the copied Responses as the authoritative sheet — do NOT rename "Form Responses 1" to "Responses"
3. Delete "Form Responses 1" after `form.setDestination()` creates it
4. The form writes to "Form Responses 1" (wherever `setDestination` puts it); the `onFormSubmit` trigger
   reads from `e.range` (form-question order) and copies the processed row into "Responses"
   (template column order) after all phases complete
5. Goals by HIM reads from "Responses" (stable template columns) ✓

**Trigger change needed in `addResponseOnSubmit.js` `onFormSubmitLocked_`:**
- Resolve columns from `e.range.getSheet()` (the form destination sheet), NOT from `'Responses'`
- After Phase 3 (team promotion), map the processed `formResponses` array into "Responses" column order
  and append a row to "Responses"
- Dedup "Responses" using the appended row number
- `maybeReuseLastMonthsGoals_` should be passed `e.range.getSheet()` as the responses sheet
  (since that's where the submitted row lives for in-place reuse updates)

---

## Sheet Index — SIT Template (needs your edits)

When copying to a new tracker spreadsheet, the Tracker disposition column below identifies what to do with each sheet in the new tracker.
`Delete` = remove from tracker copy (template-only sheets).  
`Hidden` = copy but hide in tracker.  
`Visible` = copy and keep visible.  
All Tracker disposition is to be deleted from the tracker.
Make no changes to the SIT or Template sheets based on this.

| # | Sheet | Hidden in template | Tracker disposition | Notes |
|---|-------|:-----------------:|---------------------|-------|
| 1 | Tracker | No | Visible | Primary PAX scoring grid |
| 2 | Config | No | Hidden | Runtime config |
| 3 | ListDB | No | Delete | AO/goal lists for signup webapp |
| 4 | Links | No | Delete from template | Old name for TrackerDB? |
| 5 | TrackerDB | No | Delete | Template-only — all tracker history |
| 6 | Inspiration | Yes | Hidden | Referenced by onOpen |
| 7 | Bonus Tracker | No | Visible | Bonus scoring |
| 8 | Periods | Yes | Hidden | Lookup date to week number periods |
| 9 | Controls | No | Hidden | Bonus Types used in Tracker sheet and Bonus calculation |
| 10 | Team Score | No | Visible | Derived team scores |
| 11 | Responses | No | Hidden | Form submission store — copy from template |
| 12 | PaxDB | No | Delete | Template use for cross-tracker PAX history |
| 13 | Pivot Table 22 | No | Delete | Old pivot — keep or delete? |
| 14 | HIM Score | No | Visible | Individual chart/progress |
| 15 | Goals by HIM | No | Visible | Formula sheet; references Responses by column position |
| 16 | UBonus Tracker | Yes | Hidden | Formulas for Bonus calculations |
| 17 | Goals by AO | No | Visible | Goals organized by AO; references Responses |
| 18 | FunFacts | No | Hidden | Nag email fun facts |
| 19 | Help | No | Visible | Operator help |
| 20 | Activity | Yes | Delete | Audit log |

---

## Planned Code Changes — DONE (v2.2.28)

### 1. `copySpreadsheetWithoutScript_` ✓ — driven by TRACKER_SHEET_INDEX_
### 2. `hideInternalSheets_` ✓ — driven by TRACKER_SHEET_INDEX_
### 3. Delete "Form Responses 1" ✓ — both copyAndInit_ and autoGenerateNextMonthTracker_
### 4. `addResponseOnSubmit.js` ✓ — appendToResponsesSheet_ maps form row → Responses column order

## Smoke Workflow — Next Steps

Smoke mode is active on SIT. Old tracker has been torn down (trashed).

```bash
# Step 3: (MANUAL) Run copyAndInit from SIT template spreadsheet menu
# Step 4: After tracker is created, get its ID:
node tools/callWebapp.js getSmokeStatus --env sit
# Step 5: Sign up a test PAX
node tools/callWebapp.js identify --cmd signup --env sit \
  --body '{"f3Name":"SmokeTest","email":"smoke@example.com"}'
# Step 6: Verify Tracker sheet (replace SMOKE_TRACKER_ID with value from getSmokeStatus)
node tools/callWebapp.js getSheet --env sit \
  --body '{"sheetId":"<SMOKE_TRACKER_ID>","sheetName":"Tracker"}'
# Step 7: Human: confirm spreadsheet + Goals by HIM has no #REF! errors → proceed
# Step 8: Teardown
node tools/callWebapp.js cleanupTracker --env sit \
  --body '{"sheetId":"<SMOKE_TRACKER_ID>","trashSpreadsheet":true}'
node tools/callWebapp.js setScriptProperties --env sit \
  --body '{"properties":{"SMOKE_MODE":"","SMOKE_TRACKER_ID":""}}'
# Step 9: Confirm clean
node tools/callWebapp.js getSmokeStatus --env sit
```

---

