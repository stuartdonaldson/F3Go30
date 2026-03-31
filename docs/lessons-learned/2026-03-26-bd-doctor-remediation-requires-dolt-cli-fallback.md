# LL: bd doctor remediation loop required raw dolt CLI fallback with no documented escalation path

Date: 2026-03-26
Domain: process | tooling | bd

## Observation

Clearing `bd doctor` warnings for "Dolt Status: config modified" required 5+ rounds:

1. `bd vc commit -m "..."` reported success and produced the same commit hash on every
   attempt, but `config: modified` persisted in doctor output after each run — silent
   no-op with success messaging.
2. `bd dolt commit` also reported "Committed" but produced the same hash — same problem.
3. `bd dolt commit` changed the shell working directory to `.beads/dolt/F3Go30`, causing
   the subsequent `bd doctor` call to fail with "no .beads/ directory found" — a
   destructive side effect of the command.
4. Resolution required fallback to raw dolt CLI: `dolt add config && dolt commit` executed
   from inside `.beads/dolt/F3Go30/` — not documented anywhere in bd's workflow.
5. After the raw dolt commit, doctor reported clean on the next run from project root.

## Why Chain

Why 1 — `bd vc commit` reported success but did not clear the dolt working set dirty state
Why 2 — `bd vc commit` scope does not include uncommitted table diffs in the dolt working
         set; it commits at a different layer than what `dolt diff` reports
Why 3 — The distinction between bd-level commit scope and dolt working-set commit scope is
         not documented; both commands appear equivalent from doctor's remediation message
Why 4 — `bd dolt commit` has a side effect (changes shell working directory to the dolt
         subdirectory) that breaks subsequent bd commands run without explicit `cd` back
Why 5 — No escalation path exists in any skill, guide, or framework document for when
         bd-level commits do not clear doctor dirty warnings
Root cause: bd commit commands have undocumented scope boundaries and working-directory
side effects; no documented escalation path to raw dolt CLI when bd-level commits
fail to clear dirty doctor state.

## Initial Candidates

- c: Create or update a bd doctor remediation skill/guide with explicit escalation:
     (1) `bd vc commit` first, (2) if still dirty: `bd dolt commit`, (3) if still dirty:
     `cd .beads/dolt/<db> && dolt add <table> && dolt commit`, (4) always run `bd doctor`
     from project root (not from inside .beads/dolt/)
- e: bd memory — "if bd vc commit does not clear config: modified, fall back to
     dolt add config && dolt commit from inside .beads/dolt/<db>/"
- a: Add note to DevStandard doc-standard or bd workflow documentation: bd doctor
     remediation has a three-tier escalation; raw dolt CLI is the fallback tier
