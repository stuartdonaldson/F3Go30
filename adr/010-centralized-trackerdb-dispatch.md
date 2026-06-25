# ADR-010: Centralized Script Execution via TrackerDB Dispatch

Status: Accepted

Date: 2026-06-23

## Context

Under the copy-from-template model (ADR-002), each new monthly tracker is a full copy of the Go30 Template spreadsheet, including its bound script. Triggers (form-submit, daily −1 marking, nag email) are installed separately in each copy via a manual "Initialize Triggers" step, and each copy's script runs against its own `SpreadsheetApp.getActiveSpreadsheet()`.

This has three growing costs:

1. **Manual per-copy setup.** Every new month requires opening the copy and running "Initialize Triggers" before it functions correctly. Missing this step silently breaks nag emails and −1 marking for that month.
2. **Script Properties do not propagate to copies.** `SpreadsheetApp.copy()` duplicates sheets, formulas, and the bound script's *code*, but never its Script Properties store. Tokens and configuration (Axiom ingest token, GasLogger config, URL-shortener API keys) must be re-entered by hand on every copy, or — as currently done — worked around with a manually-set `IS_TEMPLATE_HOST` flag (`script/CreateNewTracker.js:672`) that exists purely to compensate for property isolation.
3. **No single place to run script changes.** A code fix must be pushed to the template and then re-pushed to whichever month spreadsheet is currently live (the `month` clasp deployment target), doubling release effort and creating drift risk between template and live-month code.

The project already has partial infrastructure pointing toward a different model:
- `TrackerDB` (`script/go30tools.js:23`) is a sheet in the Template that aggregates metadata (spreadsheet ID, URLs, form ID, start date) for every monthly tracker.
- The signup web app (`script/signupWebapp.js:275-303`) already resolves a target month's spreadsheet ID from a Links/TrackerDB-style lookup and opens it with `SpreadsheetApp.openById()` rather than assuming it's the active spreadsheet — proving the cross-spreadsheet dispatch pattern works in production.
- ADR-009 established a web app dispatcher as the standard way to invoke GAS functions from outside the bound script's own context, which is structurally the same problem.

## Decision

All scripts run from a single container: the Go30 Template's bound Apps Script project. Monthly tracker spreadsheets created by `copyAndInit()` are now **pure data spreadsheets** — they hold sheets and data only; they do not run their own triggers or logic.

Every function that previously assumed `SpreadsheetApp.getActiveSpreadsheet()` is the target tracker is refactored to:

1. Accept (or derive) a **context date** — the date for which the operation is being performed. Production callers (time-driven triggers, real form submissions) derive this from the actual current date; tests and tools pass it explicitly.
2. Look up the target tracker's spreadsheet ID in `TrackerDB` by matching the context date against each row's start date / active-month range.
3. Open the resolved spreadsheet with `SpreadsheetApp.openById()` and operate on it explicitly, never on the active spreadsheet.

Triggers (daily −1 marking, nag email, form-submit) are installed **once**, on the Template, and each invocation iterates the relevant `TrackerDB` rows (or resolves the one row matching "today") rather than running once per spreadsheet copy. Form-submit handling is bound per-form via the form ID stored in `TrackerDB`/Links, dispatching to the correct spreadsheet by form ID rather than by `forSpreadsheet()` context.

Because every function now runs in the Template's script project, Script Properties (Axiom token, GasLogger config, URL-shortener keys) are set once and are visible to all dispatched operations. The `IS_TEMPLATE_HOST` flag and its workaround become unnecessary.

### Testing implication

Because dispatch is keyed by context date rather than by "whichever spreadsheet I happen to be bound to," tests get an isolated, deterministic path: seed a `TrackerDB` row with a **future start date** pointing at a persistent Go30 Test/Dev spreadsheet, then call the dispatch functions with that future date as the context date. This exercises the real TrackerDB lookup and `openById()` path without touching the live current month's data and without mocking `Date.now()`/`new Date()`.

### Test/Dev spreadsheet

A persistent **Go30 Test** (or **Go30 Dev**) spreadsheet is maintained alongside the live Template, with its own `TrackerDB` row(s) at fixed future dates. It is reused across test runs rather than created/torn down per run. This reuses the existing `test` clasp deployment target (`tools/manage-deployments.js` `TARGETS.test`) and keeps live-month data isolated from test writes.

## Consequences

- New monthly trackers no longer need "Initialize Triggers" — there is nothing to initialize in the copy itself; the copy only needs a `TrackerDB` row.
- A code change is pushed once, to the template, and takes effect for every past, current, and future tracker immediately — no separate `month` deployment push.
- Script Properties configured once on the Template apply uniformly; the `IS_TEMPLATE_HOST` flag and its rationale comment (`CreateNewTracker.js:665-672`) can be removed once dispatch no longer depends on running inside a copy.
- The `month` clasp deployment target (`tools/manage-deployments.js` `TARGETS.month`) becomes unnecessary once all live functions are dispatched from the template; it can be retired after the migration.
- Every dispatch function gains a TrackerDB lookup and an `openById()` call, which is slower and has a different failure mode than operating on the active spreadsheet (a missing or ambiguous TrackerDB row now fails the operation instead of it silently running on the wrong sheet). Lookup failures must fail loudly (error/log), not silently no-op.
- Because the web app and all triggers now run against the Template's bound script, any deployment to the **template** target is live for production immediately — the template is no longer a safe place to test changes against real data. The persistent Go30 Test/Dev spreadsheet (above) is the substitute test environment going forward.
- TrackerDB's schema, previously read-only aggregate output (`script/go30tools.js:355-399` `_updateTrackerDB`), becomes a read path for execution dispatch as well as a write path for aggregation. Row matching (which row is "active" for a given context date) needs a defined, unambiguous rule — date ranges must not overlap.

## Future Refinement (deferred, not part of this decision)

An on-demand test environment may eventually replace the persistent Go30 Test/Dev spreadsheet above: a web-app-triggered command that (1) copies the Template, (2) copies the current live Tracker's data into the copy for realistic test data, (3) scrubs/redirects all email addresses so no real PAX or Site Q is notified, (4) writes a `TrackerDB` row for the copy with an out-of-band date range, and (5) becomes the standing target for deployment verification. This is explicitly out of scope for the initial migration. It is noted here so the `TrackerDB` date-range matching and `openById()` dispatch design is not built in a way that would preclude it — an out-of-band date range for an on-demand copy must resolve through the same lookup path as any other row, with no special-casing.

## Supersedes

ADR-002 (Copy-From-Template Approach) is superseded with respect to script/trigger ownership: monthly trackers are still created by copying the template spreadsheet (the Drive-copy mechanism in ADR-002 is unchanged), but the copy no longer carries its own running scripts or triggers — those now live solely in the Template and dispatch via TrackerDB. ADR-002's consequences describing "the copy includes the bound Google Form" and sheet/formula inheritance remain accurate; its implicit assumption that the copy also runs its own logic does not.
