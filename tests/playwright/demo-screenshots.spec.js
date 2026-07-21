/**
 * Demo screenshot capture — F3Go30 demo script (Go30-Demo-Script.md)
 *
 * Drives the live SIT signup + check-in + bonus front end as a real PAX
 * ("NoSadClown") at mobile viewport, saving screenshots for the demo doc/video.
 * No Google login required, so this spec overrides the project's storageState.
 *
 * TARGET (F3Go30-ubwl.2 follow-up): these shots are taken against the STATIC front
 * end, not the GAS-hosted SignupApp/CheckinApp they originally captured. Since a bare
 * ?cmd=signup / ?cmd=checkin now redirects out to the static page, the static UI *is*
 * what a real PAX sees — screenshotting the GAS fallback would document a screen almost
 * nobody lands on. Consequences for the locators below:
 *   - no Google sandbox iframe and no "created by a Google Apps Script user" banner, so
 *     locators are plain page.locator() rather than a nested frameLocator;
 *   - the static signup is one consolidated #step-signup with su-prefixed sub-steps
 *     (su-step-intro/-identify/-info/-choose/-done), not SignupApp.html's separate
 *     step-info/step-choose/step-done pages — see static-signup.spec.js, whose helpers
 *     this mirrors;
 *   - the flow never leaves the document, so there are no per-step navigation waits.
 *
 * The main flows are served from an ephemeral 127.0.0.1 origin (same helper as
 * static-checkin.spec.js) so they don't depend on GitHub Pages propagation. The one
 * exception is the redirect-banner test, which deliberately makes the real GAS->static
 * journey against the published page — that is the only way to capture the genuine
 * arrival state, and it doubles as an end-to-end check that the publish landed.
 *
 * Usage:
 *   npx playwright test tests/playwright/demo-screenshots.spec.js
 *
 * Runs headless (overrides the suite-wide headless:false in playwright.config.js,
 * which exists only for the GAS-editor spec's real-viewport requirement).
 *
 * Re-running: the signup step is idempotent — the signup app looks up
 * NoSadClown/nosadclown@example.com by identify and re-fills the existing
 * registration if found, so re-running this spec updates rather than duplicates
 * the SIT row.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.resolve(__dirname, '../..');
const STATIC_DIR = path.join(ROOT, 'static-pages', 'src');
const OUTPUT_DIR = path.join(ROOT, 'docs/references/demo-screenshots');

const DEMO_PAX = {
  f3Name: 'NoSadClown',
  email: 'nosadclown@example.com',
  team: 'Crucible',
  who: 'An available, attentive and engaged partner',
  what: 'No porn, alcohol or sobriety violations. Meditate 10 minutes daily.',
  how: 'Morning meditation; daily check-in with my Go30 team, and with my partner.',
};

const BONUS_ENTRY = {
  type: 'EHing FNG',
  message: "Brought Splinter out to the Hawk's Nest AO this morning",
  link: 'https://f3cascades.slack.com/archives/C0A18QD4MD5/p1234567890',
};

const BONUS_ENTRY_EDITED = {
  message: "Brought Splinter out to the Hawk's Nest AO this morning (edited during demo)",
};

// Known-but-not-registered-this-month fallthrough fixture (F3Go30-xj1q.1) — same fixture PAX
// as tests/playwright/identity-token-flow.spec.js. Registered for "next" month only (not
// current), so check-in's PaxDB fallback treats them as known-but-unregistered. See
// docs/OPERATIONS.md's fixture note for how this PAX was established.
const KNOWN_NOT_REGISTERED_PAX = { f3Name: 'LateSignupTest', email: 'latesignup@example.com' };

// Public PAX web apps need no Google login and no real-viewport GAS editor
// interactions, so unlike the rest of the suite this spec can run headless.
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

/**
 * Follows GAS's renderStaticRedirect_ interstitial (WebApp.js) out to the static origin,
 * whichever path it takes.
 *
 * NOTE this is NOT a headless-Chromium artifact, unlike attemptTopRedirect_'s gesture-initiated
 * hop. renderStaticRedirect_'s `window.top.location.replace` runs on load with no user
 * activation at all, and GAS serves it in an iframe sandboxed
 * `allow-top-navigation-by-user-activation` — so Chrome refuses it for EVERY visitor, always
 * ("Unsafe attempt to initiate navigation... has no user activation"). The `<a id="go">`
 * tap-through is therefore the only path any real PAX has, which is why this helper follows it
 * rather than waiting for a bounce that never comes. Tracked separately as a product defect;
 * this helper documents current behaviour, it does not endorse it.
 * HtmlService output, so the anchor sits inside Google's nested sandbox iframes.
 */
async function followStaticRedirect(page, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (new URL(page.url()).origin !== 'https://script.google.com') return;
    const go = page.frameLocator('iframe').frameLocator('iframe').locator('#go');
    if (await go.isVisible().catch(() => false)) {
      const href = await go.getAttribute('href');
      await page.goto(href, { waitUntil: 'networkidle' });
      return;
    }
    await page.waitForTimeout(300);
  }
  throw new Error('Neither the automatic static redirect nor its tap-through link appeared within timeout');
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUTPUT_DIR, name), fullPage: true });
}

test.describe('Go30 demo screenshots (SIT)', () => {
  let execUrl;
  let gasCheckinUrl;
  let staticOrigin;
  let server;

  test.beforeAll(async () => {
    const settings = loadSettings();
    const deploymentId = settings.testDeploymentId;
    if (!deploymentId || deploymentId.startsWith('<')) {
      throw new Error('testDeploymentId not set in local.settings.json — run npm run deploy:sit first');
    }
    execUrl = `https://script.google.com/macros/s/${deploymentId}/exec`;
    // Bare (no &static=0) on purpose — the redirect-banner test wants the real redirect.
    gasCheckinUrl = `${execUrl}?cmd=checkin`;
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    server = await startStaticServer();
    staticOrigin = `http://127.0.0.1:${server.address().port}`;
  });

  test.afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  function signupPageUrl() {
    return `${staticOrigin}/index.html?webapp=${encodeURIComponent(execUrl)}&cmd=signup`;
  }

  function checkinPageUrl() {
    return `${staticOrigin}/index.html?webapp=${encodeURIComponent(execUrl)}`;
  }

  test('signup flow', async ({ page }) => {
    await page.goto(signupPageUrl());
    await expect(page.locator('#step-signup')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#su-step-intro')).toBeVisible();

    await shot(page, '01-signup-intro.png');

    // On the static intro "How it works" is a link out to a standalone page (target=_blank),
    // not SignupApp.html's in-page #howBtn/#howBody accordion — #howBtn does exist on this
    // page but belongs to the dashboard step, so clicking it here would never become visible.
    // Screenshot the destination page directly rather than driving a popup.
    const howHref = await page.locator('#su-step-intro a[href="how-it-works.html"]').getAttribute('href');
    await page.goto(`${staticOrigin}/${howHref}`);
    await shot(page, '02-signup-how-it-works.png');
    await page.goBack();
    await expect(page.locator('#su-step-intro')).toBeVisible({ timeout: 15000 });

    await page.locator('#suIntroNextBtn').click();
    await expect(page.locator('#su-step-identify')).toBeVisible();

    await page.locator('#suF3Name').fill(DEMO_PAX.f3Name);
    await page.locator('#suEmail').fill(DEMO_PAX.email);
    await page.locator('#suIdentifyBtn').click();
    await expect(page.locator('#su-step-info')).toBeVisible({ timeout: 15000 });

    // "Other" free-text rather than probing the AO/goal selects: the static signup uses the
    // same su-prefixed team block static-signup.spec.js drives, and the demo team name only
    // needs to render, not to resolve to a real configured team on this environment.
    await page.locator('#suTtOtherOption').click();
    await page.locator('#suTeamOtherInput').fill(DEMO_PAX.team);
    await page.locator('#suWhoInput').fill(DEMO_PAX.who);
    await page.locator('#suWhatInput').fill(DEMO_PAX.what);
    await page.locator('#suHowInput').fill(DEMO_PAX.how);

    await shot(page, '03-signup-who-what-how.png');

    await page.locator('#suInfoNextBtn').click();

    // If there's a month choice step, keep the current selection and save from there;
    // otherwise suInfoNextBtn saves directly.
    const chooseVisible = await page.locator('#su-step-choose').isVisible().catch(() => false);
    if (chooseVisible) {
      await shot(page, '04-signup-choose-month.png');
      await page.locator('.month-option[data-key="current"]').click();
      await page.locator('#suSaveBtn').click();
    }

    await expect(page.locator('#su-step-done')).toBeVisible({ timeout: 15000 });
    await shot(page, '05-signup-done.png');
  });

  // F3Go30-ubwl.3: the arrival a PAX following an old ?cmd=checkin bookmark actually gets —
  // GAS's renderStaticRedirect_ interstitial bounces them to the static page with ?from=gas,
  // which raises the "this link has moved, update your bookmark" advisory. Unlike every other
  // test here this one uses the real published page (that is where the redirect points), so it
  // also serves as an end-to-end check that the deploy's static publish actually landed.
  test('GAS redirect landing shows the update-your-bookmark banner', async ({ page }) => {
    await page.goto(gasCheckinUrl, { waitUntil: 'networkidle' });

    // The interstitial itself is a screen a real PAX sees, so capture it before tapping through.
    await expect(page.frameLocator('iframe').frameLocator('iframe').locator('#go')).toBeVisible({ timeout: 15000 });
    await shot(page, '00a-gas-moved-interstitial.png');

    await followStaticRedirect(page);

    expect(new URL(page.url()).origin).not.toBe('https://script.google.com');
    await expect(page.locator('#gasMovedBanner')).toBeVisible({ timeout: 15000 });
    // The advisory outlives its trigger: index.html strips ?from=gas as soon as the banner
    // renders, so that a PAX who bookmarks straight from the address bar doesn't carry the
    // marker forward and get nagged forever on a URL that has already moved.
    expect(new URL(page.url()).searchParams.has('from')).toBe(false);
    await shot(page, '00-gas-redirect-bookmark-banner.png');
  });

  test('check-in, dashboard, and bonus points flow', async ({ page }) => {
    await page.goto(checkinPageUrl());
    await expect(page.locator('#step-identify')).toBeVisible({ timeout: 15000 });

    // Typed identify resolves in place on the static page (applyIdentifySuccess_ patches the
    // URL to a bookmarkable ?id=), so there is no navigation and no tap-through fallback link
    // to chase the way the GAS page needed.
    const app = page;
    await app.locator('#idF3Name').fill(DEMO_PAX.f3Name);
    await app.locator('#idEmail').fill(DEMO_PAX.email);
    await app.locator('#identifyBtn').click();
    await expect(app.locator('#step-checkin')).toBeVisible({ timeout: 15000 });

    await shot(page, '06-checkin.png');

    // Only click "Did it" if today isn't already recorded (idempotent re-run).
    const todayYesEnabled = await app.locator('#todayYesBtn').isEnabled().catch(() => false);
    if (todayYesEnabled) {
      await app.locator('#todayYesBtn').click();
      await page.waitForTimeout(1000);
      await shot(page, '07-checkin-recorded.png');
    }

    // F3Go30-th22: Advanced whole-month check-in calendar + unified selection panel.
    await app.locator('#advancedToggleBtn').click();
    await expect(app.locator('#advancedGrid')).toBeVisible();
    await shot(page, '07b-checkin-advanced-calendar.png');
    await app.locator('#advancedToggleBtn').click(); // close it back — leaves the page in its default state
    await expect(app.locator('#advancedGrid')).toBeHidden();

    await app.locator('#dashboardBtn').click();
    await expect(app.locator('#step-dashboard')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(500); // let charts/rings finish drawing
    await shot(page, '08-dashboard.png');

    await app.locator('#bonusBtn').click();
    await expect(app.locator('#step-bonus')).toBeVisible({ timeout: 15000 });
    await shot(page, '09-bonus-list.png');

    await app.locator('#bonusAddBtn').click();
    await expect(app.locator('#bonusFormCard')).toBeVisible();
    await app.locator('#bonusType').selectOption({ label: BONUS_ENTRY.type });
    await app.locator('#bonusMessage').fill(BONUS_ENTRY.message);
    await app.locator('#bonusLink').fill(BONUS_ENTRY.link);
    await shot(page, '10-bonus-add-form.png');

    await app.locator('#bonusSaveBtn').click();
    await expect(app.locator('#bonusFormCard')).toBeHidden({ timeout: 15000 });
    await expect(app.locator('#bonusList')).toContainText(BONUS_ENTRY.message, { timeout: 15000 });
    await shot(page, '11-bonus-added.png');

    const entry = app.locator('.bonus-entry', { hasText: BONUS_ENTRY.message }).first();
    await entry.locator('.bonus-edit-btn').click();
    await expect(app.locator('#bonusFormCard')).toBeVisible();
    await expect(app.locator('#bonusFormHeading')).toHaveText('Edit Bonus');
    await shot(page, '12-bonus-edit-form.png');

    await app.locator('#bonusMessage').fill(BONUS_ENTRY_EDITED.message);
    await shot(page, '13-bonus-edit-form-filled.png');

    await app.locator('#bonusSaveBtn').click();
    await expect(app.locator('#bonusFormCard')).toBeHidden({ timeout: 15000 });
    await expect(app.locator('#bonusList')).toContainText(BONUS_ENTRY_EDITED.message, { timeout: 15000 });
    await shot(page, '14-bonus-edited.png');
  });

  // Read-only: never saves, so KNOWN_NOT_REGISTERED_PAX's fixture state is left untouched.
  test('check-in known-but-unregistered fallthrough into prefilled signup', async ({ page }) => {
    await page.goto(checkinPageUrl());
    await expect(page.locator('#step-identify')).toBeVisible({ timeout: 15000 });

    await page.locator('#idF3Name').fill(KNOWN_NOT_REGISTERED_PAX.f3Name);
    await page.locator('#idEmail').fill(KNOWN_NOT_REGISTERED_PAX.email);
    await page.locator('#identifyBtn').click();

    // applyTypedIdentifyResult_'s knownPaxNotRegistered branch calls openSignup_('current')
    // in place, so there is no intermediate redirect screen to capture — the GAS flow's
    // 06b step-signupRedirect shot has no static equivalent and is intentionally dropped.
    await expect(page.locator('#step-signup')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#su-step-info')).toBeVisible({ timeout: 15000 });
    await shot(page, '06c-checkin-known-not-enrolled-signup.png');
  });
});
