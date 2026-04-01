# OPERATIONS — F3Go30

## Deployment

### Model

The script is bound to a specific Google Sheets spreadsheet and has no standalone deployment.
Script files live in `script/` and are pushed to Google Apps Script via `clasp push` run from
the `script/` folder.

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
| Copy and Initialize | `copyAndInit()` | Start of each new month (manual) |
| Initialize Triggers | `initializeTriggers()` | After opening the new tracker for the first time |
| Initialize Monthly Trigger | `initializeMonthlyTrigger()` | Once on the template spreadsheet to schedule auto-generate |
| Reinitialize this spreadsheet | `reinitializeSheets()` | Development or reset |
| Run test function (DEV) | `testFunction()` | Developer use only |

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
| `startDateIso` | Start date entered by Q in `YYYY-MM-DD` format; written to the Links sheet Month column |
| `trackerUrl` | Short URL to the Tracker sheet |
| `formUrl` | Short URL to the HC form |
| `slackMessage` | Ready-to-paste Slack message text (form URL + tracker URL) |
| `siteQName` | Site Q display name from Config |
| `siteQEmail` | Site Q email from Config |
| `confirmationMessage` | Text set on the HC form confirmation |
| `templateSpreadsheetId` | File ID of the template spreadsheet; used by test scripts to verify the Links sheet |
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
| Tracker not populated after HC form submit | Row missing after form submit | Verify form-submit trigger exists in Apps Script Triggers panel; re-run "Initialize Triggers" |
| −1 not appearing for missed days | Nightly trigger not firing | Verify daily trigger for `markEmptyCellsAsMinusOne` in Triggers panel; re-run "Initialize Triggers" |
| `onFormSubmit` throws when Tracker is empty | Range error if Tracker has fewer than 4 rows | Script exits early with a log message; verify Tracker has at least one data row |
| Auto-generate fails | Site Q receives failure email with error details and orphaned spreadsheet ID | Delete orphaned spreadsheet from Drive; run "Copy and Initialize" manually; check Config sheet for missing NameSpace or Site Q rows |

## References

- [Sheet reference](docs/sheet-reference.md) — detailed per-sheet descriptions, column layouts, formulas, and operator notes

