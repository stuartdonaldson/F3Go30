# CONTEXT — F3Go30

## Introduction & Goals

### Purpose

F3Go30 automates the monthly lifecycle of a Go30 fitness challenge tracker in Google Sheets:
copying a template spreadsheet, linking a Google Form for sign-ups, initializing sheets, setting
up time and form-submit triggers, and marking missed check-ins nightly. It allows a single Q
(site leader) to stand up a new month's tracker in minutes without manual sheet or trigger
configuration.

### Quality Goals

| Priority | Quality Goal | Scenario |
|----------|-------------|----------|
| 1 | Operability | A non-technical site Q creates a new monthly tracker using only the custom menu, without touching Apps Script |
| 2 | Correctness | No PAX entry is duplicated, dropped, or incorrectly marked −1 due to a race condition or range error; the copied spreadsheet requires no manual setup beyond trigger initialization |
| 3 | Recoverability | If a step in Copy and Initialize fails, the sidebar log surfaces the failure with enough context for the Q to recover manually |

### Stakeholders

| Stakeholder | Expectation |
|-------------|-------------|
| Site Q | Menu-driven workflow; no scripting required |
| PAX (participants) | HC form always linked and accessible; Tracker sheet reflects accurate daily status |
| Developer | Fast context reload; clear module boundaries; known dead code is labeled |

---

## Constraints

### Technical Constraints

- Runs exclusively in Google Apps Script (V8 runtime); no local execution
- Bound to a specific Google Sheets spreadsheet; cannot run standalone
- Menu access restricted to the spreadsheet owner's Google account
- Google Forms API does not support programmatic ownership transfer across accounts; initial form
  linking requires a one-time manual step for new regions (see ADR-004)
- URL shortening requires a TinyURL API token stored as a Script Property; Bitly is supported as
  an alternative

### Organizational Constraints

- Single developer; no external CI/CD pipeline
- Deployed by pushing files via `clasp` from the `script/` folder

---

## Core Capabilities

- Copy the active tracker spreadsheet to a new named spreadsheet in the same Drive folder
- Initialize all sheets in a new tracker for the target month and start date
- Link, title, and set the confirmation message on the associated Google Form HC sign-up
- Shorten tracker and form URLs via TinyURL (or Bitly) and surface them in a notification sidebar
- Set sharing permissions on the new tracker to anyone-with-link/view
- Set up a daily 1 AM trigger to mark empty check-in cells as −1 after a 24-hour grace period
- Set up a form-submit trigger to populate the Tracker sheet when a PAX submits the HC form
- Auto-generate next month's tracker and HC form via a scheduled trigger on the 20th of each
  month; email Site Q with links and a ready-to-paste Slack message on success or failure
- Log all menu-initiated activity to a hidden Activity sheet
- Append a record (date, start date, name, tracker URL, form URL, spreadsheet ID, form ID) to
  a Links sheet in the template spreadsheet each time a new tracker is created

---

## Use Cases

### UC-1: Q Creates a New Monthly Tracker

Actor: Site Q (spreadsheet owner)

Preconditions:
- Q is logged in as the Google account that owns the current tracker spreadsheet
- A valid template or current tracker is open
- Config sheet contains a `Site Q` row with the email address in the secondary column (column C)

Primary Flow:
1. Q opens the spreadsheet; the F3 Go30 menu appears
2. Q selects "Copy and Initialize"
3. Q enters the start date when prompted; tracker name is auto-generated as `YYYY-MM-NameSpace`
4. Script copies the spreadsheet and HC form to the same Drive folder
5. Script initializes all sheets, sets form title, sets sharing permissions, and shortens URLs
6. Sidebar displays links to the new spreadsheet and form, plus a ready-to-paste Slack message

Alternate Flows:
A1: Q cancels a prompt → script exits cleanly with a sidebar log message
A2: URL shortening fails → script logs the failure and continues with the full URL
A3: Site Q email missing from Config sheet → script exits with an actionable error before any copy is made

Postconditions:
- New tracker spreadsheet exists in Drive with initialized sheets and correct sharing
- Sidebar contains clickable links to the new tracker and HC form, and a ready-to-paste Slack message
- Links sheet in the template spreadsheet has a new row: date, start date (YYYY-MM-DD), spreadsheet name, tracker URL, form URL, spreadsheet ID, form ID

Constraints:
- Only the spreadsheet owner sees the F3 Go30 menu

---

### UC-2: PAX Submits HC Sign-Up Form

Actor: PAX (participant)

Preconditions:
- The HC form is linked to the tracker spreadsheet
- The form-submit trigger has been initialized on the tracker

Primary Flow:
1. PAX opens the HC form link and submits their goal and F3 name
2. Form response lands in the Responses sheet
3. Form-submit trigger fires `onFormSubmit`
4. Script checks for a duplicate F3 name in the Tracker sheet
5. If not a duplicate, adds a new row with the PAX's data, copies formulas from the prior row, and sorts

Alternate Flows:
A1: F3 name already exists in Tracker → submission is ignored; no duplicate row added
A2: Fewer than 4 form fields present → function exits without writing

Postconditions:
- PAX row exists in the Tracker sheet, sorted and formula-populated

Constraints:
- Deduplication is by F3 name only; name collisions between distinct PAX are possible

---

### UC-3: Nightly Miss Marking

Actor: Time-based trigger (1 AM daily)

Preconditions:
- Daily trigger has been initialized on the tracker
- Tracker sheet has date columns in row 3

Primary Flow:
1. Trigger fires `markEmptyCellsAsMinusOne` at 1 AM
2. Script finds the column for two days prior (grace period)
3. For each PAX row, if the cell is empty, writes −1

Postconditions:
- All PAX who did not record a value within the grace period have −1 in the appropriate column

Constraints:
- Only cells in the two-day-prior column are evaluated; current and yesterday columns are not touched

---

### UC-4: Scheduled Monthly Auto-Generate

Actor: Time-based trigger (20th of each month, 2 AM) — template spreadsheet only

Preconditions:
- Monthly trigger has been installed via "Initialize Monthly Trigger" on the template spreadsheet
- Config sheet contains `NameSpace` (column B) and `Site Q` rows (name in column B, email in column C)
- Template spreadsheet has a bound HC form

Primary Flow:
1. Trigger fires `autoGenerateNextMonthTracker` on the 20th of the month
2. Script derives next month's start date and reads NameSpace and Site Q config
3. Script copies template, renames and moves the HC form, initializes sheets, shortens URLs
4. Script emails Site Q with tracker link, HC form link, and a ready-to-paste Slack message

Alternate Flows:
A1: Site Q email or NameSpace missing from Config → script logs error and sends email to Site Q if possible; exits without copying
A2: URL shortening fails → script logs the failure and uses the full URL in the email
A3: Any step throws after copy → Site Q is emailed with error details and the orphaned spreadsheet ID

Postconditions:
- New tracker spreadsheet exists in Drive with initialized sheets and correct sharing
- Site Q has received an email with links and Slack message copy-paste

Constraints:
- Trigger runs in the template spreadsheet context; the new tracker's own triggers must still be initialized manually via "Initialize Triggers" in the new spreadsheet

---

### UC-5: Developer Verifies GAS Behavior via LogFile

Actor: Developer

Preconditions:
- Config sheet contains a `LogFile` row (column A = `LogFile`); column B may be empty on first use
- Developer has saved the LogFile URL from a prior run, or is prepared to record it after first use

Primary Flow:
1. Developer triggers a GAS action (e.g., Copy and Initialize, form submit simulation)
2. GAS checks Config sheet for `LogFile` URL; if absent, creates a Drive file with anyone-with-link read
   permissions and writes the URL to column B
3. GAS appends a structured log entry (timestamp, trigger name, JSON payload including sidebar HTML, URLs,
   Config values read)
4. Developer reports the action is complete
5. Developer downloads the log file via the saved URL; asserts on expected keys, values, and HTML content

Alternate Flows:
A1: Drive file creation fails → GAS logs error to Logger and continues without crashing
A2: LogFile URL is stale (file deleted) → GAS creates a new file and updates Config sheet

Postconditions:
- Log entry exists in Drive file confirming the triggered operation and its outputs
- Assertions pass without manual UI inspection

Constraints:
- Log file is readable by anyone with the link; do not share publicly (contains Site Q email and URLs)
- Verification covers content correctness only; visual rendering and button behavior require manual inspection

---

## Non-Goals

- Not a multi-region coordination platform; each region operates its own independent spreadsheet
- Not a public SaaS; no web app, API, or external hosting
- Does not automate the initial one-time form linking step when bootstrapping a new region
- Does not send proactive PAX-facing email; Site Q email is only used for auto-generate success/failure notification
- No automated testing or CI/CD pipeline

---

## Glossary

| Term | Definition |
|------|------------|
| PAX | Participant in an F3 workout or Go30 challenge |
| HC | Hard Commit — a formal commitment by a PAX to participate; submitted via Google Form |
| Q | Leader of an F3 workout or challenge session; in this context the site Q manages the Go30 tracker |
| Site Q | The Q responsible for a specific F3 region's Go30 instance; typically the spreadsheet owner |
| Go30 | A 30-day F3 fitness challenge tracked in Google Sheets |
| FNG | Friendly New Guy — a first-time F3 participant |
| Tracker sheet | The primary worksheet in the Go30 spreadsheet; one row per PAX, one column per day |
| Bonus Tracker | A secondary sheet where PAX log bonus-point activities (EH, Fellowship, Inspiration, Q) |
| Responses sheet | Google Form response destination sheet; source data for `onFormSubmit` |
| Help sheet | Sheet containing operational URLs (e.g., Next Month HC Signup link) |
| Activity sheet | Hidden sheet logging all script-initiated actions with timestamp and user |
| Template | The canonical Go30 spreadsheet from which new monthly trackers are copied |
| NameSpace | Region identifier read from Config (e.g., `F3Waxhaw`); drives spreadsheet naming |

## References

- [Sheet reference](docs/sheet-reference.md) — per-sheet descriptions, column layout, formulas, and operational notes

