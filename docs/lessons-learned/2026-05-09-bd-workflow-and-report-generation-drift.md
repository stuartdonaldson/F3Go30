# LL: bd workflow and report generation drift under correction

Date: 2026-05-09
Domain: process

## Observation
During this session, the user had to correct the agent multiple times while working with bd artifacts and generated reporting.

Objective facts:
- The agent directly inspected and began editing `.beads/issues.jsonl`, despite a standing project instruction that this file is a bd system artifact and must not be manually used or updated.
- The first generated `bdreport.md` reported incorrect summary counts that did not match `bd status`.
- The first generated `bdreport.md` omitted the required Mermaid dependency chart.
- A later Mermaid chart added to `bdreport.md` contained invalid syntax and produced a parse error.
- The user explicitly intervened and directed the agent to use `bd update` rather than touching `.beads/issues.jsonl`, and to regenerate the report with correct counts and a valid Mermaid graph.
- Model context for the incident: the main assistant in this session is GPT-5.4. An earlier report generation step was delegated to a subagent invocation explicitly requesting `GPT-4o (copilot)`.

## Why Chain

Branch A — source-of-truth bypass
Why 1 — The agent interacted with `.beads/issues.jsonl` directly instead of treating `bd` CLI output as the only authoritative mutation/read path.
Why 2 — The agent optimized for immediate repository-local text editing rather than following the bd workflow boundary.
Why 3 — The current instruction stack contains the bd constraint, but no enforced pre-edit check prevented direct edits to bd-managed artifacts once a likely file path was found.
Root cause A: The workflow lacks an enforced guard that requires bd-managed state to be read and mutated only through `bd` commands rather than direct file access.

Branch B — generated report contract drift
Why 1 — The first `bdreport.md` was generated from invented or stale assumptions rather than validated live `bd` outputs.
Why 2 — The report generation step did not follow the documented `bd-report` procedure before writing the file.
Why 3 — The agent treated report writing as a generic summarization task instead of a constrained workflow with required sections and command-backed values.
Root cause B: The report-generation workflow was not anchored to its required live-command procedure before output was produced.

Branch C — delegation without post-generation validation
Why 1 — The initial report content was accepted from a delegated subagent result without validating key invariants against `bd status` and the required Mermaid graph contract.
Why 2 — The primary agent did not run a post-generation verification pass on counts, required sections, and Mermaid renderability before presenting the result.
Why 3 — Delegated output was treated as sufficient completion evidence even though the task had exact, checkable output requirements.
Root cause C: Delegated workflow outputs are not consistently subjected to mandatory local verification against explicit acceptance criteria before being returned.

## Initial Candidates
b: strengthen agent instructions around bd-managed artifacts and direct-file prohibition
c: update `bd-report` workflow to require explicit post-write validation against `bd status` and Mermaid render success
c: add or revise a workflow skill/checklist for “tool-owned artifact boundaries” (bd artifacts, generated tracker files, similar system state)
d: add a gate/checklist item for generated reports that require source-of-truth counts and required sections
e: record a delegation caution that subagent/model output is never sufficient for exact-format operational reports without local validation