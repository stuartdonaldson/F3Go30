---
name: backlog
description: >-
  Execute the F3Go30 issue backlog in priority order with TDD verification and
  human-in-the-loop live testing. Use when the user says "work the backlog",
  "execute backlog", "work through issues", "clear the queue", or "/backlog".
  Handles claiming, implementing, simplifying, and batching issues for live
  verification before close. Enforces TDD gate for new features and prevents
  false-green closes on issues whose AC depends on live sheet or API state.
  Not for single-issue work — use bd show/update directly for that.
metadata:
  version: "1.0"
  status: documented
  validation: untested
  priority: high
  created: "2026-03-31"
  last_updated: "2026-03-31"
  depends_on: [implementation-gate, simplify, doc-trigger-check]
---

# Backlog Execution

**Goal:** Close real work, not just code — an issue is done only when its AC is verified against
the actual system, not when the code looks right.

## Setup

```bash
bd ready -n 50           # available work (no blockers)
bd list --status=open    # full picture including blocked
```

**Test scripts** (Python: `/mnt/c/dev/venvs/uv1/bin/python`):
- `test/test_tracker_init.py --log <logfile_url>` — verify a live initialized tracker
- `test/log_channel.py <drive_url>` — read LogFile entries directly
- LogFile URL: `https://drive.google.com/file/d/19CN6lyB8ksoAAubtfuTRCltpMIyy8ZWd/view`

## Execution Order

1. P0/P1 bugs — correctness risks in production
2. Quick-wins bundles (closing the finding bead + fix in one step is fine)
3. P2 bugs before P2 tasks
4. P2 tasks, then P3/P4

## Per-Issue Steps

1. `bd show <id>` — read full description and AC
2. `bd update <id> --claim` — claim it
3. Run `/implementation-gate` — required before touching any code
4. **New feature?** Write or update the test assertion first; confirm it fails; then implement
5. Make the change
6. Run `/simplify` on changed code
7. Run `/doc-trigger-check`
8. Classify for close (see Close Rules below)

## Close Rules

**Close immediately** — AC is structural (syntax, logic, no external state):
```bash
bd close <id>
```

**Hold for live-verification batch** — AC depends on live sheet, API, or Drive state:
- Accumulate 3–5 such issues before pausing
- Then ask the human to run:
  ```bash
  /mnt/c/dev/venvs/uv1/bin/python test/test_tracker_init.py \
      --log https://drive.google.com/file/d/19CN6lyB8ksoAAubtfuTRCltpMIyy8ZWd/view
  ```
- Share the full script output and ask: **"Do all checks pass?"**
- Close only after human confirms pass
- For quick-wins bundles: `bd close <finding-id1> <finding-id2> <bundle-id>`

## Commit & Push

- Commit atomically per logical unit (one file or one concern)
- Push at session end

## Anti-Patterns

**Pattern:** False-green close
**Symptom:** Issue closed after syntax/import check; behavioral AC never verified against live data
**Prevented by:** Close Rules — live-verification batch gate
**Found:** F3Go30 — declared green-phase done after import check; no sheet fixture used

**Pattern:** Skipping TDD for new features
**Symptom:** Feature implemented before test; test written to match implementation, not AC
**Prevented by:** Per-Issue Step 4 — write failing test first
