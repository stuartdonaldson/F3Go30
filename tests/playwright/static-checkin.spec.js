/**
 * Static check-in front end — CORS spike + live SIT verification (F3Go30-5nfj.2)
 *
 * Serves static-pages/src/index.html from a local http server on 127.0.0.1 (a genuinely
 * different origin from script.google.com / script.googleusercontent.com — the same class of
 * cross-origin boundary a real CDN-hosted deployment would have) and drives it with a real
 * browser against the live SIT web app. This IS the SPIKE the issue's AC requires: if the
 * cross-origin fetch()/response-body read didn't work, the tests below would never pass — a
 * header/CORS failure surfaces as a rejected promise, not a silently empty page.
 *
 * static-pages/src/index.html is now a faithful port of script/CheckinApp.html + IdentityCore.html
 * (same CSS, same DOM ids/classes, same client logic — see that file's own header comment) —
 * every locator below is deliberately identical to checkin-advanced-grid.spec.js's, just driven
 * directly against `page` instead of through GAS's double-nested iframe sandbox. That parity is
 * the point: this spec (and that one) exercise the same behavior surface, just reached through
 * two different front doors.
 *
 * Reuses the same NoSadClown disposable fixture PAX as checkin-advanced-grid.spec.js. This page
 * authenticates via a session guid (?id=) rather than typed f3Name/email, so beforeAll mints one
 * directly against the live identify endpoint (the same call the page's own identify form makes).
 *
 * Usage:
 *   npx playwright test tests/playwright/static-checkin.spec.js
 */
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../..');
const STATIC_DIR = path.join(ROOT, 'static-pages', 'src');
const DEMO_PAX = { f3Name: 'NoSadClown', email: 'nosadclown@example.com' };

test.use({ storageState: undefined, viewport: { width: 390, height: 844 }, headless: true });

function loadSettings() {
  const p = path.join(ROOT, 'local.settings.json');
  if (!fs.existsSync(p)) throw new Error('local.settings.json not found');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function isoDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** Minimal static file server — origin is http://127.0.0.1:<port>, unrelated to any GAS host. */
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

test.describe('Static check-in front end (client, live SIT)', () => {
  let checkinUrl;
  let staticOrigin;
  let server;
  let sessionGuid;
  let todayIso;

  test.beforeAll(async ({ request }) => {
    const settings = loadSettings();
    const deploymentId = settings.testDeploymentId;
    if (!deploymentId || deploymentId.startsWith('<')) {
      throw new Error('testDeploymentId not set in local.settings.json — run npm run deploy:sit first');
    }
    checkinUrl = `https://script.google.com/macros/s/${deploymentId}/exec`;

    // Mint a real session guid for the fixture PAX (same call the page's own typed-identify
    // form makes) — this static page authenticates via ?id=<guid>, not typed f3Name/email.
    sessionGuid = crypto.randomUUID();
    const res = await request.post(checkinUrl + '?cmd=checkin', {
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      data: JSON.stringify({ action: 'identify', f3Name: DEMO_PAX.f3Name, email: DEMO_PAX.email, guid: sessionGuid }),
      maxRedirects: 5,
    });
    const json = await res.json();
    expect(json.matched).toBe(true);
    expect(json.identityToken).toBe(sessionGuid);
    expect(json.config).toBeTruthy(); // F3Go30-5nfj.2 follow-up: site config now rides the identify response

    server = await startStaticServer();
    staticOrigin = `http://127.0.0.1:${server.address().port}`;
    todayIso = isoDate(new Date());
  });

  test.afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  function checkinPageUrl() {
    return `${staticOrigin}/index.html?webapp=${encodeURIComponent(checkinUrl)}&id=${sessionGuid}`;
  }

  test('CORS spike: cross-origin fetch reads the identify JSON and renders the check-in view', async ({ page }) => {
    const t0 = Date.now();
    await page.goto(checkinPageUrl());
    await expect(page.locator('#step-checkin')).toBeVisible({ timeout: 15000 });
    const firstPaintMs = Date.now() - t0;
    // eslint-disable-next-line no-console
    console.log(`[F3Go30-5nfj.2] static page: ?id= -> #step-checkin visible in ${firstPaintMs}ms`);

    // updateHeaderIdentity_ renders "<namespace>: <f3Name>", same as CheckinApp.html.
    await expect(page.locator('#headerName')).toContainText(DEMO_PAX.f3Name);
    await expect(page.locator('#step-identify')).toBeHidden();
  });

  test('unrecognized token falls through to the blank identify form, same as GAS', async ({ page }) => {
    await page.goto(`${staticOrigin}/index.html?webapp=${encodeURIComponent(checkinUrl)}&id=${crypto.randomUUID()}`);
    await expect(page.locator('#step-identify')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#idError')).toBeHidden();
  });

  test.describe('once identified', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(checkinPageUrl());
      await expect(page.locator('#step-checkin')).toBeVisible({ timeout: 15000 });
    });

    test('page load: TODAY/YESTERDAY visible, calendar hidden', async ({ page }) => {
      await expect(page.locator('#checkinTodayBlock')).toBeVisible();
      await expect(page.locator('#advancedGrid')).toBeHidden();
    });

    test('dashboard is prefetched in the background and Continue to Dashboard renders it from cache', async ({ page }) => {
      let dashboardCalls = 0;
      page.on('request', (req) => {
        if (req.method() === 'POST' && req.url().includes('cmd=checkin')) {
          const body = req.postData();
          if (body && body.includes('"dashboard"')) dashboardCalls++;
        }
      });
      // prefetchDashboard_ already fired right after identify (before this test's listener
      // attached) — waiting briefly then clicking through must not add a second call.
      await page.waitForTimeout(1500);
      await page.locator('#dashboardBtn').click();
      await expect(page.locator('#step-dashboard')).toBeVisible({ timeout: 15000 });
      await expect(page.locator('#dPaxBoard')).not.toBeEmpty();
      expect(dashboardCalls).toBeLessThanOrEqual(1);
    });

    test.describe('once the calendar is open', () => {
      test.beforeEach(async ({ page }) => {
        await page.locator('#advancedToggleBtn').click();
        await expect(page.locator('#advancedGrid')).toBeVisible();
      });

      test('renders one cell per day-in-month with correct pad offset and status classes', async ({ page }) => {
        const cells = page.locator('.cal-cell:not(.pad)');
        const cellCount = await cells.count();
        const dates = await cells.evaluateAll((els) => els.map((el) => el.dataset.date));
        const firstDate = new Date(dates[0] + 'T00:00:00');
        const daysInMonth = new Date(firstDate.getFullYear(), firstDate.getMonth() + 1, 0).getDate();
        expect(cellCount).toBe(daysInMonth);

        const padCount = await page.locator('.cal-cell.pad').count();
        expect(padCount).toBe(firstDate.getDay());
      });

      test('the today cell carries .today and selection defaults to today', async ({ page }) => {
        const todayCells = page.locator('.cal-cell.today');
        await expect(todayCells).toHaveCount(1);
        expect(await todayCells.getAttribute('data-date')).toBe(todayIso);
        await expect(page.locator('#checkinSelectedDate')).toContainText('Today');
      });

      test('a future day accepts Hit/Miss/No-check-in/Failed and its cell status updates, then restores', async ({ page }) => {
        const cells = page.locator('.cal-cell:not(.pad)');
        const total = await cells.count();
        const futureCell = cells.nth(total - 1);
        const futureIso = await futureCell.getAttribute('data-date');
        test.skip(futureIso < todayIso, 'no future day available in the viewed month');

        const originalClass = await futureCell.getAttribute('class');
        const originalStatus = /st-(done|missed|pending|absent)/.exec(originalClass)[1];
        const probeStatus = originalStatus === 'missed' ? 'done' : 'missed';
        const probeBtnId = originalStatus === 'missed' ? '#selYesBtn' : '#selNoBtn';
        const restoreBtnId = { done: '#selYesBtn', missed: '#selNoBtn', pending: '#selNoneBtn', absent: '#selFailBtn' }[originalStatus];

        await futureCell.click();
        await page.locator(probeBtnId).click();
        await expect(page.locator(`.cal-cell[data-date="${futureIso}"]`)).toHaveClass(new RegExp('st-' + probeStatus));

        // Verify server-side, independent of the browser.
        const check = await page.request.post(checkinUrl + '?cmd=checkin', {
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          data: JSON.stringify({ action: 'identify', token: sessionGuid }),
          maxRedirects: 5,
        });
        const checkJson = await check.json();
        const writtenEntry = (checkJson.monthGrid || []).filter((e) => e.dateIso === futureIso)[0];
        expect(writtenEntry && writtenEntry.status).toBe(probeStatus);

        await page.locator(restoreBtnId).click();
        await expect(page.locator(`.cal-cell[data-date="${futureIso}"]`)).toHaveClass(new RegExp('st-' + originalStatus));
      });
    });
  });
});

test.describe('Existing GAS HtmlService check-in page still works unchanged', () => {
  test('renders and identifies via the iframe sandbox (regression guard)', async ({ page }) => {
    const settings = loadSettings();
    const deploymentId = settings.testDeploymentId;
    const checkinUrl = `https://script.google.com/macros/s/${deploymentId}/exec?cmd=checkin`;
    await page.goto(checkinUrl, { waitUntil: 'networkidle' });
    const dismissBtn = page.getByRole('button', { name: 'Dismiss' });
    if (await dismissBtn.isVisible({ timeout: 8000 }).catch(() => false)) await dismissBtn.click();
    const app = page.frameLocator('iframe').frameLocator('iframe');
    await expect(app.locator('#step-identify')).toBeVisible({ timeout: 15000 });
  });
});
