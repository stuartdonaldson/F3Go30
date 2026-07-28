/**
 * Transport resilience in a real browser (F3Go30-313u).
 *
 * The node harness (test/test_client_transport_resilience.js) executes the extracted callApi
 * against stubbed fetch/timers; this spec proves the same behaviour where it actually matters —
 * a real fetch, a real AbortController, real timers — with the failures injected by Playwright
 * routing rather than waited for. That distinction is the point: the bug this fixes was found by
 * a live spec flaking, and a fix verified only against a flake is not verified.
 *
 * Deliberately NOT live-backend-dependent (unlike static-signup.spec.js / static-checkin.spec.js):
 * every request is intercepted, so nothing here can fail because SIT is having a bad minute — the
 * exact failure mode being defended against.
 *
 * Usage:
 *   npx playwright test tests/playwright/transport-resilience.spec.js
 */
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.resolve(__dirname, '../..');
const STATIC_DIR = path.join(ROOT, 'static-pages', 'src');

// Any well-formed /exec URL works — every request to it is intercepted below, so this is only
// ever an origin for the page to aim at.
const FAKE_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycb-transport-resilience-test/exec';

test.use({ storageState: undefined, viewport: { width: 390, height: 844 }, headless: true });

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

function jsonBody(route, payload) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(payload),
  });
}

test.describe('Client transport resilience (F3Go30-313u)', () => {
  let staticOrigin;
  let server;

  test.beforeAll(async () => {
    server = await startStaticServer();
    staticOrigin = `http://127.0.0.1:${server.address().port}`;
  });

  test.afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  // ?cmd=signup opens on the intro step and fires no request of its own, so the page is idle and
  // every request below is one this test asked for.
  function idlePageUrl() {
    return `${staticOrigin}/index.html?webapp=${encodeURIComponent(FAKE_WEBAPP_URL)}&cmd=signup`;
  }

  /** Attempt counter + injectable behaviour for every POST the page makes. */
  async function interceptExec(page, handler) {
    const attempts = [];
    await page.route('**/exec*', async (route) => {
      const req = route.request();
      const body = req.postData() || '';
      let action = '';
      try { action = JSON.parse(body).action || ''; } catch (e) { /* not a JSON body */ }
      attempts.push(action);
      await handler(route, action, attempts.filter((a) => a === action).length);
    });
    return attempts;
  }

  test('AC2: a read that fails below HTTP is retried once, transparently, and resolves', async ({ page }) => {
    await page.goto(idlePageUrl());
    const attempts = await interceptExec(page, async (route, action, nth) => {
      if (nth === 1) return route.abort('failed'); // exactly what a lost request looks like
      return jsonBody(route, { ok: true, matched: true, data: { team: 'Crucible' } });
    });

    const result = await page.evaluate(() => window.callApi('identify', { f3Name: 'X' }, 'signup')
      .then((res) => ({ ok: true, matched: res.matched }), (err) => ({ ok: false, message: err.message })));

    expect(result).toEqual({ ok: true, matched: true });
    expect(attempts.filter((a) => a === 'identify')).toHaveLength(2);
    await expect(page.locator('#apiErrorBanner')).toBeHidden();
  });

  test('AC1: a request whose response never arrives settles, releases the UI, and does not hang', async ({ page }) => {
    await page.goto(idlePageUrl());
    // Never fulfilled, never aborted — the exact shape observed on SIT: GAS ran the call and
    // answered, and the response never reached the browser. Before F3Go30-313u this hung forever.
    await page.route('**/exec*', () => { /* swallow */ });

    const started = Date.now();
    const settled = await page.evaluate(() => window.callApi('identify', { f3Name: 'X' }, 'signup')
      .then(() => 'resolved', (err) => 'rejected: ' + err.message), { timeout: 60000 });
    const elapsed = Date.now() - started;

    expect(settled).toContain('rejected');
    expect(settled).not.toContain('Failed to fetch');
    // Two 8s read attempts plus overhead — the point is that it settles at all, well short of
    // the forever it used to take.
    expect(elapsed).toBeLessThan(45000);
    await expect(page.locator('#checkinSyncingNote')).toBeHidden();
  });

  test('AC3: a write is never retried — a lost response may mean it landed', async ({ page }) => {
    await page.goto(idlePageUrl());
    const attempts = await interceptExec(page, async (route) => route.abort('failed'));

    const result = await page.evaluate(() => window.callApi('save', { f3Name: 'X' }, 'signup')
      .then(() => 'resolved', (err) => 'rejected'), { timeout: 60000 });

    expect(result).toBe('rejected');
    expect(attempts.filter((a) => a === 'save')).toHaveLength(1);
  });

  test('AC4: a connectivity failure reads as connectivity, with no Site-Q escalation', async ({ page }) => {
    await page.goto(idlePageUrl());
    await interceptExec(page, async (route) => route.abort('failed'));

    // Drive the real UI path, not just callApi: the PAX types a name and taps Continue.
    await page.locator('#suIntroNextBtn').click();
    await page.locator('#suF3Name').fill('TransportTest');
    await page.locator('#suEmail').fill('transporttest@example.com');
    await page.locator('#suIdentifyBtn').click();

    await expect(page.locator('#apiErrorBanner')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#apiErrorNetworkGuidance')).toBeVisible();
    await expect(page.locator('#apiErrorServerGuidance')).toBeHidden();
    await expect(page.locator('#apiErrorContactLink')).toBeHidden();
    await expect(page.locator('#apiErrorDetail')).not.toContainText('Failed to fetch');

    // AC1's real-world payoff: the PAX can try again without reloading.
    await expect(page.locator('#suIdentifyBtn')).toBeEnabled();
    await expect(page.locator('#suIdentifyBtn')).not.toHaveText(/Checking/);
    await expect(page.locator('#checkinSyncingNote')).toBeHidden();
  });

  test('AC6: a server that answers with an error keeps its message and its Site-Q escalation', async ({ page }) => {
    await page.goto(idlePageUrl());
    const attempts = await interceptExec(page, async (route) =>
      jsonBody(route, { ok: false, error: 'signup_closed_for_month' }));

    await page.locator('#suIntroNextBtn').click();
    await page.locator('#suF3Name').fill('TransportTest');
    await page.locator('#suEmail').fill('transporttest@example.com');
    await page.locator('#suIdentifyBtn').click();

    await expect(page.locator('#apiErrorBanner')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#apiErrorServerGuidance')).toBeVisible();
    await expect(page.locator('#apiErrorNetworkGuidance')).toBeHidden();
    await expect(page.locator('#apiErrorDetail')).toContainText('signup_closed_for_month');
    // A server that answered has already decided — asking it again would only double the load.
    expect(attempts.filter((a) => a === 'identify')).toHaveLength(1);
  });
});
