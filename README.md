# F3Go30

Google Apps Script automation for managing monthly Go30 habit-challenge trackers in Google Sheets, with phone-friendly web apps for PAX to sign up, check in daily, track progress, and log bonus points.

## Overview

Go30 is an F3 monthly habit challenge, built on the *Atomic Habits* premise that small actions repeated consistently reshape who you become: each PAX picks one small, specific Daily Challenge (e.g. 15 minutes of stretching, journaling, no phone while driving), commits to it, and scores it Hit or Miss each day for the month — with a team for accountability. F3Go30 runs the whole cycle:

- **Monthly tracker automation** — copies and initializes each month's tracker spreadsheet, wires time-based triggers, shortens URLs, and logs to Axiom, all driven from a single Template so a non-technical Site-Q never touches the plumbing.
- **PAX web apps** — sign-up (Hard Commit; replaces the retired Google sign-up Form), one-tap daily check-in, a personal dashboard (streaks, month-progress ring, team board), and bonus-point logging (Fellowship, Q, Inspire, EHing an FNG). All served as Apps Script `doGet`/`doPost` endpoints reading and writing the region's own spreadsheet — no external hosting, API, or database. The app remembers each PAX via a bookmarkable "identify-once" link.

Topics: apps-script, google-sheets, automation, fitness, go30, beads, gdpr-conscious

## Status

**Current — v2.6.8, deployed to PROD (2026-10-07).** The full PAX-facing web app (sign-up, daily check-in, dashboard, Scorecard, bonus points) is live. Sign-up happens only on the Go30 page: the old Google sign-up Form is closed, and new monthly trackers no longer get one. Teams use a single field backed by the Template's TeamDB sheet. Two environments run in parallel: **PROD** (the live Template) and **SIT** (integration testing). See [docs/CHANGELOG.md](docs/CHANGELOG.md) for the user-facing feature history.

**What's next, in order:**

1. **Stability first.** Watch the activity health report (below) for check-in reliability, especially lost responses on the current app version, and close known defects before new features. See `bd ready` for the current queue.
2. **User-facing feature push.** Once stable, the next UI investment is **branding**, **awards for progress** (recognizing streaks and milestones), and **inspiration** woven into the check-in and dashboard experience.
3. **Published documentation & explainer video.** Ship durable, publicly linkable docs (the newcomer [Intro](docs/Go30-Intro.md) and [FAQ](docs/Go30-FAQ.md) are drafted) and produce a PAX explainer video for registration and sign-in (`F3Go30-xc7`).

---

## Getting Started

### Prerequisites

- Google account that owns the Go30 tracker spreadsheet
- Go30 Template spreadsheet created and accessible (the bound script is deployed on this template)
- [clasp](https://github.com/google/clasp) installed: `npm install -g @google/clasp`
- F3Go30's credential file configured by running `clasp_config_auth=~/.clasprc-f3go30.json clasp login`. This same env var (or the `--auth <file>` flag) is required by every other clasp command too — see the project CLAUDE.md §clasp and the `claspAuth` field in `local.settings.json`.
- `TINYURL_ACCESS_TOKEN` Script Property configured (see [OPERATIONS.md](docs/OPERATIONS.md))

### Deploy

```bash
cd script
clasp push
```

Open the spreadsheet with the owner account — the **F3 Go30** custom menu should appear.

See [OPERATIONS.md](docs/OPERATIONS.md) for full configuration and failure mode reference.

---

## Activity & Health Reports

Runtime logs go to Axiom and are mirrored into a local store (`data/axiom/`, needs `duckdb` in the
uv1 venv) so PROD history outlives Axiom's 30 days. `tools/activity_log.py` reads that store
(syncing first; `--no-sync` skips the network). `--env sit|prod` is required for the health and
version reports (the narrative covers both environments without it). Run them with
the uv1 venv Python (`/mnt/c/dev/venvs/uv1/bin/python`).

| Report | Command | What it answers |
|--------|---------|-----------------|
| Activity narrative | `tools/activity_log.py --env prod --since 24h` | What did PAX do? Sessions in plain English, with errors and reconnect failures listed first |
| Health report | `tools/activity_log.py --health --env prod` | How is the app doing? Findings first, then tables by version, week and hour of day |
| One view | `… --health --env prod --view version` (or `week`, `hour`) | Just the server and app tables for that view, with no findings |
| Who's on a version | `tools/activity_log.py --version-users 2.6.5 --env prod` | Who still uses an app version, when each PAX last used it, and the version they've moved to |

- **By version:** server and app (browser) tables, each count shown as a number and a percent. The
  app table also shows when each version first appeared and when it was mostly gone.
- **By week:** Sunday-start weeks (UTC). The current week is shown but never compared.
- **By hour:** hour of day in Pacific time, as rates, because traffic varies a lot by hour. Flags
  hours whose failure rate or login p95 is well above the window's.
- **Findings:** rule-based flags such as log loss, rate and latency regressions, new error
  messages, old app versions still in use, and PAX with repeated failures.
- App failures are counted when they happened on the device, not when the report reached the
  server (offline failures are relayed later).
- Window: `--weeks N` (default 4 whole weeks plus the current one), or `--since` / `--start` and
  `--end`. Output: `--format text|md|json`, and `--out <file>`. `json` adds a drill-down query per
  finding.
- Raw queries: `tools/query_axiom.py` (live APL, or `--local --sql` against the store).

Details: [OPERATIONS.md](docs/OPERATIONS.md) §Periodic health report and §Local Axiom store.

---

## Documentation

| Document | Purpose |
|----------|---------|
| [CONTEXT.md](docs/CONTEXT.md) | Purpose, capabilities, use cases, glossary |
| [DESIGN.md](docs/DESIGN.md) | Architecture, modules, data model, runtime risks |
| [OPERATIONS.md](docs/OPERATIONS.md) | Configuration, deployment, failure modes |
| [ADRs](adr/) | Architecture decision records |
| [Sheet reference](docs/sheet-reference.md) | Per-sheet descriptions, column layout, formulas, and operational notes |

## Project Management

- Recommended: use the Beads issue tracker for backlog and task management. Beads is optional but recommended for AI-assisted workflows and issue tracking that lives with the repository. See the included `.beads/README.md` for usage and local installation instructions, or learn more at https://github.com/steveyegge/beads.
- The repository includes a local Beads database (`.beads/`) so you can run `bd` commands locally without an external service. Using Beads is an optional prerequisite for following the project's documented bead-based workflows.

