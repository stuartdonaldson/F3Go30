# Implementation Plan — F3Go30-4j4o

> Requested as "4jmo"; no such bead exists. The intended bead is **F3Go30-4j4o**
> (confirmed): *Re-architect SIT/smoke test tooling around on-demand tracker provisioning.*

## 1. What "implement 4j4o" actually means

`4j4o` is an **umbrella / coverage epic with no code of its own.** It closes when its
children resolve — it does not get "implemented" directly. Two facts fix the shape of this plan:

1. **4j4o is `depends-on` → `i5md`.** The concrete mechanism (an on-demand,
   namespace-scoped Template copy) is scoped under epic **`i5md`** and decided in
   **ADR-014**. 4j4o is now the *test-coverage* tracker for that mechanism.
2. **Its bug children are deferred and re-homed under `i5md.6`.** `jldr`, `4j4o.1`,
   `4j4o.2` are all `depends-on` → **`i5md.6`** ("Migrate deferred smoke tests"). They
   cannot be built against the old single-`SMOKE_MODE`-tracker design — that is the whole
   reason the epic exists.

So the implementable path to closing 4j4o runs **through the `i5md` chain**, plus one
independent child (`31w5`). This plan sequences that chain to the point where the three
deferred bugs get live coverage and 4j4o can be closed.

### 4j4o children and their delivery vehicle

| Child | State | Closed by |
|-------|-------|-----------|
| `31w5` — regression-test idea collection | open | **Independent** — triage only (§6). Not gated on i5md. |
| `4j4o.1` — bonus actions can't target smoke tracker | deferred | code fix already landed (unverified); live-verified under `i5md.6` |
| `jldr` — checkin `day:'today'` never matches smoke tracker | deferred | `i5md.6` |
| `4j4o.2` — cross-month bonus-edit relocation has no coverage | deferred | `i5md.6` |

## 2. Current state (verified 2026-07-09)

Do **not** re-derive this — it is the starting line.

- **ADR-014 accepted** (`adr/014-namespace-scoped-template-resolution.md`). `i5md.1`
  (design) is **closed**. Read ADR-014 once; it is the spec for everything below.
- **`i5md.2` (resolution seam) is in progress and partly landed:**
  - `resolveTemplateSpreadsheet_(e, payload)` exists — `script/go30tools.js:844`, exported
    at `:1619`. Reads `e.parameter.ns` (GET) / `payload.ns` (POST), looks it up in the
    `NamespaceDB` sheet via `_lookupNamespaceTemplateId_`, **fails safe to the bound
    spreadsheet** when `ns` is absent/unknown/unopenable.
  - Unit tests exist: `test/test_resolve_template_spreadsheet.js` (fallback cases covered).
  - Already wired into **`WebApp.js`** (`:47, :71, :112, :197`) and **`dashboardWebapp.js`**
    (`:395, :408, :438`).
  - **Still hardcode `getActiveSpreadsheet()`** — the audit target for finishing `i5md.2`:
    `WebApp.js:297, :318, :329, :376` (all in the admin path). Per ADR-014 D2/D4 some admin
    reads legitimately stay bound; each must be classified, not blindly rewritten.
- **`4j4o.1` code fix already landed but NOT live-verified:** `resolveBonusSheet_`
  (`dashboardWebapp.js:1182`) now branches on `payload.targetMonth` (mirrors
  `resolveCheckinIdentity_`). Unit suite green. It needs a live smoke tracker to verify — the
  exact thing `i5md.6` provides. Keep it OPEN until then.

## 3. Critical path (ordered)

```
[done] i5md.1 design (ADR-014)
   │
   ▼
i5md.2  finish resolution seam  ──► i5md.3  thread ns through client (D3)
   (audit remaining getActive-        (signup/checkin/bonus pages) — BULK OF WORK
    Spreadsheet sites)                    │
   │                                      ▼
   ├──────────────────────────►  i5md.5  NamespaceDB allowlist + Kind gate (anti-enumeration)
   │                                      │
   ▼                                      ▼
CopyTemplate provisioning (D6) ──► i5md.4 teardown (P3, can trail)
   (explicit PROD source, write NamespaceDB row)
   │
   ▼
i5md.6  migrate deferred smoke tests onto provisioned 3-month env
   │        └─ resolves jldr, 4j4o.1, 4j4o.2 (live-verify each)
   ▼
Close 4j4o  (after 31w5 triaged — §6)
```

`i5md.3` is the schedule driver (ADR-014 "Consequences": small at the resolution layer,
broad at the client layer). `i5md.4` (P3) may trail `i5md.6` since teardown can be manual
initially (`cleanupTracker` + delete `NamespaceDB` row by hand).

## 4. Work items — implementation detail

Each item lists the **exact context to load** (so a Sonnet run reads only what it needs),
the approach, and the done-gate. Anchors are `file:line` at time of writing — grep the
function name if drifted.

---

### WI-1 — Finish `i5md.2`: audit remaining `getActiveSpreadsheet()` sites
**Bead:** `i5md.2` (in progress) · **Size:** S · **Model:** Sonnet

**Necessary context (read only this):**
- ADR-014 §D1, §D2, §D4 (resolution seam; request-follows-`ns` vs. trigger/admin stays-bound).
- `script/WebApp.js:280–390` (the 4 hardcoded sites: `:297, :318, :329, :376`).
- `script/go30tools.js:844–880` (seam impl, already read-complete).

**Approach:** For each of the 4 sites, classify: *request-driven read of tenant data* →
route through `resolveTemplateSpreadsheet_(e, payload)`; *admin/infra read that must stay on
the executing deployment* → leave bound, add a one-line comment citing ADR-014 D2/D4.
`:329` and `:376` already use the `payload.sheetId ? openById : getActive` admin pattern —
confirm they need no `ns` and document why.

**Test:** extend `test/test_resolve_template_spreadsheet.js` only if a site's routing becomes
non-trivial; otherwise no new unit test (mechanical).
**Done:** every entry-point `getActiveSpreadsheet()` is either routed or carries a
stays-bound rationale comment; `bd close i5md.2`.

---

### WI-2 — `i5md.3`: thread `ns` round-trip through the client (D3)
**Bead:** `i5md.3` · **Size:** L (schedule driver) · **Model:** Sonnet, but split per page

ADR-014 D3: the sandboxed client iframe carries no query string, so `ns` must be
(a) read server-side in `doGet`, (b) injected into the page template, (c) **echoed in every
`callApi()` POST body** — exactly as `targetMonth` / session `id` / checkin token are today.

**Split into 3 independent sub-runs (one page each) to keep context small:**

| Sub-run | Page + server render fn | Client file |
|---------|-------------------------|-------------|
| WI-2a checkin | `dashboardWebapp.js` `buildCheckinPageOutput_` / `renderCheckinPageForTypedIdentify_` / `handleCheckinPost_` | `script/CheckinApp.html` |
| WI-2b signup  | `signupWebapp.js` `renderSignupPage_` | `script/SignupApp.html` |
| WI-2c bonus   | bonus handlers in `dashboardWebapp.js` (`handleBonusList_/Add_/Edit_`) | bonus UI within `CheckinApp.html` |

**Necessary context per sub-run:** ADR-014 §D3 + the one server render fn + the one HTML
file's existing `targetMonth`/token plumbing (grep `targetMonth` in the HTML to find the exact
pattern to clone). **Do not load the other pages.**

**Approach (identical each page):** find where `targetMonth` is injected server-side and echoed
in `callApi()`; add `ns` alongside it, same lifecycle. `ns` defaults to `''` (→ bound
spreadsheet, unchanged prod behaviour).

**Test:** each page gets a node test asserting the POST body carries `ns` when the page was
rendered with one. Live-verify deferred to `i5md.6`.
**Done:** all three pages round-trip `ns`; `bd close i5md.3`.

---

### WI-3 — `i5md.5`: NamespaceDB allowlist + `Kind` gate
**Bead:** `i5md.5` · **Size:** S–M · **Model:** Sonnet

**Necessary context:** ADR-014 §D2, §D4, §D7 (registry columns; `Kind`; fail-safe);
`script/go30tools.js:844–880` (`_lookupNamespaceTemplateId_`).

**Approach:** The anti-enumeration property is *already* structurally present (unknown `ns` →
bound). This WI hardens and tests it: (1) confirm no handler opens a request-supplied id
except via `resolveTemplateSpreadsheet_` (grep `openById` across `script/*.js`); (2) surface
the registry `Kind` / per-trigger columns (`NagEnabled`, etc.) from the lookup for later
trigger fan-out; (3) unit tests for the reject/fail-safe path (malicious `ns`, `ns` for an
unregistered id).
**Done:** `openById` audit clean; allowlist tests green; `bd close i5md.5`.

---

### WI-4 — CopyTemplate provisioning (ADR-014 D6)
**Bead:** part of `i5md` lifecycle (folds in `w6y3`) · **Size:** M · **Model:** Sonnet

**Necessary context:** ADR-014 §D5, §D6; `script/CopyTemplate.js` (whole file, ~13 KB — small);
`test/test_copy_template.js`.

**Approach:** (1) `copyTemplateToNewEnvironment_` currently copies
`getActiveSpreadsheet()`; give it an **explicit source Template id** (PROD) decoupled from the
**destination registry = active (SIT)**. (2) On success, **write the `NamespaceDB` row**
(`NameSpace`, `TemplateId`, `Kind`, trigger columns) into the *active* deployment. (3) Confirm
`applySafeConfigDefaults_` still forces `Email Test Mode=Yes` + `NameSpace=<folder>` (D5
invariant — never auto-rewrite other Config rows).
**Test:** extend `test_copy_template.js` for the explicit-source + NamespaceDB-write paths.
**Done:** a SIT admin action provisions a 3-month scrubbed env from PROD and registers it.

---

### WI-5 — `i5md.6`: migrate deferred smoke tests → resolves jldr / 4j4o.1 / 4j4o.2
**Bead:** `i5md.6` (this is what closes 4j4o's bug children) · **Size:** M–L · **Model:** Sonnet + human live gate

**Necessary context:** the three child beads (`bd show jldr 4j4o.1 4j4o.2`); `tools/smokeTest.js`;
`tools/callWebapp.js` (`ns` not yet supported — add `--ns` passthrough); ADR-014 §D3.

**Approach:** rewrite each deferred scenario against a **provisioned namespace env** (pass
`ns` per request) instead of `SMOKE_MODE`:
- **jldr:** check in against a day that actually exists in the provisioned tracker (explicit
  date now reachable because the env owns real month columns) — kills the
  `day_column_not_found` structural bug.
- **4j4o.1:** exercise `bonusAdd/List/Edit` against the isolated env → **live-verifies the
  already-landed `resolveBonusSheet_` fix.**
- **4j4o.2:** the 3-month env lets one test PAX hold Tracker rows in two months at once →
  covers `findBonusRowByIdentity_` cross-month relocation (the "that entry no longer belongs
  to you" fix).

**Test/verify:** these ARE the tests. Each must pass **live on SIT** (human-in-the-loop per
the `/backlog` gate — no false-green close on live-state-dependent ACs).
**Done:** all three scenarios green on SIT; `bd close jldr 4j4o.1 4j4o.2 i5md.6`.

---

### WI-6 — `i5md.4`: whole-environment teardown (P3, may trail)
**Bead:** `i5md.4` · **Size:** S · **Model:** Sonnet

**Necessary context:** ADR-014 §D6; `cleanupTracker` in `script/CreateNewTracker.js` (grep);
`script/CopyTemplate.js`.
**Approach:** an admin action that deletes the `NamespaceDB` row (primary safety cut — makes
the ns unresolvable immediately) and optionally trashes the folder + files. Structurally
avoids the trigger-leak mode (namespace envs install no triggers of their own).
**Done:** provision→teardown cycle leaves no Drive/registry residue; `bd close i5md.4`.

---

## 5. Sonnet execution guidance (token/context discipline)

The user's ask: implement **efficiently with Sonnet**, minimal context. Rules:

1. **One WI per session/agent.** Never load the whole repo. Each WI above lists its exact
   read-set — load only that. `dashboardWebapp.js` is 83 KB and `go30tools.js` 61 KB: **never
   read them whole** — grep the named function and read a ±40-line window.
2. **ADR-014 is the single source of truth.** Read it once at the start of a WI; do not
   re-derive design decisions already in it (§D1–D7).
3. **TDD gate (`/implementation-gate` + `/backlog`):** for each WI, write/extend the node test
   first (`test/test_*.js`, run with `node`), red→green, then implement. New logic requires a
   failing test before code.
4. **Live-verification gate:** `i5md.6` ACs depend on live SIT sheet/API state. **Do not
   close** those beads on unit-green alone — they need `npm run deploy:sit` + a
   `tools/callWebapp.js` / `tools/smokeTest.js` run confirmed by a human. This is the exact
   false-green trap the `/backlog` skill guards.
5. **Deploy is environment-scoped:** default **SIT** (`npm run deploy:sit`). Only touch PROD
   on explicit instruction.
6. **Parallelism:** WI-2a/2b/2c (client pages) are independent and can be separate agents.
   WI-1, WI-3, WI-4 are independent of each other once the seam (§2) exists. WI-5 is the join
   point — it needs WI-2, WI-3, WI-4 done.
7. **Cost note:** WI-1, WI-3, WI-6 are small/mechanical → cheap Sonnet runs. WI-2 and WI-5 are
   the effort; keep them split per the tables above so no single run carries multi-file context.

## 6. `31w5` (independent child — triage, don't build here)

`31w5` is an **idea-collection** bead, not gated on i5md. Its lead idea (per-request
`contextDate` override on webapp entry points, mirroring the existing `runNagCheck`/`runMinusOne`
`contextDate` pattern; **must be per-request, never a global Script Property** on the
`ANYONE_ANONYMOUS` deployment) is orthogonal to the namespace work. **Action for 4j4o closure:**
triage `31w5` — split its live ideas into their own beads or explicitly defer — so 4j4o has no
open unresolved child. Do not fold its scope into the i5md chain.

## 7. Definition of done for 4j4o

Close `4j4o` when **all** hold:
- `i5md.6` closed → `jldr`, `4j4o.1`, `4j4o.2` **live-verified on SIT** and closed.
- `31w5` triaged (ideas beaded or deferred), not left dangling.
- SMOKE_MODE single-tracker special-casing retired or explicitly deferred with rationale
  (ADR-014 "Consequences" allows retirement once i5md.6 lands).
- `bd close 4j4o` with a note pointing at the i5md deliverables that resolved it.

## 8. Out of scope (do not pull in)

Per ADR-014 §D4 and "Future Refinement": **`onFormSubmit` under a namespace is deferred**
(per-spreadsheet installed trigger; entangled with standalone-project migration). The
standalone Apps Script migration itself is aspirational and out of scope. Verification tooling
independent of the tracker environment (xlsx-export reading, email-inbox harnesses, Playwright
sidecars — `gbj`, `c3p`, `rmh`, `ymu`) is separately tracked and not part of 4j4o.
