# ADR-008: Deduplicate Responses Sheet by F3 Name, Not Email

Status: Accepted
Date: 2026-05-08

## Context
When a PAX submits the Go30 sign-up form more than once (e.g. to update goals or reuse last month's data), GAS automatically appends a new row to the Responses sheet. The duplicate row causes sheets that query Responses directly (Goals by HIM, Goals by AO) to show the same participant twice.

The initial implementation of `deduplicateResponsesSheet_` keyed on email address: it removed any prior Responses row for the same email, keeping only the latest submission. This works for the common case but breaks when a PAX changes their email address — the old row (old email) would not be matched, leaving a stale entry, while the new submission creates a second row. It also means a PAX cannot change their registered email without manual HC intervention.

F3 Name is the stable, community-wide identifier for a participant. It is set at registration, does not change between months, and is used as the key in the Tracker sheet for the same reason.

## Decision
Deduplicate Responses by F3 Name. When a new form submission arrives, remove any prior Responses row whose F3 Name matches the submitted row's F3 Name (excluding the submitted row itself).

## Consequences
- A PAX can change their email address between months without creating a stale Responses entry or requiring HC intervention.
- F3 Name must be present in the submitted row; the existing guard in `onFormSubmitLocked_` already enforces this.
- A PAX who changes their F3 Name between months will have both rows retained (old name is not matched). This is acceptable — F3 Name changes are rare and can be resolved manually by the HC.
- The Tracker sheet already keys on F3 Name for duplicate detection; this aligns both sheets on the same identifier.
