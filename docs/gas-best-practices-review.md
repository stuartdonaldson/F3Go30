# GAS Best-Practices Review for F3Go30

Source: `/mnt/c/dev/GAS-Practices/best-practices/` (extracted from AudioTrackCombiner and WingTools).

## F3Go30 context (what shapes applicability)

- **Bound** Apps Script project (attached to the Tracker spreadsheet). No web app, no `/exec` URL, no `doGet`.
- Triggers: `onFormSubmit`, daily nag, monthly auto-generate, plus an HtmlService **sidebar** (`NotificationSidebar.html`) opened from sheet-internal flows.
- Source layout: `script/` with `script/.clasp.json`. No `package.json`, no Node tooling wired up.
- Existing logging: `logFile.js` already writes to a single shared Drive text file; `test/log_channel.py` reads it (UC-5).
- Existing tests: mock-based JS unit tests + Python scripts that touch the live sheet/log file. Recurring lesson (LL 2026-04-01, bd memory `test-scripts-require-live-validation`): we can't close test ACs without real-fixture validation.
- Version is hand-edited in `script/version.js`; currently stale (`2.0.0` dated `2026-03-31`).

## Summary table

| Practice | Verdict | Why |
|---|---|---|
| gas-server-logging | **Adopt (adapt)** | We already do a simpler form of this; structured entries + correlation IDs unblock real-fixture test assertions |
| gas-playwright-testing | **Adopt narrowly** (operator flows only) | Drives Sheets menu → sidebar end-to-end; doesn't reach trigger-driven flows |
| gas-deployment (TEST/PROD) | **Adopt (managed deployments)** | Bound scripts: test vs prod via separate scriptIds in `local.settings.json`; a `set-script-id` tool swaps `.clasp.json`; unbound scripts use deployment description prefix |
| gas-cm-and-deployment (version stamp + managed deploy) | **Adopt** | Node/npm already required by clasp so no new dependency; managed deployment script reads `local.settings.json`, sets scriptId, stamps version, then pushes |
| google-sheet-verification (xlsx export) | **Adopt (test-only)** | Directly attacks the "can't verify live sheet state" recurring failure |
| Email verification (Gmail API/IMAP) — *not in source repo* | **Adopt** | Only way to verify nag + reuse-notice emails; catches double-send and missing-recipient bugs |
| Form submission verification — *not in source repo* | **Adopt (direct POST + 1 schema test)** | Drives form-submit flows deterministically; one Playwright spec catches schema drift |

---

## 1. Server-side logging via Drive — **Adopt (adapt)**

### How it would apply

Reuse and extend `GasLogger.js` from `/mnt/c/dev/GAS-Practices/best-practices/gas-server-logging/GasLogger.js` rather than building a new helper. The existing `logFile.js` single-file model is retired in favour of GasLogger's **per-flush timestamped file** model, which eliminates concurrent-append contention entirely. `log_channel.py` is updated to scan the project subfolder for the latest `.log` file instead of reading a single pinned file.

**GasLogger extension points for F3Go30:**

1. **Project subfolder** — on `_getFolder()`, resolve the parent shared folder from Script Properties (`GAS_LOGGER_PARENT_FOLDER_ID`), then find-or-create a subfolder named by the project prefix (`GAS_LOGGER_PROJECT_PREFIX = 'F3Go30'`). All log files land under `<shared-folder>/F3Go30/`. The hardcoded `'ATC-Dev'` fallback in the source is removed.
2. **Fallback to Logger only** — if `GAS_LOGGER_PARENT_FOLDER_ID` is not set, or `DriveApp.getFolderById()` throws, `_folder` stays `null` and `flush()` skips the Drive write silently. All entries still pass through `Logger.log()` regardless.
3. **Correlation IDs** — at the start of every triggered execution (`onFormSubmit`, `nag_daily_`, `autoGenerateNextMonthTracker`, `copyAndInit`), generate an `execId` (`Utilities.getUuid()`) and stamp it on every `GasLogger.log()` entry. Add a `runId` set by test fixtures via Script Property when a Python test starts a run.
4. **NoticeLog alignment** — `NoticeLog` retains its sidebar-queue semantics; trigger-context callers use `GasLogger.log()` + `Logger.log()` directly. A single `logAndNotice(tag, data)` helper in `response_utils.js` handles the dual-context case rather than scattering the branch everywhere.

**`local.settings.json` additions (not committed to git):**

```json
{
  "GAS_LOGGER_PARENT_FOLDER_ID": "<Drive folder ID of the shared log root>",
  "GAS_LOGGER_PROJECT_PREFIX": "F3Go30"
}
```

These are pushed to Script Properties once via `clasp run setScriptProperty` (see §3 for the PropertiesService helper pattern). Note: `clasp run` requires the script to be linked to a GCP project with the Apps Script API enabled, an OAuth consent screen, and an API executable deployment — see the caveat in the GAS-Practices `gas-cm-and-deployment/README.md` Prerequisites section. For this project, set Script Properties manually from the GAS editor until GCP is wired up.

### Pros
- Reuses reviewed, working code from GAS-Practices — no new helper to design.
- Per-flush files eliminate concurrent-append contention (the main risk of the old single-file model).
- Closes the "test can't verify behavior" gap — Python tests assert on `tag`/`data` fields in the latest file in `F3Go30/`.
- Graceful fallback: if the folder is missing or mis-configured, nothing breaks — `Logger.log()` still captures entries.
- Correlation IDs make multi-trigger overlap debuggable and enable full-flow assertions across log + email.

### Cons
- `log_channel.py` must change from reading a fixed file ID to scanning a subfolder for the latest file. Small but it's a test-harness change.
- Per-flush files accumulate in Drive; a pruning step (or Drive retention policy) is needed eventually.
- `NoticeLog` dual-semantics are not resolved by this change — the `logAndNotice` wrapper defers rather than eliminates the complexity.

### Risks
- **PII in logs** — NDJSON `data` payloads must be scrubbed; easier to leak once we add structured fields. Mitigation: document which fields are safe to log; never log raw form response values.
- **Subfolder creation race** — if two executions call `_getFolder()` simultaneously and the folder doesn't exist yet, both try to create it. Mitigation: `_getFolder` uses `getFoldersByName().hasNext()` before creating; GAS execution isolation means this race is unlikely in practice.

### Effort
Small. GasLogger.js copied in, `_getFolder` extended (~10 lines), `log_channel.py` updated to scan folder, ~5 call sites updated to `GasLogger.log()`.

---

## 2. Playwright testing — **Adopt narrowly (operator flows only)**

### How it would apply

We **deviate** from the source pattern: instead of navigating to a `/exec` web-app URL and the documented `#sandboxFrame > #userHtmlFrame` iframe, we drive the host **Google Sheet** directly:

```
Playwright → docs.google.com/spreadsheets/d/{TEST_TRACKER_ID}/edit
          → wait for menubar (role=menubar)
          → click custom menu (e.g. "F3 Go30")
          → click submenu item ("Reinitialize Sheets")
          → wait for sidebar iframe to appear
          → assert via frameLocator on title/status/log divs
          → optionally type into prompt input, click submit
          → wait for done state
          → (then) xlsx-export the sheet and assert on cell writes
```

Selectors stay on **ARIA roles + visible text** (`getByRole('menuitem', { name: 'Reinitialize Sheets' })`), not Google's internal CSS classes — that's the part that survives Sheets UI churn reasonably well.

### What this buys (unique coverage)

1. **Menu wiring.** `onOpen.js` registers the right items pointing at the right function names. Today this fails silently — a typo in `onOpen` only surfaces when an operator clicks and nothing happens.
2. **Operator end-to-end flows.** `copyAndInit`, `reinitializeSheets`, the `Sort_PAX` / `AutoFill` macros — user-clicked, sidebar-driven, and the source of past silent breakage (the NoticeLog dual-logging issue, the copyAndInit-no-email regression).
3. **Sidebar prompt round-trip.** The `sendToServer` path is currently untested.
4. **Scope/permission regressions.** A scope added by code that wasn't authorized shows up as an interactive auth dialog — Playwright sees it, mocks don't.

### What this does NOT buy

- **Form-submit and nag flows** — installable triggers, not menu clicks. Most recent bug churn (signupReuse, addResponseOnSubmit, nag.js) lives here. Playwright is silent on it; those still need the xlsx-export approach plus directly-callable test shims.
- **Monthly cron** — same, no UI surface.

So Playwright covers the **operator-driven** half of the system, not the **trigger-driven** half.

### Pros

- Replaces the current manual "click through it" smoke test for the operator flows that have repeatedly broken silently.
- Combined with xlsx-export, gives a real test pyramid: unit (mocks) → integration (xlsx) → end-to-end (Playwright drives menu, then verifies via xlsx).
- Catches a class of regressions (menu typos, scope dialogs, async sidebar message ordering) that no other tier reaches.

### Cons

- **Sidebar iframe selector isn't documented** like `#sandboxFrame > #userHtmlFrame` is for web apps. We have to discover and pin it ourselves, and it's more likely to drift than the web-app pattern's selectors.
- **Async menu population.** Custom menus from `onOpen` populate after page-ready; needs explicit role/text waits, not `domcontentloaded`.
- **Apps Script execution latency.** 5–30s per server call; tests need generous timeouts and per-test retry on rate-limit.
- **Auth setup is real.** `storageState` of a Google session, refreshed every few days. Won't run in CI without that. First-run auth dialogs for any new scope require manual unblock.
- **Sheet mutations are real.** Every run modifies the test tracker; flaky tests leave dirty state. Need a reset/seed step.

### Risks

- **Sheets UI drift** — Google reorganizes menu structure or sidebar DOM. Mitigation: ARIA-role selectors, but accept a few-times-per-year selector update tax.
- **Cross-test interference** — sidebar polling state, leftover `TO_CLIENT` queue entries from previous runs. Mitigation: explicit reset helper that clears PropertiesService queues at test start.
- **Premature investment** — building scaffolding before confirming the sidebar iframe is selectable. Mitigation: see spike below.

### Effort

Medium. Auth setup + 3–5 specs covering the highest-value operator flows. Don't try to cover the whole app.

### Spike before committing

Before building the full harness, run a **half-day spike**: from a logged-in Playwright session, open the test tracker, click the F3 Go30 menu, trigger the simplest sidebar-opening function, and confirm we can:

1. Resolve the sidebar iframe with a stable selector (ARIA / `name` / structural).
2. Read text out of the sidebar's `#sb-title` / `#sb-status` divs.
3. Type into the prompt input and confirm `sendToServer` fires.

If any of those three is unstable, downgrade Playwright to "manual smoke only" and stop. If all three work, proceed with the full harness scope above.

---

## 3. TEST / PROD deployment management — **Adopt (managed deployments)**

### How it applies to bound scripts

A bound script has **one** `.clasp.json` pointing at a `scriptId`. TEST and PROD are separate script projects bound to separate spreadsheets (the test tracker and the live monthly tracker). Swapping between them means updating `scriptId` in `.clasp.json`.

**Approach: `set-script-id` tool + `manage-deployments` script**

- `local.settings.json` (not committed) stores both IDs:

```json
{
  "SCRIPT_ID_TEST": "<test tracker script project ID>",
  "SCRIPT_ID_PROD": "<prod tracker script project ID>"
}
```

- `tools/set-script-id.js <test|prod>` reads `local.settings.json` and rewrites `script/.clasp.json` with the appropriate `scriptId`. This is the **only** place `.clasp.json`'s `scriptId` is changed — never hand-edit it.
- `npm run deploy:test` and `npm run deploy:prod` call `set-script-id` first, then stamp-version, then `clasp push`. The two commands are the operator's deploy surface; the underlying script ID plumbing is invisible.
- `npm run deploy:test` is safe to run frequently (advances HEAD on the test project). `npm run deploy:prod` is a deliberate action.

### How it applies to unbound scripts

For any future unbound script project, TEST/PROD are distinguished by **deployment description prefix** rather than scriptId. `local.settings.json` stores:

```json
{
  "DEPLOYMENT_DESCRIPTION_PREFIX": "F3Go30"
}
```

`clasp deployments` lists all deployments; the managed-deploy script identifies the target deployment by matching `F3Go30-test` or `F3Go30-prod` in the description, then calls `clasp deploy --deploymentId <id>` to update it.

### clasp mechanics (findings integrated)

- **`doGet` on a bound project** — a bound project *can* be deployed as a web app and will get a `/exec` URL, but `getActiveSpreadsheet()` is unavailable in that context. Open the sheet explicitly with `SpreadsheetApp.openById(id)` or read the ID from Script Properties. Execution identity (run as me vs user) controls what files the web app can access.
- **`clasp run` behavior** — runs against the latest pushed code (dev mode) by default. `--nondev` runs the last *deployed* version. Requires Apps Script API enabled in the GCP project and appropriate OAuth scopes. Use `clasp run setScriptProperty` for scripted config changes (see PropertiesService pattern below).
- **PropertiesService helpers** — `clasp` has no built-in CLI for script properties. Add two tiny GAS helpers:
  ```js
  function setScriptProperty(key, value) {
    PropertiesService.getScriptProperties().setProperty(key, value);
  }
  function getScriptProperty(key) {
    Logger.log(PropertiesService.getScriptProperties().getProperty(key));
  }
  ```
  Push once, then `clasp run setScriptProperty --params '["GAS_LOGGER_PARENT_FOLDER_ID","<id>"]'` to configure without opening the GAS editor.
- **File deletion / push semantics** — there is no single-command delete for an individual remote file. `clasp push` replaces the remote project with the local tree — removing a file locally then pushing removes it remotely. Run `clasp show-file-status` and `clasp create-version` before any destructive push.

### Pros
- Single npm command per target; no manual `.clasp.json` editing.
- `set-script-id` makes the TEST/PROD boundary explicit and auditable.
- PropertiesService helpers eliminate the need to open the GAS editor for config changes.

### Cons
- Requires two separate script projects and two separate spreadsheets for the bound case. Initial setup is manual.
- `clasp run` for PropertiesService helpers requires Apps Script API enabled in GCP — one-time setup step.

### Risks
- **Wrong target push** — `npm run deploy:prod` with uncommitted test-only code in the tree. Mitigation: `set-script-id` logs the target before pushing; consider a git-clean check in the script.
- **Stale `.clasp.json` in repo** — if `scriptId` is committed, it will always show the last-pushed target. Document that `.clasp.json` `scriptId` is managed by `set-script-id` and should not be relied on as a source of truth for the current target.

---

## 4. Version stamping + managed deployment workflow — **Adopt**

### What to take

**Version stamping** — `tools/stamp-version.js` rewrites `script/version.js` with the current version from `package.json` + UTC build timestamp before every push. Fixes the stale `APP_VERSION = '2.0.0'` dated March 31.

**Managed deployment** — integrated with §3's `set-script-id` tool. The full push pipeline is:

```
npm run deploy:test   →  set-script-id test  →  stamp-version  →  clasp push -f
npm run deploy:prod   →  set-script-id prod  →  stamp-version  →  clasp push -f
```

`npm run push` remains available as a shorthand for stamp-version + push without changing the script target (for iterating on the current target).

**Leave:** the `npm version patch` → tag → deploy → post-release-bump chain. Tightly coupled to web-app deployment URLs we don't have. Use `bd` for change tracking; add git tags manually if needed.

### Node / npm dependency

Node and npm are already required for `clasp` — this is not a new dependency. Anyone who can `clasp push` already has Node available.

### How it would apply

1. `package.json` at repo root: `"version": "2.0.0"` and scripts `push`, `deploy:test`, `deploy:prod`.
2. `tools/stamp-version.js` (~30 lines): reads `package.json` version, writes `script/version.js`.
3. `tools/set-script-id.js` (~20 lines): reads `local.settings.json`, writes `script/.clasp.json` `scriptId`.
4. Bump version with `npm version patch` when tagging a release; otherwise push freely.

### Pros
- `APP_VERSION` in the running script always reflects what was actually pushed.
- Single command per deploy target; version stamp and script-ID swap are automatic.
- `local.settings.json` keeps credentials and IDs out of git.

### Cons
- Raw `clasp push` bypasses the stamp — same bypass risk as before, now also bypasses `set-script-id`. Document the `npm run` commands as the required push path.

### Risks
- Low. Stamp is idempotent; worst failure is a stale version string (status quo). `set-script-id` failing leaves `.clasp.json` unchanged rather than corrupting it.

---

## 5. Google Sheet verification via xlsx export — **Adopt (test-only)**

### How it would apply

This is the highest-leverage practice for F3Go30 given the recurring `test-scripts-require-live-validation` lesson.

Approach:
1. Maintain a **dedicated test tracker spreadsheet** (clone of a real tracker template) with sharing set to **Anyone with the link, Viewer**. This sheet contains no real PAX PII — just synthetic test data.
2. Python tests already in `/test/` (e.g. `test_tracker_init.py`, `inspect_spreadsheet.py`) gain a `download_xlsx(spreadsheet_id)` helper. After triggering a flow (form submit simulation, `copyAndInit`, etc.) that writes to the test tracker, the test downloads the sheet as xlsx and asserts on cells with `openpyxl`.
3. Deps: `requests`, `openpyxl`. Already have a venv at `/mnt/c/dev/venvs/uv1`.

This is the only way I see to satisfy AC on issues whose acceptance criteria reference live sheet state without hand-clicking through the spreadsheet — which is exactly what the `test-scripts-require-live-validation` memory says we currently can't do.

### Pros
- Directly addresses the recurring test-validation gap. Lets us close issues green with mechanical evidence rather than human inspection.
- No OAuth, no service account, no Sheets API quota concerns.
- Format-stable: `openpyxl` lets us assert on headers, rows, and named ranges.

### Cons
- Requires a *separate* test fixture sheet. We can't point this at real Site Q trackers because they contain PII and shouldn't be world-readable.
- Triggers in a bound script run as the spreadsheet owner; setting up an automated form-submit from Python requires either pre-publishing the form's `formResponse` URL or invoking GAS via a `doPost` shim. The latter is a small piece of net-new code.
- xlsx export reflects current sheet state, not a transactional snapshot; if a write is async we have to poll.

### Risks
- **Sharing drift** — someone changes the test sheet's sharing setting and tests start 401-ing on a Google sign-in HTML page. Mitigation: validate xlsx magic bytes on download (the source README does this).
- **PII leak by accident** — copying a real tracker into the test sheet would expose names/emails to the link. Mitigation: a `tools/scrub-tracker.gs` helper, or a checked-in fake-data seeder.
- **Form-submit driving** — if we choose to drive form submissions from Python via `formResponse`, the form structure can drift and break tests silently. Mitigation: also assert on form schema.

### Effort
Medium. The download helper is small; the test fixture sheet + form-driving harness is the bulk of the work.

---

## 6. Email verification via Gmail API / IMAP — **Adopt** (not in source repo)

### Why Playwright on Gmail is the wrong tool

Gmail's UI is more volatile than Sheets' (A/B layouts, threaded views, mobile vs desktop). There's a documented programmatic alternative that does exactly what we want, with stable contracts.

### How it would apply

1. **Dedicated test mailbox** — a Gmail account (e.g. `f3go30-test+verify@gmail.com` or a separate account) that receives all test-flow emails. The GAS code already sends to addresses derived from Config / form responses; tests use the test mailbox as the recipient by feeding it through the test fixture's PAX list.
2. **Reader, two options:**
   - **Gmail API** via `google-api-python-client` with OAuth refresh token. `users.messages.list(q='subject:... newer_than:1h')`. Stable, well-documented, scriptable.
   - **IMAP with an App Password** — simpler, works in CI, no OAuth setup. Use `imaplib` (stdlib) or `imap-tools`.
3. **Tests** trigger a flow (`onFormSubmit` via direct POST, or `nag_daily_` invoked via a test shim), poll the test mailbox for ≤30s, assert on subject / recipients / body.
4. **Correlation** — pass an `execId` (from the structured-logging upgrade) into the email body or subject so concurrent runs don't cross-match.

### What this catches that nothing else does

- **Double sends** (we shipped this bug — `sendGoalReuseEmail` + `sendResponseSettingsEmail` both firing per submission).
- **Missing emails** when an optional Config row is absent (the nag flow's `NAG_EMAIL` regression).
- **Wrong recipient / wrong template variable substitution** — neither unit tests nor xlsx assertions can catch these.

### Pros

- Programmatic, stable contract (Gmail API/IMAP have been around for decades).
- Fast (sub-second per check after the email lands).
- Composable with `execId` correlation from the structured-logging upgrade — same correlation ID in log file and email subject means full-flow assertions.

### Cons

- Requires a dedicated test mailbox + credentials management (App Password in `local.settings.json`, or OAuth refresh token).
- Email delivery is eventually consistent — needs a poll-with-timeout, typically 5–30s.
- Test flow has to actually send to the test mailbox, which means either (a) the test fixture's PAX list uses test mailbox addresses, or (b) the GAS code has a "test mode" that BCCs the test mailbox. (a) is cleaner.

### Risks

- **Mailbox drift / quota** — test runs accumulate messages. Mitigation: a teardown step that archives or deletes messages older than the run.
- **Anti-spam delays** — Google sometimes rate-limits programmatic email reads if the account is new. Mitigation: use an established account, not a freshly-created one.
- **PII in test emails** — same scrubbing concern as the test tracker sheet; use synthetic PAX data only.

### Effort

Small. ~half day to add an `EmailVerifier` Python helper and wire credentials.

---

## 7. Form submission verification — **Adopt (direct POST + one Playwright schema test)** (not in source repo)

### Why not Playwright for every form-submit test

Driving every form-submit test through Playwright on `docs.google.com/forms/...` re-tests Google's renderer on every assertion. Slow (~10s/test), brittle (Forms UI churn), and the `formResponse` POST endpoint is exactly what the renderer hits internally — we can hit it directly.

### Two-tier approach

**Tier 1: direct HTTP POST (the workhorse)**

```python
# tests/form_submit.py
import requests
def submit_form(form_id, entry_payload):
    url = f"https://docs.google.com/forms/d/e/{form_id}/formResponse"
    r = requests.post(url, data=entry_payload)
    r.raise_for_status()
    return r
```

- Field IDs (`entry.123456789`) discovered once from the rendered form, pinned as constants in a fixture.
- N tests use this. Fast, deterministic. Same payload Forms sends internally.

**Tier 2: one Playwright schema-invariant test**

```js
test('form schema is intact', async ({ page }) => {
  await page.goto(FORM_URL);
  // Assert: required questions are present
  await expect(page.getByText('What is your F3 name?')).toBeVisible();
  await expect(page.getByText('What is your email?')).toBeVisible();
  // Assert: question types haven't changed (text input vs radio vs grid)
  await expect(page.locator('input[type="text"]').first()).toBeVisible();
});
```

- Catches what direct POST misses: someone edits the form in the Forms UI, adds a required question, renames an existing one. Direct-POST tests would silently 200 OK while submitting incomplete responses.
- One spec, runs as a guard. If it goes red, regenerate the field-ID fixture for the direct-POST tier.

### Pros

- Direct POST is ~100x faster per test than Playwright on Forms.
- Schema drift is caught in exactly one place; the rest of the suite is fast and deterministic.
- Composes cleanly with the xlsx-export and email verification: submit → assert sheet write → assert email sent.

### Cons

- Field-ID discovery is a one-time manual step (or scripted via the schema test). If the form is regenerated from scratch (e.g. the monthly auto-generation creates a new form with new IDs), fixture must update.
- Direct POST bypasses any client-side validation Forms applies — bugs that depend on client-side validation behavior aren't caught here. Probably not a concern for our use case (server-side `onFormSubmit` is what we care about).

### Risks

- **Form regeneration churn** — `autoGenerateNextMonthTracker` creates a new form per month. Field IDs change monthly. Mitigation: re-discover IDs as a setup step in each test run, OR pin tests against a stable test-only form that doesn't get regenerated.
- **Captcha / abuse detection** — Forms doesn't currently captcha programmatic POSTs to `formResponse`, but Google could change this. Low probability, low mitigation cost (fall back to Playwright for the small number of submission tests).

### Effort

Small for direct POST (~half day). Half day for the schema-invariant Playwright test. Coupled with the email-verification work because most form-submit tests want to assert on both sheet writes AND emails.

---

## Recommended order of adoption

1. **Version stamping + managed deployment setup** — `package.json`, `stamp-version.js`, `set-script-id.js`, `local.settings.json`. Fixes stale version and establishes TEST/PROD push discipline. (~half a day)
2. **GasLogger.js integration** — copy from GAS-Practices, extend `_getFolder` for F3Go30 subfolder + fallback, add `execId` correlation at each trigger entry point, update `log_channel.py`. Provides correlation IDs used by 3 and 4. (~1 day)
3. **PropertiesService helpers + `clasp run` wiring** — `setScriptProperty` / `getScriptProperty` GAS helpers for scripted config (GAS_LOGGER_PARENT_FOLDER_ID etc.). (~half day)
4. **xlsx-export verification + test fixture sheet** — biggest impact on closing the live-validation gap. (~2–3 days)
5. **Email verification (Gmail API/IMAP) + test mailbox** — closes the email side-effect gap. (~half day)
6. **Form submission: direct POST + one Playwright schema test** — drives form-submit flows. Composes with 4 and 5 for full-flow assertions. (~1 day)
7. **Playwright spike** (half day) — confirm sidebar iframe and menu selectors are stable. Gate before 8.
8. **Playwright operator-flow harness** (3–5 specs) — only if 7 succeeds. Covers menu wiring, `copyAndInit` / `reinitializeSheets`, sidebar prompt round-trip. (~2–3 days)

## Open questions

- **Scrubbing strategy for the test tracker** — do we maintain it as a hand-curated synthetic fixture, or auto-generate it from a template?
- **Sidebar testability** — the HtmlService sidebar isn't covered by any of these patterns. Worth a separate think if we want assertions on sidebar behavior.
- **NoticeLog vs StructuredLogger** — should they be two facets of one helper, or stay separate? Today they have different audiences (sidebar vs file) but overlapping concerns.
