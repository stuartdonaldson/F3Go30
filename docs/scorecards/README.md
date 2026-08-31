# Go30 Scorecards — competitive display options

UI mockups for presenting individual and team competition in the Go30 web app, as an alternative
to the tracker spreadsheet's `HIM Score` and `Team Score` sheets.

Open `index.html` in a browser (works from `file://` — no build, no server). Each option is a
standalone page; every page carries a switcher so the five can be flipped through side by side.

| File | Option | Compares |
|------|--------|----------|
| `index.html` | Overview + recommendation | — |
| `option-a-him-ladder.html` | HIM Ladder | Every PAX against every PAX |
| `option-b-team-race.html` | Team Race | Team against team, normalized by roster size |
| `option-c-awards-wall.html` | Awards Wall | Named honours on eight individual and three team axes |
| `option-d-consistency-grid.html` | Consistency Grid | Every PAX × every day, grouped by team |
| `option-e-my-standing.html` | Where I Stand | One PAX against his neighbours, his team, and the AO |

All five render the same fabricated July 2026 month (36 PAX, 6 teams) from `assets/mock-data.js`,
so differences on screen are differences of layout, not of data. The F3 handles are invented; no
real PAX data is in this folder.

---

## What the sheets do today, and what the app can do instead

`HIM Score` is a `QUERY` over the Tracker sorted by total Score descending. `Team Score` is a
nested `QUERY` that groups by team, averages Score/Raw Score/each bonus type, and sorts by average
Score. Both are static tables of numbers, evaluated only when someone opens the spreadsheet.

The app already holds strictly more than those two sheets show, per PAX, on the client:

| Field | Source |
|-------|--------|
| `name`, `team`, `score`, `rawScore`, `scorePct` | `buildDashboardPaxRow_`, `script/dashboardWebapp.js` |
| `dayValues` (1 / 0 / −1 / blank per day) | same — the whole month, per PAX, not just a total |
| `streak`, `maxStreak30` | same, windowed across the month boundary via PaxCache |
| `bonusByType` + `bonusByTypeSeries` (per day) | same |
| every team's grouped roster and average | `groupByTeam_`, same file |

The dashboard payload carries this for the **whole roster**, not just the viewer — `paxBoard` is
already every PAX grouped by team. **No option in this folder needs a new server field or a new
sheet read.** The one thing not in today's payload is the *prior* month's total (used here for
"vs June" and Most Improved); PaxCache already holds the history window that would produce it.

---

## Trade-offs

| | Motivational mechanic | Main risk | Build cost |
|---|---|---|---|
| **A · HIM Ladder** | Rank + a named man one place above you | Publicly ranks the bottom third every day | Medium — new screen |
| **B · Team Race** | Shared goal; you are not letting your six down | Team averages penalise mid-month FNG recruitment | Medium — new screen + line chart |
| **C · Awards Wall** | Many ways to win; rewards Qing/EHing, not just score | A small AO lets the same men sweep every category | Medium — award rules need agreeing |
| **D · Consistency Grid** | "Don't break the chain", visible AO-wide | Most exposing of the five; reads as shaming if Miss and no-show look alike | Low — it is the existing day data, re-laid-out |
| **E · Where I Stand** | Nearest rivals + the smallest action that moves you | Little team competition on its own | Lowest — a card on the existing dashboard |

**Recommendation: E + B.** E gives every man a reason to open the app whether he is first or last
and is a card on the dashboard rather than a new screen; B gives the AO something to argue about
and is the honest successor to `Team Score`. Add C once a full month of data exists to award from
— its rules (what counts, how ties break, whether an award can be held two months running) are a
Site Q decision, not a code decision. A and D are the highest-risk on morale: A ranks everyone
publicly, D shows everyone's gaps. Both are worth having, but scoped — A cut to "top 10, then you
and your two neighbours", D shown one team at a time.

---

## Open questions for Site Q

1. **Is public bottom-of-list ranking acceptable?** Decides whether A ships whole, cut down, or not
   at all.
2. **Normalize teams by average or by percentage of possible points?** Average (used in B) is what
   `Team Score` does today and penalises a team that adds an FNG mid-month.
3. **Do awards reset monthly, and can a man hold one two months running?** Blocks C.
4. **Does a reported Miss (0) deserve visible credit over a no-show (−1)?** The scoring already
   makes that distinction; D is the option that makes it visible to everyone, which is either the
   point or the problem.

---

## Files

```
index.html                       gallery + recommendation
option-{a..e}-*.html             the five mockups; each ends with its own why/watch-out note
assets/tokens.css                Go30 surface/ink/status tokens copied from static-pages/src/index.html,
                                 plus the one addition: a validated 6-slot categorical team palette
assets/mock-data.js              the single shared July 2026 roster used by all five
assets/viz.js                    shared chart primitives — donut, multi-series line chart with
                                 crosshair, legend, table view, option switcher
```

Conventions the mockups hold to, so they can be lifted into the app as-is: colours come from the
app's own CSS custom properties (light and dark both render correctly); the team palette passes
colourblind-separation and contrast checks on the Go30 card surface in both modes; every team mark
carries a visible text label rather than relying on colour alone; every chart has a hover tooltip
and a "Show the numbers" table behind it.
