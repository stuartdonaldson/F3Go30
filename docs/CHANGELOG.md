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

- **Fixed the check-in page occasionally disagreeing with itself** — the day calendar could show a
  check-in as still pending when the today/yesterday buttons (and the dashboard) already showed it
  done, if you'd paged the calendar to another month right before checking in. Separately, on a
  phone left open in the background for a while, checking in on a different device could get
  silently overwritten back to the phone's old answer the next time you opened the app — that's
  fixed too; the newest check-in now always wins, on every device.
- **Automatic reconnect after a "Couldn't reach the server" banner** — the app now quietly
  retries in the background and clears the banner itself once your connection is back, instead
  of needing a manual refresh. If it's not back after a couple of minutes, a "Reload page" button
  appears so you can force it yourself.
- **Signup now requires a team and your WHO/WHAT/HOW goals** before it lets you continue, with an
  inline explanation of why each one matters — and a new ℹ️ button next to Team type opens a quick
  explainer on AO-based vs. custom teams.
- **A reused Slack Link on a Bonus Tracker entry is now called out** — if you paste the same link
  into a second entry for the week, you'll see a plain-language notice (both at save time and in
  your bonus list) that it won't add extra points, instead of it silently not counting.
- **New menu — tap your name** in the app header for quick access to How It Works, FAQ, Log Bonus
  Points, and Send Feedback (a rating + note that goes straight to your Site Q, with your name and
  app version attached so they can track it down).
- **A "Sign up for next month?" popup** now appears once next month's tracker is ready if you
  haven't signed up for it yet — "Sign Up" drops you straight into the signup form, already filled
  in from this month's goals; "Remind me later" hides it until tomorrow.

---

## v2.5 — Pax-detail popup, announcement splash, dashboard accuracy (2026-08-11)

The 2.5 series rolls up everything landed since v2.4.0: a redesigned pax-detail popup (bonus
info, prev/next teammate nav), a Site-Q-pushable announcement splash, a simplified sign-up flow,
and a string of dashboard/streak accuracy fixes.

- **Pax-detail popup** — tap any PAX on the dashboard to see their details, goals, bonus info,
  and more. Prev/next arrows let you page through the rest of your team without closing the
  popup, and a persistent back button in the header takes you out of it from wherever you are.
- **Bonus points** — tap the Bonus tile or the Trophy icon in the upper right to edit or view
  your bonus points.
- Your Site Q can now push a short notice to everyone's check-in app ("HC moved to Saturday", a
  month-end reminder) — it shows once, auto-expires after a few days, and you can dismiss it or
  ask to be reminded again in 30 minutes.
- Signing up: the separate goal-based team dropdown is gone — pick "Other" and start typing your
  team name for the same suggestions as autocomplete, instead of a second dropdown to choose
  between.
- Fixed the dashboard's 7-day rolling-average line drifting upward with no new check-in
  activity — it no longer factors in days you haven't reported yet, so it now stops drawing at
  the last day you actually checked in instead of sliding a real day out of the window as an
  unfilled one slides in. Also brightened the line and gave near-zero bars a minimum height so a
  "Missed it" day doesn't collapse to invisible.
- Fixed pre-marking a future day wiping out your streak. Checking in ahead for a day two or more
  out made your streak read as 1 on every team tile (and shortened your 30-day best), even though
  the month grid still showed all your days correctly. Streak, 30-day best and the 7-day chart are
  now always calculated as of the day you're looking at — including when you use the date arrows
  to look back at an earlier month.
- Fixed the 7-day chart dropping days when you use the date arrows to look back at a full
  earlier month — it now always plots one point per day of the month you're viewing.
- Fixed a teammate's 7-day chart in their pax-detail popup showing only a handful of points early
  in the month — it now shows a real trailing window padded from the end of the prior month, same
  as your own chart already did.
- If you sign up near the end of a month for next month, then use your check-in link before this
  month is over, you're now asked whether you'd also like to join for the rest of this month —
  instead of being dropped straight into a sign-up form as if you'd never registered at all. (v2.4.9)
- Dark mode: check-in (both the app-hosted and static pages) now automatically matches your
  browser/OS light-or-dark preference, switching live if you flip your OS theme while the page
  is open.
- Fixed the Total Score tile showing a number that didn't match your hits/misses/bonus/fails —
  it could run ahead of "today" if you'd pre-marked a future day, and the Fail count in the
  breakdown was mislabeled "no check-in" instead of "fails". Scrubbing the date-nav arrows back
  to a prior day now shows your score as of that day, not always today's running total. (v2.4.1)
- Fixed "Continue to Dashboard" occasionally showing your dashboard without a Hit/Miss you'd just
  tapped on the check-in step — clicking right after a background refresh could race it and show
  a snapshot from just before your tap. On the plain-web-page check-in, a returning visit on your
  saved link now paints your check-in status instantly from your last visit (a small "Syncing…"
  indicator shows in the header while it double-checks with the server) instead of waiting on a
  network round trip before showing anything; if that saved link had gone stale or been revoked,
  it now correctly falls back to the sign-in form instead of continuing to show old data. (v2.4.2)
- Signing up and editing your goals now happen right on the check-in page instead of sending you
  off to a separate Google-hosted page and back. This matters most at the start of a month: if
  you open check-in before you've signed up for the new month, you now go straight to your goals
  with your name and previous answers already filled in, and land back on check-in when you're
  done — previously that bounced you out to another site (and, on a phone with the page saved to
  your home screen, out of the app entirely and into your browser). The old sign-up page still
  works for anyone using a link to it.
- An old bookmarked or saved check-in link (and the plain Go30 home link) now takes you straight
  to the new plain-web-page check-in instead of the old Google-hosted one, the same way sign-up
  links already did. The first time you land there from an old link, a banner reminds you the
  link has moved and to update your bookmark — dismiss it once and it won't show again. Getting
  there is one tap on a "has moved / Continue" button rather than an automatic jump — Google's
  hosting doesn't allow the jump to happen on its own, so the button is the real way there, not
  a fallback for a rare case.
- Check-in now tells you when it's out of date. If a newer version of the app has been released
  since your copy last loaded — which can go unnoticed for days once you've saved check-in to
  your home screen, because it doesn't reload itself — a banner offers you a "Reload" to pick it
  up (or "Not now", which stays quiet until the *next* release). The version at the bottom of the
  page now always shows the version you're actually running, and names the current one alongside
  it when yours is behind, so it's a reliable answer when someone asks what version you're on.
- Fixed the dashboard disagreeing with the spreadsheet after a check-in or a bonus entry. Two
  check-ins tapped in quick succession (say "today", then "yesterday" before the first finished)
  could leave the dashboard showing only one of them even though both were recorded correctly.
  Separately, adding or editing a bonus moved your bonus pills but left your Total Score at its
  pre-bonus value until something else refreshed it. Both now update as soon as the entry is
  saved, and the dashboard's numbers come from the spreadsheet's own recalculated values.
- Bonus entries that don't actually raise your score — because the weekly cap for that bonus type
  was already credited, or the entry is still missing a required link — now say so plainly, both
  in the bonus list and in the confirmation you see right after saving, instead of silently
  looking identical to a bonus that counted.
- Fixed a blank icon when adding Go30 to your iPhone's home screen (Android was unaffected);
  it now shows the Go30 logo like everywhere else.
- Fixed the dashboard and check-in getting stuck showing an old snapshot in a long-lived app
  session — most noticeable if you keep Go30 open on your home screen through the day: a bonus
  entry or check-in from earlier could go on showing stale counts even after returning to the
  app, since it only checked for fresh data right after opening, not on every visit. Reopening
  the app now always refreshes in the background, updating the screen in place once it lands.

---

## v2.4 — Faster check-in, published as a plain web page (2026-07-16)

The two headline efforts this cycle: making check-in feel instant for a returning PAX, and
publishing check-in as a plain web page instead of a Google-hosted one.

**Speed — returning-PAX check-in**
- Check-in is noticeably faster for a returning PAX: "Continue to Dashboard" now opens instantly
  instead of waiting on a fresh load, and the bookmarked check-in page itself opens quicker.
- Fixed "Continue to Dashboard" occasionally showing your dashboard as if today's (or a
  calendar-edited day's) check-in hadn't happened yet, right after you'd just submitted it.
- A Site Q's manual edit to the Bonus Tracker sheet is now picked up by the dashboard right away,
  instead of only after the next webapp-driven bonus write or a short caching delay.
- Fixed the bookmarked check-in link intermittently failing to appear after identify (a PAX could
  get stuck re-typing their name/email every visit, or land back on the sign-in form after
  reopening the app) — the bookmark link is now assigned the instant identify succeeds instead of
  via a follow-up redirect that some phone browsers could block.
- Removed an unnecessary "tap here to continue" step after entering your name/email on check-in —
  you now land straight on the check-in screen (with the bookmark note) in one step.
- Editing or adding a bonus entry now immediately reflects on the dashboard without a manual
  reload, on both front ends.

**New: check-in as a plain web page**
- Check-in is now also available as an ordinary web page (not just inside the Google-hosted app) —
  same look, same features, but it opens close to instantly since it isn't waiting on Google's
  page wrapper to boot first. Reached the same way, via your saved link or the sign-up
  confirmation email; the original app-hosted page still works unchanged.
- The check-in page's browser tab now shows your own name and the group's logo once you've
  identified, instead of a generic title/icon — helpful when it's saved to your phone's home
  screen alongside other apps.
- A saved check-in link now updates the address bar as soon as you identify, so refreshing or
  re-bookmarking the page keeps working immediately rather than only after a follow-up visit.
- Sign-up confirmation emails, reminder emails, and the home page's check-in link now all open the
  faster plain-web-page check-in surface, matching your bookmarked link — previously only the
  bookmarked link itself used it.

**Other check-in / sign-up improvements**
- The daily "missing check-in" reminder email now leads with the check-in web app — a PAX taps in
  their F3 name once, then bookmarks the page so it remembers them — and demotes the Tracker sheet
  to an "older sheet interface" fallback link, instead of leading with the Tracker sheet.
- A PAX known from a prior month who isn't yet signed up for the current month is now carried
  straight into a pre-filled sign-up instead of being told they can't be found.
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
- Renamed the "No-report" outcome to "Failed to report" everywhere it appears (check-in, sign-up,
  dashboard legend, FAQ), and fixed the check-in "Missed it" button and dashboard legend swatch to
  use a consistent color for that state.

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
