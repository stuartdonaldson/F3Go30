# Roadmap — F3Go30

## Funnel

- Scheduled auto-creation of next month's tracker (time-based trigger, unattended flow)
- Menu item to announce next month signup in current tracker
- Evaluate README.md word count — currently ~2,000 words vs. 800-word Minimal tier target; determine if section-level scaling is needed

## Review

### Scheduled auto-creation of next month's tracker

Adds a time-based trigger that fires 1 week before end of month, runs the
copy-and-initialize flow unattended, then emails f3go30@gmail.com with links to
the new spreadsheet and HC form plus the ready-to-copy Slack messages.

**Dependencies:** Slack copy-paste message generation (F3Go30-dot) must be
complete first — the auto-creation flow reuses those message templates.

**Open questions:**
- How to handle prompt inputs (tracker name, start date) without a UI — auto-derive from current month?
- Error handling for unattended execution — what happens if the copy fails at 1 AM with no user present?

### Menu item: announce next month signup in current tracker

Adds "Announce Next Month Signup" to the F3 Go30 menu. Posts a notice in the
current tracker (e.g., pinned row or Help sheet entry) that next month is open
for HC signups, with the form link. Optionally generates the same Slack
copy-paste block from the Slack message feature.

**Dependencies:** Slack copy-paste message generation (F3Go30-dot) for the
optional Slack message reuse.
