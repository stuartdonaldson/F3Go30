# ADR-004: Experimental Form Generation Deferred

Status: Accepted
Date: 2026-03-02

## Context
When a new region copies the Go30 spreadsheet from the Puget Sound template (which they do not own), the Google Form is not copied automatically — Drive's copy operation only copies a bound form if the user owns both the spreadsheet and the form. The goal was to allow "Copy and Initialize" to fully bootstrap a new region without manual steps. Two experimental approaches were explored in `FORMCONFIRMATIONMESSAGE.js` and `formManager.js`: updating the confirmation message via `FormApp.getActiveForm()`, and a full form export/import using JSON serialization.

## Decision
Programmatic form generation and cross-account form copying are deferred. The experimental code (`FORMCONFIRMATIONMESSAGE.js`, `formManager.js`) was removed from the repository. New regions must manually copy the form on first setup.

## Consequences
- `FORMCONFIRMATIONMESSAGE.js` and `formManager.js` have been deleted (2026-03-30). They are no longer in the codebase.
- The manual bootstrapping instructions for new regions are documented in README.md §OPERATIONS.
- If Google expands Apps Script's form ownership API, this decision should be revisited. A new ADR would supersede this one.
- Known breaking issues in the experimental code: blob serialization failure, incorrect `ItemType.DROP_DOWN` constant, validation export/import mismatch. See TODO-OLD.md for full detail.
