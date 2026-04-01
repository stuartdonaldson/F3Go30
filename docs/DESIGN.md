# DESIGN — F3Go30

## Solution Strategy

The tool follows a **copy-from-template** pattern: a working spreadsheet (and its bound form) is
duplicated rather than built from scratch each month. New tracker names are auto-generated as
`YYYY-MM-NameSpace` (e.g. `2026-04-F3Waxhaw`) using the start date and the `NameSpace` value
from the Config sheet; operators are not prompted for a name. This avoids the complexity of
programmatically creating Google Forms with correct ownership — a restriction Google Apps Script
does not fully support across accounts. The owner-only menu gate enforces that only the authorized
Q can trigger destructive or structural operations. A sidebar notification panel (rather than
`alert()` dialogs) allows the script to stream progress updates during long-running copy
operations without blocking execution.

Programmatic form generation was explored but deferred — the Google Forms API does not support
ownership transfer, making full automation impossible for cross-account regional bootstrapping.
See ADR-004.

---

## Runtime Architecture

```mermaid
%%{init: {'theme': 'architecture-beta'}}%%
graph TD
    A[Q opens spreadsheet] --> B[onOpen — owner check]
    B --> C{Owner?}
    C -- Yes --> D[F3 Go30 menu shown]
    C -- No --> E[No menu]
    D --> F[Copy and Initialize]
    F --> G[Copies spreadsheet + form]
    G --> H[initSheets — resets all sheets]
    H --> I[URL shortening]
    I --> J[Sidebar: links to new tracker]
    %% Q background tasks (manual, in-browser)
    J --> BG1[Verify Tracker sheet]
    J --> BG2[Init the Triggers in new Tracker]
    J --> BG3[Update Go30 Links and Slack]
    D --> K[Initialize Triggers]
    K --> L[Daily 1 AM trigger]
    K --> M[Form-submit trigger]
    N[PAX submits HC form] --> M
    M --> O[onFormSubmit — adds PAX row to Tracker]
    L --> P[markEmptyCellsAsMinusOne — writes −1 for missed days]
    D --> MT[Initialize Monthly Trigger]
    MT --> MTrig[Monthly trigger — 20th of month]
    MTrig --> AGS[autoGenerateNextMonthTracker]
    AGS --> EmailQ[Emails Site Q with links + Slack message]
classDef lightblue fill:#ADD8E6,stroke:#333,stroke-width:1px,color:#000
class A,B,C,D,E,F,G,H,I,J,K,L,M,N,O,P,MT,MTrig,AGS,EmailQ lightblue
classDef lightgreen fill:#90EE90,stroke:#333,stroke-width:1px,color:#000
class BG1,BG2,BG3 lightgreen
```

---

## Building Block View

### Level 1 — System Overview

| Module | Files | Responsibility |
|--------|-------|---------------|
| Entry Points | `onOpen.js`, `macros.js` | Custom menu, trigger initialization, legacy macro entry points |
| Tracker Lifecycle | `CreateNewTracker.js`, `addResponseOnSubmit.js`, `markMinusOne.js` | Copy-and-init workflow, form-submit handler, nightly miss marking |
| UI / Notifications | `NotificationSBCode.js`, `NotificationSidebar.html` | Sidebar panel: log streaming, prompts, HTML link generation |
| Utilities | `logActivity.js`, `urlShortener.js`, `Utilities.js` | Activity logging, URL shortening (TinyURL/Bitly), cell utilities, Config sheet reads |

**macros.js:** Contains `startNewMonth()` and `initTriggers()` entry points that partially overlap
with `onOpen.js` and `addResponseOnSubmit.js`. This is a legacy layer flagged for cleanup
(F3Go30-j1t).

---

## Runtime View

Known code-level risks:

| Scenario | Risk | Status |
|----------|------|--------|
| `initSheets()` called without arguments from `macros.js` | Signature mismatch — throws at runtime if `startNewMonth()` is invoked | Known bug — F3Go30-j1t |
| Tracker has fewer than 4 rows when `onFormSubmit` runs | `getRange` throws on negative row count | Guard added — F3Go30-x82 |
| URL shortener returns non-200 | Error caught but fallback URL not surfaced with actionable message | Known gap |
| `autoGenerateNextMonthTracker` installed on wrong spreadsheet | If installed on a monthly tracker instead of the template, copies from that tracker not the template | Install monthly trigger only on the template spreadsheet |

---

## Crosscutting Concepts

### Notification and Logging

Two logging channels serve different execution contexts:

- **Sidebar (`NoticeLog`, `NoticeLogInit`, `NoticePrompt`)** — active only after `NoticeLogInit()`
  opens the sidebar. Used inside `copyAndInit()` and `reinitializeSheets()`. Messages enqueue to
  `TO_CLIENT` PropertiesService; silently discarded if no sidebar is open.
- **Apps Script Logger (`Logger.log`)** — always available. Required for all trigger-fired and
  background functions (`onFormSubmit`, `markEmptyCellsAsMinusOne`, `autoGenerateNextMonthTracker`).

`NoticeLog()` mirrors to `Logger.log()` (HTML-stripped) regardless of sidebar state. Functions
that cannot guarantee a sidebar context must call `Logger.log()` directly.

---

## Data Model

| Sheet | Purpose | Key Columns |
|-------|---------|-------------|
| Tracker | One row per PAX; daily check-in grid | A: F3 Name, Row 3: dates (MM/dd/yyyy), data rows 4+ |
| Responses | Raw Google Form submission data | Col 4 (index 3): F3 Name, Col 6: Team |
| Config | Runtime configuration read by the script | A: variable name, B: primary value, C: secondary value |
| Help | Operational links and config values | A: Label, B: URL |
| Bonus Tracker | PAX bonus-point activity log | PAX-entered; not script-managed |
| Activity | Hidden audit log of script actions | A: Datetime, B: User email, C: Message, D: Sheet name |
| Links | Record of every tracker created | Date, start date, name, tracker URL, form URL, spreadsheet ID, form ID |
