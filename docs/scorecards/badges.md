# Go30 Badges & Titles — catalogue for review

**Status:** ideation. Nothing here is agreed, scheduled, or built. Criteria are written to be
testable so they can be argued with precisely; icons and names are placeholders pending Site Q.

Companion to `docs/scorecards/README.md` (the five competitive-display mockups). That doc asks
*how do we display competition*; this one asks *what exactly is being awarded, and on what clock*.

---

## 1. Three classes, three clocks

The system splits three ways. The split is not cosmetic — each class has a different lifetime,
a different storage cost, and a different motivational job.

| Class | Clock | Holders | Persisted state | Job |
|-------|-------|---------|-----------------|-----|
| **R · Rolling** | trailing 28 days | anyone who qualifies | **none** — pure function of the window | "He is doing this now" |
| **P · Permanent** | never expires | anyone who ever qualified | career record | "This happened" |
| **T · Title** | monthly | exactly one | holder record | "One man holds it, and it is contested" |

**Why titles stay monthly and badges roll.** Go30 *is* a monthly program — the tracker, the
teams and the celebration all turn over together, so the competition should turn over with them.
But personal identity does not reset because a calendar page turned, and the 1st of the month is
the program's worst attrition moment. Rolling badges carry momentum across the boundary; monthly
titles keep the contest tied to the month's cohort.

**Why 28 and not 30.** 28 days is exactly four Sun–Sat periods, so the window always holds
exactly four of each weekday and exactly four weekly bonus periods. A "most fellowship in the
window" comparison can never be distorted by a window that happened to catch five Saturdays.
`MAX_STREAK_WINDOW_DAYS_` is 30 and lacks this property — see §6 Q4.

---

## 2. Notation used in the criteria

| Symbol | Meaning |
|--------|---------|
| `W` | the trailing 28 days of day data ending at the **context date** (not real-today — see §6 Q5) |
| `1` / `0` / `−1` | Tracker day values: Hit / Miss / Failed to report |
| `run(1) ≥ n` | a run of `n` or more consecutive `1` values inside `W` |
| `counted(TYPE)` | complete Bonus Tracker entries of `TYPE` that survive the weekly cap (max 4 in `W`) |
| `activity(TYPE)` | **every** complete entry of `TYPE`, cap ignored (this is the uncapped count) |
| `scorePct` | score ÷ days since first active day — already computed, fair to mid-month joiners |

`counted` vs `activity` is the load-bearing distinction. **Badges use `counted`** ("3 of the last
4 weeks" is a clean, non-competitive threshold). **Titles use `activity`** (volume is what
separates a leader). Scoring arithmetic is untouched by both.

---

## 3. Class R — Rolling badges (28-day qualification)

Stateless. Recomputed every dashboard build from the PaxCache day window. Nothing to expire.

| Icon | Name | F3 flair alt | Criterion | Cost |
|------|------|--------------|-----------|------|
| 🔥 | **Unbroken I–IV** | The Chain | `run(1)` inside `W` ≥ **7 / 14 / 21 / 28** | T0 |
| 📋 | **Always Posted** | No Fartsack | zero `−1` among days in `W` that have data; requires ≥14 days of data | T0 |
| ✅ | **Clean Week** | — | at least one complete Sun–Sat period inside `W` with all 7 days = `1` | T0 |
| 📈 | **Steady** | — | ≥ 60% of days with data in `W` are `1` | T0 |
| 🔄 | **Kotter** | — | a run of ≥3 consecutive `−1` inside `W`, followed later by `run(1) ≥ 5` ending on the most recent day with data | T0 |
| 🤝 | **Second F** | — | `counted(Fellowship) ≥ 3` in `W` — three of the last four weeks | T1 |
| 💡 | **Third F** | — | `counted(Inspire) ≥ 3` in `W` | T1 |
| 📣 | **Took the Q** | Weinke | `counted(Q Point) ≥ 3` in `W` | T1 |
| 🎖 | **All Three F's** | — | Second F **and** Third F held simultaneously **and** `run(1) ≥ 7` (First F is the daily challenge itself) | T1 |

**Steady** exists deliberately as the accessible rung. A ladder whose lowest step is a 7-day
unbroken streak has nothing to offer the man who most needs a reason to keep opening the app.

**Hysteresis is required.** A man sitting on a threshold would otherwise earn and lose the same
badge on alternating days, and if earn notifications are wired he gets pinged daily. Rule:
**earn at `n`, lose at `n − 2`**, and once earned a badge holds a minimum of 7 days regardless.

**Decay is a feature.** "🤝 Second F expires Thursday unless you post another" is the strongest
notification payload in the system — a deadline attached to something he already owns. Loss
aversion does more work here than achievement does. See `F3Go30-kgzo.3/.4`.

---

## 4. Class P — Permanent badges (career)

Never expire. You do not un-bring an FNG. These want the per-PAX record that `F3Go30-uz9e`
(PaxProfile) is migrating toward; until then they need a cross-month aggregate.

| Icon | Name | F3 flair alt | Criterion | Cost |
|------|------|--------------|-----------|------|
| 🎣 | **The Hook I–III** | Fisher of Men | lifetime `activity(EHing FNG)` ≥ **1 / 3 / 5** | T2 |
| 🗓 | **Finisher I–IV** | — | completed **1 / 3 / 6 / 12** Go30 months (present in the tracker with ≥50% of days reported) | T2 |
| 🏆 | **Past HIM** | — | held HIM of the Month in any closed month | T3 |
| 🏅 | **Retired Title Holder** | — | final holder of any retired title, stamped with the month (see §5) | T3 |
| ⚓ | **Day One** | — | present in this AO's first Go30 month | T2 |

`EHing FNG` is the one bonus type with no weekly cap and a 5× multiplier — the score already
rewards it fully, so The Hook is recognition rather than compensation.

---

## 5. Class T — Titles (monthly, one holder)

Exactly one holder, contested continuously through the month, **defender's advantage** on ties
(a challenger must strictly exceed; otherwise two men on the same streak swap the crown daily on
sort order). The steal is the moment, not the holding — fire it once through `F3Go30-koqf`'s
report-once machinery.

### Core — always active, never rotate

| Icon | Title | Metric |
|------|-------|--------|
| 🏆 | **HIM of the Month** | highest `scorePct` |
| 🔥 | **Chain Boss** | highest max streak in the month |
| 🎣 | **EH Champion** | highest `activity(EHing FNG)` |

### Rotating pool — Site Q activates two per month

| Icon | Title | Metric |
|------|-------|--------|
| ☕ | **Coffeeteria King** | highest `activity(Fellowship)` |
| 📣 | **Q Machine** | highest `activity(Q Point)` |
| 💡 | **Inspiration** | highest `activity(Inspire)` |
| 📊 | **Most Improved** | largest Δ `scorePct` vs prior month |
| 🤫 | **Quiet Consistency** | best `scorePct` among PAX never in the month's top 5 |
| 🌑 | **Gloom Grinder** | seasonal (Dec–Feb only): highest `scorePct` |

### Team titles

| Icon | Title | Metric |
|------|-------|--------|
| 🥇 | **Team Cup** | highest average `scorePct` |
| 📋 | **Full Muster** | highest % of days reported |
| 🚀 | **Climbing Fastest** | largest Δ average `scorePct` vs prior month |

Render the team's held title on **every member's tile**. That converts individual behaviour into
a team good, which fits Go30's accountability model far better than an individual ladder does.

### Rotation and retirement rules

1. **3 core + 2 rotating** active in any month. Site Q picks the two.
2. A rotating title runs **1–3 months**, then retires.
3. **Retired ≠ deleted.** The final holder keeps it permanently, stamped with the month
   ("Coffeeteria King — July 2026"), as a Class P badge. Nothing is lost, which is exactly what
   makes retiring a title safe to do.
4. **No man holds more than two titles at once.** A third passes to the runner-up. This is the
   answer to the small-AO sweep problem (`README.md` open question 3) — with 20–30 PAX the same
   three men will otherwise take everything.
5. Rotation is a **Site Q lever, not a code change** — the active set should be config, not a
   deploy.

---

## 6. Build cost tiers

| Tier | What it needs | Unlocks |
|------|---------------|---------|
| **T0** | nothing — client-side, from today's `paxBoard` payload | every day-based rolling badge |
| **T1** | `activityByType` (uncapped counts) — a ~10-line sibling to `computeBonusPillsAsOf_` in `script/BonusTypes.js`, **plus** a cross-month bonus read (see below) | all bonus badges and volume titles |
| **T2** | prior-month / career rollup | Most Improved, Finisher, The Hook, Day One |
| **T3** | persisted holder record + report-once column (ADR-017 pattern) | defender's advantage, steal moments, Past HIM |

**T0 is genuinely free.** `PAX_HISTORY_WINDOW_DAYS_ = 400` (`script/PaxCache.js:662`) already
stores a dense, month-boundary-agnostic, namespace-scoped day string per PAX — and its own header
calls it "a growth surface for later migration slices." Every streak, Clean Week, Steady, Always
Posted and Kotter badge is a slice of a string already in memory.

**T1's real cost is not the counter.** Day outcomes are cached; **bonus entries are not** — they
live in the per-month Bonus Tracker sheet. On the 3rd, a 28-day window needs 25 days of the
*prior* month's bonus data. Three options:

- Truncate the window at month start — cheap, but reintroduces exactly the month-boundary cliff
  this whole design exists to remove. **Do not.**
- Read the prior month's Bonus Tracker once per build and cache it — one extra sheet open,
  warm-cacheable. Reasonable interim.
- Add a bonus sibling to PaxCache — which is essentially `F3Go30-uz9e.5` already ("widen
  PaxProfile cache with a score sibling"). Same shape, same rationale. **Correct home.**

---

## 7. Proposed rollout — two per month

Sequenced so each month ships only what the prior month's plumbing already paid for. The order
is a real dependency chain, not a preference.

| Month | Ships | Requires | Why here |
|-------|-------|----------|----------|
| **1** | 🔥 Unbroken, 📋 Always Posted | T0 | Launch on the two most legible ideas, zero server change |
| **2** | ✅ Clean Week, 📈 Steady, 🏆 HIM of the Month *(title)* | T0 | Adds the accessible rung and the first contest |
| **3** | 🔄 Kotter, 🔥 Chain Boss *(title)* | T0 + T3 | First persisted holder; proves defender's advantage |
| **4** | 🤝 Second F, ☕ Coffeeteria King *(title)* | T1 | First bonus-driven pair; pays the cross-month bonus read |
| **5** | 💡 Third F, 📣 Took the Q, 🎖 All Three F's | T1 | Completes the three-F triad in one release — it only lands as a set |
| **6** | 🎣 The Hook, 🗓 Finisher; **first title retirement** | T2 | Career tier opens; rotation cycle proves out |

Two per month is a deliberate ceiling. Each badge needs an explanation moment, and a badge
everyone already has is not a badge.

---

## 8. Open questions for Site Q

1. **Is "Always Posted" / No Fartsack too pointed?** It is the funniest name in the list and the
   one most likely to read as a dig at the men it excludes.
2. **Streak insurance** — one forgiven miss per 28 days? Kind, but it dilutes "unbroken." If
   adopted, it must be a *display variant* and never touch `computeStreak_`; streak is
   display-only today and score does not depend on it, so the blast radius is zero.
3. **Can a man hold the same title two months running?** Rule 4 caps concurrent holds but says
   nothing about repeats.
4. **28 vs 30.** Adopting 28 introduces a second window constant beside the existing
   `MAX_STREAK_WINDOW_DAYS_ = 30`. Accept the wart with a comment, or move both to 28?
5. **Context-date anchoring.** The window must resolve off `resolveContextDate_`, or the date-nav
   arrows and `setContextDate` testing break — badges would render for today while the board
   shows the viewed day. Do badges scrub with the date arrows (needs a per-day series, like
   `bonusByTypeSeries`) or render for today only?
6. **Never award a "worst."** Confirming the standing constraint: the `0` vs `−1` distinction is
   meaningful and must never be publicly ranked. That is the failure mode that turns the tracker
   into a shaming device.
