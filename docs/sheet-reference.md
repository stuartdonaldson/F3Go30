# F3Go30 Spreadsheet — Sheet Reference

**Source spreadsheet:** 2026-03-T3 Go30
(Extracted 2026-04-01 from the most recent `copyAndInit` log entry)

This document explains the purpose and mechanics of every sheet in the F3Go30 tracker
spreadsheet. Sheets are grouped by role: PAX-facing, operator/admin, scoring, and legacy/archive.

---

## PAX-Facing Sheets

### Tracker

**Tab color:** Green  
**Who uses it:** Every registered PAX, every day of the month.

This is the heart of the spreadsheet. Each row is one PAX. Each column from the first date
onward is one day of the month. PAX navigate to their row and enter `1` (completed workout) or
`0` (missed) in the cell for each day.

**How a PAX row gets added**

When a PAX submits the Hard Commit signup form, Google Forms writes the response to the
Responses sheet. This fires the `handleFormSubmit_()` GAS function (installed as an
`onFormSubmit` trigger). That function:

1. Reads the F3 Name from the form response (field index 3).
2. Checks whether that name already exists in the Tracker. If it does, skips the insert
   (last-write-wins on re-submission — no duplicate rows are created).
3. Finds the next empty row in column A (starting at row 4) and writes the F3 Name there.
4. Copies all formulas and formatting from the previous PAX row down to the new row, so
   every new PAX immediately has correct score formulas, bonus columns, and date cells.
5. Clears any plain numeric values in the new row (avoiding carry-over of another PAX's
   day-by-day data).
6. Re-sorts rows 4 onward by team (column B) then name (column A), so the leaderboard stays
   organized.

**Column layout (row 3 is the header row)**

| Column | Label | How it works |
|--------|-------|-------------|
| A | F3 Name | Written by `handleFormSubmit_()`. PAX's F3 handle. |
| B | Goal / Team | `=IFNA(VLOOKUP($A4,'Goals by HIM'!A:B,2,0),"")` — pulls the PAX's stated goal or team from the Goals by HIM sheet. |
| C | Fellowship *(hidden)* | `=SUMIFS(UBonus_Multiplier, UBonus_Name, $A4, UBonus_Type, C$3, ...)` — sum of fellowship bonus points earned. Hidden to reduce visual clutter. |
| D | Q-Point | Sum of Q-Point bonuses earned this month. |
| E | Inspire | Sum of Inspire bonuses earned. |
| F | EHing FNG | Sum of EHing FNG bonuses earned. |
| G | Raw Score | `=SUMIF(SDTracker_Data_Header,"<>Bonus",I4:AS4)` — sum of all day columns that are NOT bonus columns. One point per workout day completed. |
| H | Score | `=SUM($I4:$AS4)` — total score including raw + all bonus points. |
| I… | Date columns | One column per calendar day, orange fill. PAX enter `1` or `0`. |
| Bonus cols | Bonus *(green fill)* | Period bonus columns (one per week). See below. |
| AT–AW | Bonus by type *(hidden region)* | Per-type bonus summaries used by the HIM Score and Team Score queries. |

**Period / Bonus columns**

Row 2 carries period numbers (1–5) above the Bonus columns. Each Bonus column appears
immediately after Saturday and again after the last day of the month. The value in each Bonus
cell is:

```
=SUMIFS(UBonus_Multiplier, UBonus_Name, $A4, UBonus_Period, P$2, UBonus_Complete, TRUE)
```

This sums every Bonus Tracker entry for this PAX in the matching period where `Complete = TRUE`.
The period number comes from the Periods sheet, which maps each date to its week-within-month
number.

**Row 1 decorations**

- Column B: `=NOW()` — shows the current date/time, effectively a "last refreshed" timestamp.
- Column H (merged across H1:AW1): A rotating inspiration quote pulled from the Inspiration
  sheet. The formula uses `LET` + `MOD(NOW(),1)*86400` to cycle through all quotes in the
  Inspiration sheet, changing every 10 seconds based on the time of day.

---

### Bonus Tracker

**Tab color:** Purple  
**Who uses it:** PAX, to record bonus activities throughout the month.

PAX submit bonus entries directly into this sheet (rows 2 onward). Each row is one bonus claim.

**User-entered columns**

| Column | Label | What PAX enter |
|--------|-------|----------------|
| A | Name | Their F3 name (must match Tracker exactly) |
| F | Type | Bonus type selected from dropdown: EHing FNG, Fellowship, Q Point, Inspire |
| G | When | Date the activity occurred |
| H | What/Where/Who | Free-text description of the activity |
| I | Slack Link | Required for some bonus types — a link to the backblast, Slack post, or evidence |

**Auto-calculated hidden columns**

Columns B, C, D, E are hidden from PAX view but drive all Tracker scoring:

| Column | Label | Formula |
|--------|-------|---------|
| B | Period | `=VLOOKUP($G2:$G892, Periods!B:C, 2, 0)` — looks up the date in column G and returns the week-within-month period number (1–5). This determines which Bonus column in the Tracker gets credited. |
| C | Uncapped Points | Shows the point value only for bonus types flagged as uncapped (EHing FNG). For capped types, this is blank. |
| D | Multiplier | `=VLOOKUP(F, Controls!A:B, 2, FALSE)` — the point value for this bonus type, from the Controls sheet. |
| E | Complete | `TRUE` if all requirements for this bonus type are satisfied. For types that require a link, `Complete = TRUE` only when column I (Slack Link) is non-blank. For types with no link requirement (Fellowship), `Complete = TRUE` whenever column A is non-empty. |

**Bonus type rules (from Controls sheet)**

| Bonus Type | Points | Link Required? | Capped per period? | Notes |
|------------|--------|----------------|--------------------|-------|
| EHing FNG | 5 | Yes | No (uncapped) | Must provide a Slack link as evidence. Can claim multiple per week — every FNG you bring earns 5 points. |
| Fellowship | 1 | No | Yes | No evidence link needed. Capped — one per period maximum (enforced by the capped/uncapped logic). |
| Q Point | 1 | Yes | Yes | Must provide a link to the backblast for the Q you led. One Q per week maximum. |
| Inspire | 1 | Yes | Yes | Must provide a link to a post or share. Capped per period. |

**How bonus points flow to the Tracker**

1. PAX fills in Name, Type, When, and (if required) Slack Link in Bonus Tracker.
2. The hidden formulas auto-calculate Period, Multiplier, and Complete.
3. The Tracker's Bonus column formula uses `SUMIFS` against the UBonus Tracker named ranges
   (which deduplicate the Bonus Tracker via `=UNIQUE()`). It sums `Multiplier` where
   `Name = this PAX`, `Period = this period`, and `Complete = TRUE`.
4. Only `Complete = TRUE` rows contribute to the score, so an entry with no link provided
   shows in the Bonus Tracker but earns zero points until the link is added.

**Correcting a bad entry**

A PAX can return to the Bonus Tracker and edit their row directly. There is no separate
correction flow — editing column I to add a missing link will immediately change `Complete`
to `TRUE` and update the Tracker score on next recalculation.

---

### Responses

**Visibility:** Visible  
**Who uses it:** Written by Google Forms; read by `handleFormSubmit_()` and the Goals by HIM query.

This is the form response destination. Google Forms appends one row per submission. Columns:

| Col | Question |
|-----|---------|
| A | Timestamp |
| B | Email Address |
| C | Are you currently participating in Go30? |
| D | **F3 Name** ← key field, used as the Tracker row identifier |
| E | Team preference (AO-based vs goal-based) |
| F | **Team** ← used in Goals by HIM and the Tracker sort |
| G | Goal selection from list |
| H | WHO do you ultimately want to become? |
| I | WHAT is your Go30 Challenge? |
| J | HOW are you going to be successful this month? |
| K | Cell Phone Number |
| L | Constructive Comments |
| M | Success Story |

**Important:** The F3 Name field (column D) is the key that links a response to a Tracker row.
If a PAX re-submits with the same F3 name, `handleFormSubmit_()` detects the duplicate and does
not add a second Tracker row — but it still logs the new response here. If a PAX edits their
response via the Google Forms "edit response" link and changes their F3 name, the Tracker row
keyed on the original name will **not** update automatically. An operator must manually update
the Tracker cell to match.

---

### Help

**Tab color:** Black  
**Who uses it:** PAX and operators looking for tutorials and resources.

A simple reference sheet. Row 1 is a heading ("Here are resources to help you in Go30").
Subsequent rows contain clickable resource links, currently including a YouTube tutorial video.
This sheet should be kept in sync with current documentation and updated as new video content
is published.

---

## Scoring and Display Sheets

### HIM Score

**Tab color:** Green  
**Who uses it:** PAX checking individual standings.

A live leaderboard of individual PAX, sorted by total Score descending. Driven by a single
Google Sheets QUERY formula:

```
QUERY(Tracker!$A$3:Z$79,
  "SELECT A, C, D, E, F, G, H ORDER BY H DESC", 1)
```

Columns displayed: F3 Name, Fellowship, Q-Point, Inspire, EHing FNG, Raw Score, Score.
Updates in real time as PAX enter daily data and bonus entries.

---

### Team Score

**Tab color:** Blue  
**Who uses it:** PAX checking team standings; operators for end-of-month reports.

A team leaderboard, driven by a nested QUERY that:
1. Groups the Tracker by team (column B).
2. Counts members per team.
3. Averages Score, Raw Score, Fellowship, Q-Point, Inspire, and EHing FNG across team members.
4. Filters to teams with more than 1 member.
5. Sorts by average Score descending.

Columns: Team, Score (avg), Raw Score (avg), Fellowship (avg), Q-Point (avg), Inspire (avg),
EHing FNG (avg).

---

### Goals by HIM

**Tab color:** Red  
**Who uses it:** Operators; also referenced by the Tracker (column B goal/team lookup).

A QUERY view of the Responses sheet showing each PAX's signup goals, sorted by F3 Name:

```
QUERY(Responses!$A1:$L70,
  "select D, F, H, I, J, K where D IS NOT NULL ORDER BY D, F", 1)
```

Columns: F3 Name, Team, WHO/WHAT/HOW goals, Cell Phone Number.

The Tracker column B formula does `VLOOKUP($A4, 'Goals by HIM'!A:B, 2, 0)` to pull each
PAX's team or goal into the Tracker row, where it's used for the team sort and Team Score query.

---

## Configuration and Automation Support Sheets

### Config

**Visibility:** Hidden  
**Who uses it:** GAS functions only — not for direct editing during normal operations.

Stores the three runtime configuration values that GAS functions read at startup:

| Variable | Column B | Column C | Purpose |
|----------|----------|----------|---------|
| NameSpace | `T3 Go30` | — | Region identifier appended to new spreadsheet names (e.g., `2026-03-T3 Go30`) |
| Site Q | `Little John` | `stu@asyn.com` | Operator name and email. The email receives the monthly confirmation message from `autoGenerateNextMonthTracker()`. |
| LogFile | Drive URL | — | Google Drive URL of the append-only log file used by all GAS functions for operational logging. |

---

### Controls

**Visibility:** Hidden  
**Who uses it:** Formulas in Bonus Tracker and UBonus Tracker — not for direct editing.

The lookup table that defines the rules for each bonus type. Every Bonus Tracker formula
that calculates Multiplier, Complete, and Uncapped Points references this sheet:

| Bonus Type | Multiplier | Link Required? | Uncapped? |
|------------|-----------|----------------|-----------|
| EHing FNG | 5 | Yes | Yes |
| Fellowship | 1 | No | No |
| Q Point | 1 | Yes | No |
| Inspire | 1 | Yes | No |

Column E contains variable names used by named range definitions (e.g., `Bonus`).
Column G contains a month-name formula that is currently showing a `#REF!` error — likely
a leftover from a named-range migration and not in active use.

---

### Periods

**Visibility:** Hidden  
**Who uses it:** Bonus Tracker period lookup — not for direct editing.

Maps every date in the current month to its period number (week within month, 1–5).
Column A contains the period number for the first date of each new week. Column B contains the
date. Column C calculates the period:

```
=WEEKNUM(B1, 1) - WEEKNUM(DATE(YEAR(B1), MONTH(B1), 1), 1) + 1
```

This gives week-of-month numbering starting at 1, regardless of the calendar year. The dates
in column B are populated by a Google Sheets QUERY that transposes the date header row from the
Tracker — when the Tracker is initialized with a new month's dates, Periods updates automatically.

The Bonus Tracker's Period formula does `VLOOKUP(date, Periods!B:C, 2, 0)` to convert each
bonus entry's date into its period number, which the Tracker then uses to credit the correct
Bonus column.

---

### UBonus Tracker

**Visibility:** Hidden  
**Who uses it:** Named range source for Tracker SUMIFS formulas — not for direct editing.

A deduplicated mirror of the Bonus Tracker, created by a single array formula:

```
=UNIQUE('Bonus Tracker'!A:F)
```

All rows except header and unique entries are hidden. The five columns are exposed as named
ranges (`UBonus_Name`, `UBonus_Period`, `UBonus_Multiplier`, `UBonus_Complete`, `UBonus_Type`)
that the Tracker's Bonus column SUMIFS formulas reference by name rather than by cell address.
This indirection means the Tracker formulas do not need to change if the Bonus Tracker moves
or grows.

---

### Inspiration

**Visibility:** Hidden  
**Who uses it:** Tracker row 1 rotating quote display.

A two-column table of motivational quotes (Quote in column A, Author in column B). Currently
holds 25 entries. The merged cell H1 in the Tracker cycles through these quotes every 10 seconds
using a `LET` formula that computes an index from the current time of day modulo the number of
available quotes.

---

### Status

**Visibility:** Hidden  
**Who uses it:** Reserved for automation state flags.

A single-cell sheet. Currently empty. Exists as a reserved location for GAS functions to
write transient state (e.g., "initialization in progress") that other functions could check.

---

### Activity

**Visibility:** Hidden  
**Who uses it:** Written by `logActivity()` GAS function; readable by operators for audit purposes.

An append-only log of automation events. Four columns: Datetime, User (F3 name or function
identifier), Message (description of the operation), Sheetname. Currently holds ~494 rows of
historical activity. Used for debugging and auditing — for example, every form submission logs
a `Response` entry with the PAX's F3 name.

---

## Legacy and Archive Sheets

### Links old

**Visibility:** Visible  
**Who uses it:** Operators looking up historical tracker and form URLs.

A historical registry of past monthly trackers. Each row records the Month (date), Spreadsheet
ID, Tracker URL (tinyURL), HC Form URL (tinyURL), Slack Channel, and Slack Canvas for one past
month. Rows go back to at least February 2026. The current scheme records links in a `Links`
sheet on the template spreadsheet instead; this sheet preserves the older pre-migration history.

---

### Responses old

**Visibility:** Hidden  
**Who uses it:** Goals by AO query — legacy data only.

One header row plus one data row from a prior month when teams were AO-based (column F was
"AO" rather than "Team"). Referenced only by the Goals by AO sheet. No new data is written
here.

---

### Goals by AO

**Visibility:** Hidden  
**Who uses it:** Legacy — not shown to PAX or operators in current workflow.

The predecessor to Goals by HIM. Queries `Responses old` instead of the current Responses
sheet. Orders by AO then F3 Name. Kept for historical continuity but not actively used in
current scoring or display.

---

### Notes

**Visibility:** Hidden  
**Who uses it:** Reference — not used by active automation.

A single row containing the raw Google Forms URL for the signup form. Predates the Links sheet
tracking system. Kept as a fallback reference if the form URL is needed.

---

### Copy of NextMonthLink

**Visibility:** Hidden  
**Who uses it:** Template for generating pre-filled sign-up form links.

Contains a pre-filled Google Forms URL template with placeholder tokens
(`F3NAME`, `WHO`, `WHAT`, `HOW`, `0000000000`, team name) that can be substituted to generate
a personalized re-enrollment link for the next month. Used when generating the auto-notification
email to re-engage existing PAX.

---

### Sheet195

**Visibility:** Visible  
**Content:** Empty (1 row × 1 column)

An artifact sheet — likely the remnant of a spreadsheet copy or import operation. No formulas,
no data, no known purpose. Safe to delete.
