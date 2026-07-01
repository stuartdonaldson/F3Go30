# ADR-012: Dashboard Team Grouping Reads the Live Tracker Team Column, Not a Roster

Status: Accepted

Date: 2026-06-30

## Context

The new PAX dashboard (`?cmd=checkin` → `dashboard` action, `script/dashboardWebapp.js`) needed a
"My Team" tile row and a team-grouped PAX leaderboard, similar in spirit to the
`docs/references/Go30 PAX Scoring Dashboard/` design reference. That reference mockup groups PAX
under invented team names (`ALPHA`/`BRAVO`/`CHARLIE`) implying a fixed team roster.

The actual Go30 data model has no such roster. The Tracker sheet's column B (`Goal / Team`) is a
per-PAX `VLOOKUP` into `Goals by HIM`, itself sourced from each PAX's free-form sign-up answer
(an AO name, a goal-based team name, or an "other" free-text value, classified by
`classifyTeam_` in `signupWebapp.js`). There is no sheet or table anywhere that lists "the teams"
independently of what PAX have typed into their sign-up.

## Decision

The dashboard's "My Team" and PAX board groupings are computed by grouping Tracker rows on their
live column B value (case-insensitive, trimmed; blank → `Unassigned`) at read time
(`groupByTeam_` in `script/dashboardWebapp.js`), not against any maintained team list.

## Consequences

- No new "teams" sheet, config, or roster needs to be created or kept in sync — the dashboard
  reflects whatever team/goal values are already in the Tracker, with zero migration.
- A PAX's dashboard team membership changes automatically and immediately if their `Goals by HIM`
  entry (and therefore the Tracker's column B `VLOOKUP` result) changes — there is no separate
  team-assignment step for the dashboard to get out of sync with.
- Because grouping is driven by free-form sign-up values rather than a controlled team list, minor
  spelling/capitalization variants that aren't already normalized by `classifyTeam_` (e.g. an
  "other" free-text team typed two different ways) will appear as two separate groups. This is an
  accepted limitation of the existing free-form team model, not something this decision
  introduces or is scoped to fix.
- The design reference's fixed multi-team roster (`ALPHA`/`BRAVO`/`CHARLIE`) is not implemented;
  any future request for curated/renamed team groupings would need a real roster data source
  first.
