# ADR-001: Owner-Only Menu Pattern

Status: Accepted
Date: 2026-03-02

## Context
The F3 Go30 custom menu provides operations (Copy and Initialize, Initialize Triggers, Reinitialize) that are destructive or structurally significant. If any user with access to the spreadsheet could trigger these operations, accidental resets or duplicate trackers would occur. The spreadsheet is shared with anyone-with-link for edit access so PAX can interact with the Tracker sheet directly.

## Decision
The F3 Go30 menu is only added to the UI when the active user's email matches the spreadsheet owner's email. Non-owners open the sheet normally with no menu visible.

## Consequences
- Site Qs must open the spreadsheet while logged in as the owner account (typically f3go30@gmail.com in Puget Sound); switching accounts is a manual step if they are logged in as a personal account.
- PAX cannot accidentally trigger structural operations.
- Developers testing from a non-owner account will not see the menu; they must use the Apps Script editor directly or temporarily change ownership.
