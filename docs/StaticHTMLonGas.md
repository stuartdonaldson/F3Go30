# Porting a GAS HtmlService Page to a Static Front End — Best Practices

> Written from F3Go30's migration of its check-in page (`script/CheckinApp.html`, served via
> `HtmlService`) to a static HTML/JS page hosted on GitHub Pages, calling the same GAS web app as
> a plain JSON API. Source issues: F3Go30-5nfj.1/.2 and same-day follow-ups (favicon, title,
> bookmarkable URL). Intended as a transferable playbook for other GAS bound/unbound web-app
> projects considering the same move.

## Why do this

Apps Script's `HtmlService` renders web-app pages inside a **cross-origin sandboxed iframe**
(`script.googleusercontent.com`), wrapped by a top-level document Google controls. That wrapper
is where most of the pain comes from:

- **Slow first paint.** The top-level document has to boot, negotiate the sandbox iframe, then
  load your HTML inside it before anything user-visible appears. Measured on F3Go30's check-in
  page (local Chromium, same network): **~3.3s to first byte / ~4.5s to `networkidle`** for the
  GAS page vs **~18ms to shell commit / ~30ms to `domcontentloaded`** for the static equivalent —
  roughly two orders of magnitude. The server round trip for actual data (identify, dashboard)
  costs the same either way; the difference is pure sandbox-boot overhead paid before your code
  ever runs.
- **Google's blue banner / chrome.** The top-level wrapper is Google's, not yours — branding,
  "Report abuse" footer, and (depending on deployment settings) a warning interstitial are outside
  your control.
- **The sandbox blocks ordinary browser mechanics.** Because the served HTML lives in a nested
  cross-origin iframe, several things that "just work" on a real page don't:
  - `document.title` changes from client-side JS never reach the top-level (bookmarkable)
    document/tab. The only way to control a per-user page title is server-side, via
    `HtmlOutput.setTitle()` at render time — meaning the title has to be computed *before* the
    template renders, from whatever identity is available in the request (e.g. a saved-link
    token), not after an async identify call resolves client-side.
  - `<link rel="icon">` tags written directly in the HTML are documented as ignored. The only
    supported favicon mechanism is `HtmlOutput.setFaviconUrl()`, which requires an **externally
    hosted** URL (clasp has no static binary-asset hosting — it only syncs `.gs`/`.html`/manifest
    sources).
  - A deep-link query string (e.g. `?id=<token>`) is not visible to the client's own JS at all —
    Apps Script injects the rendered content into the iframe with no query string of its own. Any
    request parameter the client needs has to be read server-side and templated into the page.
  - Async, client-driven navigation state (e.g. "I just identified via a typed name+email form,
    put a bookmarkable token in the address bar") can't reach the address bar either, since the
    page never truly navigates — there's no top-level URL for `history.replaceState` to act on
    from inside the sandbox in the way a real page would expect. (The static page, by contrast,
    *is* the top-level document, so this is a non-issue there — see "Details the first pass
    missed" below for what broke when this was ported over naively.)
- **No CDN, no HTTP caching control.** Every request re-runs through Apps Script's execution
  quota and cold-start path; there's no way to put a CDN or long-lived cache headers in front of
  it.

None of this is a defect in Apps Script — `HtmlService` is doing exactly what it's designed to do
(sandbox third-party script execution inside Google's UI shell). It's just the wrong tool once you
want page-shell performance and address-bar-level control comparable to a normal web app, while
still keeping all your business logic and data on the Apps Script side.

**When this migration is *not* worth it:** internal tools with a handful of users, sheet-bound
sidebars/menus that only ever open inside the Sheets UI (no bookmarkable URL story to begin with),
or pages where the sandbox's quirks above genuinely don't matter. The value here is specifically
for public-facing or frequently-revisited pages where first-paint latency and browser-native
behavior (bookmarks, tab titles, favicons) are user-visible.

## The core idea

Keep Apps Script as the **backend only**. The web app's `doPost` dispatcher already has (or gains)
a plain JSON action for whatever the HTML page used to get via server-side templating or
`google.script.run`. A static HTML/CSS/JS file — hosted anywhere that serves static files over
HTTPS — calls that JSON endpoint with `fetch()` and renders client-side. The GAS-served
`HtmlService` page can keep running unmodified alongside it; nothing about this requires ripping
out the old page first.

```
Static host (GitHub Pages, or any static host)
  index.html  --fetch()-->  GAS web app /exec?cmd=<x>  (doPost, JSON in/out)
                                   |
                                   v
                            Same business logic, same Sheet-backed data
                            the HtmlService page already used
```

### Step 1 — Confirm CORS actually works (spike before porting anything)

Apps Script's `/exec` URL responds with a redirect to `script.googleusercontent.com` before
returning your content. Confirm **both hops** send `Access-Control-Allow-Origin: *` (they did for
F3Go30, unconditionally — no allowlist needed) before investing in a port. Verify with a real
browser from a genuinely different origin (not `file://`, which has its own CORS exemptions that
can hide a real problem) — F3Go30 used Playwright serving the static file from `127.0.0.1` while
calling a live SIT deployment. A same-origin `text/plain` POST body (not `application/json`, which
triggers a CORS preflight) keeps the request a CORS "simple request", avoiding an extra
OPTIONS round trip GAS doesn't handle.

### Step 2 — Give the client everything the server used to bake in

An `HtmlService` page gets configuration values "for free" via server-side templating
(`<?= ... ?>` at render time) and via `doGet`'s access to the request (query params, session-like
saved tokens). A static page has none of that — it only has its own URL's query string and
whatever the API returns. Two changes carry the weight:

1. **Route configuration through the existing data-fetching call**, don't invent a new endpoint.
   F3Go30 added one `config` field to the *existing* identify response (shared by both front
   ends — one `checkinClientConfig_dw_()` helper builds it once, called from the same
   `handleCheckinIdentify_` both the GAS-templated page and the static page's first API call
   already invoke). This is the single most important structural decision in this migration:
   because both front ends call the *identical* server function, the two payloads can never drift
   out of parity — there is nothing to keep in sync by hand.
2. **Move query-string configuration to the page's own URL.** Whatever `doGet`'s `e.parameter`
   used to carry (namespace, saved-session token, a debug context-date override) becomes a query
   param on the static page's own URL instead (`index.html?webapp=<exec-url>&id=<token>&ns=...`).
   The static page reads these with `URLSearchParams` at load and forwards them on every API call
   exactly where the GAS page used to inject them server-side.

### Step 3 — Hand-port the HTML/CSS/JS, don't templated-generate it

Port the existing `HtmlService` file(s) to plain HTML **by hand**, keeping the same DOM ids/classes/
CSS and the same client-side logic verbatim wherever it doesn't depend on server templating. Two
things this buys you:
- Existing UI tests that assert on locators/classes need no changes to also cover the static page.
- A design-tool export format that requires a proprietary runtime (React-based `.dc.html` +
  `support.js` bundles, in F3Go30's case) is *not* itself a deployable artifact for either front
  end — both need the same manual port to vanilla HTML/CSS/JS regardless, so do it once, shared.

Any GAS `<?!= include('SomeFile') ?>` shared partial (F3Go30 had one for identity/HTTP-client
plumbing, `IdentityCore.html`) gets inlined into the static file's own `<script>` block, commented
as "kept byte-for-byte identical to the GAS include" — a deliberate manual-sync point, since there
is no shared build step between the two files. Grep both files periodically for drift.

### Step 4 — Client-side identity resolution replaces server-side templating

The biggest logic change: the GAS page could resolve "who is this visitor" *before* the page ever
reached the browser (`doGet` decodes a saved-session token server-side, bakes the resolved
identity into the template). The static page can't do that — it's a plain file with no per-request
server hook — so identity resolution becomes the **first thing the client does after load**: an
async `identify` API call, using the token/query params read from its own URL. Render a lightweight
"identifying…" state for that gap; it's typically much shorter than the old sandbox-boot latency
it replaces.

### Step 5 — Build and publish as their own pipeline stage

- A small build step (F3Go30: `tools/build-static-pages.js`) stamps build-time values into a
  placeholder in the source (a version string, in this case) and writes one copy per environment
  (SIT/PROD) into `dist/<env>/`. Keep the *source* file free of environment-specific values — the
  build step's job is narrowly to stamp what genuinely can't be known until then.
- **Publish to a dedicated static-only repo, not the main dev repo.** F3Go30's first pass wired a
  GitHub Actions Pages workflow directly into the main repo (deploy-on-push-to-main). That coupled
  the static page's release cadence to *every* push to main, and put a public Pages site on a repo
  that also holds unrelated source. It was replaced same-day with a separate repo
  (`f3go30/static-pages`, checked out locally as a sibling directory) that GitHub Pages serves
  directly from `main`/root — a publish step (`tools/publish-static-pages.js`) builds, copies the
  target env's `dist/` folder into that sibling repo, commits, and pushes. That repo holds **only**
  generated output — its own README says so explicitly, "not hand-edited" — which matters for the
  favicon-consolidation decision below.
- **Chain the publish into the existing deploy, don't make it a separate manual step.** Both the
  GAS web app and the static page share one version/build counter; a static-only publish that
  bypassed the real deploy would either reuse a stale build stamp or double-bump the counter.
  F3Go30's `deploy()` (`tools/manage-deployments.js`) calls the static-publish script automatically
  as its last step (`--skip-bump`, since deploy already bumped the counter), publishing only the
  env that was actually just deployed (SIT deploy → sit bundle; PROD deploy → prod bundle).

### Step 6 — Regression-test both front ends against the same live backend

Add a Playwright spec (or equivalent) that serves the static file from a **genuinely different
origin** than the GAS deployment (this is what actually exercises CORS, not a same-origin dev
server) and drives it against a real SIT deployment: identify, a data-mutating action, and a
read-back that proves the write landed. Keep one regression test for the *original* GAS page in
the same suite ("still works unchanged") — the point of this migration is additive, and a
regression there is exactly as costly as one in the new page.

## Details the first pass missed (fix these up front, not as follow-ups)

These were each individually true and each shipped as a *same-day follow-up* after the initial
port — worth checking for explicitly rather than discovering one at a time, since none of them
show up in a functional smoke test (the page works; it just doesn't behave like a real page yet):

1. **Page `<title>`.** A static page is a real top-level document, so unlike the GAS sandbox
   constraint above, `document.title` *can* just be set client-side once identity resolves — but
   it's easy to port the HTML/CSS/JS faithfully and simply forget the page needs this at all,
   since the GAS version got it "for free" via `HtmlOutput.setTitle()` and the static source
   started from a generic placeholder title. Check for it explicitly.
2. **Favicon.** Browsers request a favicon independent of anything in the page's own `<head>`, so
   a missing one is easy to miss entirely in casual testing — the page renders correctly either
   way. Static hosts do not synthesize one the way a real domain with `favicon.ico` at its root
   would; there's no "default" here to fall back on. Decide once where the canonical image lives
   and point every consumer at that single copy — see below.
3. **Bookmarkable URL after client-side identify.** The GAS page's real `<form>` POST navigation
   landed the address bar on a token'd `?id=` URL for free (server-rendered redirect target). A
   static page's identify call is always an async `fetch()` — nothing navigates, so nothing
   updates the address bar unless the client does it explicitly. Fix: once a typed-identify
   response resolves with a token, `history.replaceState(null, '', bookmarkUrl)` — not
   `pushState`, so it doesn't add a spurious back-button stop.
4. **CORS request shape.** `Content-Type: application/json` triggers a CORS preflight
   (`OPTIONS`) that Apps Script's web app doesn't handle usefully; use `text/plain` and parse JSON
   server-side instead, so the browser treats it as a "simple request" and skips the preflight
   entirely.
5. **Consolidate hosted assets to one canonical copy.** The favicon fix's first draft pointed the
   GAS page's `HtmlOutput.setFaviconUrl()` at a raw file path in the *main development repo*
   (`raw.githubusercontent.com/<user>/<mainrepo>/main/docs/...`) while the static page needed its
   own local copy to reference relatively. Since the static-pages repo is generated-only and
   already gets published on every deploy, the better fix was to make the logo one of its
   generated assets (source copy under `static-pages/src/assets/`, copied into `dist/<env>/assets/`
   by the same build step, published by the same publish step) and repoint *both* consumers — the
   static page's own `<link rel="icon">` and the GAS page's `setFaviconUrl()` — at that one hosted
   copy. One canonical location instead of two hand-maintained ones that can silently diverge.

## What we actually got from this (F3Go30 numbers)

- **~100x faster first paint**: ~18ms shell commit / ~30ms `domcontentloaded` vs. ~3.3s first byte
  / ~4.5s `networkidle` for the equivalent GAS page, same network, same machine.
- **No Google chrome above the page** — the static page is a normal top-level document; whatever
  banner/interstitial the HtmlService sandbox wrapper adds simply isn't there.
- **Zero server-side risk to the existing page** — the GAS `HtmlService` page was never modified
  to make this work (the one shared change, `checkinClientConfig_dw_`, is additive and used by
  both), so there was no cutover risk; the two front ends can run side by side indefinitely, or the
  old one can be retired later on its own schedule.
- **A CDN-hosted static file** in front of Apps Script's execution quota/cold-start path for
  everything that doesn't need live data (shell HTML, CSS, JS) — only the actual identify/data
  calls still pay a server round trip, same as before.

## Checklist for the next project

- [ ] Spike CORS live, from a real cross-origin static serve, against the actual web app — before
      porting anything.
  - [ ] Use `text/plain` POST bodies (avoid a CORS preflight).
- [ ] Identify every value the old page got via server-side templating or `doGet`'s request
      access; route each one through either the static page's own URL query string or an existing
      API response's payload (extend, don't fork, an existing endpoint's response shape).
- [ ] Hand-port HTML/CSS/JS keeping DOM ids/classes identical, so existing tests carry over.
- [ ] Move identity/data resolution to a client-side call fired immediately on load; render a
      brief loading state for the gap.
- [ ] Set `<title>` client-side once identity resolves.
- [ ] Add a `<link rel="icon">`, pointed at one canonical hosted image location.
- [ ] If identify can happen via a client-side form (not just a pre-existing token in the URL),
      `history.replaceState` a bookmarkable URL once it resolves.
- [ ] Build to per-environment output with a stamped version; keep the source file
      environment-agnostic.
- [ ] Publish to a dedicated static-only repo/host, not the main dev repo's own Pages config.
- [ ] Chain the publish step into the existing deploy automation, sharing one version/build
      counter — don't make it a separately-run, separately-versioned step.
- [ ] Add a regression test that exercises the static page from a genuinely different origin
      against a live deployment, plus a "the original GAS page still works" guard in the same
      suite.
