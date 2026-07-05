# Roadmap — F3Go30

## Funnel

- Menu item to announce next month signup in current tracker
- Evaluate README.md word count — currently ~2,000 words vs. 800-word Minimal tier target; determine if section-level scaling is needed

## Recently Delivered

- **v2.3 (2026-07)** — PAX-facing web apps: sign-up, daily check-in, dashboard, and bonus-point
  logging, with identify-once "remember me". See `docs/CHANGELOG.md` for the full feature list.
- **(2026-05)**
  - Scheduled auto-creation of next month's tracker (time-based trigger, unattended flow)
  - Tracker-month registration confirmation email on form submit
  - Template-based Links upsert keyed by `SheetId` and `Sheet Template` Config lineage
  - Outbound email test-mode policy (send to Site Q only with intended-recipient annotation)

## Review

### Menu item: announce next month signup in current tracker

Adds "Announce Next Month Signup" to the F3 Go30 menu. Posts a notice in the
current tracker (e.g., pinned row or Help sheet entry) that next month is open
for HC signups, with the form link. Optionally generates the same Slack
copy-paste block from the Slack message feature.

**Dependencies:** Slack copy-paste message generation (F3Go30-dot) for the
optional Slack message reuse.
