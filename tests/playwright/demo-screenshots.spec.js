/**
 * Demo screenshot capture — F3Go30 demo script (Go30-Demo-Script.md)
 *
 * Drives the live SIT signup + check-in + bonus web apps as a real PAX
 * ("NoSadClown") at mobile viewport, saving screenshots for the demo doc/video.
 * These are the public-facing PAX web apps (doGet ?cmd=signup / ?cmd=checkin) —
 * no Google login required, so this spec overrides the project's storageState.
 *
 * GAS web apps render inside Google's sandboxed iframe (iframe > iframe > app
 * content) with a dismissible "created by a Google Apps Script user" banner
 * above it — every locator below goes through the nested frameLocator, and the
 * banner is dismissed once per page so it doesn't show up in screenshots.
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

const ROOT = path.resolve(__dirname, '../..');
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

async function dismissGasBanner(page) {
  const dismissBtn = page.getByRole('button', { name: 'Dismiss' });
  if (await dismissBtn.isVisible({ timeout: 8000 }).catch(() => false)) {
    await dismissBtn.click();
    await expect(dismissBtn).toBeHidden({ timeout: 5000 }).catch(() => {});
  }
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUTPUT_DIR, name), fullPage: true });
}

test.describe('Go30 demo screenshots (SIT)', () => {
  let signupUrl;
  let checkinUrl;

  test.beforeAll(() => {
    const settings = loadSettings();
    const deploymentId = settings.testDeploymentId;
    if (!deploymentId || deploymentId.startsWith('<')) {
      throw new Error('testDeploymentId not set in local.settings.json — run npm run deploy:sit first');
    }
    signupUrl = `https://script.google.com/macros/s/${deploymentId}/exec?cmd=signup`;
    checkinUrl = `https://script.google.com/macros/s/${deploymentId}/exec?cmd=checkin`;
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  });

  test('signup flow', async ({ page }) => {
    await page.goto(signupUrl, { waitUntil: 'networkidle' });
    await dismissGasBanner(page);
    const app = page.frameLocator('iframe').frameLocator('iframe');

    await shot(page, '01-signup-intro.png');

    await app.locator('#howBtn').click();
    await expect(app.locator('#howBody')).toBeVisible();
    await shot(page, '02-signup-how-it-works.png');

    await app.locator('#introNextBtn').click();
    await expect(app.locator('#step-identify')).toBeVisible();

    await app.locator('#idF3Name').fill(DEMO_PAX.f3Name);
    await app.locator('#idEmail').fill(DEMO_PAX.email);
    await app.locator('#identifyBtn').click();
    await expect(app.locator('#step-info')).toBeVisible({ timeout: 15000 });

    // Pick whichever team-type list actually contains "Crucible" on this environment.
    await app.locator('#ttAoOption').click();
    const aoHasCrucible = await app.locator('#teamAoSelect option', { hasText: DEMO_PAX.team }).count();
    if (aoHasCrucible > 0) {
      await app.locator('#teamAoSelect').selectOption({ label: DEMO_PAX.team });
    } else {
      await app.locator('#ttGoalOption').click();
      const goalHasCrucible = await app.locator('#teamGoalSelect option', { hasText: DEMO_PAX.team }).count();
      if (goalHasCrucible > 0) {
        await app.locator('#teamGoalSelect').selectOption({ label: DEMO_PAX.team });
      } else {
        await app.locator('#ttOtherOption').click();
        await app.locator('#teamOtherInput').fill(DEMO_PAX.team);
      }
    }

    await app.locator('#whoInput').fill(DEMO_PAX.who);
    await app.locator('#whatInput').fill(DEMO_PAX.what);
    await app.locator('#howInput').fill(DEMO_PAX.how);

    await shot(page, '03-signup-who-what-how.png');

    await app.locator('#infoNextBtn').click();

    // If there's a month choice step, keep the default (current) selection and save from there;
    // otherwise infoNextBtn saves directly.
    const chooseVisible = await app.locator('#step-choose').isVisible().catch(() => false);
    if (chooseVisible) {
      await shot(page, '04-signup-choose-month.png');
      await app.locator('#saveBtn').click();
    }

    await expect(app.locator('#step-done')).toBeVisible({ timeout: 15000 });
    await shot(page, '05-signup-done.png');
  });

  test('check-in, dashboard, and bonus points flow', async ({ page }) => {
    await page.goto(checkinUrl, { waitUntil: 'networkidle' });
    await dismissGasBanner(page);
    const app = page.frameLocator('iframe').frameLocator('iframe');

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

  test('check-in known-but-unregistered fallthrough into prefilled signup', async ({ page }) => {
    await page.goto(checkinUrl, { waitUntil: 'networkidle' });
    await dismissGasBanner(page);
    const app = page.frameLocator('iframe').frameLocator('iframe');

    await app.locator('#idF3Name').fill(KNOWN_NOT_REGISTERED_PAX.f3Name);
    await app.locator('#idEmail').fill(KNOWN_NOT_REGISTERED_PAX.email);
    await app.locator('#identifyBtn').click();

    // The known-but-unregistered fallback auto-redirects the whole page into a prefilled
    // signup (?cmd=signup&autoStart=1&targetMonth=current) rather than showing check-in.
    await page.waitForURL((url) => url.href.includes('cmd=signup'), { timeout: 15000 });
    await dismissGasBanner(page);
    const signupApp = page.frameLocator('iframe').frameLocator('iframe');
    await expect(signupApp.locator('#step-info')).toBeVisible({ timeout: 15000 });
    await shot(page, '06b-checkin-known-not-enrolled.png');
  });
});
