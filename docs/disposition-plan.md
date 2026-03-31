# Disposition Plan — F3Go30

Generated: 2026-03-02  
Phase: 1.5 — Disposition Planning  
Tier: Minimal

---

## Section 1 — Disposition Table

| # | Item | Source | Recommended Action | Target | Prerequisite | Operator Decision |
|---|------|--------|--------------------|--------|--------------|-------------------|
| 1 | Existing README.md | README.md | Rename → README-OLD.md, then author new README.md from Minimal template | README.md (new) | None | |
| 2 | Script.md (video narration) | Script.md | Move to docs/references/ | docs/references/go30-q-tutorial-script.md | None | |
| 3 | TODO.md (code review findings) | TODO.md | Migrate content into PLAN.md §Backlog and README.md §DESIGN §Runtime View; rename to TODO-OLD.md | PLAN.md, README.md | #1 complete | |
| 4 | LICENSE | LICENSE | Keep — no changes | Root | None | |
| 5 | README.md §CONTEXT — Introduction & Goals | README-OLD.md prose | Migrate + condense | README.md §CONTEXT | #1 | |
| 6 | README.md §CONTEXT — Constraints | None (must be authored) | Author — GAS runtime limits, owner-account requirement, Google Drive dependency | README.md §CONTEXT | #1 | |
| 7 | README.md §CONTEXT — Capabilities | README-OLD.md §Key Features | Migrate + reformat as durable capabilities (not sprint stories) | README.md §CONTEXT | #1 | |
| 8 | README.md §CONTEXT — Use Cases | README-OLD.md + Script.md flows | Author 2–3 UCs: Q-copies-tracker, PAX-submits-HC, Daily-miss-marking | README.md §CONTEXT | #1 | |
| 9 | README.md §CONTEXT — Non-Goals | None (must be authored) | Author — e.g., not a public SaaS, no multi-region coordination, no CI/CD pipeline | README.md §CONTEXT | #1 | |
| 10 | README.md §CONTEXT — Glossary | None (must be authored) | Author — PAX, HC, Q, Site Q, Go30, FNG, Tracker sheet, Bonus Tracker | README.md §CONTEXT | #1 | |
| 11 | README.md §DESIGN — Solution Strategy | README-OLD.md (scattered) | Author — copy-from-template pattern, owner-only menu rationale, form linking constraints | README.md §DESIGN | #1 | |
| 12 | README.md §DESIGN — Runtime Architecture | None (must be authored) | Author Mermaid diagram: Q opens sheet → menu → copy/init → triggers → PAX submits form → onFormSubmit → daily cron → markMinusOne | README.md §DESIGN | #1 | |
| 13 | README.md §DESIGN — Building Block View | None (must be authored) | Author module table: Entry Points, Tracker Lifecycle, UI/Notifications, Utilities, Dead Code (experimental) | README.md §DESIGN | #1 | |
| 14 | README.md §DESIGN — Runtime View | TODO.md §Potential errors / risks | Migrate error/edge-case findings as key runtime scenarios | README.md §DESIGN | #1, #3 | |
| 15 | README.md §DESIGN — Data Model | None (must be authored) | Author sheet inventory: Tracker, Responses, Help, Bonus Tracker, Activity (hidden) | README.md §DESIGN | #1 | |
| 16 | README.md §OPERATIONS — Deployment | README-OLD.md §Installation | Migrate + condense | README.md §OPERATIONS | #1 | |
| 17 | README.md §OPERATIONS — Configuration | README-OLD.md §URL Shortener Setup | Migrate + reformat as env-var table | README.md §OPERATIONS | #1 | |
| 18 | README.md §OPERATIONS — Failure Modes | TODO.md §Potential errors / risks | Migrate risks as symptom/recovery table | README.md §OPERATIONS | #1, #3 | |
| 19 | PLAN.md | None + TODO.md backlog | Author PLAN.md with In Progress, Next, Backlog (from TODO.md §Improvements / next steps) | PLAN.md | #3 | |
| 20 | CLAUDE.md | None | Author from Minimal template | CLAUDE.md | #1, #19 | |
| 21 | /adr/ directory + stubs | None | Create /adr/ with stub for each ADR candidate (see #22–#27) | /adr/ | None | |
| 22 | ADR: Owner-only menu pattern | onOpen.js comment + README-OLD.md | Author ADR — decision to restrict menu to spreadsheet owner | /adr/001-owner-only-menu.md | #21 | |
| 23 | ADR: Copy-from-template approach | README-OLD.md prose | Author ADR — copy current sheet vs. build from scratch | /adr/002-copy-from-template.md | #21 | |
| 24 | ADR: TinyURL as default shortener | README-OLD.md §URL Shortener Setup | Author ADR — TinyURL primary, Bitly optional | /adr/003-tinyurl-default-shortener.md | #21 | |
| 25 | ADR: Experimental form generation deferred | README-OLD.md §Experimental, TODO.md | Author ADR — why programmatic form copy is not production-ready | /adr/004-experimental-form-generation-deferred.md | #21 | |
| 26 | ADR: V8 runtime | appsscript.json | Author ADR — V8 over Rhino | /adr/005-v8-runtime.md | #21 | |
| 27 | ADR: 24-hour grace period for −1 marking | markMinusOne.js comment | Author ADR — daily cron runs at 1 AM, checks 2 days prior | /adr/006-daily-minus-one-grace-period.md | #21 | |
| 28 | script/FORMCONFIRMATIONMESSAGE.js | script/ | Keep file; document as experimental/dead code in README.md §DESIGN §Building Block View | README.md §DESIGN | #13 | |
| 29 | script/formManager.js | script/ | Keep file; document as experimental/dead code in README.md §DESIGN §Building Block View | README.md §DESIGN | #13 | |
| 30 | script/macros.js legacy overlap | script/macros.js | Document in Building Block View as legacy entry-point layer; flag relationship to onOpen.js | README.md §DESIGN | #13 | |
| 31 | /docs/framework/ files | DevStandard repo | Copy doc-bootstrap-standards.md + doc-bootstrap-minimal.md into /docs/framework/; create /docs/framework/README.md | /docs/framework/ | None | |

---

## Section 2 — Escalation Block

```
Item #:    2
Item:      Script.md (Go30 Q video narration script)
Question:  Is this document still current and intended to be maintained, or is it
           a one-time artifact? If maintained, it belongs in docs/references/.
           If it is a historical artifact with no future use, it can be archived
           with TODO-OLD.md instead of moved to docs/references/.
Answer:    This may be out of date, but is intended to be updated to current and maintained.
```

```
Item #:    22–27
Item:      ADR candidates (6 total)
Question:  Do you want all 6 ADRs authored, or only the most consequential ones?
           Suggested minimum set: #22 (owner-only menu), #23 (copy-from-template),
           #25 (experimental form deferred). Items #24, #26, #27 capture lower-stakes
           choices and could be deferred or folded into prose in README.md §DESIGN
           §Solution Strategy instead of separate ADR files.
Answer:    Keep all except #26
```

```
Item #:    30
Item:      script/macros.js legacy overlap with onOpen.js
Question:  macros.js contains startNewMonth(), initNewMonth(), clearTriggers(),
           initTriggers() which partially duplicate trigger setup logic in onOpen.js
           and addResponseOnSubmit.js. Should this be documented as intentional
           (legacy entry points kept for compatibility) or flagged as a cleanup target
           in PLAN.md §Backlog?
Answer:  Flagged for cleanup
```

---

## Section 3 — Processing Instructions

## How to Complete This File

1. Review each row in the Disposition Table
2. Add your decision to the `Operator Decision` column:
   - `Approve` — proceed as recommended
   - `Modify: [your instruction]` — proceed with changes you specify
   - `Escalate` — needs discussion before action
   - `Discard` — drop this item entirely
3. Answer each question in the Escalation Block or write `Defer`
4. Save the file then paste the following prompt into Claude Code:

---

### Resume Prompt

I have updated /docs/disposition-plan.md with my decisions.
Please:
1. Read /docs/disposition-plan.md
2. Confirm your understanding of each operator decision
3. Flag any decisions that conflict or create downstream problems
4. Produce a revised disposition table reflecting all modifications
5. Confirm readiness to proceed to Phase 2 — Scaffold Creation
6. Do not begin Phase 2 until I confirm
