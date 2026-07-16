/**
 * Static check-in front end — CORS spike + live SIT verification (F3Go30-5nfj.2)
 *
 * Serves static-pages/index.html from a local http server on 127.0.0.1 (a genuinely
 * different origin from script.google.com / script.googleusercontent.com — the same class of
 * cross-origin boundary a real CDN-hosted deployment would have) and drives it with a real
 * browser against the live SIT web app. This IS the SPIKE the issue's AC requires: if the
 * cross-origin fetch()/response-body read didn't work, 'renders the check-in view' below would
 * never pass — a header/CORS failure surfaces as a rejected promise, not a silently empty page.
 *
 * Reuses the same NoSadClown disposable fixture PAX as checkin-advanced-grid.spec.js. This
 * page authenticates via a session guid (?id=) rather than typed f3Name/email, so beforeAll
 * mints one directly against the live identify endpoint (the same call CheckinApp.html's typed
 * form makes) before any browser is involved.
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
const STATIC_DIR = path.join(ROOT, 'static-pages');
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

  test.beforeAll(async ({ request }) => {
    const settings = loadSettings();
    const deploymentId = settings.testDeploymentId;
    if (!deploymentId || deploymentId.startsWith('<')) {
      throw new Error('testDeploymentId not set in local.settings.json — run npm run deploy:sit first');
    }
    checkinUrl = `https://script.google.com/macros/s/${deploymentId}/exec`;

    // Mint a real session guid for the fixture PAX (same call CheckinApp.html's typed-identify
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

    server = await startStaticServer();
    staticOrigin = `http://127.0.0.1:${server.address().port}`;
  });

  test.afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  test('CORS spike: cross-origin fetch reads the identify JSON and renders the check-in view', async ({ page }) => {
    const t0 = Date.now();
    await page.goto(`${staticOrigin}/index.html?webapp=${encodeURIComponent(checkinUrl)}&id=${sessionGuid}`);
    await expect(page.locator('#step-checkin')).toBeVisible({ timeout: 15000 });
    const firstPaintMs = Date.now() - t0;
    // eslint-disable-next-line no-console
    console.log(`[F3Go30-5nfj.2] static page: ?id= -> #step-checkin visible in ${firstPaintMs}ms`);

    await expect(page.locator('#headerName')).toHaveText(DEMO_PAX.f3Name);
    await expect(page.locator('#step-notfound')).toBeHidden();
  });

  test('dashboard loads via a separate deferred call after the check-in view renders', async ({ page }) => {
    let dashboardCalls = 0;
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes(checkinUrl)) {
        const body = req.postData();
        if (body && body.includes('"dashboard"')) dashboardCalls++;
      }
    });
    await page.goto(`${staticOrigin}/index.html?webapp=${encodeURIComponent(checkinUrl)}&id=${sessionGuid}`);
    await expect(page.locator('#step-checkin')).toBeVisible({ timeout: 15000 });
    // The dashboard call is deferred (fired after the check-in view already rendered), not
    // bundled into the identify response — assert it lands afterwards, not that it never fires.
    await expect(page.locator('#dashboardSummary')).not.toHaveClass(/loading/, { timeout: 15000 });
    await expect(page.locator('#dashboardSummary')).toContainText('dashboard');
    expect(dashboardCalls).toBe(1);
  });

  test('a check-in write from the static page lands in the sheet', async ({ page }) => {
    await page.goto(`${staticOrigin}/index.html?webapp=${encodeURIComponent(checkinUrl)}&id=${sessionGuid}`);
    await expect(page.locator('#step-checkin')).toBeVisible({ timeout: 15000 });

    // Use a future day from the month grid so this never fights another spec's today/yesterday
    // assertions (same isolation strategy as checkin-advanced-grid.spec.js).
    const cells = page.locator('.cal-cell:not(.pad)');
    const total = await cells.count();
    const futureCell = cells.nth(total - 1);
    const futureIso = await futureCell.getAttribute('data-date');
    const todayIso_ = isoDate(new Date());
    test.skip(futureIso < todayIso_, 'no future day available in the viewed month');

    const originalClass = await futureCell.getAttribute('class');
    const originalStatus = /st-(done|missed|pending|absent)/.exec(originalClass)[1];
    const probeStatus = originalStatus === 'missed' ? 'done' : 'missed';
    const probeBtnId = originalStatus === 'missed' ? '#selYesBtn' : '#selNoBtn';
    const restoreBtnId = { done: '#selYesBtn', missed: '#selNoBtn', pending: '#selNoneBtn', absent: '#selFailBtn' }[originalStatus];

    await futureCell.click();
    await expect(page.locator('#selectionPanel')).toBeVisible();
    await page.locator(probeBtnId).click();
    await expect(page.locator(`.cal-cell[data-date="${futureIso}"]`)).toHaveClass(new RegExp('st-' + probeStatus));

    // Verify server-side, independent of the browser, then restore.
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
