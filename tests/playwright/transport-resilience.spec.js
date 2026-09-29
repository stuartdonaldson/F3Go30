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
    // 3-attempt read contract (F3Go30-5c2a.9, superseding F3Go30-313u's "retry exactly once").
    // Only the FIRST attempt is swallowed (never fulfilled, never aborted -- the exact shape
    // observed on SIT: GAS answered and the response never reached the browser), which proves
    // the real AbortController timeout fires. Attempts 2 and 3 are aborted immediately, so the
    // test costs one 12s timeout rather than 3 x 12s and stays under the H4 30s ceiling.
    const attempts = await interceptExec(page, async (route, action, nth) => {
      if (nth === 1) return; // swallow
      return route.abort('failed');
    });

    const started = Date.now();
    const settled = await page.evaluate(() => window.callApi('identify', { f3Name: 'X' }, 'signup')
      .then(() => 'resolved', (err) => 'rejected: ' + err.message), { timeout: 60000 });
    const elapsed = Date.now() - started;

    expect(settled).toContain('rejected');
    expect(settled).not.toContain('Failed to fetch');
    expect(attempts.filter((a) => a === 'identify')).toHaveLength(3);
    expect(elapsed).toBeLessThan(25000);
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
  // ── F3Go30-5c2a.7 AC9: a transport-failed check-in is confirmed by read-back ───────────────
  // The node harness (test/test_client_write_confirm.js) covers the loop's every branch; this is
  // the same behaviour through the real UI, real fetch and real routing. Fully intercepted. The
  // dropped checkin POST aborts at once (route.abort) rather than hanging for the 25s write
  // timeout, which keeps both scenarios well inside the H4 ceiling.
  function isoToday_() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function identifyResponse_(todayIso) {
    return {
      ok: true, matched: true, f3Name: 'ConfirmTest', email: 'confirmtest@example.com',
      monthLabel: 'This month', todayStatus: 'pending', yesterdayStatus: 'pending', yesterdayAvailable: false,
      goals: {}, monthGrid: [{ dateIso: todayIso, status: 'pending' }],
      availableMonths: [], registeredMonthKeys: [], nextMonthRegistered: true,
    };
  }

  /** Opens the check-in step with identify answered, then a checkin POST that is dropped and a
   * monthGrid read-back answered by `monthGridStatus` (held until `gate` resolves, if given). */
  async function openCheckinWithDroppedWrite_(page, monthGridStatus, gate) {
    const todayIso = isoToday_();
    await page.goto(`${staticOrigin}/index.html?webapp=${encodeURIComponent(FAKE_WEBAPP_URL)}`);
    const attempts = await interceptExec(page, async (route, action) => {
      if (action === 'identify') return jsonBody(route, identifyResponse_(todayIso));
      if (action === 'checkin') return route.abort('failed');
      if (action === 'monthGrid') {
        if (gate) await gate;
        return jsonBody(route, { ok: true, registered: true, monthGrid: [{ dateIso: todayIso, status: monthGridStatus }] });
      }
      return jsonBody(route, { ok: true });
    });
    await page.locator('#idF3Name').fill('ConfirmTest');
    await page.locator('#idEmail').fill('confirmtest@example.com');
    await page.locator('#identifyBtn').click();
    await expect(page.locator('#step-checkin')).toBeVisible({ timeout: 15000 });
    // Records whether the error banner is EVER shown, not just whether it is shown at the end.
    await page.evaluate(() => {
      window.__bannerEverShown = false;
      const b = document.getElementById('apiErrorBanner');
      new MutationObserver(() => { if (!b.classList.contains('hidden')) window.__bannerEverShown = true; })
        .observe(b, { attributes: true, attributeFilter: ['class'] });
    });
    return attempts;
  }

  test('5c2a.7 AC9: a check-in whose response was dropped but whose write landed shows no error banner', async ({ page }) => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const attempts = await openCheckinWithDroppedWrite_(page, 'done', gate);

    await page.locator('#todayYesBtn').click();
    // While the read-back is outstanding: the calm notice, never the red banner, and the button is free.
    await expect(page.locator('#writeConfirmNotice')).toBeVisible();
    await expect(page.locator('#apiErrorBanner')).toBeHidden();
    await expect(page.locator('#todayYesBtn')).toBeEnabled();
    release();

    await expect(page.locator('#todayYesBtn')).toHaveClass(/current/);
    await expect(page.locator('#writeConfirmNotice')).toBeHidden();
    await expect(page.locator('#apiErrorBanner')).toBeHidden();
    expect(await page.evaluate(() => window.__bannerEverShown)).toBe(false);
    expect(attempts.filter((a) => a === 'checkin')).toHaveLength(1); // the write is never replayed
    expect(attempts).toContain('monthGrid');
  });

  test('5c2a.7 AC9: a check-in whose response was dropped and whose write did NOT land shows the banner and reverts', async ({ page }) => {
    const attempts = await openCheckinWithDroppedWrite_(page, 'pending');

    await page.locator('#todayYesBtn').click();

    await expect(page.locator('#apiErrorBanner')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#apiErrorHeadline')).toHaveText('Couldn’t reach the server.');
    await expect(page.locator('#apiErrorNetworkGuidance')).toBeVisible();
    await expect(page.locator('#todayYesBtn')).not.toHaveClass(/current/);
    await expect(page.locator('#writeConfirmNotice')).toBeHidden();
    expect(attempts.filter((a) => a === 'checkin')).toHaveLength(1);
  });
});
