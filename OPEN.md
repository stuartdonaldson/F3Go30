# Open Work — F3Go30

_Saved 2026-06-25 for context handoff. Delete this file when work is complete._

---

## Current State

Smoke test is mid-run on SIT. A smoke tracker exists with a SmokeTest PAX row but
`#REF!` errors in Goals by HIM because Responses column order in the new tracker
doesn't match what the template formulas expect.

**Live smoke tracker:** `1iaZ4Udx2oMT5JP-x6oEg1Uc-0Zaxca-N81oBWXVW9xs`  
**SMOKE_MODE:** active on SIT  
**SMOKE_TRACKER_ID:** set to above ID  

All commits are pushed except for the uncommitted diffs below.

---

## Uncommitted Changes (not yet committed or tested)

| File | Change |
|------|--------|
| `script/WebApp.js` | Added `listSheets` action; `getSheet` now accepts optional `sheetId` to read non-template spreadsheets |
| `script/CreateNewTracker.js` | `autoGenerateNextMonthTracker_` now writes `SMOKE_TRACKER_ID` and appends ` (Smoke)` to nameSpace when smoke mode is active; `copySpreadsheetWithoutScript_` updated to always copy hidden sheets (interim — see work below) |
| `CLAUDE.md` + `docs/OPERATIONS.md` | Smoke workflow step 5 now passes `sheetId` to `getSheet` |

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

Edit the **Tracker disposition** column. Options: `Visible`, `Hidden`, `Delete`.

`Delete` = remove from tracker copy (template-only sheets).  
`Hidden` = copy but hide in tracker.  
`Visible` = copy and keep visible.  

| # | Sheet | Hidden in template | Tracker disposition | Notes |
|---|-------|:-----------------:|---------------------|-------|
| 1 | Tracker | No | Visible | Primary PAX scoring grid |
| 2 | Config | No | Hidden | Runtime config |
| 3 | ListDB | No | Hidden | AO/goal lists for signup webapp |
| 4 | Links | No | ? | Old name for TrackerDB? |
| 5 | TrackerDB | No | Delete | Template-only — all tracker history |
| 6 | Inspiration | Yes | Hidden | Referenced by onOpen |
| 7 | Bonus Tracker | No | Visible | Bonus scoring |
| 8 | Periods | Yes | ? | Unknown — likely formula lookup |
| 9 | Controls | No | ? | Unknown — formula inputs? |
| 10 | Team Score | No | Visible | Derived team scores |
| 11 | Responses | No | Hidden | Form submission store — copy from template |
| 12 | PaxDB | No | Delete | Template-only — cross-tracker PAX history |
| 13 | Pivot Table 22 | No | ? | Old pivot — keep or delete? |
| 14 | HIM Score | No | Visible | Individual scores |
| 15 | Goals by HIM | No | Visible | Formula sheet; references Responses by column position |
| 16 | UBonus Tracker | Yes | ? | Hidden in template — likely formula dependency |
| 17 | Goals by AO | No | Visible | Formula sheet; references Responses |
| 18 | FunFacts | No | Hidden | Nag email fun facts |
| 19 | Help | No | Visible | Operator help |
| 20 | Activity | Yes | Hidden | Audit log |

---

## Planned Code Changes (not started)

### 1. `copySpreadsheetWithoutScript_` — drive from sheet index
Replace heuristic exclusion logic with the sheet index above.
- Copy sheets marked `Visible` or `Hidden`; skip sheets marked `Delete`
- Restore hidden state after copy
- Responses is now `Hidden` → gets copied (fixes Bug 3)

### 2. `hideInternalSheets_` — replace `visibleAllowList` with sheet index
Currently hardcoded. Should derive from the same index.

### 3. `copyAndInit_` and `autoGenerateNextMonthTracker_` — don't rename "Form Responses 1"
After `form.setDestination()`, delete "Form Responses 1" instead of renaming to "Responses".

### 4. `addResponseOnSubmit.js` — trigger copies processed row into Responses
See Trigger change needed section above.

### 5. Smoke workflow — teardown current smoke tracker, re-run after fixes deployed
After all code changes deployed:
```bash
node tools/callWebapp.js cleanupTracker --env sit \
  --body '{"sheetId":"1iaZ4Udx2oMT5JP-x6oEg1Uc-0Zaxca-N81oBWXVW9xs","trashSpreadsheet":true}'
node tools/callWebapp.js setScriptProperties --env sit \
  --body '{"properties":{"SMOKE_MODE":"","SMOKE_TRACKER_ID":""}}'
# Then re-run full smoke from step 1
```

---

## Refactor Note (file separately when ready)

`copyAndInit_` and `autoGenerateNextMonthTracker_` share ~150 lines of tracker creation
logic. Suggested refactor: extract `createTrackerSpreadsheet_(options)` with a `notifyFn`
callback for the notification difference (sidebar vs email). File as a separate bd issue
after smoke test passes.
