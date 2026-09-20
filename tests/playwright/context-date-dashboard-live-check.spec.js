/**
 * `contextDate` reaches the dashboard's resolved month — live SIT verification (F3Go30-f3fa,
 * REVIEW-260910 findings 1+2).
 *
 * The bug: `static-pages/src/index.html`'s dashboard load defaulted its viewed `dateISO` from a
 * bare `isoDate_(new Date())` — the browser's real clock — while `callApi` faithfully echoed the
 * page's `?contextDate=` override on every request. The server resolved `realToday` from that
 * override correctly, but `resolveDashboardMonth_` resolves off the *viewed* date, which the
 * client never overrode — so a prior-month `?contextDate=` silently resolved the real current
 * month's tracker instead. This is exactly the mechanism CLAUDE.md's `setContextDate` section
 * documents for deterministic month-boundary testing, on the one screen it didn't actually work.
 *
 * The fix (`contextToday_`/`contextTodayIso_`) is a source-level change a Node unit test can
 * assert (test_static_page_client_invariants.js's no-bare-isoDate_(new Date()) guard) — but
 * whether the override actually reaches the *server's resolved month* end-to-end is a live-wire
 * question only a real deployed round trip answers, which is what this spec is for.
 *
 * Uses the NoSadClown fixture, self-registered for the live current month via
 * ensureFixturePaxIdentified_ (live-check-helpers.js, F3Go30-51hy) — a month rollover on SIT
 * otherwise leaves a known-but-unregistered PAX (`knownPaxNotRegistered:true`) failing every live
 * spec that shares this fixture, as it did here and elsewhere on 2026-09-19. Read-only beyond that
 * one-time signup, so no state to restore, and no live Config write (unlike setContextDate/
 * setConfigValue): `contextDate` is a plain request field, sent straight through the URL query
 * string, so there's nothing to clean up on SIT after this spec runs.
 *
 * Usage:
 *   npm run deploy:sit
 *   npx playwright test tests/playwright/context-date-dashboard-live-check.spec.js
 */
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { dismissAnnouncementIfPresent_, ensureFixturePaxIdentified_ } = require('./live-check-helpers.js');

const ROOT = path.resolve(__dirname, '../..');
const STATIC_DIR = path.join(ROOT, 'static-pages', 'src');
const DEMO_PAX = { f3Name: 'NoSadClown', email: 'nosadclown@example.com' };
const LIVE_ROUND_TRIP_MS = 30000;
// F3Go30-u76i: this used to wait on the automatic prefetchDashboard_ call that fires right after
// identify — but the ?id= startup resume path only prefetches when applyIdentifySuccess_ runs
// with !opts.preserveView, which is not guaranteed on every resume (and isn't the resume path's
// contract to guarantee); relying on it made the spec's trigger an implementation detail rather
// than the behavior under test. #dashboardBtn's click handler (static-pages/src/index.html)
// always issues its own real action:"dashboard" POST one way or another — a fresh non-silent
// loadDashboard_() when nothing is cached yet, or a silent revalidateDashboard_() fetch when the
// prefetch already warmed the cache — so clicking it, with the listener already armed, is a
// request guaranteed to happen instead of one that might. Same generous budget as before: two
// sequential double-hop (302 -> googleusercontent echo) SIT round trips (identify, then this
// request) can occasionally clear 30s combined.
const DASHBOARD_LOAD_TIMEOUT_MS = 60000;

test.use({ storageState: undefined, viewport: { width: 390, height: 844 }, headless: true });
test.describe.configure({ timeout: 120000 });

function loadSettings() {
  const p = path.join(ROOT, 'local.settings.json');
  if (!fs.existsSync(p)) throw new Error('local.settings.json not found');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** First of last calendar month, e.g. run on 2026-09-10 -> '2026-08-01'. SIT carries at least the
 * current and a handful of recent trackers (CLAUDE.md's copyTemplate/smoke-mode note), so last
 * month is expected to already have one — no createTrackerForMonth backfill needed for this spec. */
function priorMonthFirstIso_() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-based; m-1 is last month, wraps to December via Date's own rollover
  const prior = new Date(y, m - 1, 1);
  return prior.getFullYear() + '-' + String(prior.getMonth() + 1).padStart(2, '0') + '-01';
}

function startStaticServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const file = path.join(STATIC_DIR, req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0]);
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test.describe('Dashboard contextDate override (client, live SIT)', () => {
  let checkinUrl;
  let staticOrigin;
  let server;
  let sessionGuid;
  const contextDateIso = priorMonthFirstIso_();
  const expectedMonthKey = contextDateIso.slice(0, 7);

  test.beforeAll(async ({ request }) => {
    const settings = loadSettings();
    const deploymentId = settings.testDeploymentId;
    if (!deploymentId || deploymentId.startsWith('<')) {
      throw new Error('testDeploymentId not set in local.settings.json — run npm run deploy:sit first');
    }
    checkinUrl = `https://script.google.com/macros/s/${deploymentId}/exec`;

    sessionGuid = crypto.randomUUID();
    await ensureFixturePaxIdentified_(request, checkinUrl, DEMO_PAX, sessionGuid);

    server = await startStaticServer();
    staticOrigin = `http://127.0.0.1:${server.address().port}`;
  });

  test.afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  function checkinPageUrl() {
    return `${staticOrigin}/index.html?webapp=${encodeURIComponent(checkinUrl)}` +
      `&id=${sessionGuid}&contextDate=${contextDateIso}`;
  }

  test('a prior-month ?contextDate= reaches the dashboard load\'s resolved monthKey', async ({ page }) => {
    // The dashboard load fires a POST to ?cmd=checkin whose body carries action:"dashboard" — this
    // is the exact request the bug defeated (client dateISO ignored contextDate, so the server
    // resolved the real current month instead of the overridden one). Apps Script's webapp answers
    // through a 302 to a script.googleusercontent.com echo URL that carries the real JSON body — the
    // 302 leg itself has no usable body, so match the FINAL response by walking back through
    // redirectedFrom() to the POST that carried our action, not by matching the request URL.
    // Armed before goto() so it also catches an automatic prefetchDashboard_ (F3Go30-833s) POST if
    // one happens to land before the click below — but the click is what this spec actually
    // depends on to guarantee the request happens at all (see DASHBOARD_LOAD_TIMEOUT_MS above).
    const dashboardResponsePromise = page.waitForResponse((resp) => {
      const priorRequest = resp.request().redirectedFrom();
      if (!priorRequest) return false;
      const postData = priorRequest.postData();
      return !!postData && postData.indexOf('"action":"dashboard"') !== -1;
    }, { timeout: DASHBOARD_LOAD_TIMEOUT_MS });

    await page.goto(checkinPageUrl());
    await expect(page.locator('#step-checkin')).toBeVisible({ timeout: LIVE_ROUND_TRIP_MS });
    await dismissAnnouncementIfPresent_(page);

    // Force the dashboard load rather than trusting an automatic prefetch to have fired one for
    // us — #dashboardBtn's click handler always issues (or chains onto) a real action:"dashboard"
    // request, cached or not (static-pages/src/index.html's dashboardBtn click handler). Fire the
    // click before awaiting the response promise armed above, so a slow-to-land automatic prefetch
    // and the click-driven request are both covered by the one listener.
    await page.locator('#dashboardBtn').click();

    const dashboardResponse = await dashboardResponsePromise;
    const payload = await dashboardResponse.json();
    expect(payload.ok).not.toBe(false);
    expect(payload.monthKey).toBe(expectedMonthKey);

    // UI-level confirmation: the same contextDate-resolved month is what the dashboard actually
    // shows once opened.
    await expect(page.locator('#step-dashboard')).toBeVisible({ timeout: LIVE_ROUND_TRIP_MS });
  });
});
