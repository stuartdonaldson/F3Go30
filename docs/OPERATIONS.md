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
| `Context Date` | `YYYY-MM-DD` override (optional, blank = unset) | — | `resolveContextDate_()` (go30tools.js) — namespace-scoped fallback "today" for the webapp's month-boundary/date-navigation logic (F3Go30-31w5.1); set via the `setContextDate` admin action or the Template's "Set Test Context Date..." menu item. Ignored outright on PROD. |

### Environments

Two script projects exist. **Default environment is SIT** unless PROD is stated explicitly.

| Label | `local.settings.json` key | Spreadsheet key | Purpose |
|-------|--------------------------|-----------------|---------|
| **SIT** (System Integration Test) | `testScriptId` | `testSpreadsheetId` | Development and pre-release testing |
| **PROD** | `templateScriptId` | `templateSpreadsheetId` | Live production — the real Go30 Template |

Use `npm run deploy:sit` for SIT; `npm run deploy:prod` / `npm run release:*` for PROD. (`deploy:test` and `push` are kept as aliases.) Never push to PROD without first passing SIT validation.

### Smoke Mode

Smoke mode lets you test the full go-live flow (tracker creation, signup, check-in, bonus,
dashboard) against a disposable, namespace-provisioned copy of the Template — not the bound
SIT/PROD spreadsheet — so a smoke run can never contaminate real TrackerDB/PaxDB data. Run on
SIT first; repeat on PROD before go-live. This supersedes the legacy `SMOKE_MODE`/
`SMOKE_TRACKER_ID` single-shared-tracker mechanism (ADR-014; F3Go30-4wv9/i5md.7).

**Automated workflow (recommended):**

```bash
node tools/smokeTestNamespace.js [--env sit|prod] [--template prod|sit]
# Default: --env sit --template prod
```

`--env` and `--template` are independent (ADR-014 D6) and answer two different questions:
- `--env` — which scriptProject+hostSpreadsheet **registers and runs** the namespace (which
  deployment's `NamespaceDB` the new namespace is added to, and which webapp URL the smoke run's
  HTTP calls hit). Defaults to `sit` — only pass `--env prod` on explicit instruction.
- `--template` — which spreadsheet is **copied from** to build the namespace's Template + recent
  trackers: `prod` copies `templateSpreadsheetId` (the live PROD Template — the real, current F3
  data), `sit` copies `testSpreadsheetId` (SIT's own Template — whatever test data currently
  lives there). Defaults to `prod`, so a default run (`--env sit`, no `--template` flag)
  registers its namespace under SIT but still provisions it from **PROD's real recent
  trackers** — this is deliberate (see CopyTemplate step 1 below) and predates the `--template`
  flag; it is not a SIT-only test against SIT's own data unless you pass `--template sit`
  explicitly.

One command does the whole lifecycle:
1. Disposes any stale `Kind='smoke'` `NamespaceDB` row left behind by a prior crashed/aborted
   run, before provisioning a new one.
2. Provisions a fresh namespace (`copyTemplateToNewEnvironment_`, `kind: 'smoke'`) — a Template
   copy + 3 recent real trackers, in its own sibling Drive folder, registered in `NamespaceDB`.
3. Live-verifies signup, check-in, dashboard render, bonus add/list, and cross-month bonus-edit
   relocation against that namespace (via `ns=<namespace>` / `targetMonth: 'current'|'explicit'`
   — see "Addressing a namespace tracker" below).
4. On success, tears its own namespace down automatically (`teardownEnvironment`,
   `trashFolder: true`) — no human pause needed.
5. On any scenario failure, leaves the namespace in place and prints manual cleanup steps
   (Drive folder to trash + `NamespaceDB` row to delete) instead of tearing it down, so there's
   always something to inspect.

If a run needs cleaning up outside the normal flow:
```bash
node tools/callWebapp.js teardownEnvironment --env <env> --body '{"nameSpace":"<ns>","trashFolder":true}'
```

**Addressing a namespace tracker deterministically:** pass `ns: "<namespace>"` on any webapp
request (or `--ns <namespace>` via `tools/callWebapp.js`) to resolve entry points against that
namespace's own `TrackerDB`/`PaxDB` instead of the bound spreadsheet's (ADR-014 D1/D2). Within a
namespace, address a specific copied month with `targetMonth: 'current'` (the namespace's own
current month) or `targetMonth: 'explicit'` + `targetSheetId: "<sheetId>"` for any other month it
copied — e.g. to put the same test PAX in two separate months at once for cross-month
bonus-relocation coverage. An `ns` not present in `NamespaceDB` is rejected, never opened
directly (anti-enumeration — F3Go30-i5md.5).

**Source qualification (F3Go30-xj1q.2):** `scanTrackers()` excludes any file in the *bound*
deployment's own folder named with `(Smoke)`/`(Expired)` from every scan by default — belt-and-
braces protection against a manually mislabeled artifact, independent of namespace provisioning
(a namespace environment lives in its own sibling folder and is never a candidate for the bound
deployment's folder walk in the first place). It logs one `scanTrackers.smokeArtifactsExcluded`
warning (visible via `tools/query_axiom.py` or Stackdriver) listing what it skipped.

### Verifying the check-in "known but unregistered" fallthrough (F3Go30-xj1q.1)

Manual/SIT verification for the PaxDB fallback: a PAX known from a prior month's sign-up but
absent from the CURRENT month's tracker should be auto-carried into a prefilled sign-up, not
shown a dead-end "not found" message. There's no separate smoke toggle for this — it just needs
a PAX present in `PaxDB` (any prior month, scanned in via `runScanTrackers`) but absent from the
current month's Tracker roster.

```bash
# 1. Confirm a fixture PAX exists in PaxDB but not on the current tracker (see the
#    "known-but-unregistered" fixture note below for how one is established/reused).
node tools/callWebapp.js getSheet --env sit --body '{"sheetName":"PaxDB"}'
node tools/callWebapp.js getSheet --env sit --body '{"sheetName":"Tracker"}'   # current tracker's roster

# 2. Call identify directly against cmd=checkin with that PAX's f3Name/email — expect
#    { ok: true, matched: false, knownPaxNotRegistered: true, f3Name, email } (no tokenInvalid).
curl -s -X POST "https://script.google.com/macros/s/<deploymentId>/exec?cmd=checkin" \
  --data-raw '{"action":"identify","f3Name":"<fixture name>","email":"<fixture email>"}'

# 3. In a browser (or the Playwright identity-token-flow spec), confirm the check-in identify
#    form auto-redirects to ?cmd=signup&targetMonth=current&autoStart=1 with the name/email
#    prefilled, rather than showing the generic "we couldn't find you" message.
```

`runScanTrackers` must have run (PaxDB is scan-derived, not written synchronously by sign-up)
after any fixture PAX's tracker is placed and before this check. A truly-unknown F3 Name + Email
(present in neither PaxDB nor the current tracker) must still show the generic message with no
auto-redirect — the two cases are deliberately visually indistinguishable except for that
redirect, preserving the anti-enumeration property described in `docs/DESIGN.md`.

**Established SIT fixture (F3Go30-xj1q.1, Stage 4):** `LateSignupTest` /
`latesignup@example.com`, signed up for the "next" month only. There was no supported way to
write a PAX row directly into an existing prior-month tracker (no admin action for it, and
hand-editing a live spreadsheet via browser automation was correctly refused as an unsanctioned
write path) — a normal `save` signup call against a freshly created "next" month tracker gives
the same fixture shape (`PaxDB` entry tied to a non-current `sheetId`) via a fully supported
path:
```bash
# One-time setup (already done on SIT as of 2026-07; re-run only if the fixture needs
# re-establishing, e.g. after the "next" month becomes "current" and rolls this PAX in):
node tools/callWebapp.js createTrackerForMonth --env sit --body '{"startDateIso":"2026-08-01"}'
node tools/callWebapp.js save --cmd signup --env sit --body \
  '{"f3Name":"LateSignupTest","email":"latesignup@example.com","targetMonth":"next",
    "teamType":"AO","team":"Crucible","who":"Fixture WHO for known-but-unregistered test",
    "what":"Fixture WHAT for known-but-unregistered test","how":"Fixture HOW for known-but-unregistered test"}'
node tools/callWebapp.js runScanTrackers --env sit
```
This PAX is intentionally left in place (same rationale as `Go30-Demo-Script.md`'s NoSadClown) —
it's reused by both `tests/playwright/identity-token-flow.spec.js` and
`tests/playwright/demo-screenshots.spec.js`'s `06b-checkin-known-not-enrolled.png` shot. It will
need to be re-established once "next" rolls forward into "current" (at that point it would start
resolving as registered, breaking the fixture) — watch for that if these tests start failing
after a month boundary passes.

### CopyTemplate — standing up a new environment

`node tools/copyTemplate.js <folderName> [--env sit|prod] [--tracker-count 3]
[--source-template-id <id>] [--kind smoke|regional|demo]` stands up the *files* for a
brand-new, fully isolated environment (e.g. a different F3 region) and registers it, without
deploying or initializing anything:

1. Copies **`--source-template-id`** (defaults to PROD's `templateSpreadsheetId` from
   `local.settings.json`) into a new sibling Drive folder named `<folderName>` — the bound
   Apps Script project comes along automatically (Drive file copies of a container-bound
   spreadsheet duplicate the bound script too). Per ADR-014 D6, source and destination are
   deliberately decoupled: `--env` picks the deployment that *executes* the request and owns
   the destination `NamespaceDB` registry (typically SIT); `--source-template-id` picks what
   gets copied *from* (typically PROD). Running `--env sit` never copies SIT itself.
2. Forces the copied Template's Config sheet to safe defaults — **`Email Test Mode` = `Yes`**
   (fail-safe; the operator never has to remember to set this) and **`NameSpace` = `<folderName>`**
   (the copy gets its own identity instead of inheriting PROD's — `<folderName>` is one
   identifier used for the folder name, the Template-copy name suffix, the Config `NameSpace`,
   and the tracker-rename marker below). These are the *only* Config values that differ from a
   verbatim PROD copy — see `CopyTemplate.js`'s module header for why that must stay true.
3. Copies the N most recent **real** (non-smoke, non-expired) monthly tracker spreadsheets from
   TrackerDB into that same new folder, each renamed to `<original name> (<folderName>)` so a
   copied tracker is never visually indistinguishable from its PROD original.
4. Rebuilds the new Template copy's `TrackerDB`/`PaxDB` sheets from scratch, using only the
   copied trackers' new SheetIds — the raw copy would otherwise carry over the *entire* source
   TrackerDB/PaxDB history (both live inside the Template spreadsheet), pointing at the old
   trackers' original SheetIds instead of the copies.
5. Registers the new environment as a row in the **destination** (`--env`) deployment's
   `NamespaceDB` sheet — `NameSpace=<folderName>`, `TemplateId=<new copy's id>`,
   `Kind=<--kind, default smoke>`. Trigger fan-out opt-in columns (`NagEnabled`,
   `MinusOneEnabled`, `AutoGenerateEnabled`, `CleanupSessionsEnabled`) default to blank/off —
   an operator enables them manually per D4. This is what makes the new environment addressable
   via `ns=<folderName>` on webapp/admin requests (ADR-014 D1).

Deliberately out of scope: triggers, HC Form links, TinyURL short links, Script Properties,
and any deployment. Bringing the new environment live (initializing triggers, deploying its own
web app, re-linking forms) is a separate, manual step — see `script/CopyTemplate.js`'s file
header. Teardown (removing the `NamespaceDB` row and optionally trashing the folder) is the
`teardownEnvironment` admin action / `teardownNamespaceEnvironment_` — see ADR-014 D6.

### Performance Testing — Check-in Round-Trip Harness (F3Go30-qi26.5)

`tools/measureCheckinPerformance.js` provides a repeatable performance measurement harness for the
returning-user check-in flow (page load → auto-identify → check-in → dashboard). Use this to
capture before/after timings for optimization work.

```bash
node tools/measureCheckinPerformance.js <F3Name> [--env sit|prod] [--rounds N]
```

**Usage:**
- `node tools/measureCheckinPerformance.js TestPax` — single run against SIT
- `node tools/measureCheckinPerformance.js TestPax --env prod --rounds 3` — 3 runs against PROD

**Output:**
1. Per-round-trip timing table, broken down by GAS (`script.google.com`) and
   `googleusercontent.com` hosts, showing HTTP status, TTFB (time-to-first-byte), and total
   time for each request.
2. Axiom correlation window (start + end timestamps) for filtering GAS logs with
   `tools/query_axiom.py` — e.g.

   ```bash
   python tools/query_axiom.py --since 30m --where "_time >= '...' and _time <= '...'"
   ```

   to correlate the measurement run's network performance with server-side GAS execution logs.

**Notes:**
- Each round mints a unique identity token, so successive rounds measure independent sessions.
- Headless Chromium is used (no display required).
- Defaults to SIT environment; always test there first before running against PROD.

### Script Properties

Set in Apps Script Project Settings → Script Properties.

| Property | Required | Default | Description |
|----------|----------|---------|-------------|
| `TINYURL_ACCESS_TOKEN` | Yes (for URL shortening) | None | TinyURL API token |
| `BITLY_ACCESS_TOKEN` | No | None | Bitly API token; only needed if switching from TinyURL |
| `ADMIN_SHARED_SECRET` | Yes (for admin POST) | None | Secret required in `adminSecret` field of admin POST payloads |

---

## Running

All operations are initiated from the **F3 Go30** custom menu in Google Sheets. The menu is
visible only when the spreadsheet is opened by the owner account.

| Menu Item | Function | When to Use |
|-----------|----------|------------|
| Copy and Initialize | `copyAndInit()` | Start of each new month (manual). Registers the new tracker in `TrackerDB` and installs its form-submit trigger directly — no separate trigger step needed on the copy. |
| Initialize Template Dispatch Triggers (Template only!) | `initializeTemplateDispatchTriggers()` | Once, on the Template only — installs the daily minus-one, nag-email, check-in session cleanup, and PaxCache purge dispatch triggers. Warns if run elsewhere. |
| Initialize Monthly Trigger | `initializeMonthlyTrigger()` | Once on the template spreadsheet to schedule auto-generate |
| Reinitialize this spreadsheet | `reinitializeSheets()` | Development or reset |
| Run test function (DEV) | `testFunction()` | Developer use only |

> **Removed:** "Initialize Triggers" / `initializeTriggers()` is no longer part of the monthly
> workflow. Form-submit triggers are installed per-tracker at creation time (`copyAndInit()` /
> `autoGenerateNextMonthTracker()`); daily −1 marking and nag-email triggers are installed once,
> on the Template, via "Initialize Template Dispatch Triggers". All three dispatch to the correct
> tracker by resolving against `TrackerDB` or the firing event (ADR-010). A fourth trigger,
> `cleanupStaleCheckinSessions` (`CheckinSessions.js`), is installed the same way and prunes
> abandoned/stale check-in bookmark sessions nightly — it does not resolve a tracker, since the
> `CheckinSessions` sheet lives on the Template itself. A fifth trigger, `purgeStalePaxCache`
> (`PaxCache.js`, F3Go30-440b.2), also runs nightly on the Template and purges PaxCache
> Script Properties entries (`go30pax:`/`go30idx:`/`go30asof:`) three ways: wholesale, for any
> `TrackerDB` sheet whose tracker month started more than ~60 days ago; per-PAX, on sheets too
> recent for that wholesale wipe, for any PAX who no longer has a row in `CheckinSessions`
> (reusing that sheet's own nightly prune as an activity signal); and an orphan sweep, for any
> `go30pax:`/`go30idx:`/`go30asof:` entry whose sheetId has no `TrackerDB` row anywhere at
> all — a single deleted tracker (`cleanupTracker`) or a whole torn-down namespace
> (`teardownEnvironment`). PaxCache's Script Properties store is shared by the one deployed
> script regardless of which `ns` a request targeted, but `TrackerDB` is not (each namespace
> from `copyTemplate`/ADR-014 has its own copied spreadsheet with its own `TrackerDB`), so the
> orphan sweep first unions the bound Template's `TrackerDB` with every registered namespace's
> own `TrackerDB` (via `NamespaceDB`) before treating a sheetId as truly gone — see PaxCache.js's
> `purgeStalePaxCache_`/`collectKnownTrackerSheetIds_` docstrings. Callable on demand for testing
> via the `runPaxCachePurge` admin action (`node tools/callWebapp.js runPaxCachePurge --env <env>`).

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

### Testing the Web App (cmd=signup, cmd=checkin, and similar)

Use the **SIT environment** (`testScriptId` / `testSpreadsheetId`) for all web app testing.
`getCurrentAndNextMonths_()` resolves "current month" against the SIT TrackerDB, so write-capable
actions (`save`, `feedback`, `checkin`) against the current month hit the SIT spreadsheet, not PROD.
For go-live validation, use Smoke mode (see §Smoke Mode above).

`cmd=checkin` (`node tools/callWebapp.js <action> --cmd checkin`) actions: `identify`
(`{f3Name,email}`, read-only, anti-enumeration — response shape is identical whether or not the
PAX is found except for the presence of data), `checkin` (`{f3Name,email,day,value}` where
`day` is `'today'|'yesterday'` and `value` is `1|0` — writes a single Tracker day cell for the
current month), `dashboard` (`{f3Name,email}`, read-only), and the bonus-point actions `bonusList`
(`{f3Name,email}`, read-only), `bonusAdd`/`bonusEdit` (write a PAX's Bonus Tracker entry).
`checkin`/`bonusAdd`/`bonusEdit` write real Tracker data — never call them against a real PAX's
name/email outside a namespace-provisioned smoke environment (§Smoke Mode above).

**Always confirm the environment before writing:** pass `--env sit|prod` explicitly and, when
addressing a namespace, `ns`/`--ns` — there is no bound-deployment "which environment am I
talking to" check beyond that. `identify` is read-only and safe against either environment.

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

### Testing month-boundary fallback (contextDate override, F3Go30-31w5.1)

Every webapp entry point resolves "today" via `resolveContextDate_()` (go30tools.js), which lets
a developer pin that resolution to an explicit date instead of waiting for a real month rollover
to test fallback logic (e.g. "yesterday" correctly falling back to the *previous* month's
tracker on day 1 of a new month). Precedence: PROD always uses the real clock, full stop; then a
per-request `contextDate` field wins; then a namespace's stored Config sheet "Context Date" row;
then the real clock.

- **Scripted/API calls:** pass `contextDate` (`YYYY-MM-DD`) in the JSON body, e.g.
  `node tools/callWebapp.js identify --cmd checkin --env sit --body '{"f3Name":"...","email":"...","contextDate":"2026-08-01"}'`.
- **Set a session default for a namespace:** `setContextDate` admin action —
  `node tools/callWebapp.js setContextDate --env sit --body '{"ns":"<ns>","contextDate":"2026-08-01"}'`
  (empty `contextDate` clears it). Refuses on PROD.
- **Driving the browser UI manually:** append `?contextDate=YYYY-MM-DD` to the `cmd=checkin`/
  `cmd=signup` URL — it's read server-side on page load and auto-echoed on every subsequent
  request for that page session (same mechanism as the `ns` namespace parameter). The Template
  spreadsheet's **F3 Go30 → Set Test Context Date...** menu item (owner-only) does this for you:
  it prompts for a date, sets the namespace's Config default, and hands back ready-to-open
  check-in/signup URLs with the param already filled in.

---

## References

- [Sheet reference](docs/sheet-reference.md) — detailed per-sheet descriptions, column layouts, formulas, and operator notes

