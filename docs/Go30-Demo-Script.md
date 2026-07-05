# Go30 Demo Script

**Purpose:** Walk a viewer through signup, daily check-in, dashboard, and bonus points in Go30 —
F3's monthly small-consistent-changes habit system. Written for a how-to video voiceover and as a
Google Doc handout with mobile screenshots.

**Demo PAX used throughout:** `NoSadClown`, team **Crucible**, signed up on SIT with:

| | |
|---|---|
| **WHO** | An available, attentive and engaged partner |
| **WHAT** | No porn, alcohol or sobriety violations. Meditate 10 minutes daily. |
| **HOW** | Morning meditation; daily check-in with my Go30 team, and with my partner. |

**Screenshots:** captured live against the SIT web app with Playwright
(`tests/playwright/demo-screenshots.spec.js`, run via `npm run demo:screenshots`) at a 390×844
mobile viewport. Files live in `docs/references/demo-screenshots/`. Insert the numbered PNG at
each screen when pasting this into a Google Doc or building video slides — these are real captures
of the current app, not mockups, so they'll go stale if the UI changes; re-run the script before
reusing this doc for a new recording.

---

## Framing (say before the walkthrough)

> "Go30 isn't a fitness challenge in the usual sense — it's a 30-day system for becoming a
> different kind of man, one small daily rep at a time. Small and consistent beats big and
> sporadic, every time. You don't do it alone — you commit alongside 3 to 5 fellow HIMs who hold
> you to the standard, call out the misses, and celebrate the wins. That's the 2nd F, Fellowship,
> doing its job."

Keep this framing in mind through the whole demo: Go30 is a **WHO / WHAT / HOW** system —
identity, specific daily outcome, and the process that makes it happen — reported daily in the
Go30 tracker, with real consequences (a missed report becomes a **−1** after a 24-hour grace
period) and real community (a PAX board everyone can see).

---

## Screen 1 — Signup: "Accelerate Your Life"

**Screenshot:** `01-signup-intro.png`

**Script:**

> "This is where a PAX joins Go30. It's a quick form — F3 name, email, and their commitment for
> the month. Tap 'How it Works' first and it lays out the whole system."

**Screenshot:** `02-signup-how-it-works.png`

> "The three layers of change — Identity (Who), Processes (How), Outcomes (What) — and the daily
> mission: choose a small specific challenge, record your score in the Go30 sheet as a 1 or 0, and
> beat the 10:00 AM deadline or take a −1. It also reminds you: you can go it alone, but you won't
> go as far — work this with 3 to 5 fellow HIMs."

---

## Screen 2 — Signup: WHO / WHAT / HOW

**Screenshot:** `03-signup-who-what-how.png`

**Script:**

> "After entering their name and email, the PAX picks a team — AO-based, goal-based, or other.
> NoSadClown here is on Crucible. Then three questions in their own words:
> 'WHO do you ultimately want to become?'
> 'WHAT is your Go30 Challenge?'
> 'HOW are you going to be successful this month?'
> That's the whole framework. No jargon, no long form — just three honest sentences."

**Screenshot:** `05-signup-done.png`

> "Submit, and you're committed. A confirmation email is on its way, and there's a link straight
> to the tracker."

---

## Screen 3 — Daily Check-In

**Screenshot:** `06-checkin.png`

**Script:**

> "Every day, the PAX opens the check-in link, enters their F3 name and email — it remembers them
> after the first time — and sees their WHO, WHAT, and HOW right there as a reminder before
> tapping one of three buttons: 'I Hit it!', 'Missed it', or 'No Check-in.' If yesterday is still
> blank, that shows up too, so a PAX doesn't lose a day just because they checked in late."

> "The first time you identify yourself, the app swaps you onto your own personal link and
> nudges you to bookmark it or add it to your Home Screen — so next time you skip typing your
> name entirely. On some phones the swap can't happen automatically, so you'll see a 'Tap here
> to continue' link instead — one tap gets you to the same personal, bookmarkable link."

---

## Screen 4 — Dashboard

**Screenshot:** `08-dashboard.png`

**Script:**

> "After checking in, the PAX lands on their dashboard. Month progress as a ring — green for done,
> gold for missed, red for absent, that's the −1. Current streak and best 30-day streak next to
> it, plus total score with a breakdown of bonus points earned this month. Below that, a 7-day
> rolling average to see the trend, not just today. Then 'My Team' — everyone on Crucible at a
> glance, right alongside real teammates like Little John, Pogo, and Güéŕó. It's not hidden in a
> spreadsheet only the Site Q can see — the whole squad's progress is visible to the whole squad."

---

## Screen 5 — Bonus Points

**Screenshot:** `09-bonus-list.png`

**Script:**

> "Go30 also has a Bonus Points feature that pulls in the other Fs — Fellowship and Faith, not
> just the daily fitness rep. A PAX can log EHing an FNG, a Fellowship moment, taking a Q, or an
> Inspire moment right from their phone."

**Screenshot:** `10-bonus-add-form.png`

> "EHing FNG, Q Point, and Inspire need a link to Slack as evidence before they count — same rule
> the tracker sheet has always enforced, just easier to submit. EHing an FNG carries the most
> weight: it's worth 5x, because bringing a new guy into F3 is one of the biggest acts of
> leadership there is."

**Screenshot:** `11-bonus-added.png`

> "Save it, and it shows up right in your list, marked Counted once the evidence link is there."

---

## Closing

**Script:**

> "That's the full loop: sign up with a WHO, a WHAT, and a HOW; check in every day — I Hit it or
> Missed it; watch your streak and score build on the dashboard; and log the bonus moments that
> make F3 more than a workout — EHing a new guy, fellowship, taking a Q, inspiring someone else.
> Small and consistent, tracked honestly, done alongside other HIMs who won't let you quit. That's
> Go30."

---

## Notes for recording

- All screenshots are real captures from the SIT web app (`testDeploymentId` in
  `local.settings.json`), taken by `tests/playwright/demo-screenshots.spec.js`. Re-run with
  `npm run demo:screenshots` any time the UI changes — the spec is idempotent for signup and
  check-in (it looks up NoSadClown/nosadclown@example.com and re-fills existing data), but each run
  adds one more Bonus Points entry since there's no per-row bonus dedupe.
- NoSadClown's SIT signup and PaxDB rows are intentionally left in place (per team decision) so
  the demo can be re-run or re-recorded without re-signing-up. This is SIT, which already carries
  other test/smoke rows (Splinter, Splatter, etc.) — one more test PAX is harmless.
- The dashboard's ring legend (Done / Missed / Absent) and the −1 "Absent" penalty are the real
  accountability mechanism — don't soften this to a generic "streak app" framing; the deadline and
  the −1 are part of why Go30 works.
- There is no PAX-facing "coach's note" or team-leader view inside the check-in/dashboard/bonus
  web apps — Site Q tools (creating trackers, seeing all PAX, nag emails) live in the spreadsheet
  and admin tooling, not in the PAX-facing screens shown here. Keep the demo scoped to what a PAX
  actually sees.
- Bonus point values (EHing FNG ×5, Fellowship ×1, Q Point ×1, Inspire ×1, link-required rules)
  are defined in `script/BonusTypes.js`'s `BONUS_TYPE_DEFS_` (the single source of truth;
  `bonusWebapp.js`'s `BONUS_TYPE_RULES_` is derived from it) — confirm current values before
  recording in case they've changed.
