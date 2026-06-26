# OPERATIONS — F3Go30

## Deployment

### Model

The script is bound to the Go30 Template spreadsheet and has no standalone deployment. Script
files live in `script/` and are pushed to Google Apps Script via `npm run deploy:prod` (which invokes `tools/manage-deployments.js`).

Since ADR-010, the Template is the **only** runtime container — all triggers and dispatch logic
run there. Monthly tracker copies are pure data spreadsheets with no bound logic of their own, so
there is nothing to push or initialize on them. A push to the Template's script takes effect
immediately for every past, current, and future tracker. **This also means the Template is live
production, not a safe test environment** — see §Testing for the dev/test spreadsheet plan.

### Prerequisites

- Template spreadsheet is created and owned by the operator (this is the Go30 Template spreadsheet used by `copyAndInit`).
- `clasp` is installed and authenticated before pushing: `clasp_config_auth=~/.clasprc-f3go30.json clasp login`. The same env var (or `--auth <file>`) is required by every other clasp command too — see project CLAUDE.md §clasp.

### Installation

```bash
npm run deploy:prod   # full deploy: push code + update named deployment URL
```

`tools/manage-deployments.js` writes `.clasp.json` automatically before each push — do not
edit `.clasp.json` by hand. Both `deploy:prod` and `deploy:sit` do a full deploy (code push
plus named deployment URL update); `npm run push` is a kept alias for `deploy:prod`.

---

## Configuration

### Config Sheet

Runtime values read by the script at execution time. Located in the spreadsheet tab named
`Config`. Column A is the variable name, column B is the primary value, column C is the
secondary value.

| Variable | Column B | Column C | Used by |
|----------|----------|----------|---------|
| `Site Q` | Site Q display name | Site Q email address | `copyAndInit()`, `autoGenerateNextMonthTracker()` — form confirmation message and email notifications |
| `Email Test Mode` | `Yes` or `No` | Optional backup toggle value | Shared outbound email wrapper — when enabled, app emails are sent only to the Site Q email and include the intended recipient list in the message body |
| `NameSpace` | Region identifier (e.g. `F3Waxhaw`) | — | `copyAndInit()`, `autoGenerateNextMonthTracker()` — drives spreadsheet name (`YYYY-MM-NameSpace`) and URL aliases |
| `LogFile` | Drive file URL (written automatically on first use) | — | `copyAndInit()` — appends structured JSON log entries for UC-5 developer verification |

### Environments

Two script projects exist. **Default environment is SIT** unless PROD is stated explicitly.

| Label | `local.settings.json` key | Spreadsheet key | Purpose |
|-------|--------------------------|-----------------|---------|
| **SIT** (System Integration Test) | `testScriptId` | `testSpreadsheetId` | Development and pre-release testing |
| **PROD** | `templateScriptId` | `templateSpreadsheetId` | Live production — the real Go30 Template |

Use `npm run deploy:sit` for SIT; `npm run deploy:prod` / `npm run release:*` for PROD. (`deploy:test` and `push` are kept as aliases.) Never push to PROD without first passing SIT validation.

### Smoke Mode

Smoke mode lets you test the full go-live flow (tracker creation, signup, nag, minus-one) using
labeled artifacts that are cleaned up afterward. Run on SIT first; repeat on PROD before go-live.

**Automated workflow (recommended):**

```bash
# Full automation: steps 1–5, human review pause, then teardown
node tools/smokeTest.js [--env sit|prod]
# Default: --env sit
# Pauses after tracker creation and sheet verification for human review.
# Press Enter at the prompt to complete teardown; Ctrl+C to abort.
```

If smoke mode is left active (due to error), clean up with:
```bash
node tools/smokeTest.js --teardown [--env sit|prod]
```

**Manual workflow (if needed):**

Use `node tools/callWebapp.js` for each step. The tool handles auth, environment selection, and
the GAS 302-redirect quirk automatically.

```bash
# 1. Activate smoke mode
node tools/callWebapp.js setScriptProperties --env <env> --body '{"properties":{"SMOKE_MODE":"true"}}'

# 2. Confirm environment and smoke state
node tools/callWebapp.js getSmokeStatus --env <env>
# → { deployTarget, smokeMode: true, smokeTrackerId: null }

# 3. Create tracker via auto-generate (or use the menu in Sheets for copyAndInit)
node tools/callWebapp.js runAutoGenerate --env <env>
# copyAndInit_ appends " (Smoke)" to NameSpace and writes SMOKE_TRACKER_ID to Script Properties.

# 4. Sign up a test PAX via the signup web app
node tools/callWebapp.js identify --cmd signup --env <env> --body '{"f3Name":"SmokeTest","email":"smoke@example.com"}'

# 5. Verify the Tracker sheet shows the test row (use SMOKE_TRACKER_ID from getSmokeStatus)
node tools/callWebapp.js getSheet --env <env> --body '{"sheetId":"<SMOKE_TRACKER_ID>","sheetName":"Tracker"}'
# → { ok: true, csv: "<tab-separated rows>" }

# 6. *** HUMAN PAUSE *** — open the smoke spreadsheet and confirm it looks correct.
#    Open: https://docs.google.com/spreadsheets/d/<SMOKE_TRACKER_ID>/edit

# 7. Teardown — remove TrackerDB row, PaxDB rows, and trash the spreadsheet
node tools/callWebapp.js cleanupTracker --env <env> --body '{"sheetId":"<SMOKE_TRACKER_ID>","trashSpreadsheet":true}'

# 8. Clear smoke properties and confirm clean state
node tools/callWebapp.js setScriptProperties --env <env> --body '{"properties":{"SMOKE_MODE":"","SMOKE_TRACKER_ID":""}}'
node tools/callWebapp.js getSmokeStatus --env <env>
# → { smokeMode: false, smokeTrackerId: null }
```

**Effect of SMOKE_MODE=true:**
- `copyAndInit_` appends `" (Smoke)"` to `NameSpace` when naming the new tracker spreadsheet.
- The new tracker's spreadsheet ID is saved to `SMOKE_TRACKER_ID` in Script Properties.
- `runScanTrackers` admin action is blocked — prevents test data contaminating PaxDB.
- Outbound emails redirect to Site Q address (same as Email Test Mode) with `[SMOKE]` subject prefix.

### Script Properties

Set in Apps Script Project Settings → Script Properties.

| Property | Required | Default | Description |
|----------|----------|---------|-------------|
| `TINYURL_ACCESS_TOKEN` | Yes (for URL shortening) | None | TinyURL API token |
| `BITLY_ACCESS_TOKEN` | No | None | Bitly API token; only needed if switching from TinyURL |
| `SMOKE_MODE` | No | `''` (inactive) | Set to `'true'` to enable Smoke mode on SIT |
| `SMOKE_TRACKER_ID` | No | `''` | Written automatically by `copyAndInit_` when Smoke mode is active; cleared during teardown |
| `ADMIN_SHARED_SECRET` | Yes (for admin POST) | None | Secret required in `adminSecret` field of admin POST payloads |

---

## Running

All operations are initiated from the **F3 Go30** custom menu in Google Sheets. The menu is
visible only when the spreadsheet is opened by the owner account.

| Menu Item | Function | When to Use |
|-----------|----------|------------|
| Copy and Initialize | `copyAndInit()` | Start of each new month (manual). Registers the new tracker in `TrackerDB` and installs its form-submit trigger directly — no separate trigger step needed on the copy. |
| Initialize Template Dispatch Triggers (Template only!) | `initializeTemplateDispatchTriggers()` | Once, on the Template only — installs the daily minus-one and nag-email dispatch triggers. Warns if run elsewhere. |
| Initialize Monthly Trigger | `initializeMonthlyTrigger()` | Once on the template spreadsheet to schedule auto-generate |
| Reinitialize this spreadsheet | `reinitializeSheets()` | Development or reset |
| Run test function (DEV) | `testFunction()` | Developer use only |

> **Removed:** "Initialize Triggers" / `initializeTriggers()` is no longer part of the monthly
> workflow. Form-submit triggers are installed per-tracker at creation time (`copyAndInit()` /
> `autoGenerateNextMonthTracker()`); daily −1 marking and nag-email triggers are installed once,
> on the Template, via "Initialize Template Dispatch Triggers". All three dispatch to the correct
> tracker by resolving against `TrackerDB` or the firing event (ADR-010).

### LogFile Verification (UC-5)

After running **Copy and Initialize**, the script appends a JSON log entry to a Drive file.
Use `test/log_channel.py` to download and assert on its contents.

**Setup (first run only):**
1. Run "Copy and Initialize" on the template spreadsheet.
2. Open the Config sheet — note the URL written to the `LogFile` row (Column B).
3. Save this URL; it is reused across all subsequent log reads.

**Asserting on log output:**
```bash
pip install requests
python test/log_channel.py "https://drive.google.com/file/d/FILE_ID/view?usp=sharing"
```

Or in a test script:
```python
from test.log_channel import fetch_log_entries

entries = fetch_log_entries(log_file_url)
latest = entries[-1]
assert latest["trigger"] == "copyAndInit"
assert "trackerUrl" in latest["payload"]
assert "formUrl" in latest["payload"]
assert "confirmationMessage" in latest["payload"]
```

**Log entry payload keys (copyAndInit):**

| Key | Value |
|-----|-------|
| `spreadsheetName` | New spreadsheet name (e.g. `2026-04-F3Waxhaw`) |
| `startDateIso` | Start date entered by Q in `YYYY-MM-DD` format; written to the `TrackerDB` sheet's StartDate column |
| `trackerUrl` | Short URL to the Tracker sheet |
| `formUrl` | Short URL to the HC form |
| `slackMessage` | Ready-to-paste Slack message text (form URL + tracker URL) |
| `siteQName` | Site Q display name from Config |
| `siteQEmail` | Site Q email from Config |
| `confirmationMessage` | Text set on the HC form confirmation |
| `templateSpreadsheetId` | File ID of the template spreadsheet; used by test scripts to verify the `TrackerDB` sheet |
| `error` | Present only on failure; contains error message |
| `warning` | Present in a separate entry when URL shortening falls back to raw URL; includes `alias` (attempted TinyURL alias) and `rawUrl` (raw URL returned) |

**Security:** The LogFile URL grants read access to anyone with the link. It contains Site Q
email and spreadsheet/form URLs. Do not share publicly or commit the URL to version control.

---

## Failure Modes

| Failure | Symptom | Recovery |
|---------|---------|---------|
| Menu does not appear | User is not the spreadsheet owner | Open with the owner account |
| URL shortening fails | Sidebar shows full URL instead of short URL | Check `TINYURL_ACCESS_TOKEN` in Script Properties; use full URL manually |
| Copy and Initialize stops mid-run | Sidebar log shows last completed step | Note the step; complete remaining steps manually using Apps Script editor |
| Tracker not populated after HC form submit | Row missing after form submit | Verify the Template's form-submit dispatcher trigger exists in its Triggers panel, and that the tracker's form ID is registered correctly in `TrackerDB` |
| −1 not appearing for missed days | Nightly trigger not firing, or `TrackerDB` lookup failing for that tracker | Verify the Template's daily dispatcher trigger for `markEmptyCellsAsMinusOne` exists in its Triggers panel; verify the tracker's date range in `TrackerDB` actually covers the missed date |
| `onFormSubmit` throws when Tracker is empty | Range error if Tracker has fewer than 4 rows | Script exits early with a log message; verify Tracker has at least one data row |
| Auto-generate fails | Site Q receives failure email with error details and orphaned spreadsheet ID | Delete orphaned spreadsheet from Drive; run "Copy and Initialize" manually; check Config sheet for missing NameSpace or Site Q rows |
| Email test mode blocks delivery | A mail-sending workflow logs a delivery failure and no email is sent | If `Email Test Mode` is enabled, verify the `Site Q` row has a valid email address in column C; otherwise disable `Email Test Mode` |

---

## Testing

### GasLogger live test

Verifies end-to-end structured logging: runs `testGasLogger()` in the Apps Script editor via
Playwright, captures Logger output, and asserts on the Drive files written to
`GAS_LOGGER_LOCAL_PATH/F3Go30/`.

**Prerequisites:**
- `local.settings.json` populated (`GAS_LOGGER_LOCAL_PATH`, `SCRIPT_ID_PROD`)
- Google Drive for Desktop mounted at `GAS_LOGGER_LOCAL_PATH`
- Node.js installed; `npm install` run once

**One-time auth capture** (interactive — do this once per machine):
```bash
npm run auth
# Log in to the f3go30@gmail.com account in the browser that opens, then press ENTER
```

**Running the test** (unattended after auth):
```bash
npm run test:gaslogger
```

The test opens the Apps Script editor, runs `testGasLogger()`, writes Logger output to
`test/output/gaslogger-{timestamp}.txt`, then runs `test/test_gas_logger_live.py` to verify
the five expected Drive entries (AC2–AC5). Passes in ~45s.

**If it fails:**
- Auth expired → re-run `npm run auth`
- Drive not synced → ensure Google Drive for Desktop is running and mounted
- Selector broken → check `test-results/**/error-context.md` for updated ARIA names;
  see `/mnt/c/dev/GAS-Practices/best-practices/gas-editor-testing/README.md`

### Testing the Web App (cmd=signup and similar)

Use the **SIT environment** (`testScriptId` / `testSpreadsheetId`) for all web app testing.
`getCurrentAndNextMonths_()` resolves "current month" against the SIT TrackerDB, so write-capable
actions (`save`, `feedback`) against `targetMonth: "current"` hit the SIT spreadsheet, not PROD.
For go-live validation, use Smoke mode (see §Smoke Mode above).

**Always confirm the environment before writing:** call `{ "action": "getSmokeStatus" }` and
verify `deployTarget` matches your intended environment. `identify` is read-only and safe against
either environment.

**curl gotcha:** when POSTing to the deployed `/exec` URL, do not pass an explicit `-X POST` —
Google's web app endpoint responds with a 302 redirect to a GET-only
`script.googleusercontent.com/macros/echo` endpoint, and `-X POST` pins that method through the
redirect, producing a misleading "Page Not Found" (actually a 405). Let `--data`/`-d` imply POST
on the first request and omit `-X` so curl naturally downgrades to GET on the redirect. Always
pass `-L` to follow the redirect at all.

```bash
curl -s -L "https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec?cmd=signup" \
  --data-raw '{"action":"identify","f3Name":"Some Name","email":"some@example.com"}' \
  -H "Content-Type: text/plain"
```

---

## References

- [Sheet reference](docs/sheet-reference.md) — detailed per-sheet descriptions, column layouts, formulas, and operator notes

