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
subfolder. The GitHub Pages workflow (`.github/workflows/pages.yml`) runs this build on every
push to `main` that touches `src/`, then publishes both subfolders as one Pages site:

- SIT:  `https://stuartdonaldson.github.io/F3Go30/sit/`
- PROD: `https://stuartdonaldson.github.io/F3Go30/prod/`

Never edit `dist/` directly — it's regenerated from `src/index.html` every publish. Local testing
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

## Open decisions (not resolved by this issue)

- **Static host.** Provisioned on GitHub Pages (2026-07-15), deployed via
  `.github/workflows/pages.yml` (GitHub Actions "deploy from workflow" source, not a branch).
  See "Layout / deploy process" above for the per-environment (`sit`/`prod`) URLs.
- **URL distribution to PAX.** Out of scope per the issue — `CheckinSessions`' saved-link minting
  and the email templates still point at the GAS `/exec` URL. Migrating them is a separate,
  later issue.
