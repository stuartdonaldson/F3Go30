# LL: Framework upgrade procedure not robust to real-world project variation

Date: 2026-03-26
Domain: documentation | process

## Observation

During the F3Go30 framework upgrade to v2.1 (applied 2026-03-26), the Use Case 2
upgrade procedure in `docs/framework/README.md` could not be followed as written.
Three gaps surfaced, caught by the operator during execution:

1. Step 1 ("note version in `/docs/framework/README.md`") failed — README.md had been
   deleted in a prior partial migration. No guidance existed for this degraded entry state.

2. Steps 2–4 reference `/docs/README.md` and Standard+ templates. Project is Minimal
   tier — those targets do not exist. No tier branching is specified in the use case.

3. `CLAUDE.md` template has no managed-section markers. Framework-standard sections
   (Reading Order, Document Map, Placement Rules, Maintenance Protocol, Memory System)
   are visually indistinguishable from project-specific customisations during upgrade.

All three gaps were identified through operator observation, not through any process check.
The upgrade was completed successfully but required judgment calls not supported by the
existing procedure.

## Why Chain

**Cluster A — Upgrade procedure not robust to real-world variation (Gaps 1 and 2)**

Why 1 — The upgrade procedure could not be followed as written
Why 2 — Steps assume a clean prior state (README.md present) and a single tier (Standard+)
Why 3 — Use Case 2 was authored against one idealized scenario without branching
Why 4 — No scenario analysis was performed for degraded entry states or tier variation
Root cause: Upgrade use case was authored for a single happy path; no resilience branches
exist for partial-apply entry state or Minimal-tier execution.

**Cluster B — Managed-section convention incomplete (Gap 3)**

Why 1 — Operator could not identify framework-boilerplate vs project content in CLAUDE.md
Why 2 — No managed-section comment marks the boundary in the CLAUDE.md template
Why 3 — The managed-section pattern exists in `planning-docs-README.md` but was not
         applied to `CLAUDE.md` when the convention was established
Root cause: Managed-section convention defined but not consistently propagated to all
upgrade-affected templates.

## Initial Candidates

Cluster A:
- a: Update Use Case 2 in `docs/framework/README.md` — add partial-apply detection
     step ("if README.md absent, prior upgrade was incomplete — proceed to Step 1")
     and add Minimal-tier variant for Steps 2–4 ("Minimal tier: skip Steps 2–4;
     framework files have no Standard+ document counterparts")

Cluster B:
- c: Add managed-section comment to `CLAUDE.md` template — mark the framework-boilerplate
     block (from `## Reading Order` through `## Memory System`) with the same pattern
     used in `planning-docs-README.md`: "On framework upgrade, replace this section..."
