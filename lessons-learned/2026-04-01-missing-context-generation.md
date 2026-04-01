# LL: Incomplete CONTEXT/DESIGN generation from README source

Date: 2026-04-01
Domain: documentation

## Observation
- Requested: generate `CONTEXT.md` and `DESIGN.md` for the project based on `docs/framework` standards and the repo `README.md`.
- Assistant created `docs/CONTEXT.md` and `docs/DESIGN.md` in the parent `docs/` folder, but both drafts omitted several sections (full Constraints, complete Use Cases, full Stakeholders table, some Glossary items) despite that material being present in `README.md`.
- The user reported the omission and asked for a lessons-learned capture.

## Why Chain
## Why Chain

Primary path

Why 1 — The assistant produced condensed drafts rather than full, complete documents.
Why 2 — The assistant summarised content from `README.md` but did not exhaustively extract every section and table; some entries were paraphrased or left out.
Why 3 — The generation step prioritized concision and inferred which sections were "already present in README" rather than explicitly copying or expanding them into the new documents.
Root cause (path A): The capture process lacked an explicit data-extraction step to enumerate all `README.md` sections and map them to the required framework sections before drafting. The agent treated the README as a narrative source and produced a concise conversion instead of a deterministic, line-item migration.

Additional root-cause paths

Path B — Prompt/skill ambiguity

Why 1 — The assistant prompt/skill did not include an explicit instruction to "exhaustively list and map README sections to target document sections." 
Why 2 — Default assistant behaviour is to summarise and compress when asked to "create proposed CONTEXT.md and DESIGN.md" without being told to preserve every section verbatim.
Root cause (path B): Missing or underspecified generation prompt/skill that should require exhaustive extraction and verification.

Path C — Assumed acceptable scope

Why 1 — The assistant inferred that some content (detailed tables, complete use-case blocks) were acceptable to leave in the original README to avoid duplication.
Why 2 — There was no verification step comparing generated files against the framework's required section checklist.
Root cause (path C): Lack of an automated coverage verification step comparing generated outputs to the framework's required sections.

Path D — Placement and gating decisions

Why 1 — The assistant created files in the parent `docs/` folder rather than the repo's `/docs/` because the user requested placement "above this repository"; this introduced uncertainty about which canonical copy to update.
Why 2 — No gating rule ensured operator confirmation before writing canonical docs in the repo's expected location.
Root cause (path D): Missing pre-write gate and unclear placement rule enforcement in the workflow — lead to conservative or ambiguous placement choices and incomplete content.

## Initial Candidates

- a: Add a procedural checklist to the document-generation flow requiring explicit extraction of all `README.md` sections and a one-to-one mapping to `CONTEXT.md` and `DESIGN.md` sections before rendering. Include a generated mapping artifact (table) for review.
- b: Update the generation assistant skill or prompt template to include a mandatory "exhaustive extraction" phase when source README contains canonical content (list sections, tables, use-cases) — include a verification step that all framework-required sections are present and note any mismatches.
- c: Implement an automated coverage verification step that compares produced documents to `doc-standard.md` section requirements and emits a checklist report (pass/fail per section).
- d: Add a human confirmation gate (pre-write review) which requires the operator to approve the mapping table and a pass/fail coverage report before files are written to the canonical location.
- e: Add explicit placement rules to the prompt and verify the target path exists and complies with `doc-standard.md` placement rules (avoid ambiguous parent-folder captures).

## Action taken (capture)
- Created this staged lessons-learned file to record the incident and root cause variants.
- Did not apply fixes; resolution deferred to a batch review per `lessons-learned` process.
- Added recommended immediate actions: re-run generation with exhaustive extraction enabled; produce a section-coverage report and mapping table; request operator confirmation before moving files into canonical repo `docs/`.

## References
- [README.md](README.md) — canonical source of content that was partially copied
- `docs/framework/doc-standard.md` — target standards used for drafting
- Created files: `docs/CONTEXT.md`, `docs/DESIGN.md` (parent `docs/` folder)

## Suggested next step (resolve candidate)
- During resolve: choose one or more of the initial candidates. My recommendation for highest durability: apply option a (checklist + extraction) and option b (skill/prompt update), then enforce option d (human gate) the first two times this conversion runs. Option c (automated coverage report) provides fast, repeatable verification and should be added early.



## Action taken (capture)
- Created this staged lessons-learned file to record the incident and root cause.
- Did not apply fixes; resolution deferred to a batch review per `lessons-learned` process.

## References
- [README.md](README.md) — canonical source of content that was partially copied
- `docs/framework/doc-standard.md` — target standards used for drafting
- Created files: `docs/CONTEXT.md`, `docs/DESIGN.md` (parent `docs/` folder)

## Suggested next step (resolve candidate)
- During resolve: choose one or more of the initial candidates. My recommendation for highest durability: apply option a (checklist + extraction) and option c (skill/prompt update), then use a brief human gate (option d) for verification the first time this conversion runs.


## Additional data point — Model variance (Anthropic Sonnet 4.6)

Observation

- The user reports that Anthropic Sonnet 4.6 generated a `docs/CONTEXT.md` file in the editor with substantially more complete content than the assistant's draft (contained in the parent `docs/` folder). The Sonnet output included fuller Constraints, Stakeholders, and Use Cases.

Why chain (Path E)

Why 1 — Different models use different summarization and extraction heuristics; some preserve tables and blocks more faithfully.
Why 2 — The assistant's prompt/skill did not enforce an extraction-or-copy phase that would normalize output across models.
Root cause (path E): Model-level variance combined with an underspecified generation procedure allowed some agents (Sonnet) to produce more complete canonical drafts while others produced concise summaries.

Initial Candidates (address model variance)

- f: Add a model-comparison step to the generation workflow: run two or more models (e.g., Sonnet and current assistant) and produce a merged draft selecting the most complete sections from each output.
- g: Standardize the prompt/skill to require explicit extraction of all source sections (section headers and tables) and a machine-readable mapping artifact; use that mapping to force parity across models.
- h: Create a short human review step that shows the Sonnet output alongside the assistant output and the mapping table; operator picks the preferred draft or asks for reconciliation.
- i: Record verified authoritative drafts as the canonical artifact in the repo (commit or `docs/` placement) so subsequent agent runs have a single source of truth.

Action suggested (capture)

- Capture the Sonnet-generated draft into `docs/staging/` for review and comparison; include a diff against the assistant's draft and the original `README.md` source.
- Add a short test harness (script) that invokes both models with the same extraction prompt and emits a per-section coverage matrix showing which model preserved which sections.

References

- Sonnet-generated draft (user editor buffer)
- Assistant-generated drafts: `docs/CONTEXT.md`, `docs/DESIGN.md` (parent `docs/`)

Suggested next step (resolve)

- Run a model-comparison pass (candidate f) and use the mapping table from candidate a to reconcile the drafts. Enforce that the reconciled draft passes the automated coverage verification (candidate c) before writing to canonical `docs/` and closing this LL entry.


