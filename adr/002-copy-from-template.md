# ADR-002: Copy-From-Template Approach

Status: Accepted
Date: 2026-03-02

## Context
A new Go30 tracker is needed each month. The options considered were: (1) copy an existing tracker spreadsheet and reset its sheets, or (2) build a new spreadsheet programmatically from scratch. Google Sheets formatting, formulas, and conditional formatting are complex and would require significant maintenance to reproduce programmatically. The template already contains the correct layout.

## Decision
Each new monthly tracker is created by copying the current (or template) spreadsheet using `SpreadsheetApp.copy()`, then resetting all sheets via `initSheets()`. The copy includes the bound Google Form.

## Consequences
- New trackers inherit all formatting, formulas, and sheet structure automatically.
- Any structural change to the template propagates to future months without code changes.
- The copying process requires the script to run as the spreadsheet owner (Drive permissions).
- For new regions that do not own the Puget Sound template, the initial form link cannot be copied automatically — a one-time manual step is required. See ADR-004.
