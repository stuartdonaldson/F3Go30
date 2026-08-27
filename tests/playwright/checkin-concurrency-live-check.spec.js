/**
 * Cross-day rapid-tap burst — live SIT verification (F3Go30-anbq, F3Go30-5c2a.4).
 *
 * Reproduces the exact concurrency shape from the live HAR evidence both beads cite: a PAX
 * rage-tapping BOTH Today and Yesterday buttons, interleaved, in one burst. Per-day coalescing
 * (91c8b27/174e09e) only serializes taps within one day key — this spec proves the two fixes that
 * close the gap it left open:
 *
 *   - F3Go30-5c2a.4: a GLOBAL concurrency cap (CHECKIN_MAX_CONCURRENT_) serializes checkin writes
 *     across every day key, not just within one — asserted here by counting simultaneously
 *     in-flight checkin POSTs against the live network, never more than the cap allows.
 *   - F3Go30-anbq: setButtonLoading_'s dataset.saving flag survives a renderCheckinStatus_ render
 *     landing mid-submit — asserted here by checking every button's label is a real status label,
 *     never the stuck 'Saving…' placeholder, once its disabled state has cleared.
 *
 * Reuses the same NoSadClown disposable fixture PAX and live-SIT pattern as static-checkin.spec.js.
 *
 * Usage:
 *   npx playwright test tests/playwright/checkin-concurrency-live-check.spec.js
 */
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { dismissAnnouncementIfPresent_ } = require('./live-check-helpers.js');

const ROOT = path.resolve(__dirname, '../..');
const STATIC_DIR = path.join(ROOT, 'static-pages', 'src');
const DEMO_PAX = { f3Name: 'NoSadClown', email: 'nosadclown@example.com' };
const LIVE_ROUND_TRIP_MS = 30000;

test.use({ storageState: undefined, viewport: { width: 390, height: 844 }, headless: true });
test.describe.configure({ timeout: 120000 });

function loadSettings() {
  const p = path.join(ROOT, 'local.settings.json');
  if (!fs.existsSync(p)) throw new Error('local.settings.json not found');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function isoDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
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

test.describe('Cross-day checkin burst: global concurrency cap + no stuck "Saving…" label', () => {
  let checkinUrl;
  let staticOrigin;
  let server;
  let sessionGuid;
  let todayIso;
  let yesterdayIso;
  let baselineToday;
  let baselineYesterday;

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

    const today = new Date();
    const yesterday = new Date(today.getTime() - 86400000);
    todayIso = isoDate(today);
    yesterdayIso = isoDate(yesterday);
    baselineToday = json.todayStatus || null;
    baselineYesterday = json.yesterdayStatus || null;

    server = await startStaticServer();
    staticOrigin = `http://127.0.0.1:${server.address().port}`;
  });

  test.afterAll(async ({ request }) => {
    if (server) await new Promise((resolve) => server.close(resolve));
    // Best-effort restore — the burst below deliberately leaves both days in whatever state the
    // last tap set; put the fixture PAX back where it started for the next run.
    function toValue(status) {
      return status === 'done' ? 1 : status === 'missed' ? 0 : status === 'absent' ? -1 : null;
    }
    const restoreToday = toValue(baselineToday);
    const restoreYesterday = toValue(baselineYesterday);
    if (restoreToday !== null) {
      await request.post(checkinUrl + '?cmd=checkin', {
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        data: JSON.stringify({ action: 'checkin', f3Name: DEMO_PAX.f3Name, email: DEMO_PAX.email, day: todayIso, value: restoreToday }),
        maxRedirects: 5,
      });
    }
    if (restoreYesterday !== null) {
      await request.post(checkinUrl + '?cmd=checkin', {
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        data: JSON.stringify({ action: 'checkin', f3Name: DEMO_PAX.f3Name, email: DEMO_PAX.email, day: yesterdayIso, value: restoreYesterday }),
        maxRedirects: 5,
      });
    }
  });

  function checkinPageUrl() {
    return `${staticOrigin}/index.html?webapp=${encodeURIComponent(checkinUrl)}&id=${sessionGuid}`;
  }

  test('rapid interleaved taps on Today + Yesterday: writes serialize under the global cap, no button label sticks on "Saving…"', async ({ page }) => {
    await page.goto(checkinPageUrl());
    await expect(page.locator('#step-checkin')).toBeVisible({ timeout: LIVE_ROUND_TRIP_MS });
    await dismissAnnouncementIfPresent_(page);

    // Track concurrent in-flight checkin-action writes against the LIVE network — the direct
    // proof CHECKIN_MAX_CONCURRENT_ (=1) actually serializes writes across day keys, not just
    // within one. Instrumented via page.route rather than raw request/requestfinished events:
    // Apps Script's own redirect leg (POST /exec -> 302/307 -> googleusercontent.com echo) fires
    // its OWN request/requestfinished pair, which would double-count a single logical call if
    // measured that way. route.fetch() below follows the whole redirect chain itself, so one
    // route invocation corresponds to exactly one logical checkin write, start to finish.
    let inFlight = 0;
    let maxObservedConcurrency = 0;
    const finishedCount = { value: 0 };
    await page.route('**/exec*', async (route) => {
      const req = route.request();
      const body = req.postData() || '';
      // Parse the OUTER action, not a raw substring match — a clientTelemetry upload's payload
      // embeds a NESTED `"action":"checkin"` field of its own (recording which action the sample
      // is ABOUT), which a substring match would wrongly count as a second concurrent checkin
      // write. Only the envelope's own top-level action identifies what request this really is.
      let parsedAction = '';
      try { parsedAction = JSON.parse(body).action || ''; } catch (e) { /* not JSON, ignore */ }
      if (req.method() !== 'POST' || parsedAction !== 'checkin') return route.continue();
      inFlight++;
      maxObservedConcurrency = Math.max(maxObservedConcurrency, inFlight);
      try {
        const res = await route.fetch({ maxRedirects: 5 });
        await route.fulfill({ response: res });
      } finally {
        inFlight--;
        finishedCount.value++;
      }
    });

    // Interleave taps across BOTH days with NO gap between them — dispatched from a single JS
    // turn via page.evaluate (real DOM .click() calls) rather than Playwright's own locator.click(),
    // which polls for actionability/stability between calls and can itself introduce a gap that
    // masks a real concurrency bug. Each day gets 3 taps on 3 DIFFERENT buttons (Yes/No/None) —
    // setButtonLoading_ only disables the exact button clicked, not its day-mates, so all 3 fire;
    // the LAST tap per day (None, per this ordering) is what per-day coalescing keeps queued and
    // is what must land server-side.
    const taps = [
      'todayYesBtn', 'yesterdayNoBtn', 'todayNoBtn', 'yesterdayYesBtn',
      'todayNoneBtn', 'yesterdayNoneBtn',
    ];
    await page.evaluate((ids) => {
      ids.forEach((id) => { var el = document.getElementById(id); if (el && !el.disabled) el.click(); });
    }, taps);

    // Let the whole coalesced/queued backlog drain. Under the global cap, today's 3 taps and
    // yesterday's 3 taps do NOT all settle together: only one day is ever in flight at a time, and
    // each day itself needs up to two sequential round trips (the immediate first send, then the
    // superseding queued one) — so this can take up to ~4x a single round trip end to end. Poll
    // EVERY day button, not just one per day (an early-settling button, like the immediately-sent
    // Yes button, says nothing about a button still waiting on the second, queued round trip).
    const ALL_DAY_BTN_IDS_ = [
      'todayYesBtn', 'todayNoBtn', 'todayNoneBtn',
      'yesterdayYesBtn', 'yesterdayNoBtn', 'yesterdayNoneBtn',
    ];
    await expect.poll(() => finishedCount.value, { timeout: LIVE_ROUND_TRIP_MS }).toBeGreaterThanOrEqual(taps.length > 0 ? 1 : 0);
    await expect.poll(async () => {
      const states = await page.evaluate((ids) => ids.map((id) => document.getElementById(id).disabled), ALL_DAY_BTN_IDS_);
      return states.some(Boolean);
    }, { timeout: LIVE_ROUND_TRIP_MS * 4 }).toBe(false);

    // F3Go30-5c2a.4: the cap must have held — never more than one checkin write in flight at once.
    expect(maxObservedConcurrency).toBeLessThanOrEqual(1);

    // F3Go30-anbq: once a button's disabled state clears, its label must be a real status label,
    // never the stuck 'Saving…'/'Working…' placeholder.
    const labels = {
      todayYesBtn: await page.locator('#todayYesBtn').textContent(),
      todayNoBtn: await page.locator('#todayNoBtn').textContent(),
      todayNoneBtn: await page.locator('#todayNoneBtn').textContent(),
      yesterdayYesBtn: await page.locator('#yesterdayYesBtn').textContent(),
      yesterdayNoBtn: await page.locator('#yesterdayNoBtn').textContent(),
      yesterdayNoneBtn: await page.locator('#yesterdayNoneBtn').textContent(),
    };
    for (const [id, label] of Object.entries(labels)) {
      expect(label, `#${id} label stuck mid-submit`).not.toMatch(/Saving|Working/i);
    }

    // Server-side: whatever the LAST tap for each day was must have actually landed — proves the
    // burst didn't just look clean client-side while dropping a write.
    const check = await page.request.post(checkinUrl + '?cmd=checkin', {
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      data: JSON.stringify({ action: 'identify', token: sessionGuid }),
      maxRedirects: 5,
    });
    // Per-day coalescing keeps only the LATEST queued tap per day (91c8b27/174e09e) — the last
    // tap in the `taps` array above for each day is what must have actually landed server-side:
    // last today tap = todayNoneBtn -> 'pending'; last yesterday tap = yesterdayNoneBtn -> 'pending'.
    const checkJson = await check.json();
    expect(checkJson.todayStatus).toBe('pending');
    expect(checkJson.yesterdayStatus).toBe('pending');
  });
});
