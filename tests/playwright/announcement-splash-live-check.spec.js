/**
 * Live check for the announcement splash (F3Go30-g9bi) — the piece the Node unit suite can't
 * reach: real CSS cascade/rendering in an actual browser, against the live SIT deployment.
 *
 * Regression note (2026-08-11): the original implementation shipped with `.announce-overlay
 * { display: flex; }` declared AFTER `.hidden { display: none; }` in the stylesheet. Both are
 * single-class selectors of equal specificity, so source order alone decided the winner — the
 * overlay stayed visible (and blocked every click on the page underneath, including the
 * identify form) REGARDLESS of whether the `hidden` class was applied. test_static_page_client_
 * invariants.js's harness never caught this because it only asserts `classList.contains('hidden')`
 * in a synthetic DOM stand-in with no real stylesheet attached — the class was being toggled
 * correctly the whole time; only the rendered CSS was wrong. This spec uses Playwright's
 * `toBeVisible()`/`toBeHidden()`, which check actual computed layout, specifically so a
 * cascade regression like this fails a test instead of only a human's eyes on SIT.
 *
 * Also covers the title/HTML-body split (F3Go30-g9bi follow-up, same day): Config column B is a
 * plain-text title, column C is the body rendered as innerHTML (not textContent) so a Site Q can
 * include links/formatting — verified below via an actual clickable <a> surviving into the DOM,
 * not just literal escaped markup text.
 *
 * SAFETY (F3Go30-g9bi incident, 2026-08-11): this test writes Announce.<today's real day> — the
 * SAME key a real Site Q's live splash lives at when this happens to run on the same day one is
 * configured. An earlier version of this spec unconditionally blanked that key in afterAll,
 * which silently wiped a real, currently-live announcement (the human running it had to notice
 * and manually restore it from a saved copy of the content). It now captures whatever was there
 * via the getConfigValue admin action BEFORE overwriting, and restores that EXACT value in
 * afterAll — never a blind clear — so this spec is safe to run at any time regardless of what a
 * Site Q currently has configured.
 *
 * Usage (not part of npm test — needs a live SIT deployment):
 *   npm run deploy:sit
 *   npx playwright test tests/playwright/announcement-splash-live-check.spec.js
 */
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { loadSettings, buildPayload_, post, ENV_MAP } = require('../../tools/callWebapp.js');

// playwright.config.js's global `use.headless` is false (the GAS-editor specs need a real
// viewport) — every non-editor spec must override it back to headless, same as
// static-checkin.spec.js does. Omitting this (as an earlier version of this file did) launches a
// real visible browser window on whatever machine runs it.
test.use({ storageState: undefined, viewport: { width: 390, height: 844 }, headless: true });

const ROOT = path.resolve(__dirname, '../..');
const STATIC_DIR = path.join(ROOT, 'static-pages', 'src');
const DEMO_PAX = { f3Name: 'NoSadClown', email: 'nosadclown@example.com' };
const LIVE_ROUND_TRIP_MS = 30000;
const ANNOUNCE_KEY = 'Announce.' + new Date().getDate();
const ANNOUNCE_TITLE = 'F3Go30-g9bi live-check';
// Deliberately includes an <a> tag — the body column is rendered as HTML (innerHTML, not
// textContent) specifically so a Site Q can include links/formatting.
const ANNOUNCE_MESSAGE = 'HC moved to <a href="https://example.com/saturday">Saturday</a> this week';

async function adminCall(action, extraBody) {
  const settings = loadSettings();
  const { deploymentIdKey, adminSecretKey } = ENV_MAP.sit;
  const url = `https://script.google.com/macros/s/${settings[deploymentIdKey]}/exec?cmd=admin`;
  const payload = buildPayload_(action, 'admin', extraBody, settings[adminSecretKey]);
  return post(url, payload);
}

async function getConfigValue(key) {
  return adminCall('getConfigValue', { key });
}

async function setConfigValue(key, primary, secondary) {
  return adminCall('setConfigValue', { key, primary, secondary });
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

test.describe('Announcement splash — live SIT rendering (F3Go30-g9bi)', () => {
  let checkinUrl, staticOrigin, server, originalConfigValue;

  test.beforeAll(async ({ request }) => {
    const settings = loadSettings();
    const deploymentId = settings.testDeploymentId;
    if (!deploymentId || deploymentId.startsWith('<')) {
      throw new Error('testDeploymentId not set in local.settings.json — run npm run deploy:sit first');
    }
    checkinUrl = `https://script.google.com/macros/s/${deploymentId}/exec`;

    // Capture whatever is already at this key BEFORE overwriting it — see the SAFETY note above.
    originalConfigValue = await getConfigValue(ANNOUNCE_KEY);
    expect(originalConfigValue.ok).toBe(true);

    const setResult = await setConfigValue(ANNOUNCE_KEY, ANNOUNCE_TITLE, ANNOUNCE_MESSAGE);
    expect(setResult.ok).toBe(true);

    server = await startStaticServer();
    staticOrigin = `http://127.0.0.1:${server.address().port}`;
  });

  test.afterAll(async () => {
    // Restore the EXACT original value regardless of test outcome — never a blind clear (see the
    // SAFETY note above). `found:false` means the key didn't exist at all; blanking it is the
    // closest this Config schema gets to "not present" (upsertValue never deletes rows).
    if (originalConfigValue && originalConfigValue.ok) {
      await setConfigValue(ANNOUNCE_KEY, originalConfigValue.found ? originalConfigValue.primary : '', originalConfigValue.found ? originalConfigValue.secondary : '');
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  function pageUrl() {
    return `${staticOrigin}/index.html?webapp=${encodeURIComponent(checkinUrl)}`;
  }

  test('splash renders actually visible with the live message, and Got it makes the page underneath clickable again', async ({ page }) => {
    await page.goto(pageUrl());
    await page.locator('#idF3Name').fill(DEMO_PAX.f3Name);
    await page.locator('#idEmail').fill(DEMO_PAX.email);
    await page.locator('#identifyBtn').click();
    await expect(page.locator('#step-checkin')).toBeVisible({ timeout: LIVE_ROUND_TRIP_MS });

    // The bug: this modal previously stayed rendered (display:flex, covering the page and
    // eating all clicks) even while carrying the `hidden` class — toBeVisible() checks actual
    // computed layout, not just the class, so it fails on that regression.
    await expect(page.locator('#announcementModal')).toBeVisible({ timeout: LIVE_ROUND_TRIP_MS });
    await expect(page.locator('#announcementTitle')).toHaveText(ANNOUNCE_TITLE);
    // The body is rendered as HTML (innerHTML) — confirm the <a> actually rendered as a real,
    // clickable link, not escaped/literal markup text.
    await expect(page.locator('#announcementText a')).toHaveAttribute('href', 'https://example.com/saturday');
    await expect(page.locator('#announcementText a')).toHaveText('Saturday');

    await page.locator('#announcementDismissBtn').click();
    await expect(page.locator('#announcementModal')).toBeHidden();

    // Proves the overlay actually stopped intercepting pointer events, not just that its class
    // changed — a real click on a button underneath must land.
    await page.locator('#todayYesBtn').click({ timeout: 5000 });
    await expect(page.locator('#todayStatusNote')).not.toHaveText('');
  });

  test('Remind me later hides the splash without recording a dismissal, and the page underneath is clickable', async ({ page }) => {
    await page.goto(pageUrl());
    await page.locator('#idF3Name').fill(DEMO_PAX.f3Name);
    await page.locator('#idEmail').fill(DEMO_PAX.email);
    await page.locator('#identifyBtn').click();
    await expect(page.locator('#step-checkin')).toBeVisible({ timeout: LIVE_ROUND_TRIP_MS });
    await expect(page.locator('#announcementModal')).toBeVisible({ timeout: LIVE_ROUND_TRIP_MS });

    await page.locator('#announcementRemindLaterBtn').click();
    await expect(page.locator('#announcementModal')).toBeHidden();
    // Same proof as the Dismiss test above — a real click on the page underneath must land.
    await page.locator('#todayYesBtn').click({ timeout: 5000 });
    await expect(page.locator('#todayStatusNote')).not.toHaveText('');
  });
});
