# LL: open_spreadsheet.sh repeatedly failed and opened wrong spreadsheet

Date: 2026-03-31
Domain: tooling | deployment | scripting

## Observation
- Repeated edits to `tools/open_spreadsheet.sh` produced syntax/heredoc errors during iterative development.
- The script ultimately opened an incorrect spreadsheet URL found in a commented example inside `script/onOpen.js`.
- Attempts to `clasp push` from the agent environment failed because `clasp` was not available/authenticated in that runtime.
- Iterative edits and fixes required multiple user reports and manual guidance before the agent stabilized the script.

## Why Chain (multi-path)
Why 1 — The script used repo-wide regex heuristics to find a spreadsheet URL, which matched a commented example URL.
Why 2 — There was no authoritative mapping in the repo (no explicit `SpreadsheetId` key preferred by the opener), so heuristics were necessary and fragile.
Why 3 — The editing workflow applied incremental edits in the environment without robust local script validation (shellcheck, dry-run), allowing transient syntax errors to slip through.

Alternate path A (environment/tooling):
Why A1 — The agent attempted to run `clasp push` in an environment where `clasp` was missing or not authenticated.
Why A2 — The agent could not complete the live verification (copyAndInit) because an authenticated push/run step required user-local credentials.

Alternate path B (process/skill):
Why B1 — The implementation-gate/lessons-learned pattern was not invoked before changing code; changes were iterated live.
Why B2 — No pre-edit checklist existed (e.g., prefer explicit config keys, run `shellcheck`, run basic smoke-run) to catch the class of failures.

Root causes:
- Structural gap 1: No authoritative configuration for the bound spreadsheet (`SpreadsheetId`) — forced the opener to use heuristics.
- Structural gap 2: No enforced pre-edit validation and CI smoke checks for shell/script edits (editing-in-place without lint/validate).
- Structural gap 3: The agent's environment lacked necessary deployment tooling and credentials; the workflow assumed ability to push and verify remotely.

## Initial Candidates (lever tiers)
- Option A (tier b/a): Add `SpreadsheetId` to `script/.clasp.json` (or `dev-config.json`) and update `tools/open_spreadsheet.sh` to prefer this value. (Durable, low blast radius)
- Option B (tier c/d): Add a small skill/checklist and gate entry: "Prefer explicit `SpreadsheetId` in repo or env var" and require `shellcheck` + smoke-run before committing script edits. (Procedural + gate)
- Option C (tier a/c): Add automated CI checks: run `shellcheck` on `tools/*.sh`, and a lightweight syntax test (e.g., `bash -n`) in PRs. (Durable enforcement)
- Option D (tier b): Document and remove or tag example URLs in code (comments) that may be matched by heuristics; or change example URLs to `EXAMPLE_SPREADSHEET_ID_REDACTED`. (Targeted, reversible)
- Option E (tier f): Create a bd issue to track environment/credential requirement so that pushing from automation is explicit and gated. (Low durability — work item)

## Notes / recommended immediate actions
- Create `script/.clasp.json` or `dev-config.json` entry `SpreadsheetId` and update opener to prefer it (apply Option A first).
- Add `shellcheck` into local dev checklist and into CI for `tools/` (combine Option B+C).
- Tag/remove commented example spreadsheet URLs, or change their tokens so simple regex does not match (Option D).
- Create a bd issue to track enabling an automated push pipeline or documenting that `clasp push` must be run locally by the user (Option E).

## Files referenced
- `tools/open_spreadsheet.sh`
- `script/.clasp.json`
- `script/onOpen.js`
- `docs/clasp-help.md`
