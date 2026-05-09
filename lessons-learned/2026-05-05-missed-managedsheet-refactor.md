# 2026-05-05 — Missed ManagedSheet helper in early refactor

What happened

- I implemented a refactored `signupReuse.js` to extract and copy previous responses, but initially did not leverage the existing `ManagedSheet`/`SpreadsheetManager` utilities in `script/libSheets.js`.

Why it was missed

- The repository contains both older, array-based helpers (e.g. `resolveResponseColumns_`) and the newer `ManagedSheet` abstraction; my first pass followed the shape of the ignored draft rather than the canonical helper (confirmation bias).
- I performed a text search for obvious names, but did not prioritise scanning `libSheets.js` for `ManagedSheet` usage before coding.
- The draft file and existing utilities duplicated header-resolution logic which obscured the single-source-of-truth in `libSheets.js`.

Impact

- Extra duplicated header-mapping code was introduced temporarily, increasing maintenance surface area.
- Minimal; I subsequently refactored `maybeReuseLastMonthsGoals_` to prefer `ManagedSheet` and added a fallback to raw sheet operations to remain robust.

Resolution

- Updated `script/signupReuse.js` to use `SpreadsheetManager`/`ManagedSheet` for previous/current `Responses` sheets when possible, with a raw-sheet fallback.
- Added this lessons-learned note documenting why the helper was missed and how to avoid it.

Follow-ups / Recommendations

- Prefer `ManagedSheet` in new code paths and update legacy functions to adopt it incrementally.
- Add a short README or comment in `script/libSheets.js` pointing out the canonical helpers and common column maps (e.g. `RESPONSE_COLUMN_MAP`) to make them easy to discover.
- When starting a refactor, run a targeted grep for `ManagedSheet`, `openConfigSheet`, `openExistingSheet`, and `SpreadsheetManager` to locate high-level helpers first.

Recorded: 2026-05-05
Author: automation (GitHub Copilot agent)
