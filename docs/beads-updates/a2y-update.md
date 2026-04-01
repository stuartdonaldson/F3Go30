# Bead a2y — Parallel script development workflow and screenshot requirements

Status: proposed

This file records the recommended update for bead `a2y` to turn its single-track workflow
into parallel, script-focused workflows. It also enumerates the screenshots each script
should produce and how to capture them. Copy this content into the bead entry `a2y`
(or the beads DB) to update the official issue.

Goal

- Break the work into parallel workflows, one per script/module in `script/`, so each can be
  implemented, tested, and documented independently.
- Ensure each script's development includes a short runbook and the required screenshots
  for documentation and QA.

Scripts (one parallel workflow per item)

- `CreateNewTracker.js`
  - Purpose: copy template, initialize sheets, create Links entry, show sidebar links.
  - Deliverables: unit-like integration test via LogFile verification, UI screenshots.
  - Screenshots needed: custom menu open (owner account), Copy and Initialize prompt, sidebar final output (links + Slack block), Links sheet new row, Config sheet with NameSpace and Site Q.
  - How to capture: open template spreadsheet as owner → run `Copy and Initialize` → when sidebar shows final state, take full-screen and sidebar crop screenshots; open Links and Config tabs and capture grid view.

- `addResponseOnSubmit.js`
  - Purpose: form-submit handler that dedupes and inserts PAX row, copies formulas.
  - Deliverables: simulated form submission test, sample Responses row, Tracker row added.
  - Screenshots needed: a filled Responses row in `Responses` sheet, before/after Tracker showing newly inserted row and copied formulas, bonus-column area showing formula propagation.
  - How to capture: submit test response via the live form or use the Apps Script `testFunction()` that simulates `onFormSubmit`; capture Responses sheet row and Tracker slice.

- `markMinusOne.js`
  - Purpose: nightly miss marking trigger.
  - Deliverables: test demonstrating correct column selection and idempotence, failure-mode screenshot.
  - Screenshots needed: Tracker date header showing the two-day-prior column highlighted, plus a log or Activity entry showing the mark operation.
  - How to capture: run `markEmptyCellsAsMinusOne()` in Apps Script editor against a test tracker with known empty cells and capture the Tracker and Activity sheets.

- `logActivity.js` / `logFile.js`
  - Purpose: append and verify JSON log entries to Drive file and Activity sheet.
  - Deliverables: test helper use, `test/log_channel.py` example working against the LogFile URL.
  - Screenshots needed: Activity sheet showing recent appended JSON, the Drive LogFile view (preview) showing a sample JSON entry.
  - How to capture: run `copyAndInit()` or a small helper to write a sample log entry; open Activity sheet and LogFile preview and capture.

- `NotificationSBCode.js` + `NotificationSidebar.html`
  - Purpose: sidebar streaming log UI and Slack message textarea.
  - Deliverables: functional screenshot of the sidebar with log and Slack block, accessibility check.
  - Screenshots needed: full sidebar (showing Slack textarea and links), about-modal and any alert messages.
  - How to capture: trigger a long-running `copyAndInit()` operation, let the sidebar fill, capture full page including sidebar.

- `Utilities.js`, `urlShortener.js`
  - Purpose: shared utilities and URL shortening adapter.
  - Deliverables: unit tests for fallback behavior when TinyURL fails, documentation of Script Properties required.
  - Screenshots needed: none required for headless utilities, but include a sample Script Properties UI screenshot showing `TINYURL_ACCESS_TOKEN` present.
  - How to capture: open Apps Script Project Settings → Script Properties → capture the entry.

Common workflow per parallel track

1. Create or update the bead for this script with: title, goal, acceptance criteria, estimate, and the list of required screenshots.
2. Implement code changes in a feature branch following the bead's AC.
3. Add or update `test/` harnesses needed to verify behavior (e.g., `test/log_channel.py`, simulated form submissions).
4. Capture required screenshots and add them to `docs/assets/` (or `docs/staging/`) with filenames prefixed by the bead id (e.g., `a2y-CreateNewTracker-sidebar.png`).
5. Update `docs/sheet-reference.md` and `docs/CONTEXT.md` or `DESIGN.md` as needed to reference the new behavior and include the screenshots where they help operator tasks.
6. Close the bead when AC and screenshots are added and reviewed.

Notes on screenshots and privacy

- Screenshots may contain emails, site Q names, or other PII. Replace or redact PII before committing images to the repo or store them in a private artifact store if necessary.
- Preferred image format: PNG. Recommended max width: 1400px. Use lightweight compression.

How to apply this update to bead `a2y`

- If you manage beads via `bd` locally, run:

```bash
bd show a2y   # inspect existing bead
bd update a2y --description-file docs/beads-updates/a2y-update.md
```

- If `bd` is not available, copy the contents of this file into the bead's description field in the beads UI or into the dolt-backed beads DB.

---

End of proposed update for bead `a2y`.
