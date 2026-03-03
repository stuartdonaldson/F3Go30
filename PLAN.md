# Plan

## Status
Documentation framework (Minimal tier) scaffold complete. Migrating content and authoring ADRs.

## In Progress
- Phase 3 content migration: README.md sections authored from README-OLD.md and TODO-OLD.md
- ADR authoring (001–005)

## Next
- Review README.md word count against 800-word target
- Verify all `-OLD` files have been fully drained before deletion
- Update docs/references/go30-q-tutorial-script.md to reflect current workflow

## Blocked
- Initial form linking for new regions cannot be fully automated — Google Forms API does not support cross-account ownership transfer (see ADR-004)

## Open Decisions
- None currently open

## Recent Findings
- `macros.js` `startNewMonth()` calls `initSheets()` with no arguments, causing a runtime error if that path is used (see Backlog #2)
- `onFormSubmit` range calculation can throw if Tracker has fewer than 4 rows (Backlog #3)

## Backlog

| # | Item | Type | Priority | Notes |
|---|------|------|----------|-------|
| 1 | Fix `macros.js` / `onOpen.js` overlap — consolidate trigger setup into one path; remove or clearly disable `startNewMonth()` | Debt | High | `startNewMonth()` currently causes a runtime error; see Runtime View |
| 2 | Add guard: `onFormSubmit` range size check before `getRange` | Bug | High | Throws if Tracker has fewer than 4 rows |
| 3 | Add error handling for URL shortener non-200 responses | Bug | Med | Surface token/quota errors with actionable messages |
| 4 | Formally disable or remove `formManager.js` | Decision | Med | `FORMCONFIRMATIONMESSAGE.js` deleted (ADR-006). `formManager.js` remains — has multiple known breaking issues; see ADR-004. Decide: delete or keep as labeled dead code. Separate from #9 (confirmation message is a distinct capability, already has a path forward) |
| 5 | Add guard: `NoticePrompt` empty string handling | Bug | Low | `while (!response)` rejects valid empty string input |
| 6 | Update go30-q-tutorial-script.md to current workflow | Story | Med | Script.md content may be out of date |
| 7 | Consider TextFinder or caching in `onFormSubmit` for performance as Tracker grows | Research | Low | Full column read on every submit |
| 8 | Evaluate README.md word count limit for Minimal tier in this context | Decision | Low | README is 2,055 words vs. 800-word target; content is genuinely dense (glossary, 3 UCs, failure modes). Determine if a section-level scaling approach is needed that stops short of full Standard tier graduation |
| 9 | Add `setConfirmationMessage()` call in `copyAndInit()` | Story | Med | Form is already opened via `FormApp.openByUrl()` in `CreateNewTracker.js`; just needs the confirmation message call added to that block. See ADR-006. Delivers UC-1 |
| 10 | Generate ready-to-copy Slack messages after Copy and Initialize | Story | High | After `copyAndInit()` completes, sidebar should present: (1) a Slack canvas update block (formatted text with tracker URL, form URL, Site Q info) and (2) a Slack notice/announcement message — both ready to copy/paste. Display in sidebar with a copy button or clearly demarcated block. Delivers UC-1 |
| 11 | Scheduled auto-creation of next month's tracker | Story | Med | Add a time-based trigger that fires 1 week before end of month, runs the copy-and-initialize flow unattended, then emails f3go30@gmail.com with: (1) links to the new spreadsheet and HC form, (2) the ready-to-copy Slack messages from #10. Requires #10 to be complete. Decision needed: how to handle prompt inputs (tracker name, start date) without a UI — auto-derive from current month |
| 12 | Menu item: announce next month signup in current tracker | Story | Med | Add "Announce Next Month Signup" to the F3 Go30 menu. Posts a notice in the current tracker (e.g., a pinned row or Help sheet entry) that next month is open for HC signups, with the form link. Optionally generates the same Slack copy-paste block from #10 |
