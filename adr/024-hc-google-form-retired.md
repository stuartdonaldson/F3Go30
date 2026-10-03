# ADR-024: HC Google Form Retired — the Static Sign-up Page Is the Only Sign-up Path

Status: Proposed

Date: 2026-10-02

Implementation: F3Go30-TBD (epic)

## Context

Every monthly tracker is a Drive copy of the Template spreadsheet, which carries a linked Google
Form (the "HC Form"); the copy brings its own Form, which `createTrackerSpreadsheet_` retitles,
shortens, records in TrackerDB (`HC URL`/`ShortHC`/`FormId`) and Config (`Signup HC Form`), and
wires to a form-submit trigger (`handleFormSubmit_` → `onFormSubmitLocked_`). Since ADR-018/019
sign-up happens on the static page over `cmd=signup`. PROD Axiom shows zero form-submit events in
the 90 days to 2026-10-02 against ~50 webapp sign-ups a month, yet the Form path still carries its
own pipeline (dedup, goal reuse, prefilled-form email, registration email), keeps tracker
creation dependent on a linked Form, and needed parallel changes for every sign-up feature
(most recently ADR-023's team roster).

## Decision

The HC Google Form is retired. New trackers are created without a Form; the Template's Form is
unlinked; Forms on existing trackers stop accepting responses, with a closed message pointing to
the sign-up page; the form-submit pipeline and trigger are removed. The static sign-up page
(`cmd=signup`) is the only way to sign up.

## Consequences

- Tracker creation no longer requires or touches a Form; TrackerDB `HC URL`/`ShortHC`/`FormId`
  stay as columns (historical rows keep their values) and are blank for new trackers.
- One sign-up implementation instead of two: Form-only code (form-submit dedup/promotion, goal
  reuse via Form answer, prefilled-form email, form-submit trigger lifecycle) is deleted.
- Ordering constraint: the no-Form tracker creation must be deployed to an environment before
  that environment's Template Form is unlinked — otherwise the next `autoGenerateNextMonthTracker`
  throws "No form linked to the template spreadsheet".
- Existing Forms and their response sheets are left in Drive (closed, not trashed), so past
  responses remain readable.
- Any external link to an old Form (Slack history, bookmarks) lands on the closed message, which
  links to the sign-up page.

## Open questions

- Whether to drop the Template's `Form Responses 1` sheet and the `Signup HC Form` Config row
  once no code reads them, or leave them as inert history.
