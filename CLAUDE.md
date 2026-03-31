# CLAUDE.md — F3Go30

**Tier:** Minimal
**Standards:** /docs/framework/doc-standard.md _(read-only — do not edit)_

## Reading Order
1. Current state — `bd prime` (auto-loaded when bd in use)
2. README.md §CONTEXT — purpose, capabilities, use cases
3. README.md §DESIGN — architecture, modules
4. README.md §OPERATIONS — how to run it
5. /adr/ — why key decisions were made
6. /docs/references/ — external document summaries

## Document Map

| Content | Location |
|---------|---------|
| Purpose, capabilities, use cases, glossary | README.md §CONTEXT |
| Architecture, modules, data model, runtime risks | README.md §DESIGN |
| Deployment, configuration, failure modes | README.md §OPERATIONS |
| Current state | `bd ready` |
| Identified work | bd issues |
| Technical decisions | /adr/ |
| Strategic themes | docs/VISION.md _(when created)_ |
| Roadmap, funnel | docs/ROADMAP.md |
| Go30 Q tutorial narration script | /docs/references/go30-q-tutorial-script.md |

## Placement Rules
- New capabilities → README.md §CONTEXT §Capabilities + use case if actor-driven
- Architecture changes → README.md §DESIGN + affected diagrams
- Operational changes → README.md §OPERATIONS
- Resolved decisions → /adr/
- New terms → README.md §CONTEXT §Glossary
- New risk identified → `bd remember`
- New initiative → docs/ROADMAP.md §Funnel
- Do not create new top-level document types — review tier escalation signals first (doc-standard.md §Tier Overview)

To expand:
1. Create /docs/ with CONTEXT.md, DESIGN.md, OPERATIONS.md
2. Migrate each README.md section to its corresponding document
3. README.md becomes a brief project intro with pointers to /docs/
4. Run the bootstrap prompt to normalize the new structure

## Maintenance Protocol

Claude does not monitor documents between sessions, detect drift, or update documents
without explicit instruction.

- At session start or phase transition: run `/session-start-check`
- After any code or architecture change: run `/doc-trigger-check`
- To trigger a state review: "review project state before we start"

## Memory System
| System | Scope | Use for |
|--------|-------|---------|
| `bd remember` / `bd memories` | Project-scoped | Project rationale, design decisions, process insights — travels with the repo |
| MEMORY.md (auto-memory) | User-scoped | User preferences, cross-project style conventions |

Do not use MEMORY.md for project rationale. Do not use `bd remember` for user preferences.

## Working
```
bd ready              # available work (unblocked, prioritized)
bd list               # all open issues
bd show <id>          # full issue detail with deps
bd update <id> --claim  # claim and start work (atomic: sets assignee + in_progress)
bd close <id>         # mark complete
/bd-report            # generate bdreport.md (snapshot with graph + narrative)
```

## Reference Summaries

| File | Source Document | Covers |
|------|----------------|--------|
| /docs/references/go30-q-tutorial-script.md | Script.md (original) | Go30 Q onboarding narration — steps to create a new monthly tracker |
