# CONTEXT — F3Go30

> **Architecture note:** As of ADR-010, all script execution is centralized in the Go30
> Template's bound script. Monthly tracker spreadsheets are pure data spreadsheets — they no
> longer run their own triggers or logic; the template dispatches to them by looking up the
> target spreadsheet in `TrackerDB` for a given context date. Use cases below describe this
> target model; see ADR-010 for migration status of any use case not yet fully implemented.

## Introduction & Goals

### Purpose

F3Go30 automates the monthly lifecycle of a Go30 habit-challenge tracker in Google Sheets:
copying a template spreadsheet, linking a Google Form for sign-ups, initializing sheets, and —
from the Template's centrally-dispatched triggers — handling form submissions and marking missed
check-ins nightly for every active tracker. It allows a single Q (site leader) to stand up a new
month's tracker in minutes without manual sheet or trigger configuration in the copy itself.

### Quality Goals

| Priority | Quality Goal | Scenario |
|----------|-------------|----------|
| 1 | Operability | A non-technical site Q creates a new monthly tracker using only the custom menu, without touching Apps Script |
| 2 | Correctness | No PAX entry is duplicated, dropped, or incorrectly marked −1 due to a race condition or range error; a new monthly tracker requires no manual trigger setup — only a `TrackerDB` registration |
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
- Send a daily nag email to opted-in team members when teammates missed the previous day's check-in, using a randomly-selected `FunFacts` entry for motivational content
- Set up a form-submit trigger to populate the Tracker sheet when a PAX submits the HC form and send a registration confirmation email summarizing the current goals for that tracker month
- Auto-generate next month's tracker and HC form via a scheduled trigger on the 20th of each
  month; email Site Q with links and a ready-to-paste Slack message on success or failure
- Log all menu-initiated activity to a hidden Activity sheet
- Upsert a row (date modified, start date, name, tracker URL, form URL, spreadsheet ID, form
  ID) into the template's `TrackerDB` sheet each time a new tracker is created, keyed by
  spreadsheet ID — the same row is also the dispatch target for centralized triggers (ADR-010)
- Serve a PAX-facing daily check-in + dashboard web app (`?cmd=checkin`): identifies the PAX by
  F3 Name + Email (same pair as HC sign-up), prompts for today's (and, if missed, yesterday's)
  check-in, then shows streak, score, weekly bonus points, and a team-grouped PAX leaderboard
  read live from the current month's Tracker sheet
- From that same check-in page, let the identified PAX list, add, and edit their own Bonus
  Tracker entries (EHing FNG, Fellowship, Q Point, Inspire) without opening the spreadsheet — a
  Slack link is required before EHing FNG, Q Point, or Inspire entries count toward score, same
  rule the Bonus Tracker sheet's own formulas already enforce for manual entries
- Identify once, remembered everywhere: a PAX's F3 Name + Email, once entered on either the
  sign-up or check-in web app, is remembered (browser storage, plus a bookmarkable per-PAX link
  on check-in) and carried across both apps and repeat visits — no separate accounts, no
  re-typing, no hunting through a spreadsheet for "which row is mine." A PAX known from a past
  month's sign-up but not yet registered for the current one is carried automatically into a
  prefilled sign-up instead of hitting a dead end

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
- `TrackerDB` sheet in the template spreadsheet has a new row, keyed by spreadsheet ID: date
  modified, start date (YYYY-MM-DD), spreadsheet name, tracker URL, form URL, spreadsheet ID,
  form ID — this same row registers the tracker for centralized dispatch (form-submit, nightly
  −1 marking, nag email) by the Template; no per-spreadsheet trigger setup needed

Constraints:
- Only the spreadsheet owner sees the F3 Go30 menu

---

### UC-2: PAX Submits HC Sign-Up Form

Actor: PAX (participant)

Preconditions:
- The HC form is linked to the tracker spreadsheet
- The tracker's form ID and spreadsheet ID are registered in `TrackerDB`, so the Template's centrally-installed form-submit dispatcher can resolve and open the correct spreadsheet

Primary Flow:
1. PAX opens the HC form link and submits their goal and F3 name
2. Form response lands in the Responses sheet
3. Form-submit trigger fires `onFormSubmit`
4. Script sends a registration confirmation email that summarizes the current goals for the tracker month derived from the Tracker start date
5. Script checks for a duplicate F3 name in the Tracker sheet
6. If not a duplicate, adds a new row with the PAX's data, copies formulas from the prior row, and sorts

Alternate Flows:
A1: F3 name already exists in Tracker → submission is ignored; no duplicate row added
A2: Fewer than 4 form fields present → function exits without writing

Postconditions:
- PAX row exists in the Tracker sheet, sorted and formula-populated
- PAX receives a registration confirmation email for the target tracker month unless the reuse-specific email path already handled the submit

Constraints:
- Deduplication is by F3 name only; name collisions between distinct PAX are possible

---

### UC-3: Nightly Miss Marking

Actor: Time-based trigger (1 AM daily, installed once on the Template)

Preconditions:
- The daily trigger is installed only on the Template — not on individual tracker copies
- Every active tracker has a row in `TrackerDB` with a matching date range
- Tracker sheet has date columns in row 3

Primary Flow:
1. Trigger fires the centralized dispatcher at 1 AM with today as the context date
2. Dispatcher looks up the `TrackerDB` row(s) whose date range covers the context date and opens each target spreadsheet by ID
3. For each target, script finds the column for two days prior (grace period)
4. For each PAX row, if the cell is empty, writes −1

Postconditions:
- All PAX who did not record a value within the grace period have −1 in the appropriate column, for every active tracker

Constraints:
- Only cells in the two-day-prior column are evaluated; current and yesterday columns are not touched
- A context date matching zero or more than one `TrackerDB` row is a dispatch error and must be logged, not silently skipped

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
- Trigger runs in the template spreadsheet context; the new tracker requires only a `TrackerDB` registration, not its own trigger initialization

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

### UC-6: Daily Reminder Email Runs

Actor: Time-based trigger (10 AM daily, installed once on the Template)

Preconditions:
- The daily nag trigger is installed only on the Template, not on individual tracker copies
- Every active tracker has a row in `TrackerDB` with a matching date range
- Tracker and Responses sheets exist and contain current-month data for each active tracker
- Reminder recipients have explicitly opted in via the HC form reminder-consent field

Primary Flow:
1. Trigger fires the centralized nag dispatcher at 10 AM with today as the context date
2. Dispatcher looks up the `TrackerDB` row(s) matching the context date and opens each target spreadsheet by ID
3. For each target, script finds the prior day's column in the Tracker sheet
4. Script groups PAX by team and identifies members who did not check in
5. Script emails the opted-in members of each affected team with the missing-member list and tracker reminder text

Alternate Flows:
A1: Prior-day date column not found → function logs and exits without sending
A2: No missing PAX on a team → no email sent for that team
A3: Team has missing PAX but no opted-in recipients → no email sent for that team

Postconditions:
- Opted-in team members may receive a nag email about missing prior-day check-ins

Constraints:
- Motivation content is sourced from a randomly-selected `FunFacts` sheet entry, per the reminder workflow design decision

---

### UC-7: PAX Checks In and Views Dashboard

Actor: PAX (participant)

Preconditions:
- PAX has an active HC sign-up (F3 Name + Email) in the current month's Responses sheet
- The current month's Tracker sheet has a row for that F3 Name

Primary Flow:
1. PAX opens the check-in web app link (`?cmd=checkin`) and enters F3 Name + Email — prefilled
   from browser storage if they previously signed up or checked in on the same device
2. Script verifies the pair against the current month's Responses sheet (same anti-enumeration
   match used by sign-up) and locates the matching Tracker row
3. The typed-identify form submits to a personal `?cmd=checkin&id=<session guid>` URL (a
   server-stored check-in session, see `CheckinSessions.js`) baked into the form's own `action`
   before submission, so the address bar is already correct the instant identify succeeds — the
   PAX ends up on, and can bookmark / Add to Home Screen, a link that skips the name+email form on
   future visits. The first time the PAX lands on that URL, a one-time "bookmark this" note is shown
4. PAX taps "I Hit it!" / "Missed it" / "No Check-in" for today; if yesterday's Tracker cell is
   still blank, the same choice is also offered for yesterday
5. Script writes the chosen value(s) into the matching date column(s) of the PAX's Tracker row
6. PAX is taken to the dashboard: streak, month progress, total score, weekly bonus points, a
   "My Team" tile row, and a PAX board grouped by the Tracker's Team/Goal column
7. PAX taps the "…" button to open the underlying tracker spreadsheet directly

Alternate Flows:
A1: F3 Name + Email match a PAX known to a prior month's sign-up (found in the historical
    `PaxDB` roster, requiring an EXACT match on both fields — the same anti-enumeration
    boundary as a current-month match) but not registered for the CURRENT month → instead of a
    dead-end message, the PAX is carried automatically (same browser-storage handoff as a
    completed sign-up) into a prefilled sign-up for the current month, arriving via the same
    deep link (`?cmd=signup&targetMonth=current&autoStart=1`) the dashboard's own "Sign up for
    next month" nudge uses. A truly unknown F3 Name + Email (no match anywhere, current or
    historical) still gets the generic "not found" message with a manual "Sign up" button —
    the two cases are visually indistinguishable except for the automatic redirect, preserving
    the anti-enumeration property (a truly-unknown pair reveals nothing more than one that's
    merely unregistered this month)
A2: PAX taps "Dashboard" without checking in → dashboard loads without writing any check-in value
A3: Target Tracker cell is a formula (unexpected sheet layout) → write is refused; check-in
    is not recorded and the client shows the error banner
A4: Automatic redirect (to the tokened check-in URL, or to sign-up per A1) is blocked by the
    browser → a manual link/button is shown instead, carrying the same target URL

Postconditions:
- Today's (and, if applicable, yesterday's) Tracker cell holds the PAX's reported 1/0 value
- Dashboard reflects the Tracker sheet's live, formula-computed scores — no separate data store

Constraints:
- Identity is F3 Name + Email only — there is no password; anyone who knows both can check in
  or view the dashboard for that PAX, the same trust model as the sign-up web app
- The A1 PaxDB fallback is consulted only when the submitted F3 Name + Email were typed (or
  decoded from a still-valid saved link) and failed to match the current month — never when the
  saved link itself fails to verify (tampered/stale), which falls through to a blank form with
  no error text and no PaxDB lookup, so a broken link can never be used to probe PaxDB

---

## Non-Goals

- Not a multi-region coordination platform; each region operates its own independent spreadsheet
- Not a public SaaS; the sign-up and dashboard/check-in web apps are Apps Script `doGet`/`doPost`
  endpoints reading/writing the region's own spreadsheet directly — no external hosting, API, or
  database of their own
- Does not automate the initial one-time form linking step when bootstrapping a new region
- No automated testing or CI/CD pipeline

---

## Glossary

| Term | Definition |
|------|------------|
| PAX | Participant in an F3 workout or Go30 challenge |
| HC | Hard Commit — a formal commitment by a PAX to participate; submitted via Google Form |
| Q | Leader of an F3 workout or challenge session; in this context the site Q manages the Go30 tracker |
| Site Q | The Q responsible for a specific F3 region's Go30 instance; typically the spreadsheet owner |
| Go30 | A monthly F3 habit-building challenge, rooted in *Atomic Habits*: each PAX picks one small, specific Daily Challenge and scores it Hit (1) / Miss (0) / No-report (−1) each day for the month, with a team for accountability. Tracked in Google Sheets. The "30" is the ~30 days of consistent daily repetition, not a per-day duration |
| FNG | Friendly New Guy — a first-time F3 participant |
| Tracker sheet | The primary worksheet in the Go30 spreadsheet; one row per PAX, one column per day |
| Bonus Tracker | A secondary sheet where PAX log bonus-point activities (EH, Fellowship, Inspiration, Q) |
| Responses sheet | Google Form response destination sheet; source data for `onFormSubmit` |
| Help sheet | Sheet containing operational URLs (e.g., Next Month HC Signup link) |
| Activity sheet | Hidden sheet logging all script-initiated actions with timestamp and user |
| Template | The canonical Go30 spreadsheet from which new monthly trackers are copied; since ADR-010, also the sole runtime container for all triggers and dispatch logic |
| NameSpace | Region identifier read from Config (e.g., `F3Waxhaw`); drives spreadsheet naming |
| TrackerDB | Sheet in the Template recording every monthly tracker's spreadsheet ID, form ID, and active date range; used both to aggregate cross-tracker metrics and, since ADR-010, to resolve which spreadsheet a centrally-dispatched function should operate on for a given context date |
| Context date | The date a dispatch function is operating "as of" — the real current date for production trigger firings, or an explicit override (e.g. a future date) for tests targeting an isolated `TrackerDB` row |

## References

- [Sheet reference](docs/sheet-reference.md) — per-sheet descriptions, column layout, formulas, and operational notes

