# Requirements: Web-Based HC Signup Form (`cmd=signup`)

> Status: **Mockup approved — moving toward backend implementation.**
> A clickable mockup (`docs/references/F3 Go30 signup design.zip`) was reviewed against this
> document and matches it. This is not yet an accepted capability; it does not belong in
> `docs/CONTEXT.md` until built and accepted.
> Scope of this document: enough domain + UX detail to drive backend implementation in this repo.
> It does not yet pin the exact `doPost` JSON contract — see §Open Questions.

---

## 1. Background

F3Go30 currently collects Hard Commit (HC) signups via a linked Google Form, which writes to
the **Responses** sheet on whichever month's tracker it is bound to (see
`docs/sheet-reference.md` §Responses, `docs/CONTEXT.md` UC-2). A PAX who wants to edit a prior
submission must use the Google Forms "edit response" link, and there is no F3Go30 affordance for
choosing *which* month's tracker a submission targets.

This feature adds a web-based signup path: hitting the deployed web app with `?cmd=signup`
returns an HTML page that lets a PAX identify themselves, see (and edit) their existing signup if
they already have one, and choose which month's tracker to save into. **This is intended to
become the primary, advertised signup entry point, replacing the Google Form** — see §8
Migration: Retiring the Google Form for what that means for existing monthly-creation code.

A GAS web app dispatcher already exists per **ADR-009** (`/adr/009-web-app-dispatcher-instead-of-clasp-run.md`)
for a *different* purpose (authenticated dev/test RPC). This feature is a **separate, anonymous,
PAX-facing** entry point on the same `doGet`/`doPost` handlers in `script/WebApp.js` — it must not
reuse ADR-009's secret-validation path.

---

## 2. Actors

| Actor | Role |
|-------|------|
| PAX | Anonymous web visitor identifying by F3 Name + Email |
| Site Q | Not directly involved in this flow; benefits from reduced manual edit requests |

---

## 3. Deployment Target

The web app is deployed against the **Template** script project (`templateScriptId` in
`local.settings.json`) — the same project used today for `TEST_APP`/`clasp deploy
--deploymentId`. This keeps one stable `/exec` URL forever; the handler resolves "current month"
and "next month" tracker spreadsheets dynamically at request time (see §6.3) rather than being
redeployed monthly the way the HC Google Form is.

---

## 4. Entry Point

```
GET  https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec?cmd=signup
```

Returns an HTML page (GAS `HtmlService`) implementing the full multi-step flow client-side.
Step transitions happen in JavaScript (no full page reloads) until the final save, which is a
`doPost` call.

**Technical constraint:** GAS `HtmlService` serves static files with no build step. The mockup
must be plain HTML + CSS + vanilla JS (or a single-file framework loaded from a CDN `<script>`
tag) — no bundler, no npm install step, nothing that assumes a Node toolchain at serve time.

---

## 5. Flow

### Step 1 — Intro

Static welcome screen. Content:
- Go30 branding (see §7 Visual Style)
- One-paragraph explanation: "Sign up or update your Go30 Hard Commit"
- Single **Get Started** button → advances to Step 2

### Step 2 — Identify

Two fields, both required:
- **F3 Name** (text)
- **Email** (email, validated client-side)

Single **Continue** button. On submit, calls the backend to look up a match (see §6.1) and
advances to Step 3 with either the loaded data or a blank form.

No error message should distinguish "name found, email didn't match" from "no record at all" —
see §6.1, this is a deliberate anti-enumeration measure. Show a neutral "Welcome! Let's get your
info" for both the blank and loaded cases (loaded case additionally shows "We found your previous
signup — review and update below").

### Step 3 — Signup Info

Form fields, sourced from the Responses sheet field set (`RESPONSE_COLUMN_MAP` in
`script/response_utils.js`) — **F3 Name and Email are carried over from Step 2, read-only on this
step** (changing identity fields belongs in a separate edit, not this flow):

| Field | Type | Source key | Notes |
|-------|------|-----------|-------|
| F3 Name | text, read-only | `F3_NAME` | from Step 2 |
| Email | email, read-only | `EMAIL` | from Step 2 |
| Team type | radio: **AO-based** / **Goal-based** / **Other** | `TEAM_TYPE` | three-way choice — see below |
| Team (AO-based) | select, from AO list | `TEAM` | shown only when Team type = AO-based |
| Team (Goal-based) | select, from goal list | `TEAM` | shown only when Team type = Goal-based |
| Team (Other) | free-text | `OTHER_TEAM` | shown only when Team type = Other — PAX types whatever they want |
| WHO do you ultimately want to become? | textarea | `WHO` | |
| WHAT is your Go30 Challenge? | textarea | `WHAT` | |
| HOW are you going to be successful this month? | textarea | `HOW` | |
| Cell Phone Number | tel | `PHONE` | |
| Nag email opt-in | checkbox | `NAG_EMAIL` | reminder-email consent, per UC-6 |

**Team type behavior:** selecting a Team type swaps which one of the three Team inputs above is
shown — they are mutually exclusive views of the same underlying choice, not three separate
fields to fill in. Whichever one is visible holds the value that ultimately gets saved into the
`TEAM` (AO-based/Goal-based) or `OTHER_TEAM` (Other) response column, matching the existing
`TEAM`/`OTHER_TEAM` promotion logic in `script/addResponseOnSubmit.js` (`Phase 3 — Resolve Team`).

If Step 2 found a match, every field above is pre-filled from the matched Responses row and is
editable — see §6.4 for how Team type/Team are re-derived on load. If no match, all fields start
blank with Team type defaulting to unselected (no Team input shown until a type is chosen).

**Out of scope for this form:** `PARTICIPATION` ("Are you currently participating in Go30?") —
that field exists to drive the Google Form's "reuse last month's goals" branch
(`signupReuse.js`), which this flow replaces functionally (identify-then-edit achieves the same
goal more directly). Do not surface it as a question.

### Step 4 — Choose Target Month & Save

Before showing this step, the backend has already resolved which tracker months are available to
save into (§6.3):

- **Current month** — always available (it's the tracker context the signup is happening in)
- **Next month** — only shown if next month's tracker already exists

Render as a single choice (radio buttons or two buttons), each labeled with the actual month name
and year — reuse the `"Month YYYY"` format already produced by `formatRegistrationMonth_()` in
`script/addResponseOnSubmit.js` (e.g. "June 2026"), not generic words like "current"/"next":

```
○ Save for June 2026
○ Save for July 2026   (only rendered if next month's tracker exists)
```

A single **Save Signup** button submits and advances to Step 5.

### Step 5 — Confirmation & Feedback

Two stacked cards:

**Confirmation card** (always shown): a success checkmark, "You're committed!", the saved month
name, a note that a confirmation email is on its way (mirrors the existing registration
confirmation email content in `signupReuse.js` `sendRegistrationConfirmationEmail_`), a link back
to that month's tracker, and a **Start over** button that resets to Step 1.

**Feedback card** (always shown alongside confirmation, not gated behind it): optional, takes
~10 seconds.
- A 1–5 star rating: "How is Go30 working for you?"
- An optional free-text textarea: "Is there anything we can improve?"
- A **Send Feedback** button. On submit, the card collapses to a "Thanks for the feedback!"
  acknowledgment.
- Skipping feedback entirely (never clicking Send) is a valid end state — do not block or nag.

See §11 Resolved Decisions for where feedback gets stored server-side.

---

## 6. Business Rules

### 6.1 Matching rule (security-relevant)

Match requires **F3 Name AND Email to both match** an existing Responses row, case-insensitive.
This is a deliberate access-control check, not just dedup convenience: F3 Name is publicly visible
on the Tracker/leaderboard sheets, but Email is not displayed anywhere a PAX could see another
participant's address. Requiring both prevents someone who only knows a public F3 Name from
viewing or editing that person's private signup data (phone number, goals, etc).

- F3 Name matches but Email doesn't (or vice versa) → **treat as no match**, render the blank-form
  state. Do not reveal that the name exists.
- This intentionally differs from the Tracker's own dedup key, which is F3 Name only (ADR-008) —
  that's an internal anti-duplicate-row rule with different stakes than this PAX-facing lookup.

### 6.2 Save behavior — new vs. edit

- If Step 2 produced a match **and** the PAX chooses to save for the **same month** the match was
  found in: update that Responses row in place (no duplicate).
- If the PAX saves for a **different month** than where the match was found (e.g. matched in
  June's tracker, saving for July): write a new row into July's Responses sheet — semantically
  this is the same "carry goals forward" operation `signupReuse.js`
  (`maybeReuseLastMonthsGoals_`) already performs, just initiated by the PAX directly instead of
  via the Google Form's reuse checkbox.
- If no match was found: always a new row, in whichever month's Responses sheet was chosen.
- Whatever path is taken, the chosen target tracker's **Tracker** sheet must end up with a row for
  that F3 Name too (mirroring `handleFormSubmit_` in `script/addResponseOnSubmit.js`) — saving via
  this form must produce the same downstream state as a Google Form submission would.

### 6.3 Resolving "current month" and "next month" tracker

Because the web app is deployed on the Template (§3), it has no single fixed "current tracker."
At request time, resolve both targets from the Template's **Links** sheet (the append-only record
populated by every tracker creation — see `docs/CONTEXT.md` Core Capabilities, and
`CreateNewTracker.js`'s links-append logic):

- **Current month** = the Links row whose start date is the most recent one not in the future.
- **Next month** = a Links row whose start date is exactly one calendar month after the current
  month's start date, if one exists (it will, between the 20th auto-generate run and end of
  month — see UC-4). If absent, only "current month" is offered in Step 4.

This logic does not need to be implemented for the mockup — the mockup should accept these two
month names (and their save-target identifiers) as mock/stubbed data, so it can be wired to the
real Links-sheet lookup later without changing the UI.

### 6.4 Team type/Team reclassification on load

Historical Responses rows store `TEAM` (and sometimes `OTHER_TEAM`) as plain strings — Team
type/team-list membership can drift between months (an AO closes, a goal-based team's name
changes, etc), so a loaded record's Team type is **not** trusted as-is. Whenever Step 3 is
pre-filled from a matched record (current-month match, or a cross-month carry-forward per §6.2),
reclassify the stored team value against the *current* AO list and goal list, in this order:

1. If the stored team value matches an entry in the current **AO list** → set Team type =
   AO-based, and select that AO in the Team (AO-based) dropdown.
2. Else if it matches an entry in the current **goal list** → set Team type = Goal-based, and
   select that goal in the Team (Goal-based) dropdown.
3. Else → set Team type = Other, and put the stored value verbatim into the Team (Other) free-text
   field — this also covers values that were already stored via the Other path.

This reclassification only affects which radio is pre-selected and which dropdown/text field is
populated; it never blocks loading or silently drops data — step 3 above is the catch-all that
guarantees the original value is always preserved somewhere in the form.

The mockup implements this matching as a small pure function taking `(storedTeamValue, aoList,
goalList)` and returning `{ teamType, teamValue }` (see `classifyTeam()` in the delivered mockup,
§10). For backend implementation, `aoList` and `goalList` are read live from the **`ListDB`**
sheet in the Template spreadsheet: column **`AO Teams`** and column **`Goal Team`** (singular —
confirmed against the live spreadsheet, not the stale local xlsx copy). As of this writing `ListDB`
has 38 AO entries (including a few non-AO sentinel values like `"Goal Based*"` and `"SOLO (no
team)"` — read the column literally, do not filter or interpret these) and 5 Goal Team entries.

---

## 7. Visual Style

No existing web UI to match (Apps Script editor and Sheets are the only current surfaces), but
reuse the palette already established in F3Go30's HTML email templates
(`script/OnboardingEmailTemplate.html`, `ReminderEmailTemplate.html`,
`ResponseSettingsEmailTemplate.html`, `SignupReuseEmailTemplate.html`) so the signup form feels
visually consistent with the emails a PAX already receives:

| Use | Color |
|-----|-------|
| Header background | `#2f5d50` (deep green) |
| Header/body text on dark | `#f8f4ea` (cream) |
| Page/card background | `#f4f1ea` (light cream) |
| Card surface | `#fffdf8` |
| Card border | `#d8cfbf` (tan) |
| Link/action accent | `#0b5c86` (blue) |
| Callout/highlight border | `#b8860b` (gold) |
| Body font | Arial, sans-serif |

Must be mobile-friendly — PAX will most often open this from a phone via a text or Slack link.

---

## 8. Migration: Retiring the Google Form

The webapp becomes the **primary, advertised** signup entry point. The Google Form is **kept
dormant as a fallback**, not deleted or actively removed:

- `CreateNewTracker.js`'s `copyAndInit_` and `autoGenerateNextMonthTracker_` continue creating,
  renaming, and linking a bound HC Form each month exactly as today — no code changes to that
  form-management logic. It simply stops being the thing PAX are pointed at.
- The `Signup HC Form` Config row keeps being written every month (still useful as an admin
  fallback / escape hatch if the webapp has an outage).
- What changes is **what PAX-facing links point to**: `onOpen.js`'s `openNextMonthSignup()` (Help
  sheet "Next Month HC Signup" link), the registration confirmation email's links
  (`signupReuse.js` `sendRegistrationConfirmationEmail_`), and the monthly Site-Q
  notification/Slack-message links (`CreateNewTracker.js`) should be updated to point at the
  webapp's `?cmd=signup` URL instead of the Form URL.
- `handleFormSubmit_` (the `onFormSubmit` trigger in `script/addResponseOnSubmit.js`) is left
  fully intact — if a PAX or Site Q falls back to the dormant Form, it must still work exactly as
  it does today. The webapp's `doPost` save path is **new, parallel write logic**, not a
  replacement of the trigger handler.
- ADR-004 (experimental form generation deferred) is unaffected — the Form still needs its
  existing manual per-region bootstrap; this migration doesn't touch that.

### Why this matters for implementation

Because both paths remain live and both write to the same Responses/Tracker sheets, the webapp's
save logic and `handleFormSubmit_` need to agree on net effect (same dedup-by-F3-Name rule per
ADR-008, same Tracker-row-creation mechanics) even though they are **independent
implementations** — the webapp does not call into `onFormSubmitLocked_` or its helpers, since its
input does not come from a Google Form submission event. The save handler must still produce the
same end state: the target month's Responses sheet updated/inserted, and a Tracker-sheet row
added for that F3 Name **only if one doesn't already exist** (same uniqueness check
`handleFormSubmit_` performs today).

---

## 9. Out of Scope

- The `PARTICIPATION` reuse-checkbox flow from the Google Form (superseded by the identify step,
  see §5 Step 3) — this only affects the Form path; the webapp never shows this question.
- Authentication beyond the F3-Name+Email match check — there is no login; this is the same trust
  model as the existing anonymous Google Form.
- ADR-009's secret-based dispatcher path — unrelated, must not be touched by this feature's
  routing.
- Actually deleting the Google Form or its monthly creation/renaming code — see §8, it stays as a
  dormant fallback.

---

## 10. Delivered Mockup

A clickable HTML/CSS/JS prototype was generated and reviewed
(`docs/references/F3 Go30 signup design.zip` — `Go30 Signup.dc.html` + `support.js`). It covers
Steps 1–5 from §5 using mock/stubbed data, including:
- A "found match" scenario (Step 2 → pre-filled Step 3) and a "no match" scenario (blank Step 3)
- Both "next month available" and "next month not yet available" variants of Step 4
- All three §6.4 reclassification branches (AO, Goal, Other) via `classifyTeam()`
- The Step 5 confirmation + feedback cards

This mockup is the approved basis for backend implementation. No real network calls exist in it —
the identify lookup and save are local JS functions returning canned data; the real `doPost`
payload shape (§12) needs to be slotted in without restructuring the UI.

---

## 11. Resolved Decisions

These were open questions during mockup design; all are now resolved and binding for backend
implementation.

- **AO list / goal list source**: read live from the **`ListDB`** sheet in the Template
  spreadsheet at request time — column `AO Teams` for the AO-based dropdown, column `Goal Team`
  for the Goal-based dropdown. No Form-choice reading, no new Config list. See §6.4.
- **Feedback storage** (§5 Step 5): stored in the **Responses sheet on the target month's
  tracker spreadsheet** (not a separate sheet, not the Template). Specifically:
  - The free-text comment ("Is there anything we can improve?") goes into the existing
    **`Constructive Comments`** column — present in the live Responses sheet today but currently
    unmapped in `RESPONSE_COLUMN_MAP` and unused by any handler.
  - The 1–5 star rating has no existing column — add a new **`Feedback Rating`** column to the
    Responses sheet header and to `RESPONSE_COLUMN_MAP` as an optional field (same pattern as
    `TEAM_TYPE`/`NAG_EMAIL` today).
  - Both are written to the same Responses row the signup save just wrote/updated — feedback is
    not a separate record, it's two more fields on that PAX's signup row for that month.
- **Save logic independence** (§8): the webapp's save handler is an **independent
  implementation**, not a call into `onFormSubmitLocked_` or its helpers — its input doesn't come
  from a Form-submission event so it can't reuse that code path directly. It must still produce
  the same net effect: the target month's Responses sheet updated/inserted, and a Tracker-sheet
  row added for that F3 Name **only if one doesn't already exist** — i.e. the same uniqueness
  check `handleFormSubmit_` performs today, applied independently.

## 12. Open Questions (blocking backend implementation)

- Exact `doPost` request/response JSON shape for `cmd=signup` (identify lookup) and the save
  action — still to be drafted alongside the first implementation increment.
- Whether saving for a future month before that month's tracker has its own Tracker-sheet row
  population logic needs any additional safeguard beyond mirroring `handleFormSubmit_`'s
  uniqueness check.
