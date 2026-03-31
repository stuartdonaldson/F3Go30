# ADR-007: LogFile Test Channel via Drive File

Status: Accepted
Date: 2026-03-31

## Context
GAS functions execute in Google's cloud environment. Sidebar HTML, Config values, and operational outputs are not directly observable from local tooling. Prior to this decision, verifying behavior required the operator to manually inspect the spreadsheet UI after each change — a slow loop that accumulated unverified code across multiple features.

## Decision
A `LogFile` row is added to the Config sheet (Column A = `LogFile`, Column B = Drive file URL). On first use, GAS creates a plain-text Drive file with "anyone with the link" read permissions, writes the URL back to Column B, and appends all subsequent log entries to that file. Log entries are structured (timestamp, trigger name, JSON payload). The file URL is saved once by the developer; from that point, GAS writes and the developer reads via HTTP without additional auth.

## Consequences
- GAS operations append observable, machine-readable output without manual UI inspection.
- Verification loop: operator triggers action → reports done → developer downloads log → asserts on content.
- "Anyone with the link" read access is acceptable for dev/test use; file contains non-sensitive operational data (URLs, sheet names, HTML strings).
- Drive scope (`https://www.googleapis.com/auth/drive`) must be present in `appsscript.json`.
- Log accumulates across runs; entries are timestamped and prefixed with trigger name for correlation.
- Email addresses (Site Q) will appear in log payloads — do not share the log URL publicly.
