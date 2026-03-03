# CLAUDE.md — F3Go30

## Framework Reference
**Tier:** Minimal
**Standards:** /docs/framework/doc-bootstrap-standards.md
**Tier prompt:** /docs/framework/doc-bootstrap-minimal.md
Framework files are read-only. Do not edit in place.
Central source: `C:\Users\stuar\OneDrive\Proj\DevStandard\docs\framework\`

## Reading Order
1. PLAN.md — current state, what is in flight
2. README.md — purpose, capabilities, architecture, operations
3. /adr/ — why key decisions were made
4. /docs/references/ — external document summaries and the Go30 Q tutorial script

## Document Map

| Content | Location |
|---------|---------|
| Purpose, capabilities, use cases, glossary | README.md §CONTEXT |
| Architecture, modules, data model, runtime risks | README.md §DESIGN |
| Installation, configuration, failure modes | README.md §OPERATIONS |
| Current state, backlog | PLAN.md |
| Technical decisions | /adr/ |
| Go30 Q tutorial narration script | /docs/references/go30-q-tutorial-script.md |

## Placement Rules
- All new capabilities → README.md §CONTEXT §Capabilities + use case if actor-driven
- All architecture changes → README.md §DESIGN
- All operational changes → README.md §OPERATIONS
- All resolved decisions → /adr/
- All new terms → README.md §CONTEXT §Glossary
- Do not create new top-level document types without reviewing scaling threshold

## Scaling Threshold
Expand to Standard tier when any of these are true:
- README.md exceeds ~800 words
- More than two contributors
- More than one runtime boundary
- Deployment becomes non-trivial
- A subproject relationship emerges

To expand:
1. Create /docs/ with CONTEXT.md, DESIGN.md, OPERATIONS.md, PLAN.md, BACKLOG.md
2. Migrate each README.md section to its corresponding document
3. README.md becomes a brief project intro with pointers to /docs/
4. Run the Standard tier bootstrap prompt to normalize the new structure

## Maintenance Protocol

### Session Start
When asked to review project state, before beginning any work:
1. Read PLAN.md — flag content that appears resolved and should graduate
2. Check README.md size — flag if approaching 800 words
3. Identify open decisions in PLAN.md ready to become ADRs
4. Report findings before proceeding

### Trigger Rules
See /docs/framework/doc-bootstrap-standards.md §Trigger Rules

### What Claude Will Not Do Automatically
- Monitor documents between sessions
- Detect drift without being asked
- Update documents without explicit instruction

To trigger a state review: "review project state before we start"

## Reference Summaries

| File | Source Document | Covers |
|------|----------------|--------|
| /docs/references/go30-q-tutorial-script.md | Script.md (original) | Go30 Q onboarding narration — steps to create a new monthly tracker |
