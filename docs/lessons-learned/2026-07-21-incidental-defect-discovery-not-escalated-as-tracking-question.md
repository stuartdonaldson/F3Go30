# LL: An incidentally-discovered, out-of-scope defect went unfiled across multiple sessions until the user asked directly

Date: 2026-07-21
Domain: process

## Observation

During a live Playwright regression pass for PR #4 (SIT deploy verification), `gaslogger.spec.js`
failed with `SCRIPT_ID_PROD not set in local.settings.json`. The assistant characterized this in
its user-facing summary as "a pre-existing local-config gap, unrelated to this branch" and
recorded it only as an `Open:` line in the session's work-log.md entry — no bd issue was filed,
and the user was not asked whether it should be tracked.

The gap itself was not new: `local.settings.json` was renamed from a `SCRIPT_ID_PROD`/
`SCRIPT_ID_TEST` schema to `templateScriptId`/`testScriptId`/etc. per `docs/deployment-model.md`'s
Phase 1 migration plan, and every real deploy path (`tools/manage-deployments.js`, `npm run
deploy:*`) was updated to match — but `tests/playwright/gaslogger.spec.js` and one line in
`docs/OPERATIONS.md` were missed. `gaslogger.spec.js` has therefore been throwing in
`test.beforeAll` before any test in the file can run since that migration landed, with no bd
issue and no other doc flagging it, until the user asked "is this a known pre-existing issue and
where is it tracked?" in the next turn — at which point it was filed (F3Go30-kb8o) and fixed in
the same exchange.

## Why Chain

Why 1 — The gap went unfiled in this session despite being found and named.
  Because the assistant's response treated naming the gap in prose plus a work-log `Open:` line as
  sufficient closure, rather than as an incomplete action requiring a further step.

Why 2 — Why was a work-log mention treated as sufficient?
  Because nothing in the assistant's task-completion routine distinguishes "I noticed this and
  said so" from "I noticed this and it is now visible/trackable to a human independent of this
  chat transcript." A work-log `Open:` line is durable in the repo, but it is not something a
  human proactively re-reads — it only surfaces to them if they later re-open work-log.md or ask
  the assistant to recall it.

Why 3 — Why is there no distinction between "mentioned" and "made trackable"?
  Because none of the loaded skills or CLAUDE.md rules impose an obligation to ask, at the moment
  of incidental discovery, "this looks like a pre-existing untracked issue outside current scope —
  should I file it?" The closest mechanism (`lessons-learned` skill) triggers on gate/review
  findings that are *blocking*; the closest bd habit is user-directed ("what's next", "claim
  this") rather than assistant-initiated for side-discovered defects.

Why 4 — Why didn't the existing `technical-debt` skill or Maintenance Protocol catch this earlier,
across the many prior sessions since the templateScriptId migration?
  Because CLAUDE.md's Maintenance Protocol says "At session start or phase transition: run
  `/session-start-check`" — but this session (and, per the gap's persistence, likely others) never
  invoked it. `session-start-check`'s own trigger list includes "at the start of any session
  touching PLAN.md, DESIGN.md, CONTEXT.md, or ADRs" — this session touched CONTEXT.md, DESIGN.md,
  and OPERATIONS.md — yet the assistant proceeded directly into the requested work without running
  the check that might have surfaced accumulated debt signals (e.g. a persistently-failing spec).

Root cause: There is no procedural rule requiring that an out-of-scope defect discovered
incidentally during a task be surfaced to the user as an explicit "should this be tracked?"
question (or filed proactively) at the moment it's found — a passive mention in prose or a
work-log `Open:` line satisfies the assistant's own sense of "reported," without producing a
durable, human-visible artifact (a bd issue), so such findings silently persist until a human
happens to notice or re-ask. This is compounded by the Maintenance Protocol's session-start gate
not actually being invoked despite CLAUDE.md mandating it for doc-touching sessions.

## Initial Candidates

- b: CLAUDE.md (project) — extend the existing "Code Quality" section's duplication-flagging
  precedent ("Flag existing duplication you encounter, even outside the current task's scope...")
  with a parallel, more general rule: any out-of-scope defect noticed during work must be
  surfaced as an explicit question ("should this be tracked?"), not just narrated or logged.
- c: skill update — `work-log` skill's `Open:` field guidance could require that any `Open:` line
  describing a *defect* (not a design question) either link a bd issue id or be accompanied by an
  explicit escalation question to the user before the entry is written.
- d: gate/process — actually invoke `/session-start-check` per the existing CLAUDE.md mandate
  when a session touches doc-map files; this is a compliance gap, not a missing rule, so the lever
  may be reinforcement rather than a new artifact.
