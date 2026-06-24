# OPERATIONS — F3Go30

## Deployment

### Model

The script is bound to the Go30 Template spreadsheet and has no standalone deployment. Script
files live in `script/` and are pushed to Google Apps Script via `clasp push`.

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
cd script
clasp push
```

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

### Script Properties

Set in Apps Script Project Settings → Script Properties.

| Property | Required | Default | Description |
|----------|----------|---------|-------------|
| `TINYURL_ACCESS_TOKEN` | Yes (for URL shortening) | None | TinyURL API token |
| `BITLY_ACCESS_TOKEN` | No | None | Bitly API token; only needed if switching from TinyURL |

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

**`TEST_APP` shares the live Template spreadsheet — it is not an isolated test environment.**
`getCurrentAndNextMonths_()` resolves "current month" to whichever tracker is genuinely live and
in active use by real PAX right now. Any write-capable action (`save`, `feedback`) tested against
`targetMonth: "current"` writes into that real spreadsheet. **Always live-test write paths against
`targetMonth: "next"` only.** `identify` is read-only and safe against either.

Since ADR-010, *all* centrally-dispatched functions (not just the web app) run against the live
Template, so this caution applies project-wide, not just to the signup web app. A persistent
Go30 Test/Dev spreadsheet with its own future-dated `TrackerDB` row(s) is planned as a proper
isolated test environment — see ADR-010 §Test/Dev spreadsheet — but is not yet provisioned; until
it exists, continue testing write paths only against `targetMonth: "next"` or other genuinely
non-live data.

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

