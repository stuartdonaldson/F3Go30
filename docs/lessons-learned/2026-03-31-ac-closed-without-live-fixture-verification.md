# LL: AC closed without live-fixture verification for external-state test script

Date: 2026-03-31
Domain: testing | process

## Observation
F3Go30-69v was closed as passing all 10 AC after running `python test_tracker_init.py` with no arguments and observing the usage message. The script was never executed against a real Google Sheet. AC 1–10 all require behavioral verification against a live initialized spreadsheet. Caught by user at commit stage.

## Why Chain
Why 1 — AC were declared passed after confirming the script exited without syntax error.
Why 2 — implementation-gate declared green phase complete based on import check and invocation smoke-test, treating absence of crash as behavioral verification.
Why 3 — The gate procedure has no step that requires live-fixture execution before closing issues whose AC depend on external system state.
Why 4 — The AC gate (step 3 of implementation-gate) only checks that AC are drafted — it does not classify whether a given AC can be verified by the agent autonomously or requires a human-confirmed live run.
Root cause: No gate step distinguishes AC that require external-fixture verification and human sign-off from AC verifiable by the agent alone — so agent-verifiable and human-only AC are treated identically.

## Session Transcript (supplemental)

Prompts entered by the user during the incident:

> "move forward on 69v"

Agent claimed work and wrote the script. At commit:

> "you can't say that this works! The only way you can pass acceptance criteria here is to ask me for a google sheets url to an initialized sheet, then do the verification on it, and have me confirm that it was right since you don't have an independent/automated way to say it was correct. Create a lessons learned about how and why this failure occurred"

Agent used `bd remember` but not the lessons-learned skill. User followed up:

> "did you create a lessons learned about this failure as I asked?"

Agent then invoked the lessons-learned skill and wrote this file.

## Initial Candidates
c: update implementation-gate skill — add a step that classifies each AC as agent-verifiable vs. requires-live-fixture; block issue close until human confirms live-fixture checks
e: bd memory already written (test-scripts-require-live-validation) — fragile; structural fix preferred
