/**
 * Advanced whole-month check-in grid — client + server contract tests (F3Go30-th22.3)
 *
 * Exercises the Test surface fixed in F3Go30-th22.1's design (calendar + unified selection
 * panel, superseding the original per-day-row layout). Reuses the same live-SIT NoSadClown
 * fixture PAX as demo-screenshots.spec.js (an idempotent signup with a real current-month
 * Tracker row).
 *
 * TARGET (F3Go30-ubwl.2 follow-up): this spec drives the STATIC front end, not the GAS-hosted
 * CheckinApp.html it originally targeted. Once a bare `?cmd=checkin` began redirecting out to
 * the static page, the grid a real PAX actually touches is the static one — so that is what
 * this coverage is worth having against. The static page ships the identical grid markup
 * (#advancedGrid / #advancedToggleBtn / .cal-cell …, static-pages/src/index.html), so every
 * assertion below is unchanged; only the setup differs. Two consequences:
 *   - no sandboxed iframe, so `app` is just the page itself rather than a nested frameLocator;
 *   - the page authenticates by `?id=<guid>` (minted once in beforeAll, same call the typed
 *     identify form makes) instead of re-typing name+email and riding a form POST per test.
 * The GAS fallback page keeps its own coverage in static-checkin.spec.js's `?static=0`
 * regression guard and identity-token-flow.spec.js's fallback describe (ADR-018).
 *
 * Served from an ephemeral 127.0.0.1 origin exactly as static-checkin.spec.js does, which also
 * keeps the cross-origin call path honest — the page fetches the real SIT /exec endpoint.
 *
 * Client tests write only to days OTHER than today/yesterday (an explicit past day fixture and
 * a future day near month-end) so they never fight demo-screenshots.spec.js's own today/
 * yesterday assertions, and each write test restores the cell to its original value afterwards
 * so re-running this spec (or the whole suite) never accumulates state.
 *
 * Server-contract tests (describe block below) hit the deployed web app directly over HTTP,
 * bypassing the browser entirely — same request shape as IdentityCore.html's callApi().
 *
 * Usage:
 *   npx playwright test tests/playwright/checkin-advanced-grid.spec.js
 */
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../..');
const STATIC_DIR = path.join(ROOT, 'static-pages', 'src');

// NoSadClown is a disposable automation-only fixture (same one demo-screenshots.spec.js drives
// destructively via real check-ins/bonus edits) — safe to write to and clear here too.
const DEMO_PAX = { f3Name: 'NoSadClown', email: 'nosadclown@example.com' };

// Public PAX web apps need no Google login and no real-viewport GAS editor interactions.
test.use({ storageState: undefined, viewport: { width: 390, height: 844 }, headless: true });

function loadSettings() {
  const p = path.join(ROOT, 'local.settings.json');
  if (!fs.existsSync(p)) throw new Error('local.settings.json not found');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
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

function isoDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

test.describe('Advanced calendar grid (client, live SIT)', () => {
  let execUrl;
  let staticOrigin;
  let server;
  let sessionGuid;
  let app;
  let todayIso;

  test.beforeAll(async ({ request }) => {
    const settings = loadSettings();
    const deploymentId = settings.testDeploymentId;
    if (!deploymentId || deploymentId.startsWith('<')) {
      throw new Error('testDeploymentId not set in local.settings.json — run npm run deploy:sit first');
    }
    execUrl = `https://script.google.com/macros/s/${deploymentId}/exec`;

    // Mint one real session guid for the fixture PAX up front — the static page authenticates
    // by ?id=<guid>, so per-test typed identify (and its form POST) is unnecessary here.
    sessionGuid = crypto.randomUUID();
    const res = await request.post(execUrl + '?cmd=checkin', {
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      data: JSON.stringify({ action: 'identify', f3Name: DEMO_PAX.f3Name, email: DEMO_PAX.email, guid: sessionGuid }),
      maxRedirects: 5,
    });
    const json = await res.json();
    expect(json.matched).toBe(true);

    server = await startStaticServer();
    staticOrigin = `http://127.0.0.1:${server.address().port}`;
  });

  test.afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(`${staticOrigin}/index.html?webapp=${encodeURIComponent(execUrl)}&id=${sessionGuid}`);
    // Flat DOM on the static front end — no sandbox iframe to reach through.
    app = page;
    await expect(app.locator('#step-checkin')).toBeVisible({ timeout: 15000 });
    todayIso = isoDate(new Date());
  });

  // Test surface #13 — pre-th22 default view for anyone who never opens the calendar.
  test('page load: TODAY/YESTERDAY visible, calendar hidden', async () => {
    await expect(app.locator('#checkinTodayBlock')).toBeVisible();
    await expect(app.locator('#advancedGrid')).toBeHidden();
  });

  // Test surface #14 — toggle mutual exclusivity, both directions.
  test('toggling the calendar hides TODAY/YESTERDAY and reverses on close', async () => {
    await app.locator('#advancedToggleBtn').click();
    await expect(app.locator('#advancedGrid')).toBeVisible();
    await expect(app.locator('#checkinTodayBlock')).toBeHidden();

    await app.locator('#advancedToggleBtn').click();
    await expect(app.locator('#advancedGrid')).toBeHidden();
    await expect(app.locator('#checkinTodayBlock')).toBeVisible();
  });

  // Test surface #12 — first expand renders from memory, no extra callApi call.
  test('opening the calendar issues no additional API call', async ({ page }) => {
    let postCount = 0;
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('cmd=checkin')) postCount++;
    });
    await app.locator('#advancedToggleBtn').click();
    await expect(app.locator('#advancedGrid')).toBeVisible();
    await page.waitForTimeout(500);
    expect(postCount).toBe(0);
  });

  test.describe('once the calendar is open', () => {
    test.beforeEach(async () => {
      await app.locator('#advancedToggleBtn').click();
      await expect(app.locator('#advancedGrid')).toBeVisible();
    });

    // Test surface #1, #2 — row count / pad-cell weekday alignment / status classes.
    test('renders one cell per day-in-month with correct pad offset and status classes', async () => {
      const cells = app.locator('.cal-cell:not(.pad)');
      const cellCount = await cells.count();
      const dates = await cells.evaluateAll((els) => els.map((el) => el.dataset.date));
      // days-in-month for whichever month is being viewed
      const firstDate = new Date(dates[0] + 'T00:00:00');
      const daysInMonth = new Date(firstDate.getFullYear(), firstDate.getMonth() + 1, 0).getDate();
      expect(cellCount).toBe(daysInMonth);

      const padCount = await app.locator('.cal-cell.pad').count();
      expect(padCount).toBe(firstDate.getDay());

      // every non-pad cell carries a recognized status class matching one of the 4 states
      const classLists = await cells.evaluateAll((els) => els.map((el) => el.className));
      classLists.forEach((cls) => {
        expect(cls).toMatch(/\bst-(done|missed|pending|absent)\b/);
      });
    });

    // Test surface #4 — .today / .selected exclusivity.
    test('the today cell carries .today and the selected day carries .selected, exactly one each', async () => {
      const todayCells = app.locator('.cal-cell.today');
      await expect(todayCells).toHaveCount(1);
      expect(await todayCells.getAttribute('data-date')).toBe(todayIso);

      const selectedCells = app.locator('.cal-cell.selected');
      await expect(selectedCells).toHaveCount(1);
    });

    // Test surface #7 — default selection on open.
    test('selection defaults to today and the panel reflects todayStatus', async () => {
      const selectedCells = app.locator('.cal-cell.selected');
      expect(await selectedCells.getAttribute('data-date')).toBe(todayIso);
      await expect(app.locator('#checkinSelectedDate')).toContainText('Today');
    });

    // Test surface #8 — #selFailBtn date gate; the other 3 buttons are never disabled.
    test('#selFailBtn is disabled for today, enabled once a strictly-past day is selected', async () => {
      await expect(app.locator('#selFailBtn')).toBeDisabled();
      await expect(app.locator('#selYesBtn')).toBeEnabled();
      await expect(app.locator('#selNoBtn')).toBeEnabled();
      await expect(app.locator('#selNoneBtn')).toBeEnabled();

      const targetCell = app.locator('.cal-cell:not(.pad)').first(); // day 1 of the viewed month
      const targetIso = await targetCell.getAttribute('data-date');
      test.skip(targetIso >= todayIso, 'no strictly-past day available in the viewed month to assert against');
      await targetCell.click();
      await expect(app.locator('#selFailBtn')).toBeEnabled();
      await expect(app.locator('#selYesBtn')).toBeEnabled();
    });

    // Test surface #5 — click selects without a full re-render (only 2 cells' classLists change)
    // and without any callApi call.
    test('clicking a cell moves .selected without a full re-render or any API call', async ({ page }) => {
      let postCount = 0;
      page.on('request', (req) => {
        if (req.method() === 'POST' && req.url().includes('cmd=checkin')) postCount++;
      });

      const cells = app.locator('.cal-cell:not(.pad)');
      const total = await cells.count();
      const oldIso = await app.locator('.cal-cell.selected').getAttribute('data-date');
      const target = cells.nth(total - 1); // last day of month — reliably different from today
      const newIso = await target.getAttribute('data-date');
      test.skip(newIso === oldIso, 'last day of month happens to already be selected');

      await target.click();
      await expect(app.locator(`.cal-cell[data-date="${newIso}"]`)).toHaveClass(/selected/);
      await expect(app.locator(`.cal-cell[data-date="${oldIso}"]`)).not.toHaveClass(/selected/);
      await expect(app.locator('#checkinSelectedDate')).not.toContainText('Today');
      await page.waitForTimeout(300);
      expect(postCount).toBe(0);
    });

    // Test surface #6, #9 — a future day is fully editable; correct payload per button.
    // NoSadClown is a shared, repeatedly-exercised live fixture — this captures whatever value
    // the target cell already holds and restores it afterwards, rather than assuming a baseline,
    // so this test never clobbers real state left by another spec run.
    test('a future day accepts Hit/Miss/No-check-in and its cell status updates optimistically', async ({ page }) => {
      // last day of the viewed month is >= today for the currently-open (current) month
      const cells = app.locator('.cal-cell:not(.pad)');
      const total = await cells.count();
      const futureCell = cells.nth(total - 1);
      const futureIso = await futureCell.getAttribute('data-date');
      test.skip(futureIso < todayIso, 'no future day available in the viewed month');

      const originalClass = await futureCell.getAttribute('class');
      const originalStatus = /st-(done|missed|pending|absent)/.exec(originalClass)[1];
      const originalValue = { done: 1, missed: 0, pending: null, absent: -1 }[originalStatus];

      await futureCell.click();
      await expect(app.locator('#selFailBtn')).toBeDisabled(); // never settable for a future day

      let lastPayload = null;
      await page.route('**/exec?cmd=checkin*', async (route) => {
        lastPayload = JSON.parse(route.request().postData());
        await route.continue();
      });

      // pick whichever of Hit/Miss differs from the current status, so the click is observable
      const probeBtn = originalStatus === 'missed' ? '#selYesBtn' : '#selNoBtn';
      const probeValue = originalStatus === 'missed' ? 1 : 0;
      const probeStatus = originalStatus === 'missed' ? 'done' : 'missed';
      await app.locator(probeBtn).click();
      await expect(app.locator(probeBtn)).toHaveClass(/current/);
      expect(lastPayload).toMatchObject({ f3Name: DEMO_PAX.f3Name, day: futureIso, value: probeValue });
      await expect(app.locator(`.cal-cell[data-date="${futureIso}"]`)).toHaveClass(new RegExp('st-' + probeStatus));

      // restore the cell's original value so re-running the suite leaves no residue
      const restoreBtn = { done: '#selYesBtn', missed: '#selNoBtn', pending: '#selNoneBtn', absent: '#selFailBtn' }[originalStatus];
      await app.locator(restoreBtn).click();
      expect(lastPayload).toMatchObject({ day: futureIso, value: originalValue });
      await expect(app.locator(`.cal-cell[data-date="${futureIso}"]`)).toHaveClass(new RegExp('st-' + originalStatus));

      await page.unroute('**/exec?cmd=checkin*');
    });

    // Test surface #3 — the ✕ mark renders only on an 'absent' cell, and only there. Captures
    // the target cell's original value and restores it afterwards (see note above).
    test('marking a past day Failed renders the ✕ mark on that cell, and clearing it removes it', async () => {
      const pastCell = app.locator('.cal-cell:not(.pad)').first(); // day 1 of the viewed month
      const pastIso = await pastCell.getAttribute('data-date');
      test.skip(pastIso >= todayIso, 'no strictly-past day available in the viewed month');

      const originalClass = await pastCell.getAttribute('class');
      const originalStatus = /st-(done|missed|pending|absent)/.exec(originalClass)[1];
      test.skip(originalStatus === 'absent', 'target cell is already Failed — nothing to observe');
      const originalValue = { done: 1, missed: 0, pending: null }[originalStatus];
      const restoreBtn = { done: '#selYesBtn', missed: '#selNoBtn', pending: '#selNoneBtn' }[originalStatus];

      await pastCell.click();
      await expect(app.locator('#selFailBtn')).toBeEnabled();
      const beforeXMarks = await app.locator('.cal-cell .x-mark').count();
      await app.locator('#selFailBtn').click();
      await expect(app.locator('#selFailBtn')).toHaveClass(/current/);
      await expect(app.locator(`.cal-cell[data-date="${pastIso}"]`)).toHaveClass(/st-absent/);
      await expect(app.locator(`.cal-cell[data-date="${pastIso}"] .x-mark`)).toBeVisible();
      // exactly one net-new ✕ mark appeared — this single-cell update didn't touch any other cell
      await expect(app.locator('.cal-cell .x-mark')).toHaveCount(beforeXMarks + 1);

      // revert to the cell's original value so re-running the suite leaves no residue
      await app.locator(restoreBtn).click();
      await expect(app.locator(`.cal-cell[data-date="${pastIso}"]`)).toHaveClass(new RegExp('st-' + originalStatus));
      await expect(app.locator(`.cal-cell[data-date="${pastIso}"] .x-mark`)).toHaveCount(0);
    });
  });
});

test.describe('handleCheckinSubmit_ write contract (direct API, no browser)', () => {
  let checkinUrl;
  let ns;
  let contextDate;

  test.beforeAll(() => {
    const settings = loadSettings();
    const deploymentId = settings.testDeploymentId;
    if (!deploymentId || deploymentId.startsWith('<')) {
      throw new Error('testDeploymentId not set in local.settings.json — run npm run deploy:sit first');
    }
    checkinUrl = `https://script.google.com/macros/s/${deploymentId}/exec?cmd=checkin`;
    ns = '';
    contextDate = '';
  });

  async function submit(request, body) {
    const res = await request.post(checkinUrl, {
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      data: JSON.stringify({ action: 'checkin', f3Name: DEMO_PAX.f3Name, email: DEMO_PAX.email, ns, contextDate, ...body }),
      maxRedirects: 5,
    });
    return res.json();
  }

  function isoDaysFromToday(delta) {
    const d = new Date();
    d.setDate(d.getDate() + delta);
    return isoDate(d);
  }

  // Test surface #10 — explicit ISO date write for a future date accepts 1/0/null.
  test('an explicit future ISO date accepts value 1/0/null and round-trips {ok:true}', async ({ request }) => {
    const futureIso = isoDaysFromToday(12);
    const setMiss = await submit(request, { day: futureIso, value: 0 });
    expect(setMiss).toMatchObject({ ok: true });
    const clear = await submit(request, { day: futureIso, value: null });
    expect(clear).toMatchObject({ ok: true });
  });

  // Test surface #10 — malformed/unmatched dates are rejected.
  test('a malformed day string is rejected with invalid_day', async ({ request }) => {
    const res = await submit(request, { day: 'tomorrow', value: 1 });
    expect(res).toEqual({ ok: false, error: 'invalid_day' });
  });

  test('an out-of-range explicit date not on this Tracker is rejected with day_column_not_found', async ({ request }) => {
    const res = await submit(request, { day: '1999-01-01', value: 1 });
    expect(res.ok).toBe(false);
    expect(['day_column_not_found', 'not_found']).toContain(res.error);
  });

  // Test surface #11 — -1 is rejected for today and any future date, even posted directly.
  test('value -1 is rejected with invalid_value for today and for a future date', async ({ request }) => {
    const todayIso_ = isoDate(new Date());
    const resToday = await submit(request, { day: todayIso_, value: -1 });
    expect(resToday).toEqual({ ok: false, error: 'invalid_value' });

    const futureIso = isoDaysFromToday(9);
    const resFuture = await submit(request, { day: futureIso, value: -1 });
    expect(resFuture).toEqual({ ok: false, error: 'invalid_value' });
  });

  // Test surface #11 (round-trip) — -1 IS accepted for a genuinely past date, then cleared.
  test('value -1 is accepted for a strictly-past date and round-trips to absent, then clears', async ({ request }) => {
    const pastIso = isoDaysFromToday(-2);
    const setAbsent = await submit(request, { day: pastIso, value: -1 });
    expect(setAbsent).toMatchObject({ ok: true });
    const revert = await submit(request, { day: pastIso, value: null });
    expect(revert).toMatchObject({ ok: true });
  });

  // Regression — existing today/yesterday literals still work with the widened contract.
  test('regression: day="today"/"yesterday" literals still accept 1/0/null and round-trip ok', async ({ request }) => {
    for (const day of ['today', 'yesterday']) {
      for (const value of [1, 0, null]) {
        const res = await submit(request, { day, value });
        expect(res).toMatchObject({ ok: true });
      }
      // leave the fixture PAX's today/yesterday cleared afterwards
      await submit(request, { day, value: null });
    }
  });

  test('an invalid value is rejected with invalid_value for the "today" literal (regression)', async ({ request }) => {
    const res = await submit(request, { day: 'today', value: 2 });
    expect(res).toEqual({ ok: false, error: 'invalid_value' });
  });
});
