# Documentation Framework — Shared Standards

This file defines standards that apply identically across all tiers of the documentation
framework (Minimal, Standard, Extended). All tier prompts reference these standards.
Do not duplicate this content in tier prompts — reference it.

---

## Tier Overview

| Tier | Profile | Prompt File |
|------|---------|-------------|
| **Minimal** | Solo tool, 1–2 modules, one contributor | doc-bootstrap-minimal.md |
| **Standard** | Small team, multiple modules, internal stakeholders | doc-bootstrap-standard.md |
| **Extended** | Multiple stakeholder groups, compliance, distributed system, or safety-critical behavior | doc-bootstrap-extended.md |

Tier is determined during Phase 1 Discovery. The decision is recorded in CLAUDE.md and is
revisable as the project evolves.

**Tier escalation signals:**

| Signal | Escalate To |
|--------|------------|
| README.md exceeds ~800 words | Standard |
| More than two contributors | Standard |
| More than one runtime boundary | Standard |
| Multiple stakeholder groups with different quality expectations | Extended |
| Safety-critical behavior or compliance requirements | Extended |
| Regulatory or audit exposure | Extended |
| Distributed system with independent deployment boundaries | Extended |

---

## Use Case Scenario Format

Required for all use cases. Maximum 25 lines per use case.
Minimal tier: in README.md §CONTEXT. Standard and Extended: in CONTEXT.md.

```markdown
### UC-<N>: <Short Name>

Actor: <Primary actor>

Preconditions:
- <Condition>
- [If applicable] <Additional condition>

Primary Flow:
1. <Step>
2. <Step>
3. <Step>

Alternate Flows:
A1: <Condition> → <Outcome>
[If applicable] A2: <Condition> → <Outcome>

Postconditions:
- <Resulting system state>

Constraints:
- <Invariant or rule that must hold>
[If applicable] - <Additional constraint>
```

**Rules:**
- Implementation-neutral — no module or service names
- No "As a user" phrasing
- No diagrams inside use case blocks
- Durable and stable — not sprint-specific
- Omit Alternate Flows if none exist

---

## ADR Format

**Location:**
- Minimal: `/adr/NNNN-short-decision-name.md`
- Standard / Extended: `/docs/adr/NNNN-short-decision-name.md`

```markdown
# ADR-NNNN: <Short Decision Name>

Status: <Proposed | Accepted | Superseded | Rejected>
Date: <YYYY-MM-DD>
Supersedes: [If applicable] ADR-NNNN
Superseded by: [If applicable] ADR-NNNN

## Context
<What situation or problem prompted this decision. One to three sentences.>

## Decision
<What was decided. State it directly.>

## Consequences
<What becomes easier, harder, or different as a result.
For Proposed status: include the open question that must be resolved.>
```

**Rules:**
- Immutable once Accepted — supersede with a new ADR, do not edit
- Diagrams permitted only when they are the most concise expression of the decision;
  must be Mermaid
- One decision per ADR — do not bundle unrelated decisions

---

## Diagramming Standards

**Default: Mermaid.** Renders natively in GitHub and Claude Code, diffable in PRs,
generatable by AI agents without image handling.

| Location | Recommended Mermaid Type |
|----------|--------------------------|
| Runtime Architecture | `graph` or `C4Context` |
| Building Block / Code Structure | `graph` or `classDiagram` |
| Data Model | `erDiagram` |
| Deployment | `graph` |
| Runtime Scenarios / Failure Modes | `sequenceDiagram` |
| Quality Tree (Extended only) | `graph` |

**Diagram rules:**
- Readable in ≤60 seconds
- Prefer one high-value diagram over many small ones
- Do not duplicate clearly structured bullet or table content in diagram form
- Update diagrams when architecture changes
- CONTEXT.md and README.md §CONTEXT are diagram-free

**Escape hatch:** if a diagram cannot be expressed in Mermaid, store the image in
`/docs/assets/` and link from the relevant document with a comment:

```markdown
<!-- Mermaid not used: <reason> -->
![<Description>](../assets/<filename>)
```

---

## Writing Standards

- Current code takes priority over legacy docs when conflicts exist
- Bullet points over prose
- No marketing tone, narrative history, or duplicated explanations
- Scannable in ≤5 minutes per file
- All terms defined once in the Glossary
- Stable, descriptive headings — no clever or ambiguous names
- If verbose, simplify — do not expand
- **Empty sections must be omitted, not stubbed.** Remove placeholder stubs from
  finished documents. Add a section only when it has content.

---

## Graduation Rules

Content in PLAN.md graduates as follows:

| Content | Graduates To |
|---------|-------------|
| Resolved decision | ADR (Accepted) |
| Confirmed architecture | DESIGN.md (Standard/Extended) or README.md §DESIGN (Minimal) |
| Observed operational behavior | OPERATIONS.md (Standard/Extended) or README.md §OPERATIONS (Minimal) |
| New term in use | Glossary |
| Completed capability | §Capabilities / §Core Capabilities |
| Protocol quirk confirmed | /docs/interfaces/[protocol].md + ADR if decision required |
| Identified risk | §Risks (Extended) or BACKLOG.md §Debt (Standard/Minimal) |

---

## Trigger Rules

| Event | Required Action |
|-------|----------------|
| Decision made | Create or update ADR |
| Phase or milestone completes | Update PLAN.md |
| Architecture changes | Update DESIGN.md or README.md §DESIGN + affected diagrams |
| New capability ships | Add or update use case in CONTEXT / README.md §CONTEXT |
| Open decision resolved | Graduate from PLAN.md to ADR (Accepted); remove from PLAN.md |
| Story shipped | Delete from BACKLOG.md; update relevant use case |
| PLAN.md exceeds size target | Extract content to permanent documents before adding more |
| Any document exceeds size target | Flag to operator before expanding |
| External document updated | Update reference summary in /docs/references/ |
| New protocol behavior observed | Add to interface doc; create ADR if decision required |
| Tier escalation signal observed | Review tier classification in CLAUDE.md |

---

## Story Rules

- Stories are delivery units, not documentation
- Stories link to the use case they deliver (e.g. "Delivers UC-2")
- Stories are **deleted** when shipped — not archived
- The use case update is the permanent record of the delivered capability
- Never migrate a completed story into CONTEXT.md — update the use case instead

---

## Reference Document Handling

External documents (PDFs, specs, websites) must not be copied into project documentation.

1. Store the document in `/docs/assets/`
2. Create a summary in `/docs/references/` covering only sections relevant to this project
3. Add an entry to the References table in DESIGN.md
4. Add an entry to the Reference Index in CLAUDE.md
5. Document deviations and implementation-specific behaviors as ADRs
6. Add implementation-scoped detail to `/docs/interfaces/[protocol].md`

**Reference summary template:**

```markdown
# <Document Title>

Source: <File path in /docs/assets/ or URL>
Version: <Version or date retrieved>
Relevance: <One sentence — why this document matters to this project>

## Summary
<3–5 sentence overview of the document's scope and purpose>

## Relevant Sections

### <Section Name>
<Concise paraphrase of content relevant to this project.
Not verbatim — a useful summary of what matters here.>
[If applicable] ### <Additional Section Name>
<Paraphrase>

## Key Terms
[If applicable]
| Term | Definition |
|------|------------|

## Project-Specific Notes
[If applicable]
<How this project uses or deviates from this document's content.
ADR references where applicable.>
```

**Rules:**
- Summaries cover only sections relevant to this project
- Do not reproduce verbatim spec content — paraphrase and reference
- Keep each summary ≤800 words unless it is a primary protocol reference
- Update summary and note version change when source document updates

---

## Framework Installation

When a tier prompt is applied to a project, the following files must be copied into
`/docs/framework/` as part of Phase 2 scaffold creation:

| File | Action |
|------|--------|
| `doc-bootstrap-standards.md` | Always copy |
| Tier prompt matching this project | Always copy |
| Other tier prompts | Do not copy — store centrally |

Create `/docs/framework/README.md`:

```markdown
# Documentation Framework

This project uses the <Minimal | Standard | Extended> tier documentation framework.

| File | Purpose |
|------|---------|
| doc-bootstrap-standards.md | Shared standards — use case format, ADR format,
                               diagramming rules, writing standards, graduation rules |
| doc-bootstrap-<tier>.md | Tier prompt — run this to refactor or graduate
                            this project's documentation |

## Updating the Framework
Files in /docs/framework/ are read-only reference copies.
Do not edit them in place.
To update: obtain the revised files from the central tooling location
and replace them explicitly.

## Graduating to the Next Tier
Run the next tier prompt from the central tooling location against this repository.
After graduation, replace the tier prompt file in /docs/framework/ with the new tier.
```

**Rules:**
- Framework files in `/docs/framework/` are read-only — not edited per-project
- Framework updates come from the central tooling location and replace files explicitly
- CLAUDE.md must reference the framework location so AI agents can locate it

---

## CONTRIBUTING.md

`CONTRIBUTING.md` is an optional conventional file at the repository root. It is not
part of the CONTEXT / DESIGN / OPERATIONS structure and is not managed by the framework.

**Include CONTRIBUTING.md when:**
- More than one contributor works on the project
- Developer environment setup varies meaningfully by OS, IDE, or toolchain
- Project-specific conventions need to be stated for new contributors

**CONTRIBUTING.md covers:**
- Developer environment setup variations not covered by the canonical path in OPERATIONS.md
- IDE-specific configuration
- OS-specific notes beyond the standard activation command
- Contribution workflow (branching, PR expectations if applicable)

**OPERATIONS.md covers:**
- The canonical virtual environment setup — the standard path that works
- The Python version requirement reference (stated in CONTEXT.md §Constraints)
- Brief OS variation note for activation command

**CONTEXT.md covers:**
- Python version as a technical constraint

If CONTRIBUTING.md exists, CLAUDE.md should note it:
```markdown
## Contributing
See CONTRIBUTING.md for developer environment setup variations and
contribution workflow.
```

---

## Disposition Planning — Action Types

Used in Phase 1.5 across all tiers.

| Action | When to Use |
|--------|-------------|
| `Extract` | Content exists and belongs in a target document as-is or with minor rewrite |
| `Reconstruct` | Content existed previously but was removed; must be rebuilt from known source before that source is deleted |
| `Author` | No source exists; must be written from scratch |
| `Summarize` | External document exists; create AI-readable summary in /docs/references/ |
| `ADR — Accepted` | Decision is resolved; rationale exists; ready to write as accepted ADR |
| `ADR — Proposed` | Decision is real but unresolved; create stub ADR with open question in consequences field |
| `Stub` | Content is future-facing; create placeholder section in target document |
| `Hold in PLAN.md` | Current-state content; belongs in living tracker not a structured doc |
| `Hold in BACKLOG.md` | Identified but unscheduled work; not ready for PLAN.md |
| `Discard` | No durable value; safe to delete |
| `Escalate` | Insufficient information; flag for operator with a specific question |

---

*Monday, March 02, 2026*
