# ADR-014: Namespace-Scoped Template Resolution (NamespaceDB) for On-Demand Environments and Multi-Tenancy

Status: Accepted

Date: 2026-07-09

## Context

ADR-010 centralized all execution in the Go30 Template's bound Apps Script project, dispatching to the correct monthly tracker by matching a **context date** against `TrackerDB` rows. Its "Testing implication" recommended a *persistent* Go30 Test/Dev spreadsheet at a fixed future date, and its "Future Refinement" section explicitly deferred an **on-demand** test environment (copy the Template + realistic scrubbed data, register a `TrackerDB` row, drive dispatch against it). This ADR decides that deferred refinement and generalizes it.

The `SMOKE_MODE` single-shared-tracker approach it was meant to replace keeps hitting the same structural wall from different angles (tracked under F3Go30-4j4o):

- Date-based dispatch (`resolveTrackerForContextDate`/`resolveDashboardMonth_`) deliberately excludes smoke trackers, so any path resolving its target by date silently can't reach the smoke tracker (checkin day matching — F3Go30-jldr; bonus actions — F3Go30-4j4o.1).
- Only one smoke tracker can exist at a time, so a scenario needing two months at once (cross-month bonus-edit relocation — F3Go30-4j4o.2) cannot be set up through the public flows.
- Teardown has historically leaked triggers, eating the per-project trigger cap.

Two pieces of infrastructure already point at the answer:

- `script/CopyTemplate.js` stands up a fully isolated environment: it copies the Template (+ its bound script) and the N most recent real trackers into a new Drive folder, rebuilds that copy's `TrackerDB`/`PaxDB` from scratch, and forces two safe-mode Config values — `Email Test Mode=Yes` and `NameSpace=<folderName>` (`computeSafeConfigDefaults_`). It deliberately installs no triggers, forms, or short links.
- The webapp handler tree is **already** parameterized on the target spreadsheet: `signupWebapp.js` and `bonusWebapp.js` contain **zero** `getActiveSpreadsheet()` calls — every handler takes a `templateSpreadsheet` argument. Only ~8 entry points (`WebApp.js` render/post/admin; `dashboardWebapp.js` `buildCheckinPageOutput_`/`renderCheckinPageForTypedIdentify_`/`handleCheckinPost_`) hardcode `SpreadsheetApp.getActiveSpreadsheet()`. The admin path already uses a `payload.sheetId ? openById(...) : getActiveSpreadsheet()` pattern — a working precedent for request-directed targeting.

Six questions were open on the epic (F3Go30-i5md) and are resolved below: (1) which Config items the copy must change; (2) which paths follow the namespace vs. stay bound; (3) how the identifier is passed per request; (4) security on the `ANYONE_ANONYMOUS` surface; (5) email scrub of realistic data; (6) create/teardown lifecycle.

## Decision

Introduce a **namespace (`ns`) parameter** that, when present on a webapp/admin request, redirects that request's spreadsheet resolution from the bound Template to a namespace-scoped Template copy. A **`NamespaceDB` registry sheet** (in each deployment's bound Template) maps `ns → templateId` and is the authoritative allowlist. Absent `ns`, behaviour is exactly as today (the bound spreadsheet). This is the general multi-environment substrate; the SIT on-demand smoke environment is its first consumer.

### D1 — Resolution seam and default (Q2, Q3)

A single helper `resolveTemplateSpreadsheet_(e)` reads `e.parameter.ns` (GET) / the echoed `ns` field (POST), resolves it through `NamespaceDB`, and returns the target Template `Spreadsheet`. The ~8 entry points that hardcode `getActiveSpreadsheet()` are the only sites changed; every downstream handler already accepts the resolved spreadsheet as its `templateSpreadsheet` parameter. **Absent or unresolved `ns` ⇒ the bound spreadsheet** — identical to current production behaviour.

### D2 — NamespaceDB registry as lookup *and* allowlist (Q3, Q4; F3Go30-i5md.5)

`ns → templateId` is resolved **only** through the `NamespaceDB` registry sheet in the executing deployment's bound Template. The `NameSpace` Config value, the folder name, and the filename markers all live *inside* the copy and therefore cannot be the resolution key from the executing side; the registry is authoritative. Because the webapp is deployed `ANYONE_ANONYMOUS`, a request-supplied identifier that could open an arbitrary spreadsheet is an attack surface — the registry closes it: an `ns` not present in `NamespaceDB` is rejected (falls back to the bound spreadsheet), so anonymous callers can never redirect execution to an unregistered sheet. Registry columns:

| Column | Purpose |
|--------|---------|
| `NameSpace` | The `ns` key callers pass. |
| `TemplateId` | Spreadsheet id of the namespace's Template copy. |
| `Kind` | `smoke` \| `regional` \| `demo` (see D7). Informs trigger/scrub semantics only — never email policy. |
| `NagEnabled`, `MinusOneEnabled`, `AutoGenerateEnabled`, `CleanupSessionsEnabled` | Per-trigger fan-out opt-in (see D4). |

### D3 — Client round-trip of `ns` (Q3; F3Go30-i5md.3)

Apps Script serves page content into a nested sandbox iframe whose own `src` carries no query string (already documented in `renderSignupPage_`, confirmed live 2026-07-04). Therefore `ns` **cannot** ride along on the client automatically. It must be: read server-side in `doGet`, injected into the page template, and **echoed back in the body of every `callApi()` POST** (or as a hidden field) — exactly as `targetMonth`, the session `id`, and the saved checkin token are handled today. This plumbing across the signup, checkin, and bonus pages is the bulk of the implementation, not the resolution seam.

### D4 — Trigger scope boundary: request follows `ns`, time-triggers fan out, onFormSubmit deferred (Q2)

- **Request-driven paths** (`doGet`/`doPost`/admin) follow `ns` per D1.
- **Time-based triggers** — `sendNagEmail`, `markEmptyCellsAsMinusOne`, `MONTHLY_AUTO_GENERATE_HANDLER_`, `cleanupStaleCheckinSessions` — **fan out** over `{parent bound Template} ∪ {NamespaceDB rows whose matching per-trigger column = Enabled}`, all within one execution. The parent is processed first; each namespace is wrapped in its own `try/catch` so one namespace's failure cannot abort the parent or siblings; the loop is N-bounded (the 6-minute trigger limit). In PROD, `NamespaceDB` is normally empty, so there is no fan-out; SIT holds only a handful of registered environments.
- **`onFormSubmit` is deferred** (F3Go30-i5md, secondary). Unlike the time-based triggers — which all fire from the single bound script and can simply loop over more spreadsheet ids — `onFormSubmit` is a *per-spreadsheet installed* trigger, and every copy carries its own bound script (Drive copies duplicate the container-bound project). Routing form submissions to the code-under-test therefore requires either accepting the copy's snapshot code or installing cross-project triggers that map the event's source spreadsheet back to a namespace (via form name/containing folder). That work is entangled with the standalone-project migration (see Future Refinement) and is intentionally left parked rather than solved twice.

### D5 — Config isolation and email safety (Q1, Q5)

Two classes of configuration must be distinguished:

- **Script Properties** (`TINYURL_ACCESS_TOKEN`, `WEBAPP_URL`, Axiom sink/GasLogger config) are supplied by the **executing deployment** (SIT or PROD), *not* by the namespace. Because resolution swaps only the target spreadsheet (data), the copy never needs — and never uses — its own Script Properties. This sidesteps the property-isolation problem ADR-010 called out: there is nothing to re-enter on a copy.
- **Config-sheet rows** are the only settings that follow the namespace. At **copy time**, `CopyTemplate` forces exactly the fail-safe minimum:

  | Config row | At copy time | Rationale |
  |------------|--------------|-----------|
  | `Email Test Mode` | **forced `Yes`, unconditionally** | A freshly copied environment can never silently inherit live-email. Applies to *every* kind, including `regional`. |
  | `NameSpace` | set to `<folderName>` | Isolates naming; matches the registry `ns`. |

  All other Config-sheet values (`Site Q`, `Nag Email?`, `ReminderEmailTemplate`, `Signup HC Form`, `Signup Short URL`, `LogFile`) are **not** auto-rewritten. They are adjusted **manually** during provisioning according to the tenant's `Kind`.

  **Email Test Mode is never made `Kind`-aware.** Every copy lands email-safe by construction. Turning a `regional`/`demo` tenant live is a **deliberate manual step** taken by an operator *after* the pre-existing `TrackerDB`/`PaxDB` and Config settings have been reviewed — live email is never armed automatically. This preserves the invariant `CopyTemplate`'s header already protects: never clean a copy's Config back toward PROD's values, or you silently re-arm live sends. For `smoke`/`demo` kinds, `Email Test Mode=Yes` (redirect/suppression) *is* the scrub for send paths; realistic PAX/Site-Q data copied into those kinds is protected by leaving the fail-safe on.

### D6 — Lifecycle: provision and teardown (Q6; F3Go30-w6y3, F3Go30-i5md.4)

- **Provision.** The typical flow is: the **SIT** deployment copies the **PROD** environment into a new folder and registers it in **SIT's** `NamespaceDB`. `copyTemplateToNewEnvironment_` currently copies `SpreadsheetApp.getActiveSpreadsheet()` — run from SIT it would copy SIT, not PROD. It must take an explicit **source = PROD Template id**, decoupled from the **destination registry = active (SIT)**. On success it writes the `NamespaceDB` row (`NameSpace`, `TemplateId`, `Kind`, trigger columns).
- **Teardown.** Remove the `NamespaceDB` row (which immediately makes the namespace unresolvable — the primary safety cut) and optionally trash the folder and all its files. This replaces per-tracker `cleanupTracker` teardown for whole environments and structurally avoids the trigger-leak failure mode, since a namespace-scoped environment installs no triggers of its own.

### D7 — Multi-tenancy generalization (Kind)

`NamespaceDB` in PROD is **not** test-only: the same seam can host **regional** deployments and a **demo** tenant. The `Kind` column (`smoke` | `regional` | `demo`) informs trigger fan-out opt-in and data-scrub expectations, but — per D5 — **never** email policy. Building the seam as a general multi-tenancy substrate (rather than a test-only mechanism to be re-generalized later) is a deliberate part of this decision.

## Consequences

- The refactor is small at the resolution layer (~8 entry points) but broad at the client layer (D3 round-trip across three pages); the latter is the schedule driver.
- The SMOKE_MODE single-shared-tracker design and its `SMOKE_MODE`/`SMOKE_TRACKER_ID` special-casing can be retired once F3Go30-i5md.6 migrates the deferred smoke tests (F3Go30-jldr, F3Go30-4j4o.1, F3Go30-4j4o.2) onto provisioned environments; multi-month scenarios become expressible because multiple namespaces can coexist.
- A new anonymous-input trust boundary exists: **every** target-spreadsheet resolution must go through `resolveTemplateSpreadsheet_`/`NamespaceDB` — no handler may open a request-supplied id directly. A missing/unknown `ns` must fail safe to the bound spreadsheet, never to an arbitrary sheet.
- CacheService keys are already `sheetId`-scoped (`trackerLayoutCacheKey_`, `bonusEntriesCacheKey_`, …), so namespace isolation in cache is automatic; any fixed-key or Script-Property-backed cache must be audited to confirm it cannot leak across namespaces.
- Email safety now rests on a single invariant — copies are `Email Test Mode=Yes` by construction and only a human turns it off. Every send path must read its email policy from the **resolved** `templateSpreadsheet`, not `getActiveSpreadsheet()`, or the invariant is bypassed.
- Time-based triggers gain a fan-out loop and a per-namespace failure-isolation contract; their runtime now scales with the number of Enabled namespaces against the 6-minute cap.
- `onFormSubmit` under a namespace remains unsolved by design; tests needing form-driven submission against a namespace must wait for either the deferred form work or the standalone migration.

## Future Refinement (deferred, not part of this decision)

Before F3Go30 goes **truly** multi-tenant (beyond a demo or a small number of regional tenants), the likely next step is to break the container-bound attachment entirely and move to a **standalone Apps Script project** whose default template is driven purely by parameter/config, with no `getActiveSpreadsheet()` parent, no bound onOpen menu host, and no per-copy bound script. That migration also dissolves the `onFormSubmit` deferral (D4): a standalone project with parameterized form-submit routing handles it uniformly instead of per-copy. This is aspirational and explicitly out of scope; it is noted so the `NamespaceDB`/resolution-seam design is not built in a way that would preclude it — the `ns → template` indirection is the same indirection a standalone project would use, minus the bound-spreadsheet default.

## Fulfils / Supersedes

- **Fulfils** ADR-010's deferred "Future Refinement" (on-demand test environment) and **supersedes** ADR-010's "Testing implication"/"Test/Dev spreadsheet" recommendation of a *persistent* Go30 Test/Dev spreadsheet at a fixed future date: deployment verification now targets on-demand, namespace-scoped environments registered in `NamespaceDB`. ADR-010's context-date `TrackerDB` dispatch is unchanged and continues to operate within whichever Template (bound or namespace-resolved) a request is scoped to.
