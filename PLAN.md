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
| 4 | Finish or formally disable experimental form generation | Decision | Med | `FORMCONFIRMATIONMESSAGE.js`, `formManager.js` — complete or mark hidden; see ADR-004 |
| 5 | Add guard: `NoticePrompt` empty string handling | Bug | Low | `while (!response)` rejects valid empty string input |
| 6 | Update go30-q-tutorial-script.md to current workflow | Story | Med | Script.md content may be out of date |
| 7 | Consider TextFinder or caching in `onFormSubmit` for performance as Tracker grows | Research | Low | Full column read on every submit |
| 8 | Evaluate README.md word count limit for Minimal tier in this context | Decision | Low | README is 2,055 words vs. 800-word target; content is genuinely dense (glossary, 3 UCs, failure modes). Determine if a section-level scaling approach is needed that stops short of full Standard tier graduation |
