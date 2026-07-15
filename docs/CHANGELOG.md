# Changelog — F3Go30

User-facing record of notable releases, written from the PAX/Site-Q perspective. The
authoritative version/date is `script/version.js`. Developer-level, per-session detail lives in
`work-log.md`; forward-looking work lives in `docs/ROADMAP.md` and bd.

**What belongs here (and what doesn't).** An entry earns a place only if a PAX or a
Site-Q/administrator would both *notice and care* about the change. Refactors, test/build/deploy
mechanics, and fixes with no user-visible symptom do not — they live in git history and
`work-log.md`. This is deliberately decoupled from the deploy version churn:

| Change tier | Version movement | Recorded in |
|---|---|---|
| SIT build churn | 4th segment (`2.3.13.7`), many/day | git history only |
| PROD patch release | 3rd segment (`2.3.13`), per release | git history + `work-log.md` |
| User/admin-facing capability | rolls up to a **minor** series (`2.3`) | **this file** |

Headings are **minor-series** (`v2.3`, `v2.4`), never per-patch or per-build. Accumulate
user/admin-facing bullets under **Unreleased** as they land — however many patch/build bumps happen
underneath — and promote them to a dated minor heading when the series is cut as a coherent release.
Stamp with the minor series + date; note a specific PROD patch inline only when one item's exact
go-live matters.

---

## Unreleased

_User/admin-facing changes landed since the last minor release, awaiting the next series cut._

- The daily "missing check-in" reminder email now leads with the check-in web app — a PAX taps in
  their F3 name once, then bookmarks the page so it remembers them — and demotes the Tracker sheet
  to an "older sheet interface" fallback link, instead of leading with the Tracker sheet.
- Fixed the bookmarked check-in link intermittently failing to appear after identify (a PAX could
  get stuck re-typing their name/email every visit, or land back on the sign-in form after
  reopening the app) — the bookmark link is now assigned the instant identify succeeds instead of
  via a follow-up redirect that some phone browsers could block.
- Removed an unnecessary "tap here to continue" step after entering your name/email on check-in —
  you now land straight on the check-in screen (with the bookmark note) in one step.
- A PAX known from a prior month who isn't yet signed up for the current month is now carried
  straight into a pre-filled sign-up instead of being told they can't be found.
- The check-in page's browser tab now shows your own name and the group's logo once you've
  identified, instead of a generic title/icon — helpful when it's saved to your phone's home
  screen alongside other apps.
- The "sign up for next month" nudge on check-in now only appears in the few days before next
  month starts, instead of the whole month before.
- The signup confirmation email now leads with your personal, bookmarkable check-in link (your
  F3 name/email already built in, so it skips the sign-in form) as the main call to action,
  followed by an "update my registration" link and a de-emphasised Tracker-sheet link. Opening
  the registration link drops you straight onto your goals, pre-filled with your current details.
- New "Show month calendar" view on check-in: tap any day of the current month to set or fix its
  Hit / Miss / No-Check-in / Failed status, instead of only being able to edit today and
  yesterday. You can pre-mark a day you already know you'll miss (e.g. planned travel), or correct
  a past day that was recorded wrong. "Failed" can only be set on a day that's already over.
- Check-in is noticeably faster for a returning PAX: "Continue to Dashboard" now opens instantly
  instead of waiting on a fresh load, and the bookmarked check-in page itself opens quicker.
- Fixed "Continue to Dashboard" occasionally showing your dashboard as if today's (or a
  calendar-edited day's) check-in hadn't happened yet, right after you'd just submitted it.
- A Site Q's manual edit to the Bonus Tracker sheet is now picked up by the dashboard right away,
  instead of only after the next webapp-driven bonus write or a short caching delay.

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
