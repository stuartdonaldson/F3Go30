---
name: "work-log"
description: >-
  Append a timestamped work summary to project work-log.md with consistent formatting. 
  No argument: auto-summarize current session. With argument: use as filter prompt to identify relevant session info.
  Ensures date headers exist, writes atomically via single Bash heredoc, and displays the result.
argument-hint: "[optional filter prompt]"
compatibility: "claude-code"
metadata:
  category: "project-management"
  version: "2.0"
  status: "documented"
  validation: "tested"
  priority: "medium"
  created: "2026-05-08"
  last_updated: "2026-05-08"
---

# /work-log

Keep a project activity log without manual formatting — date headers, consistent structure, single atomic append.

## When to Use

**Explicit (no filter):** `/work-log` alone at end of session to auto-summarize what was accomplished.

**Explicit (with filter):** `/work-log "focus area"` to extract only session work matching that prompt (e.g., `/work-log "tests"` logs only test-related work).

**Auto-trigger:** Could extend to fire on session end or after `git commit`.

**Gate:** End of work session; post-commit or before pushing.

**Not needed:** Project uses formal CHANGELOG.md or treats git commits as the record.

## Addresses

- Manual work log entry forgotten or lost
- Inconsistent formatting (missing date headers, wrong indentation)
- Multiple file writes instead of atomic append

## Input

**Type:** Command invocation  
**Format:** `/work-log` (auto-summarize) or `/work-log [filter prompt]` (guided capture)  
**Required:** Nothing (defaults to auto-summary)  
**Optional:** Filter prompt to identify specific session work (e.g., "bug fixes", "tests", "documentation")  
**Minimum:** `/work-log`

## Procedure

1. **Determine mode** → If argument provided, use as filter prompt (guided capture); otherwise proceed to auto-summary
2. **Auto-summarize or filter** → No arg: analyze session context to extract accomplishments and changes; With arg: use prompt to identify matching work from session
3. **Add timestamp** → Include HH:MM:SS in log entry (system time at log invocation)
4. **Locate work-log.md** → Check for file in project root (`./work-log.md`) | Fail: note to user, create empty file and continue
5. **Check date header** → Read file and look for `## YYYY-MM-DD` matching today's date | Fail: assume no header; continue without check
6. **Append via heredoc** → Run `cat >> work-log.md << 'EOF'` with summary and timestamp, single Bash call | Fail: display error, abort, suggest manual edit
7. **Display result** → Show last 15 lines of updated file | Fail: read-back failed; user should verify manually
8. **Suggest context clear** → Display message: "Cache context grown large? Run `/clear` to clean up session history." | Do not auto-invoke /clear

## Success Criteria

- Summary appended to work-log.md (verify: `tail -5` shows new content with no truncation)
- Date header exists and matches today (verify: `grep "## YYYY-MM-DD"` returns current date)
- Timestamp included in log entry (verify: HH:MM:SS visible in appended line)
- File remains readable and valid (verify: file size increased, bash command returned 0)
- User sees final state (verify: output shows last 15 lines, date header and timestamp visible)
- Cache-clear suggestion displayed (verify: message shown to user, no auto `/clear` invoked)

## Examples

### Example 1: Auto-summary (no argument)

**Input:** `/work-log`

**Analyzes:** Current session context  
**Expected output:**
```
## 2026-05-08

14:32:15 — Fixed auth validation bug in login flow; added 12 unit tests; reviewed and approved 3 PRs
```

### Example 2: Filtered capture (with argument)

**Input:** `/work-log "tests"`

**Analyzes:** Session context, filters for test-related work  
**Expected output:**
```
## 2026-05-08

14:42:08 — Tests: Added 12 unit tests for auth module, refactored test fixtures, integrated with CI pipeline
```

**Actual:** File appended atomically, user sees confirmation with updated content and cache-clear suggestion.

## Anti-Pattern

**Pattern:** Overwriting file with `>` instead of appending with `>>`  
**Symptom:** Entire work log history lost, file contains only most recent entry  
**Prevented by:** Procedure always uses `>>` (append) and single-call heredoc  
**Found:** Bash errors when testing initial implementation

## Related

- **git commit messages** — source of truth for individual changes; work-log summarizes sessions
- **CHANGELOG.md** — formal release notes; work-log is operational daily record
