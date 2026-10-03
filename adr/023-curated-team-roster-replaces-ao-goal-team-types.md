# ADR-023: Curated, Self-Growing Team Roster Replaces AO/Goal Team Types

Status: Proposed

Date: 2026-10-02

Implementation: F3Go30-qeuu (epic)

## Context

Sign-up asks a PAX to choose a team type — **AO-based** (fixed `<select>` from `ListDB`
column A) or **Custom Team** (free text with a `<datalist>` from `ListDB` column B) — and the HC
Google Form asks the same AO-vs-goal question. `classifyTeam_` (`script/signupWebapp.js`)
re-sorts every stored value into `ao`/`goal`/`other`, and the label is written to Responses
`Team type`.

In practice the AO/goal distinction carries no behaviour: the dashboard, nag email, and Team
Score all group on the raw team string (ADR-012). `ListDB` is hand-maintained and nothing feeds
new teams back into it, so suggestions go stale, and free-text entries drift into
near-duplicates ("Shieldlock" / "Shield Lock") that ADR-012 recorded as an accepted limitation.

## Decision

1. **One team field.** Team type is removed from sign-up. A PAX either picks a
   suggested team or types a new one; a new name is accepted and added.
2. **Roster lives in a Template-resident `TeamDB` sheet** (`Team | Aliases | Status | LastUsed |
   UseCount`), replacing `ListDB`. It is not copied into trackers. Admins edit it directly to fix
   spelling, hide teams, or add aliases.
3. **Suggestions are time-windowed:** active teams whose `LastUsed` falls within the last
   `TeamSuggestWindowDays` days (Config, default 90), plus a pinned "Solo (no team)".
4. **Every save canonicalizes.** Sign-up save and HC Form submit both pass the team through one
   shared server function that matches name or alias case/space-insensitively, stores the
   canonical spelling, and upserts `LastUsed`/`UseCount` (new row if unmatched).
5. **Near-duplicates are caught at entry.** The sign-up client prompts "Did you mean …?" when a
   new name is near an existing one (punctuation/space-stripped equality or small edit distance).
6. **Rename/merge is an admin action** (`renameTeam {from, to}`): updates `TeamDB` (old name
   becomes an alias of `to`), rewrites the current tracker's Responses team column and current
   month `PaxDB` rows, and invalidates affected caches.

ADR-012's decision (group on the live Tracker column B value at read time) is unchanged; this
ADR changes what values reach that column.

## Consequences

- Team suggestions maintain themselves from real usage; admins correct, not curate.
- Duplicate teams are reduced at three points — canonical snap on save, near-match prompt, admin
  merge — rather than accepted as a limitation.
- `renameTeam` rewrites only the current tracker; prior months keep their historical spelling
  (aliases still map them for prefill/reuse).
- Installed PWA clients on an older build keep sending `teamType: 'ao'|'other'`; the server must
  accept and ignore it. Identify keeps returning `aoList`/`goalList` (empty / the roster) for
  those clients until they update.
- Responses `Team type` stops carrying meaning; it is written blank for new rows and left
  in place on existing trackers. `RESPONSE_COLUMN_MAP` keeps its old aliases for older trackers.
- The HC Google Form is not restructured: it is being retired outright (user decision
  2026-10-02 — zero PROD Form submissions in 90 days; tracked separately). Until it is, a Form
  submission's team is snapped and recorded through the same `recordTeamUse_` path.
- Sign-up save gains one `TeamDB` write; sign-up is low-frequency, so the cost is acceptable.

## Open questions

- Near-match threshold for the "Did you mean …?" prompt (edit distance ≤ 2 proposed) — set
  during implementation against the real `PaxDB` team history; revisit if it over-prompts.
- Whether to drop the `Team type` column from the Template outright once no live tracker reads it.
