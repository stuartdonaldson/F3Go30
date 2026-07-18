# Static check-in front end (F3Go30-5nfj.2)

A static HTML/JS check-in page — additive alongside the GAS HtmlService check-in page
(`script/CheckinApp.html`), which continues to work unchanged. Paints instantly from a CDN-backed
static host instead of booting inside HtmlService's sandboxed iframe, then calls the same
JSON identify/checkin/dashboard endpoints the GAS page already exposes. It's a hand-ported,
same-behavior copy of `CheckinApp.html` + `IdentityCore.html` — same CSS, same DOM ids/classes,
same client logic — not templated/generated from them; see `src/index.html`'s own header comment
for how the config values that GAS bakes in server-side (bonus type rules, Site Q contact,
namespace, app version) instead arrive on the JSON `identify` response's `config` field
(`checkinClientConfig_dw_`, `script/dashboardWebapp.js`).

## Layout / deploy process

```
static-pages/
  src/index.html     <- source, edit this
  dist/sit/           <- generated (gitignored) — SIT-stamped build
  dist/prod/           <- generated (gitignored) — PROD-stamped build
```

`node tools/build-static-pages.js [--env sit|prod|all]` stamps `STATIC_BUILD_VERSION_` (a
placeholder in the source) with a version string in the same shape `script/version.js` gets
stamped with — `<version>.<build>` for sit, bare `<version>` for prod — and writes each
environment's copy (plus a small `version.json` the GAS About dialog reads) to its own `dist/`
subfolder.

Publishing lives in a sibling repo rather than this one, and is not a separate step you run by
hand — `npm run deploy:sit` / `deploy:prod` (`tools/manage-deployments.js`) call
`tools/publish-static-pages.js` automatically as their last step, once the GAS push itself has
succeeded. It builds, then copies that target's env folder (`static-pages/dist/sit/` for a test
deploy, `dist/prod/` for a template deploy) into the `f3go30/static-pages` repo's own
`dist/<env>/` (local checkout path from `local.settings.json`'s `staticPagesRepoPath`, e.g.
`../F3Static`), then commits and pushes from that repo — GitHub Pages serves straight from its
`main` branch, so the push is what makes a build live:

- SIT:  `https://f3go30.github.io/static-pages/dist/sit/`
- PROD: `https://f3go30.github.io/static-pages/dist/prod/`

The static page shares `package.json`'s version/build counter with the GAS webapp, so there's no
supported path for publishing a static-only change independently of a deploy — see
`tools/publish-static-pages.js`'s header comment for why (and the recovery-only case where you'd
run it directly). Never edit `dist/` directly (in either repo) — it's regenerated from
`src/index.html` every publish. Local testing
(`tests/playwright/static-checkin.spec.js`) serves `src/index.html` directly (unbuilt — its
`STATIC_BUILD_VERSION_` placeholder is `null`, which is a valid, fully-functional state; the page
reconciles it with the live GAS-reported version on its first identify call regardless).

## Config

Loaded entirely from its own URL query string — no build step, no server-side templating:

- `webapp` (required) — the GAS web app's `/exec` base URL, e.g.
  `https://script.google.com/macros/s/<deploymentId>/exec`
- `id` (required) — a saved-link session token (same `CheckinSessions` guid the GAS page's
  `?id=` carries)
- `ns` / `contextDate` (optional) — passed straight through on every API call, same as the GAS
  page's `NS_`/`CONTEXT_DATE_`

Example: `index.html?webapp=https%3A%2F%2Fscript.google.com%2Fmacros%2Fs%2F<id>%2Fexec&id=<guid>`

## JSON resolve endpoint

No new server endpoint was added. `handleCheckinPost_`'s existing `action: 'identify'`
(`script/dashboardWebapp.js:500`) already calls `handleCheckinIdentify_` — the same single-shot
resolver the sibling issue (F3Go30-5nfj.1) bakes into the GAS page's initial HTML — and returns
its result as plain JSON. Since both front ends call the identical function, the payloads can
never drift out of parity; there was nothing to fork.

## SPIKE result (AC gate)

Confirmed live against SIT (2026-07-16): a cross-origin `fetch()` POST (`Content-Type:
text/plain`, a CORS "simple request") to `/exec?cmd=checkin` reads the JSON body successfully.
Both hops of the request — the initial `script.google.com` 302 and the
`script.googleusercontent.com` redirect target it points to — return
`Access-Control-Allow-Origin: *`, so this works from any static origin (no allowlisting needed).
Verified end-to-end with a real browser (Playwright) serving this page from
`http://127.0.0.1:<port>` (a origin unrelated to any Google host) — see
`tests/playwright/static-checkin.spec.js`.

## Timing note (before/after, measured 2026-07-16, local Chromium)

| Page | Time to first byte / shell commit | Time to fully interactive |
|---|---|---|
| GAS HtmlService check-in page (`?cmd=checkin`) | ~3.3s | ~4.5s (`networkidle`) |
| This static page's HTML/CSS shell | ~18ms | ~30ms (`domcontentloaded`) |

The static shell's own paint is ~100x faster because there's no HtmlService iframe/sandbox boot
to pay for before anything reaches the screen — the identify/dashboard data calls still cost the
same server-side round trip either way and load progressively after the shell is already visible,
same principle as the GAS page's own `prefetchDashboard_`.

## How it Works page (F3Go30-e3co)

`static-pages/src/how-it-works.html` is generated, not hand-edited — its canonical source is
`docs/Go30-Intro.md` (the HTML fragment between its `HOW-IT-WORKS:START`/`END` marker comments).
`tools/sync-how-it-works.js` extracts that fragment and writes this file, and also injects the
same fragment into `script/SignupApp.html`'s and `script/CheckinApp.html`'s `#howBody` panels
(between matching markers) so all three surfaces stay in sync from one edit point. Run manually
via `npm run sync:how-it-works`, or automatically as part of every `npm run deploy:sit` /
`deploy:prod` (wired into `tools/manage-deployments.js`'s `deploy()`, before `clasp push`).

Unlike `index.html`, this page has no server calls and no `STATIC_BUILD_VERSION_` stamping —
`tools/build-static-pages.js` copies it into each env's `dist/` folder unchanged, so
`dist/sit/how-it-works.html` and `dist/prod/how-it-works.html` are byte-identical:

- SIT:  `https://f3go30.github.io/static-pages/dist/sit/how-it-works.html`
- PROD: `https://f3go30.github.io/static-pages/dist/prod/how-it-works.html`

## Open decisions (not resolved by this issue)

- **Static host.** Provisioned on GitHub Pages (2026-07-15) via the `f3go30/static-pages` repo
  (checked out locally as `../F3Static`), "deploy from a branch" source (`main`, root). Moved
  out of this repo (2026-07-15) so publishing a static-page build doesn't require a push to
  F3Go30's own `main`; `tools/publish-static-pages.js` pushes there instead. See "Layout / deploy
  process" above for the per-environment (`sit`/`prod`) URLs.
- **URL distribution to PAX.** Out of scope per the issue — `CheckinSessions`' saved-link minting
  and the email templates still point at the GAS `/exec` URL. Migrating them is a separate,
  later issue.
