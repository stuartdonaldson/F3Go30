# ADR-006: Updating the Google Form Confirmation Message

Status: Accepted
Date: 2026-03-02

## Context
After "Copy and Initialize" creates a new monthly tracker, the bound Google Form's confirmation message needs to be updated with the new tracker URL and Site Q name. The question was how to obtain a valid form reference from a spreadsheet-bound Apps Script.

## Decision
`FormApp.getActiveForm()` returns null in a spreadsheet-bound script and cannot be used. The correct method is `FormApp.openByUrl(spreadsheet.getFormUrl())`, which returns a writable `Form` object. `form.setConfirmationMessage(message)` then works as expected. This was confirmed by test in `FORMCONFIRMATIONMESSAGE.js` (now deleted).

`CreateNewTracker.js` already opens the form via `FormApp.openByUrl()` during `copyAndInit()` — `setConfirmationMessage()` simply needs to be added to that existing block. See PLAN.md Backlog #9.

## Consequences
- `FormApp.getActiveForm()` must not be used in this codebase for form updates.
- The form object is already available in `copyAndInit()` — integration requires one additional call.
