# F3Go30

Google Apps Script automation for managing monthly Go30 habit-challenge trackers in Google Sheets, with phone-friendly web apps for PAX to sign up, check in daily, track progress, and log bonus points.

## Overview

Go30 is an F3 monthly habit challenge, built on the *Atomic Habits* premise that small actions repeated consistently reshape who you become: each PAX picks one small, specific Daily Challenge (e.g. 15 minutes of stretching, journaling, no phone while driving), commits to it, and scores it Hit or Miss each day for the month — with a team for accountability. F3Go30 runs the whole cycle:

- **Monthly tracker automation** — copies and initializes each month's tracker spreadsheet and signup form, wires time-based triggers, shortens URLs, and logs to Axiom, all driven from a single Template so a non-technical Site-Q never touches the plumbing.
- **PAX web apps** — sign-up (Hard Commit), one-tap daily check-in, a personal dashboard (streaks, month-progress ring, team board), and bonus-point logging (Fellowship, Q, Inspire, EHing an FNG). All served as Apps Script `doGet`/`doPost` endpoints reading and writing the region's own spreadsheet — no external hosting, API, or database. The app remembers each PAX via a bookmarkable "identify-once" link.

Topics: apps-script, google-sheets, automation, fitness, go30, beads, gdpr-conscious

## Status

**Current — v2.3.15, deployed to PROD.** The full PAX-facing web app UI (sign-up, daily check-in, dashboard, bonus points) is live, with the "identify-once / remember me" flow hardened after a round of live bug-fixing. Two environments run in parallel: **PROD** (the live Template) and **SIT** (integration testing). See [docs/CHANGELOG.md](docs/CHANGELOG.md) for the user-facing feature history.

**What's next, in order:**

1. **Stability first.** Before new features, close out known defects and shore up test tooling — e.g. the dashboard hard-erroring when a PAX navigates to a month they weren't registered for (`F3Go30-awhw`), and re-architecting the SIT/smoke test harness so multi-month and bonus-edit flows have real coverage (`F3Go30-4j4o`). See `bd ready` for the current queue.
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

