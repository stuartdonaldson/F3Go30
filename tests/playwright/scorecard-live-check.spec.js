/**
 * Scorecard screen (HIM Ladder + Top Teams) — live SIT verification (F3Go30-enwp).
 *
 * The Scorecard screen is built entirely from the dashboard payload already cached client-side
 * (state.board — see openScorecard_/renderScorecard_, static-pages/src/index.html) rather than a
 * new endpoint, so the meaningful thing a unit test can't reach is: does it actually render real
 * roster data from a live dashboard load, for both the HIM Ladder and Top Teams views, against
 * SIT's real (multi-team) roster.
 *
 * Reuses the same local-static-server + real-session-guid pattern as static-checkin.spec.js /
 * checkin-concurrency-live-check.spec.js.
 *
 * Usage:
 *   npm run deploy:sit
 *   npx playwright test tests/playwright/scorecard-live-check.spec.js
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

test.describe('Scorecard screen (client, live SIT)', () => {
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
  });

  test.afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  function checkinPageUrl() {
    return `${staticOrigin}/index.html?webapp=${encodeURIComponent(checkinUrl)}&id=${sessionGuid}`;
  }

  test('Menu -> Scorecard renders HIM Ladder and Top Teams from the real SIT roster', async ({ page }) => {
    await page.goto(checkinPageUrl());
    await expect(page.locator('#step-checkin')).toBeVisible({ timeout: LIVE_ROUND_TRIP_MS });
    await dismissAnnouncementIfPresent_(page);

    await page.locator('#dashboardBtn').click();
    await expect(page.locator('#step-dashboard')).toBeVisible({ timeout: LIVE_ROUND_TRIP_MS });
    await expect(page.locator('#dPaxBoard')).not.toBeEmpty();

    // Menu -> Scorecard (AC1)
    await page.locator('#headerIdentityBtn').click();
    await expect(page.locator('#settingsModal')).toBeVisible();
    await expect(page.locator('#settingsScorecardBtn')).toBeEnabled();
    await page.locator('#settingsScorecardBtn').click();
    await expect(page.locator('#step-scorecard')).toBeVisible({ timeout: LIVE_ROUND_TRIP_MS });

    // HIM Ladder view is the default sub-view (AC2): a ranked row per PAX, a 3-up podium, and the
    // viewer's own row present and highlighted.
    await expect(page.locator('#scTabLadder')).toHaveClass(/on/);
    const ladderRows = page.locator('#scLadder .sc-lrow');
    await expect(ladderRows.first()).toBeVisible({ timeout: LIVE_ROUND_TRIP_MS });
    expect(await ladderRows.count()).toBeGreaterThan(0);
    expect(await page.locator('#scPodium .sc-plinth').count()).toBeGreaterThan(0);
    await expect(page.locator('#scLadder .sc-lrow.me')).toHaveCount(1);

    // Switching the ranking metric re-sorts without erroring (AC2's metric toggle).
    await page.locator('#scMetrics .sc-metric-btn', { hasText: 'Workout days' }).click();
    await expect(ladderRows.first()).toBeVisible();

    // Top Teams view (AC3): one row per team, each carrying a roster-size chip and an avg score.
    await page.locator('#scTabTeams').click();
    await expect(page.locator('#scTabTeams')).toHaveClass(/on/);
    const teamRows = page.locator('#scTeams .sc-lrow');
    await expect(teamRows.first()).toBeVisible({ timeout: LIVE_ROUND_TRIP_MS });
    const teamCount = await teamRows.count();
    expect(teamCount).toBeGreaterThan(0);
    await expect(teamRows.first().locator('.sc-tchip')).toContainText('PAX');
    await expect(teamRows.first().locator('.sc-lscore')).not.toBeEmpty();

    // Back returns to the dashboard, not a dead end (HEADER_BACK_TARGET_.scorecard).
    await page.locator('#headerBackBtn').click();
    await expect(page.locator('#step-dashboard')).toBeVisible();
  });
});
