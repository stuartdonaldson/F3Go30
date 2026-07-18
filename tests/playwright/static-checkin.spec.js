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
 * F3Go30-5nfj.5 adds two client-side fixes, tested below via new top-level test() blocks (not
 * nested under 'once identified', since each needs precise control over localStorage's starting
 * state — a fresh page context per test() already gives blank storage, and go30CheckinSnapshot:v1
 * is seeded/cleared explicitly where each scenario needs it):
 *   1. Write-through dashboard-cache race fix — submitCheckin_/submitSelectionCheckin_ call
 *      applyOwnDayWrite_ synchronously, before the checkin POST's own round trip completes, so a
 *      click-then-immediately-navigate-to-dashboard sequence reflects the write on first paint
 *      regardless of whether prefetchDashboard_'s background load has landed yet.
 *   2. localStorage instant-paint + reconciliation (static-pages only — script/CheckinApp.html
 *      has its own server-side pre-render instead, no localStorage mechanism at all) — a valid,
 *      non-expired, today-present snapshot in localStorage['go30CheckinSnapshot:v1'] paints
 *      #step-checkin immediately, before the live identify fetch resolves; the live response then
 *      reconciles anything not written locally this pageview, and a matched:false response clears
 *      the snapshot and falls back to the blank identify form.
 *   3. Reload-after-write-during-in-flight-identify race — locallyWrittenIso is now set
 *      synchronously (alongside applyOwnDayWrite_), before the checkin POST's own round trip
 *      completes, so a still-in-flight identify from page load can't reconcile/persist the stale
 *      pre-write value into the snapshot. Covered by the 'race: check-in write fired while a
 *      stale in-flight identify is still pending' test below, which delays only the identify
 *      response via page.route so it's guaranteed to resolve after the checkin write fires.
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

  test('typed identify lands the address bar on a bookmarkable ?id= URL', async ({ page }) => {
    // No ?id= on load — this exercises the fetch-based typed-identify path (identifyForm's
    // submit handler), which has no real navigation to land the browser on a token'd URL the
    // way GAS's real form POST does — applyIdentifySuccess_ must patch the URL itself instead.
    await page.goto(`${staticOrigin}/index.html?webapp=${encodeURIComponent(checkinUrl)}`);
    await expect(page.locator('#step-identify')).toBeVisible({ timeout: 15000 });
    expect(new URL(page.url()).searchParams.get('id')).toBeNull();

    await page.locator('#idF3Name').fill(DEMO_PAX.f3Name);
    await page.locator('#idEmail').fill(DEMO_PAX.email);
    await page.locator('#identifyBtn').click();
    await expect(page.locator('#step-checkin')).toBeVisible({ timeout: 15000 });

    const idParam = new URL(page.url()).searchParams.get('id');
    expect(idParam).toBeTruthy();

    // Reloading that exact URL (simulating a reopened bookmark) must skip the identify form
    // entirely — the whole point of landing on a token'd URL in the first place.
    await page.reload();
    await expect(page.locator('#step-checkin')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#headerName')).toContainText(DEMO_PAX.f3Name);
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

  // ── F3Go30-5nfj.5: write-through dashboard-cache race fix ─────────────────────────────────
  test('cold cache, click Hit/Miss immediately (racing the background prefetch), advance to dashboard -> dashboard reflects the write on first paint', async ({ page }) => {
    function countOutcomes(dayValues) {
      var out = { done: 0, missed: 0, absent: 0 };
      (dayValues || []).forEach((v) => {
        if (v === 1) out.done++;
        else if (v === 0) out.missed++;
        else if (v === -1) out.absent++;
      });
      return out;
    }

    // Baseline server truth, independent of the browser — same 'dashboard' action the page's own
    // loadDashboard_ calls (script/dashboardWebapp.js handleCheckinDashboard_).
    const baseline = await page.request.post(checkinUrl + '?cmd=checkin', {
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      data: JSON.stringify({ action: 'dashboard', f3Name: DEMO_PAX.f3Name, email: DEMO_PAX.email, dateISO: todayIso }),
      maxRedirects: 5,
    });
    const baseJson = await baseline.json();
    const todayIdx = (baseJson.dayDates || []).indexOf(todayIso);
    expect(todayIdx).toBeGreaterThanOrEqual(0);
    const originalValue = baseJson.dayValues[todayIdx];
    test.skip(originalValue === -1, 'today is marked Failed server-side — self checkin cannot probe/restore that value');

    const probeValue = originalValue === 1 ? 0 : 1; // a real state change either way
    const probeBtnId = probeValue === 1 ? '#todayYesBtn' : '#todayNoBtn';
    const restoreBtnId = originalValue === 1 ? '#todayYesBtn' : originalValue === 0 ? '#todayNoBtn' : '#todayNoneBtn';

    const expectedValues = baseJson.dayValues.slice(0, todayIdx + 1);
    expectedValues[todayIdx] = probeValue;
    const expectedOutcomes = countOutcomes(expectedValues);
    const expectedScoreSubHtml = expectedOutcomes.done + ' hits<br>' + expectedOutcomes.missed + ' misses<br>' + expectedOutcomes.absent + ' fails';

    // Genuinely cold: fresh page context (this spec's test.use({storageState: undefined}) already
    // guarantees blank localStorage per test, but clear explicitly so this test's intent survives
    // any future harness config change).
    await page.goto(checkinPageUrl());
    await page.evaluate((k) => localStorage.clear(), 'go30CheckinSnapshot:v1');
    await expect(page.locator('#step-checkin')).toBeVisible({ timeout: 15000 });

    // Race the background prefetch: no waitForTimeout between these two clicks — prefetchDashboard_
    // (fired at the end of applyIdentifySuccess_, just before #step-checkin became visible above)
    // may or may not have landed yet.
    await page.locator(probeBtnId).click();
    await page.locator('#dashboardBtn').click();

    await expect(page.locator('#step-dashboard')).toBeVisible({ timeout: 15000 });
    await expect.poll(() => page.locator('#dScoreSub').innerHTML(), { timeout: 15000 }).toBe(expectedScoreSubHtml);

    // Restore original status so repeated runs don't accumulate drift on the shared fixture PAX.
    await page.locator('#dMonthProgressTile').click();
    await expect(page.locator('#step-checkin')).toBeVisible({ timeout: 15000 });
    await page.locator(restoreBtnId).click();
    await expect.poll(async () => {
      const check = await page.request.post(checkinUrl + '?cmd=checkin', {
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        data: JSON.stringify({ action: 'dashboard', f3Name: DEMO_PAX.f3Name, email: DEMO_PAX.email, dateISO: todayIso }),
        maxRedirects: 5,
      });
      const checkJson = await check.json();
      return checkJson.dayValues[todayIdx];
    }, { timeout: 15000 }).toBe(originalValue);
  });
});

// ── F3Go30-5nfj.5: localStorage instant-paint + reconciliation (static-pages only) ──────────
test.describe('Static check-in front end: localStorage snapshot instant paint (F3Go30-5nfj.5)', () => {
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

    sessionGuid = crypto.randomUUID();
    const res = await request.post(checkinUrl + '?cmd=checkin', {
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      data: JSON.stringify({ action: 'identify', f3Name: DEMO_PAX.f3Name, email: DEMO_PAX.email, guid: sessionGuid }),
      maxRedirects: 5,
    });
    const json = await res.json();
    expect(json.matched).toBe(true);

    server = await startStaticServer();
    staticOrigin = `http://127.0.0.1:${server.address().port}`;
    todayIso = isoDate(new Date());
  });

  test.afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  function checkinPageUrl(token) {
    return `${staticOrigin}/index.html?webapp=${encodeURIComponent(checkinUrl)}&id=${token || sessionGuid}`;
  }

  test('warm localStorage snapshot paints #step-checkin instantly, before the live identify call resolves', async ({ page }) => {
    // Populate a real snapshot from a normal prior visit (saveCheckinSnapshot_ fires once the live
    // token-identify response lands — wait for #checkinSyncingNote to clear as proof it landed).
    await page.goto(checkinPageUrl());
    await expect(page.locator('#step-checkin')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#checkinSyncingNote')).toBeHidden({ timeout: 15000 });
    const snapshotRaw = await page.evaluate((k) => localStorage.getItem(k), 'go30CheckinSnapshot:v1');
    expect(snapshotRaw).toBeTruthy();

    // Delay only the live identify round trip so the instant paint below is observably ahead of it.
    await page.route('**/exec*', async (route) => {
      const req = route.request();
      const body = req.postData() || '';
      if (req.method() === 'POST' && body.includes('"action":"identify"')) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
      await route.continue();
    });

    const t0 = Date.now();
    await page.goto(checkinPageUrl());
    // Short, explicit windows — proving the paint happened BEFORE the 3s-delayed identify could
    // possibly have landed, not just relying on the default long timeout.
    await expect(page.locator('#step-checkin')).toBeVisible({ timeout: 500 });
    await expect(page.locator('#checkinSyncingNote')).toBeVisible({ timeout: 500 });
    expect(Date.now() - t0).toBeLessThan(3000);
    await expect(page.locator('#step-tokenLoading')).toBeHidden();

    // Once the delayed live response lands, the syncing note clears and checkin stays visible.
    await expect(page.locator('#checkinSyncingNote')).toBeHidden({ timeout: 15000 });
    await expect(page.locator('#step-checkin')).toBeVisible();
  });

  test('race: check-in write fired while a stale in-flight identify is still pending -> snapshot ends up with the post-write value once syncing completes (F3Go30-5nfj.5 regression)', async ({ page }) => {
    // Populate a real snapshot from a normal prior visit.
    await page.goto(checkinPageUrl());
    await expect(page.locator('#step-checkin')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#checkinSyncingNote')).toBeHidden({ timeout: 15000 });

    const snapshot = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), 'go30CheckinSnapshot:v1');
    expect(snapshot).toBeTruthy();
    const todayEntry = (snapshot.monthGrid || []).find((e) => e.dateIso === todayIso);
    expect(todayEntry).toBeTruthy();
    const originalStatus = todayEntry.status;
    const originalValue = originalStatus === 'done' ? 1 : originalStatus === 'missed' ? 0 : originalStatus === 'absent' ? -1 : null;
    const probeStatus = originalStatus === 'missed' ? 'done' : 'missed';
    const probeBtnId = probeStatus === 'done' ? '#todayYesBtn' : '#todayNoBtn';

    try {
      // Delay only the identify round trip so it's guaranteed to resolve AFTER the checkin write
      // below fires — reproduces the exact race fixed in F3Go30-5nfj.5: reconcileWithLocalWrites_
      // and saveCheckinSnapshot_ run off this delayed identify's .then(), so if locallyWrittenIso
      // weren't set synchronously (before the checkin write's own round trip), this identify could
      // beat it and persist the stale pre-write value.
      await page.route('**/exec*', async (route) => {
        const req = route.request();
        const body = req.postData() || '';
        if (req.method() === 'POST' && body.includes('"action":"identify"')) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
        await route.continue();
      });

      await page.goto(checkinPageUrl());
      await expect(page.locator('#step-checkin')).toBeVisible({ timeout: 500 });
      await expect(page.locator('#checkinSyncingNote')).toBeVisible({ timeout: 500 });

      // Fire the checkin write immediately — while the delayed identify is still in flight.
      await page.locator(probeBtnId).click();

      // Wait for the delayed identify to resolve (syncing note clears) — this is the moment
      // reconcileWithLocalWrites_/saveCheckinSnapshot_ run against the in-flight identify response.
      await expect(page.locator('#checkinSyncingNote')).toBeHidden({ timeout: 15000 });

      // No further navigation/reload — assert the snapshot the syncing identify just persisted
      // already reflects the write, proving locallyWrittenIso protected it during reconciliation.
      const finalSnapshot = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), 'go30CheckinSnapshot:v1');
      const finalEntry = (finalSnapshot.monthGrid || []).find((e) => e.dateIso === todayIso);
      expect(finalEntry.status).toBe(probeStatus);
    } finally {
      await page.unroute('**/exec*');
      await page.request.post(checkinUrl + '?cmd=checkin', {
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        data: JSON.stringify({ action: 'checkin', f3Name: DEMO_PAX.f3Name, email: DEMO_PAX.email, day: todayIso, value: originalValue }),
        maxRedirects: 5,
      });
    }
  });

  test('server data changed since the last visit -> stale snapshot paints first, then updates to match the live response with no manual refresh', async ({ page }) => {
    function statusToValue(status) {
      return status === 'done' ? 1 : status === 'missed' ? 0 : status === 'absent' ? -1 : null;
    }

    // Populate a real snapshot from a normal prior visit.
    await page.goto(checkinPageUrl());
    await expect(page.locator('#step-checkin')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#checkinSyncingNote')).toBeHidden({ timeout: 15000 });
    const snapshot = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), 'go30CheckinSnapshot:v1');
    expect(snapshot).toBeTruthy();

    // A future day (not today) so we don't disturb today's fixture state — same pattern as the
    // existing calendar test's future-day probe.
    const futureEntry = (snapshot.monthGrid || []).slice().reverse().find((e) => e.dateIso > todayIso);
    test.skip(!futureEntry, 'no future day available in the viewed month');
    const futureIso = futureEntry.dateIso;
    const originalStatus = futureEntry.status;
    const probeStatus = originalStatus === 'missed' ? 'done' : 'missed';
    const probeValue = statusToValue(probeStatus);

    // Change the server out of band — no browser navigation, no snapshot update — so the stale
    // snapshot the next reload paints from genuinely diverges from the live server.
    const write = await page.request.post(checkinUrl + '?cmd=checkin', {
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      data: JSON.stringify({ action: 'checkin', f3Name: DEMO_PAX.f3Name, email: DEMO_PAX.email, day: futureIso, value: probeValue }),
      maxRedirects: 5,
    });
    expect((await write.json()).ok).toBe(true);

    try {
      // Reload: paints instantly from the now-stale snapshot (still showing originalStatus).
      await page.goto(checkinPageUrl());
      await expect(page.locator('#step-checkin')).toBeVisible({ timeout: 15000 });

      await page.locator('#advancedToggleBtn').click();
      await expect(page.locator('#advancedGrid')).toBeVisible();

      // Polls (toHaveClass) until the live identify response reconciles the calendar — no manual
      // refresh performed by this test, matching the AC's "no manual refresh needed".
      await expect(page.locator(`.cal-cell[data-date="${futureIso}"]`)).toHaveClass(new RegExp('st-' + probeStatus), { timeout: 15000 });
    } finally {
      const restoreValue = statusToValue(originalStatus);
      await page.request.post(checkinUrl + '?cmd=checkin', {
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        data: JSON.stringify({ action: 'checkin', f3Name: DEMO_PAX.f3Name, email: DEMO_PAX.email, day: futureIso, value: restoreValue }),
        maxRedirects: 5,
      });
    }
  });

  test('revoked/invalid token with a stale localStorage snapshot still present -> falls back to the identify form, snapshot cleared', async ({ page }) => {
    // Seed a well-formed snapshot (reusing a real one's shape from a normal prior visit — full
    // control while staying representative) but with a token that matches no live session.
    await page.goto(checkinPageUrl());
    await expect(page.locator('#step-checkin')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#checkinSyncingNote')).toBeHidden({ timeout: 15000 });
    const snapshot = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), 'go30CheckinSnapshot:v1');
    expect(snapshot).toBeTruthy();

    const bogusToken = crypto.randomUUID();
    await page.evaluate(([k, snap, token]) => {
      snap.token = token;
      snap.savedAt = Date.now();
      localStorage.setItem(k, JSON.stringify(snap));
    }, ['go30CheckinSnapshot:v1', snapshot, bogusToken]);

    const t0 = Date.now();
    await page.goto(checkinPageUrl(bogusToken));
    // loadCheckinSnapshot_ only checks token-matches-URL-param, TTL, and today-in-monthGrid — not
    // server validity — so this still paints instantly, briefly showing the (stale/bogus) identity.
    await expect(page.locator('#step-checkin')).toBeVisible({ timeout: 1000 });
    // eslint-disable-next-line no-console
    console.log(`[F3Go30-5nfj.5] bogus-token snapshot painted #step-checkin in ${Date.now() - t0}ms`);

    // Once the live identify call resolves matched:false for the bogus token, falls back to the
    // blank identify form and the stale snapshot is cleared.
    await expect(page.locator('#step-identify')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#step-checkin')).toBeHidden();
    const remaining = await page.evaluate((k) => localStorage.getItem(k), 'go30CheckinSnapshot:v1');
    expect(remaining).toBeNull();
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
