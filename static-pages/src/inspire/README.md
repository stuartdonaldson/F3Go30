# Inspire Playground

Design preview for the celebration / encouragement moments that fire when a PAX
checks in, hits a streak, completes Go30, or misses a day.

**This folder is a playground, not shipped code.** `tools/build-static-pages.js`
only bundles `index.html`, `how-it-works.html`, and `assets/` into `dist/` — it
does not walk `inspire/`. Open `inspire/index.html` directly in a browser.

## What it demonstrates
- **Daily check-in** — SVG progress ring fills +1, count-up number, emoji pop.
- **Streak tier** — flame grows/flickers per tier, streak count-up.
- **Halfway / Go30 / Bonus / New PB** — badge "stamp" reveal + confetti cannon.
- **Missed a day / streak broke** — a deliberately gentle "gloom" screen
  (sunrise gradient, F3 affirmation, one bounce-back CTA). No red, no shame.

## Design constraints (kept intentionally)
- **Zero dependencies / CSP-safe** — confetti is hand-rolled canvas, no CDN.
  This matters because the real app is served by Google Apps Script.
- **`prefers-reduced-motion`** honored, plus an in-page Motion toggle. Relevant
  to the older-PAX demographic.
- **Palette** mirrors `static-pages/src/index.html` (light + dark), so what you
  see here is what the dashboard would look like.
- Affirmation copy rotates from small pools so it doesn't go stale.

## Wiring into the real dashboard (later)
The reusable pieces are: the ring-fill helper, the affirmation pools + rotator,
the badge-stamp CSS, the miss-state screen, and the `confetti()` function. Lift
those into `index.html` and trigger them from the existing check-in / streak /
goal state rather than the demo buttons.
