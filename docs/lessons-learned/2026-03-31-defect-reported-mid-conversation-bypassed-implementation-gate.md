# LL: Defect reported mid-conversation bypassed implementation gate and bead creation

Date: 2026-03-31
Domain: process

## Observation

User said: "the tinyurl issue, the short url should have had the MMMM-YY- along with the
name space and that is more than 5 chars" — explicit defect identification mid-conversation.

Agent read CreateNewTracker.js, made the fix (committed cf8035d and 316a3cf), and pushed
to remote before any bead was created. No implementation gate was invoked. The fix also
introduced a second error (MonthYY- format instead of YYYY-MM-), requiring a third commit
(cf8035d) to correct.

User caught the gate bypass and asked: "did you just fix it or did you create a bead for it,
and what should you have done?" Bead F3Go30-dmd was created and closed retroactively.

Caught at: user review, post-commit.

## Why Chain

Why 1 — Code was written and committed before a bead existed.
Why 2 — The implementation gate was not invoked at the point the defect was reported.
Why 3 — The agent treated the user's defect identification as a correction to in-flight work
         (continuing the current task) rather than as a new task boundary requiring gate entry.
Why 4 — There is no explicit rule requiring the agent to treat a user-labelled defect as a
         gate trigger distinct from a conversational correction.
Root cause: The implementation gate only fires when the agent self-identifies an implementation
request; no convention requires it to fire when the *user* explicitly labels something a defect
mid-conversation, making the gate bypassable whenever a bug surfaces through dialogue.

## Contributing factor

The format misread (MonthYY vs YYYY-MM) shows the gate bypass also skipped the clarification
step that would normally precede implementation — the agent assumed the format from "MMMM-YY"
rather than confirming it against existing conventions (newSpreadsheetName was already YYYY-MM-NameSpace
and visible in the code).

## Initial Candidates

b: add rule to CLAUDE.md — when user uses words "defect", "bug", "that's wrong", or "that's a defect",
   treat as a new task boundary: create bead before any code is read or written.
c: update implementation-gate skill — add "user reports defect mid-conversation" to auto-trigger list
   and keywords section alongside existing implementation triggers.

## Resolution note (user, 2026-03-31)

A candidate resolution behaviour: when a user reports a defect, ask whether they want it
corrected inline (quick fix, no formal process) or handled formally (bead created, AC drafted,
test case written before any code is touched). This gives the user explicit control over the
trade-off between speed and rigour on a case-by-case basis, rather than the agent deciding
unilaterally. The question should be asked before reading any implementation files.
