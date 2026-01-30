# Script folder review (errors + next steps)

## Summary
- Reviewed all files under the script folder for potential runtime errors, logic issues, and maintainability gaps.
- Items below are grouped into potential errors/risks and recommended next steps.

## Potential errors / risks to validate
1. initSheets signature mismatch when called without arguments
   - File: [script/macros.js](script/macros.js)
   - `initNewMonth()` calls `initSheets()` with no parameters, but `initSheets(newSpreadsheet, startDate)` expects both arguments in [script/CreateNewTracker.js](script/CreateNewTracker.js). This will throw at runtime if `startNewMonth()` is used.

2. Range size can become invalid when the destination sheet has fewer than 4 rows
   - File: [script/addResponseOnSubmit.js](script/addResponseOnSubmit.js)
   - `getRange(4, 1, destinationSheet.getLastRow() - 3, 1)` will throw if `getLastRow() < 4`. Same risk in the sort range.

3. Active Form may be null for spreadsheet-bound scripts
   - File: [script/FORMCONFIRMATIONMESSAGE.js](script/FORMCONFIRMATIONMESSAGE.js)
   - `FormApp.getActiveForm()` can return null in bound scripts. The code comments already note this risk.

   Note: This file (and [script/formManager.js](script/formManager.js)) contains experimental, untested work-in-progress for programmatic form generation/copying to help bootstrap new regions. It is currently unused and should be treated as dead code until a viable strategy is finalized.

4. Experimental import/export has multiple breaking gaps
   - File: [script/formManager.js](script/formManager.js)
   - Image export stores a blob, but JSON serialization cannot carry blobs; import expects `imageUrl` which is never exported.
   - Dropdown item type check uses `FormApp.ItemType.DROP_DOWN` (likely invalid; Apps Script uses `LIST`).
   - Validation export stores help text, but import tries to use it as a regex pattern.
   - File upload item method names may not match Apps Script API (`setAllowedFileTypes` vs `setAcceptableFileTypes`).

5. NoticePrompt blocks on empty string responses
   - File: [script/NotificationSBCode.js](script/NotificationSBCode.js)
   - `while (!response)` treats empty string as “no response,” so a user can’t submit an intentionally blank value.

## Improvements / next steps
1. Add guard checks for missing sheets and empty data ranges
   - File: [script/addResponseOnSubmit.js](script/addResponseOnSubmit.js)
   - Before reading ranges or sorting, check for null sheet references and ensure computed row counts are $\geq 1$.

2. Normalize trigger naming and cleanup
   - Files: [script/macros.js](script/macros.js), [script/markMinusOne.js](script/markMinusOne.js), [script/addResponseOnSubmit.js](script/addResponseOnSubmit.js)
   - Consider a single “initialize triggers” path and remove unused or legacy helpers to reduce confusion.

3. Improve form confirmation setup by passing explicit form reference
   - File: [script/FORMCONFIRMATIONMESSAGE.js](script/FORMCONFIRMATIONMESSAGE.js)
   - Prefer `FormApp.openByUrl(spreadsheet.getFormUrl())` or pass the form object into `setGo30ConfirmationMessage()` so it works in bound scripts.

4. Finish or disable the experimental form export/import
   - File: [script/formManager.js](script/formManager.js)
   - Either complete serialization (including images/validation) or mark functions as disabled/hidden to avoid accidental use.

5. Add error handling for URL shorteners
   - File: [script/urlShortener.js](script/urlShortener.js)
   - Check non-200 responses, parse error payloads, and surface actionable messages (e.g., invalid token, quota exceeded).

6. Consider performance optimizations for frequent triggers
   - File: [script/addResponseOnSubmit.js](script/addResponseOnSubmit.js)
   - De-duplicate scans by using `TextFinder` or caching to avoid full column reads when the tracker grows.

7. Consolidate UI logging/notifications
   - Files: [script/NotificationSBCode.js](script/NotificationSBCode.js), [script/NotificationSidebar.html](script/NotificationSidebar.html)
   - Ensure polling cadence is intentional (interval vs manual re-poll in handler) and align comments with actual timing.
