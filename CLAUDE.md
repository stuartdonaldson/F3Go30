# CLAUDE.md — F3Go30

**Tier:** Standard
**Standards:** /docs/framework/doc-standard.md _(read-only — do not edit)_

## Reading Order
1. Current state — `bd prime` (auto-loaded when bd in use)
2. docs/CONTEXT.md — purpose, capabilities, use cases
3. docs/DESIGN.md — architecture, modules
4. docs/OPERATIONS.md — how to run it
5. /adr/ — why key decisions were made
6. /docs/references/ — external document summaries

## Document Map

| Content | Location |
|---------|---------|
| Purpose, capabilities, use cases, glossary | docs/CONTEXT.md |
| Architecture, modules, data model, runtime risks | docs/DESIGN.md |
| Deployment, configuration, failure modes | docs/OPERATIONS.md |
| Current state | `bd ready` |
| Identified work | bd issues |
| Technical decisions | /adr/ |
| Strategic themes | docs/VISION.md _(when created)_ |
| Roadmap, funnel | docs/ROADMAP.md |
| Go30 Q tutorial narration script | /docs/references/go30-q-tutorial-script.md |

## Placement Rules
- New capabilities → docs/CONTEXT.md §Capabilities + use case if actor-driven
- Architecture changes → docs/DESIGN.md + affected diagrams
- Operational changes → docs/OPERATIONS.md
- Resolved decisions → /adr/
- New terms → docs/CONTEXT.md §Glossary
- New risk identified → `bd remember`
- New initiative → docs/ROADMAP.md §Funnel

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

## Shell Safety (Quoted Payloads)

When running shell commands that include human-written text payloads (issue descriptions,
acceptance criteria, notes, markdown), prevent shell expansion by default.

- Use single-quoted heredocs for multi-line payloads: `<<'EOF'`
- Never pass payload text in double-quoted CLI args when content may include backticks,
	`$`, `$(...)`, or backslashes
- Prefer stdin / `--body-file -` for multi-line content instead of inline argument strings
- Do not chain create/update commands with command substitution in the same shell line
	when payload text is present; run verification/read commands separately after writes
- If a command must include literal backticks or `$`, verify they are inside a single-quoted
	heredoc payload, not in shell-parsed argument context

## Reference Summaries

| File | Source Document | Covers |
|------|----------------|--------|
| /docs/references/go30-q-tutorial-script.md | Script.md (original) | Go30 Q onboarding narration — steps to create a new monthly tracker |

## Deployment Environments

Two environments exist. **Default is SIT** unless PROD is stated explicitly.

| Label | Script project | Spreadsheet |
|-------|---------------|-------------|
| **SIT** | `testScriptId` | `testSpreadsheetId` |
| **PROD** | `templateScriptId` | `templateSpreadsheetId` |

Any action that is environment-scoped — deploy, admin webapp POST, log/Axiom query, smoke mode toggle, `runScanTrackers`, creating a tracker month, cleanup — must name the environment. If unspecified, assume SIT and proceed. If the user says "prod", "production", "template", or "go live", switch to PROD context and proceed.

Either environment can be in **Smoke mode** (testing go-live flows with labeled artifacts that are cleaned up afterward). Smoke mode is activated via `SMOKE_MODE` Script Property; artifacts are named by appending `" (Smoke)"` to NameSpace.

## clasp - command line tool for google apps script credentials.
The local.settings.json file claspAuth setting contains the clasp auth credentials file which must be passed in to clasp with the "--auth" arguent or via the "clasp_config_auth" environment variable.

## Developer CLI Tools

### clasp auth (required on every manual clasp command)
Do NOT use bare `clasp` — it silently falls back to wrong credentials. `CLASP_CONFIG` is not a
real clasp variable; only `clasp_config_auth` (lowercase exact match) works.
```
clasp_config_auth=~/.clasprc-f3go30.json clasp <subcommand>
```

### Deploying
Environment switching is managed by `tools/manage-deployments.js`, which writes `.clasp.json`
before each push. Do not edit `.clasp.json` manually. Both npm scripts do a full deploy
(push + named deployment URL update).
```
npm run deploy:sit    # push to SIT (testScriptId)       — alias: npm run deploy:test
npm run deploy:prod   # push to PROD (templateScriptId)  — alias: npm run push
npm run release:patch # bump version + deploy:prod + git push --follow-tags
```

### Web app calls (all environments, all endpoints)
```
node tools/callWebapp.js <action> [--cmd admin|signup|...] [--env sit|prod] [--body '{"key":"val"}']
```
Reads deployment ID from local.settings.json. For `--cmd admin` (the default), also reads and
injects the admin secret automatically. Default: `--cmd admin --env sit`.

Common admin actions: `getSmokeStatus`, `setScriptProperties`, `cleanupTracker`,
`runScanTrackers`, `getSheet`

### Smoke mode workflow (run on SIT first; repeat on PROD before go-live)
See docs/OPERATIONS.md §Smoke Mode for the full numbered sequence. Quick reference:
```bash
# 1. Activate
node tools/callWebapp.js setScriptProperties --env <env> --body '{"properties":{"SMOKE_MODE":"true"}}'
# 2. Confirm
node tools/callWebapp.js getSmokeStatus --env <env>
# 3. Run copyAndInit (monthly menu or auto-generate trigger)
# 4. Sign up a test PAX via signup web app (targetMonth: "current" resolves to smoke tracker)
node tools/callWebapp.js identify --cmd signup --env <env> --body '{"f3Name":"SmokeTest","email":"smoke@example.com"}'
# 5. Verify Tracker sheet (get SMOKE_TRACKER_ID from getSmokeStatus output)
node tools/callWebapp.js getSheet --env <env> --body '{"sheetId":"<SMOKE_TRACKER_ID>","sheetName":"Tracker"}'
# 6. Human: confirm spreadsheet looks correct, then proceed to teardown
# 7. Teardown
node tools/callWebapp.js cleanupTracker --env <env> --body '{"sheetId":"<SMOKE_TRACKER_ID>","trashSpreadsheet":true}'
node tools/callWebapp.js setScriptProperties --env <env> --body '{"properties":{"SMOKE_MODE":"","SMOKE_TRACKER_ID":""}}'
# 8. Confirm clean
node tools/callWebapp.js getSmokeStatus --env <env>
```

