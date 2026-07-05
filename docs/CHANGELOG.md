# Changelog — F3Go30

User-facing record of notable releases, written from the PAX/Site-Q perspective. The
authoritative version/date is `script/version.js`. Developer-level, per-session detail lives in
`work-log.md`; forward-looking work lives in `docs/ROADMAP.md` and bd.

---

## v2.3 — PAX-facing web apps (2026-07)

The 2.3 series moved sign-up, daily check-in, the dashboard, and bonus-point logging off the Google
Sheet and onto phone-friendly web pages. PAX previously did all of this inside the Google Sheets
app — a lot of scrolling to find your own row; now the web app remembers who you are and only asks
for what it doesn't already know.

### Sign-up
- Web-based Hard Commit sign-up — no separate Google Form needed.
- Returning PAX are recognized by F3 name + email and their team and goals are pre-filled.
- Changing your email retires the old entry instead of creating a duplicate (ADR-008).
- Confirmation email summarizing your goals, with a link straight into daily check-in.

### Daily check-in
- One-tap **"I Hit it!" / "Missed it" / "No Check-in"** for today.
- If you check in late, it also offers yesterday when that day was left blank — you don't lose it.
- **Identify once, then the app remembers you.** Your first identify swaps you onto a personal,
  bookmarkable link that survives phone storage resets; if the browser blocks the automatic swap, a
  "Tap here to continue" link takes you to the same bookmarkable link.
- Check-ins resolve correctly across month boundaries (e.g. marking "yesterday" on the 1st updates
  last month's tracker).

### Dashboard
- Current streak, best 30-day streak, and a 7-day rolling average.
- Month-progress ring: done, missed, and absent (the −1 penalty).
- "My Team" tile plus a full PAX board, grouped by team.
- Step back to any prior month you participated in; a nudge if you haven't signed up for next month.

### Bonus points
- Log Fellowship, Q, Inspire, or EHing-an-FNG from your phone instead of editing the sheet.
- EHing an FNG is worth 5×; Fellowship, Q, and Inspire count at most once per week.
- Q, Inspire, and EHing FNG require a Slack evidence link, validated when you submit.
- Edit or delete an entry you already logged, even across a month boundary.

### Under the hood (Site-Q / operator)
- All PAX apps are Apps Script `doGet`/`doPost` endpoints reading/writing the region's own
  spreadsheet — no external hosting, API, or database.
- Anti-enumeration: identify returns the same response shape whether or not a PAX is found, so the
  roster can't be probed.
- Admin actions are gated by a shared secret echoed in the request body.
- Monthly triggers are centralized on the Template and dispatch by `TrackerDB` lookup (ADR-010), so
  every tracker's activity is visible in one place.
