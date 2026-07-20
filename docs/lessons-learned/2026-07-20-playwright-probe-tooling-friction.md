# LL: Ad hoc live-verification tooling cost repeated retries via undocumented constraints

Date: 2026-07-20
Domain: process

## Observation

While live-verifying SIT behavior for bead F3Go30-bkxg (writing a temporary Playwright probe
script to observe the actual static-signup redirect landing before writing test assertions),
two tool-usage attempts failed and had to be retried with a different approach:

1. A `Bash` heredoc (`cat > /tmp/probe.spec.js <<'EOF' ... EOF`) containing JS with braces and
   quotes was rejected by the harness with "Contains brace with quote character (expansion
   obfuscation)," despite being a legitimate single-quoted heredoc with no shell-expansion risk.
   Switching to the `Write` tool succeeded on the first attempt.
2. The probe script was first placed at `/tmp/probe.spec.js` and run with
   `npx playwright test /tmp/probe.spec.js`, which returned "No tests found. Make sure that
   arguments are regular expressions matching test files." The project's Playwright config
   scopes `testDir` to `tests/playwright/`; copying the file there before rerunning succeeded.

## Why Chain (branched)

Branch A — Bash heredoc false-positive block
  Why 1 — The heredoc command was blocked before execution.
  Why 2 — The harness's static safety filter pattern-matches brace+quote combinations as a
          proxy for shell-expansion obfuscation attempts.
  Why 3 — The filter does not distinguish a safe single-quoted heredoc body (no shell expansion
          possible) from an actual injection risk.
  Root cause A: CLAUDE.md's "Shell Safety (Quoted Payloads)" section documents heredoc quoting
  for payload text with backticks/`$`, but does not note that the harness's own static filter
  can still reject a legitimate single-quoted heredoc on brace+quote content alone, nor does it
  name `Write` as the fallback for exactly that case — so the block was discovered by trial
  rather than anticipated.

Branch B — Playwright testDir silently excludes out-of-tree spec files
  Why 1 — `npx playwright test /tmp/probe.spec.js` reported no tests found, with no indication
          of why the explicitly-named file wasn't picked up.
  Why 2 — The project's Playwright config scopes `testDir` to `tests/playwright/`; a spec file
          outside that directory is invisible to test matching even when passed by exact path.
  Why 3 — No project documentation notes this constraint for one-off/throwaway probe scripts,
          so it had to be rediscovered by trial each time an ad hoc live check is needed.
  Root cause B: No documented note (in CLAUDE.md or a testing-oriented skill) that ad hoc
  Playwright probe scripts must be placed inside the configured `testDir` to be discoverable.

## Initial Candidates

Branch A: b — add one line to this project's CLAUDE.md "Shell Safety (Quoted Payloads)" section
noting that the harness's static filter can reject legitimate brace-containing heredocs
regardless of quoting, and that `Write` is the reliable fallback for such payloads.

Branch B: b — add one line to this project's CLAUDE.md (or wherever Playwright usage is
documented) noting that ad hoc/throwaway Playwright specs must live under `tests/playwright/`
(the configured `testDir`) to be runnable at all.
