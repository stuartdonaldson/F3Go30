/**
 * Hedged dashboard reads in a real browser against live SIT (F3Go30-8naq.6).
 *
 * F3Go30-8naq.2 made a read a HEDGE, not an abort-and-reissue: past REQUEST_TIMEOUT_MS_ (12s) a
 * slow attempt is left open while the next one starts in parallel; the first parsed response wins
 * and every other attempt is aborted; MAX_READ_ATTEMPTS_ x REQUEST_TIMEOUT_MS_ (36s) is the
 * deadline. The node tier proves that with fake timers (test_client_transport_resilience.js) and
 * the network-free spec with a fake clock and synthetic bodies (transport-resilience.spec.js).
 * What neither can show is a REAL Apps Script response arriving late or never, through the real
 * fetch/AbortController, in a real Chromium. SIT never produces a >12s read on demand, so
 * page.route holds the dashboard request: the held request is the fault, the body that eventually
 * lands is the genuine SIT response (route.fetch / route.continue), never a stand-in.
 *
 * Drives the page's own non-silent read, `loadDashboard_()` (a script-level function in the
 * classic-script page, the same path #dashboardBtn takes when nothing is cached; the page also
 * exposes `callApi` this way, which transport-resilience.spec.js already uses). Calling it
 * directly rather than clicking #dashboardBtn keeps this to ONE deterministic read: with the
 * automatic identify-time prefetch holding a cached board, a click would be a silent revalidate
 * (no render/banner to assert), and with the prefetch failing it would chain a second full read.
 *
 * No timing constant is overridden and no production knob exists or was added: scenarios run on
 * real time (S1 ~14s, S2 ~12s + a SIT round trip, S3 36s). A small init script wraps window.fetch
 * ONLY to timestamp each dashboard attempt and observe its AbortSignal (delegating to the real
 * fetch) and to log the Syncing note's text, so attempt timing and aborts are read from the page
 * itself rather than inferred from Playwright's event ordering. A boundary fault (SIT down while
 * the real response is fetched) is classified by tests/harness/outcomes.js, never caught here.
 *
 * Fixture: NoSadClown, self-registered for the current month via ensureFixturePaxIdentified_.
 * Read-only: nothing is written to SIT, nothing to restore.
 *
 * Usage:
 *   pnpm exec playwright test tests/playwright/dashboard-hedged-read-live-check.spec.js
 */
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { dismissAnnouncementIfPresent_, ensureFixturePaxIdentified_, startStaticServer_ } = require('./live-check-helpers.js');

const ROOT = path.resolve(__dirname, '../..');
const DEMO_PAX = { f3Name: 'NoSadClown', email: 'nosadclown@example.com' };
const LIVE_ROUND_TRIP_MS = 60000;
const TELEMETRY_QUEUE_KEY = 'go30ClientTelemetryQueue:v1';
// The page's own contract (static-pages/src/index.html REQUEST_TIMEOUT_MS_ / MAX_READ_ATTEMPTS_),
// restated only to bound the observed timings; a change there is a change to this spec on purpose.
const HEDGE_INTERVAL_MS = 12000;
const DEADLINE_MS = 3 * HEDGE_INTERVAL_MS;
const TIMING_TOLERANCE_MS = 2500;

test.use({ storageState: undefined, viewport: { width: 390, height: 844 }, headless: true });
test.describe.configure({ timeout: 150000 });

function loadSettings() {
  const p = path.join(ROOT, 'local.settings.json');
  if (!fs.existsSync(p)) throw new Error('local.settings.json not found');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// Timings use performance.now() (monotonic), never Date.now(): on this WSL2 host the wall clock
// measurably disagrees with timers (a 12s setTimeout reads ~10.5s of Date.now), and the page's
// hedge timers are what is under test.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs in the page before its own scripts: timestamps every dashboard fetch, records when its
 * AbortSignal fires, and logs each visible text of the Syncing note. Delegates to the real fetch. */
function instrumentPage_() {
  window.__dashFetches = [];
  window.__syncLog = [];
  const realFetch = window.fetch.bind(window);
  window.fetch = function (url, init) {
    const body = init && typeof init.body === 'string' ? init.body : '';
    if (body.indexOf('"action":"dashboard"') !== -1) {
      const rec = { issuedAt: performance.now(), abortedAt: null };
      window.__dashFetches.push(rec);
      if (init.signal) init.signal.addEventListener('abort', () => { rec.abortedAt = performance.now(); });
    }
    return realFetch(url, init);
  };
  document.addEventListener('DOMContentLoaded', () => {
    const el = document.getElementById('checkinSyncingNote');
    new MutationObserver(() => {
      if (!el.classList.contains('hidden')) window.__syncLog.push(el.textContent);
    }).observe(el, { attributes: true, childList: true, characterData: true, subtree: true });
  });
}

test.describe('Hedged dashboard reads (real browser, live SIT)', () => {
  let execUrl;
  let staticOrigin;
  let server;
  let sessionGuid;

  test.beforeAll(async ({ request }) => {
    const deploymentId = loadSettings().testDeploymentId;
    if (!deploymentId || deploymentId.startsWith('<')) {
      throw new Error('testDeploymentId not set in local.settings.json — run pnpm run deploy:sit first');
    }
    execUrl = `https://script.google.com/macros/s/${deploymentId}/exec`;
    sessionGuid = crypto.randomUUID();
    await ensureFixturePaxIdentified_(request, execUrl, DEMO_PAX, sessionGuid);
    server = await startStaticServer_();
    staticOrigin = `http://127.0.0.1:${server.address().port}`;
  });

  test.afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  /**
   * Opens the page as the fixture PAX and waits until the identify-time prefetch has settled, so
   * the only dashboard reads after `arm()` are the ones the scenario asks for. `behave(route,
   * nth)` decides each dashboard attempt (nth is 1-based, counted from arm()); everything else
   * passes through untouched.
   */
  async function openPage(page) {
    await page.addInitScript(instrumentPage_);
    const state = { armed: false, nth: 0, behave: null, carried: [] };
    await page.route('**/exec*', async (route) => {
      const body = route.request().postData() || '';
      let parsed = {};
      try { parsed = JSON.parse(body); } catch (e) { /* not JSON: pass through */ }
      if (parsed.telemetry && Array.isArray(parsed.telemetry.records)) state.carried.push(...parsed.telemetry.records);
      if (!state.armed || parsed.action !== 'dashboard') return route.continue();
      return state.behave(route, ++state.nth);
    });
    await page.goto(`${staticOrigin}/index.html?webapp=${encodeURIComponent(execUrl)}&id=${sessionGuid}`);
    await expect(page.locator('#step-checkin')).toBeVisible({ timeout: LIVE_ROUND_TRIP_MS });
    await dismissAnnouncementIfPresent_(page, { timeout: 8000 });
    await page.waitForFunction(() => !state.dashboardPrefetchPromise, null, { timeout: LIVE_ROUND_TRIP_MS });
    await page.evaluate(() => { window.__dashFetches.length = 0; window.__syncLog.length = 0; });
    return {
      arm(behave) { state.behave = behave; state.armed = true; state.armedAtIso = new Date().toISOString(); },
      /** Telemetry records captured after arm(), from the queue and from request bodies that carried them. */
      async telemetry(kind) {
        const queued = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), TELEMETRY_QUEUE_KEY);
        const byId = new Map();
        queued.concat(state.carried).forEach((rec) => { if (rec.kind === kind && rec.ts >= state.armedAtIso) byId.set(rec.id, rec); });
        return [...byId.values()];
      },
    };
  }

  /** Real response for a held request, fulfilled with CORS headers (the page is cross-origin). */
  async function fulfillFromBackend(route, real) {
    const response = await real;
    await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } });
  }

  test('S1: a slow first attempt wins; the hedge is aborted, no error banner', async ({ page }) => {
    const h = await openPage(page);
    const HOLD_MS = 14000;
    h.arm(async (route, nth) => {
      if (nth > 1) return; // attempt 2 (and 3): let it open and never answer, the hedge that must be aborted
      const real = route.fetch();
      await sleep(HOLD_MS);
      await fulfillFromBackend(route, real);
    });

    const t0 = performance.now();
    await page.evaluate(() => loadDashboard_());
    const elapsed = performance.now() - t0;

    const fetches = await page.evaluate(() => window.__dashFetches);
    expect(fetches.length).toBeGreaterThanOrEqual(2);
    expect(fetches[1].issuedAt - fetches[0].issuedAt).toBeGreaterThan(HEDGE_INTERVAL_MS - TIMING_TOLERANCE_MS);
    expect(fetches[1].issuedAt - fetches[0].issuedAt).toBeLessThan(HEDGE_INTERVAL_MS + TIMING_TOLERANCE_MS);
    expect(elapsed).toBeGreaterThanOrEqual(HOLD_MS - 500); // rendered from the held first attempt, not a faster hedge
    expect(fetches[0].abortedAt).toBeNull();
    fetches.slice(1).forEach((f) => expect(f.abortedAt).not.toBeNull());

    await expect(page.locator('#step-dashboard')).toBeVisible();
    await expect(page.locator('#apiErrorBanner')).toBeHidden();
    expect(await page.evaluate(() => window.__syncLog)).toContain('⟳ Syncing-2…');
    await expect(page.locator('#checkinSyncingNote')).toBeHidden();

    const hedged = await h.telemetry('hedgedRead');
    expect(hedged).toHaveLength(1);
    expect(hedged[0].ctx).toMatchObject({ winningAttempt: 1, hedged: true });
  });

  test('S2: a hung first attempt; the second attempt wins and the first is aborted', async ({ page }) => {
    const h = await openPage(page);
    h.arm(async (route, nth) => {
      if (nth === 1) return; // never answered
      return route.continue();
    });

    await page.evaluate(() => loadDashboard_());

    const fetches = await page.evaluate(() => window.__dashFetches);
    expect(fetches.length).toBeGreaterThanOrEqual(2);
    expect(fetches[1].issuedAt - fetches[0].issuedAt).toBeGreaterThan(HEDGE_INTERVAL_MS - TIMING_TOLERANCE_MS);
    expect(fetches[1].issuedAt - fetches[0].issuedAt).toBeLessThan(HEDGE_INTERVAL_MS + TIMING_TOLERANCE_MS);
    expect(fetches[0].abortedAt).not.toBeNull();
    await expect(page.locator('#step-dashboard')).toBeVisible();
    await expect(page.locator('#apiErrorBanner')).toBeHidden();
    expect(await page.evaluate(() => window.__syncLog)).toContain('⟳ Syncing-2…');

    const hedged = await h.telemetry('hedgedRead');
    expect(hedged).toHaveLength(1);
    expect(hedged[0].ctx.winningAttempt).toBeGreaterThanOrEqual(2); // 2 normally; 3 only if SIT itself took >12s
    expect(hedged[0].ctx.hedged).toBe(true);
  });

  test('S3: every attempt held; the error banner appears at the 36s deadline and all attempts are aborted', async ({ page }) => {
    const h = await openPage(page);
    h.arm(async () => { /* hold every attempt */ });

    const t0 = performance.now();
    await page.evaluate(() => loadDashboard_());
    const elapsed = performance.now() - t0;

    expect(elapsed).toBeGreaterThan(DEADLINE_MS - TIMING_TOLERANCE_MS);
    expect(elapsed).toBeLessThan(DEADLINE_MS + TIMING_TOLERANCE_MS);
    await expect(page.locator('#apiErrorBanner')).toBeVisible();
    await expect(page.locator('#apiErrorHeadline')).toHaveText('Couldn’t reach the server.');

    const fetches = await page.evaluate(() => window.__dashFetches);
    expect(fetches).toHaveLength(3); // MAX_READ_ATTEMPTS_, launched at 0 / 12 / 24s
    fetches.forEach((f) => expect(f.abortedAt).not.toBeNull());
    fetches.forEach((f) => expect(f.abortedAt - fetches[0].issuedAt).toBeLessThan(DEADLINE_MS + TIMING_TOLERANCE_MS));
    await expect(page.locator('#checkinSyncingNote')).toBeHidden();
    expect(await h.telemetry('hedgedRead')).toHaveLength(0); // nothing won
  });
});
