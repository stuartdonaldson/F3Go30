/**
 * Identity-token check-in flow — F3Go30-4j4o.
 *
 * Covers the bookmarkable "remember me" check-in link (script/IdentityToken.js,
 * dashboardWebapp.js's identify handler, CheckinApp.html / SignupApp.html) end to end
 * against the live SIT web apps. This flow can't be covered by tools/smokeTest.js's
 * API-only checks because its real regression risk lives in browser mechanics:
 *   - the token round-trips through a real target="_top" navigation out of the GAS
 *     sandbox iframe (attemptTopRedirect_), not a script-level redirect
 *   - a saved-link token bypasses the identify form entirely on next load
 *   - a next-month-only signup must NOT mint a token / redirect into check-in
 *     (mintIdentityToken_sw_ only runs for the current-month branch — see
 *     signupWebapp.js's handleSignupSave_)
 *
 * Uses two dedicated, idempotent test PAX distinct from the demo-screenshots PAX so the
 * two specs don't clobber each other's SIT rows. Re-running either test here re-fills the
 * existing row rather than duplicating it, same as demo-screenshots.spec.js.
 *
 * Usage:
 *   npx playwright test tests/playwright/identity-token-flow.spec.js
 */
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '../..');

const CURRENT_MONTH_PAX = {
  f3Name: 'TokenFlowTest',
  email: 'tokenflowtest@example.com',
  team: 'Crucible',
  who: 'An available, attentive and engaged partner',
  what: 'No porn, alcohol or sobriety violations. Meditate 10 minutes daily.',
  how: 'Morning meditation; daily check-in with my Go30 team, and with my partner.',
};

const NEXT_MONTH_PAX = {
  f3Name: 'TokenFlowNextMonth',
  email: 'tokenflownextmonth@example.com',
  team: 'Crucible',
  who: 'An available, attentive and engaged partner',
  what: 'No porn, alcohol or sobriety violations. Meditate 10 minutes daily.',
  how: 'Morning meditation; daily check-in with my Go30 team, and with my partner.',
};

// Public PAX web apps need no Google login, so this spec (like demo-screenshots) overrides
// the project's storageState and can run headless.
test.use({ storageState: undefined, headless: true });

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

/**
 * Waits for a token'd check-in redirect to land, whichever path it takes.
 *
 * attemptTopRedirect_ (CheckinApp.html / SignupApp.html) tries a script-driven
 * `window.top.location.href` assignment first, relying on the triggering click's "user
 * activation" still being sticky across the async API-call gap — not guaranteed on every
 * browser, and confirmed here to reliably fall back under Playwright's synthetic clicks in
 * headless Chromium. When it doesn't fire within a couple seconds, the fallback UI (a real
 * anchor tag) becomes visible instead — follow that link the same way a real user would tap it.
 */
async function followTokenRedirect(page, fallbackLinkLocator, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (/cmd=checkin&id=/.test(page.url())) return;
    if (await fallbackLinkLocator.isVisible().catch(() => false)) {
      const href = await fallbackLinkLocator.getAttribute('href');
      await page.goto(href, { waitUntil: 'networkidle' });
      return;
    }
    await page.waitForTimeout(300);
  }
  throw new Error('Neither the automatic top-redirect nor its fallback link appeared within timeout');
}

/** Fills the signup app's who/what/how + team for the given PAX up through the info step. */
async function fillSignupInfo(app, pax) {
  await app.locator('#idF3Name').fill(pax.f3Name);
  await app.locator('#idEmail').fill(pax.email);
  await app.locator('#identifyBtn').click();
  await expect(app.locator('#step-info')).toBeVisible({ timeout: 15000 });

  await app.locator('#ttAoOption').click();
  const aoHasTeam = await app.locator('#teamAoSelect option', { hasText: pax.team }).count();
  if (aoHasTeam > 0) {
    await app.locator('#teamAoSelect').selectOption({ label: pax.team });
  } else {
    await app.locator('#ttOtherOption').click();
    await app.locator('#teamOtherInput').fill(pax.team);
  }
  await app.locator('#whoInput').fill(pax.who);
  await app.locator('#whatInput').fill(pax.what);
  await app.locator('#howInput').fill(pax.how);
}

test.describe('Identity-token check-in flow (SIT)', () => {
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
  });

  test('current-month signup mints a token and redirects into check-in', async ({ page }) => {
    await page.goto(signupUrl, { waitUntil: 'networkidle' });
    await dismissGasBanner(page);
    let app = page.frameLocator('iframe').frameLocator('iframe');

    await app.locator('#howBtn').click().catch(() => {});
    const introNext = app.locator('#introNextBtn');
    if (await introNext.isVisible().catch(() => false)) await introNext.click();
    await expect(app.locator('#step-identify')).toBeVisible();

    await fillSignupInfo(app, CURRENT_MONTH_PAX);
    await app.locator('#infoNextBtn').click();

    // If a month-choice step appears, explicitly keep "current" selected and save from there.
    const chooseVisible = await app.locator('#step-choose').isVisible().catch(() => false);
    if (chooseVisible) {
      await app.locator('.month-option[data-key="current"]').click();
      await app.locator('#saveBtn').click();
    }

    // performSave_ hands off via attemptTopRedirect_ — follow either the automatic
    // top-navigation or its fallback link (see followTokenRedirect above).
    await followTokenRedirect(page, app.locator('#goToCheckinLink'));

    app = page.frameLocator('iframe').frameLocator('iframe');
    await expect(app.locator('#step-checkin')).toBeVisible({ timeout: 15000 });
    // recentlyMinted is true only in the first minute after this exact token was generated —
    // see IDENTITY_TOKEN_FRESH_WINDOW_MS_ (dashboardWebapp.js).
    await expect(app.locator('#bookmarkHereNote')).toBeVisible();
  });

  test('reopening the bookmarked token link signs in directly, with no identify form', async ({ page }) => {
    // Get a fresh token for this PAX the same way the "current-month" test does, then
    // simulate a real bookmark reopen: a brand-new navigation straight to that URL.
    await page.goto(checkinUrl, { waitUntil: 'networkidle' });
    await dismissGasBanner(page);
    let app = page.frameLocator('iframe').frameLocator('iframe');
    await app.locator('#idF3Name').fill(CURRENT_MONTH_PAX.f3Name);
    await app.locator('#idEmail').fill(CURRENT_MONTH_PAX.email);
    await app.locator('#identifyBtn').click();
    await followTokenRedirect(page, app.locator('#continueManuallyLink'));
    const tokenUrl = page.url();

    await page.goto(tokenUrl, { waitUntil: 'networkidle' });
    await dismissGasBanner(page);
    app = page.frameLocator('iframe').frameLocator('iframe');

    // The identify form must never appear on a token'd reopen — the token round-trip
    // (SAVED_IDENTITY_TOKEN, see CheckinApp.html) bypasses it entirely.
    await expect(app.locator('#step-identify')).toBeHidden();
    await expect(app.locator('#step-checkin')).toBeVisible({ timeout: 15000 });
    await expect(app.locator('#checkinHeading')).toContainText(CURRENT_MONTH_PAX.f3Name);
  });

  test('"Not you?" returns to a blank identify form at the bare URL', async ({ page }) => {
    await page.goto(checkinUrl, { waitUntil: 'networkidle' });
    await dismissGasBanner(page);
    let app = page.frameLocator('iframe').frameLocator('iframe');
    await app.locator('#idF3Name').fill(CURRENT_MONTH_PAX.f3Name);
    await app.locator('#idEmail').fill(CURRENT_MONTH_PAX.email);
    await app.locator('#identifyBtn').click();
    await followTokenRedirect(page, app.locator('#continueManuallyLink'));

    app = page.frameLocator('iframe').frameLocator('iframe');
    await expect(app.locator('#step-checkin')).toBeVisible({ timeout: 15000 });

    await app.locator('#notYouLink').click();
    await page.waitForURL((url) => url.href.includes('cmd=checkin') && !url.href.includes('id='), { timeout: 15000 });

    app = page.frameLocator('iframe').frameLocator('iframe');
    await expect(app.locator('#step-identify')).toBeVisible({ timeout: 15000 });
    await expect(app.locator('#idF3Name')).toHaveValue('');
    await expect(app.locator('#idEmail')).toHaveValue('');
  });

  test('next-month-only signup does not mint a token or redirect into check-in', async ({ page }) => {
    await page.goto(signupUrl, { waitUntil: 'networkidle' });
    await dismissGasBanner(page);
    let app = page.frameLocator('iframe').frameLocator('iframe');

    const introNext = app.locator('#introNextBtn');
    if (await introNext.isVisible().catch(() => false)) await introNext.click();
    await expect(app.locator('#step-identify')).toBeVisible();

    await fillSignupInfo(app, NEXT_MONTH_PAX);
    await app.locator('#infoNextBtn').click();

    const chooseVisible = await app.locator('#step-choose').isVisible().catch(() => false);
    const hasNextOption = chooseVisible && (await app.locator('.month-option[data-key="next"]').count()) > 0;
    test.skip(!hasNextOption, 'no next-month tracker exists on this environment — nothing to select');

    await app.locator('.month-option[data-key="next"]').click();
    await app.locator('#saveBtn').click();

    // handleSignupSave_ only mints identityToken on the current-month branch (signupWebapp.js)
    // — a next-month-only save must stay on the confirmation screen, never navigate the whole
    // page to the check-in URL.
    await expect(app.locator('#step-done')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1000); // attemptTopRedirect_'s fallback window is 400ms
    expect(page.url()).not.toContain('cmd=checkin');
  });

  // ── Known-but-not-registered-this-month fallthrough (F3Go30-xj1q.1) ──────────────────────
  // Check-in's PaxDB fallback (handleCheckinIdentify_, dashboardWebapp.js) carries a PAX known
  // to PaxDB from a prior signup — but absent from the CURRENT month's tracker — straight into
  // a prefilled signup instead of a dead-end "we couldn't find you" message. Requires a fixture
  // PAX that's in PaxDB (via a completed prior-month signup + scanTrackers) but not on the
  // current tracker's roster — see the bead's "FIXTURE DECISION" note. Not yet established as of
  // Stage 2; the plan explicitly allows deferring these to Stage 4 once the fixture exists.
  const LATE_SIGNUP_PAX = { f3Name: 'LateSignupTest', email: 'latesignup@example.com' };
  const KNOWN_NOT_REGISTERED_FIXTURE_READY = false; // flip once Stage 4 establishes the fixture

  test('typed identify for a truly-unknown name+email shows the sign-up prompt without auto-redirecting', async ({ page }) => {
    await page.goto(checkinUrl, { waitUntil: 'networkidle' });
    await dismissGasBanner(page);
    const app = page.frameLocator('iframe').frameLocator('iframe');
    await app.locator('#idF3Name').fill('TrulyUnknownPax');
    await app.locator('#idEmail').fill('trulyunknownpax@example.com');
    await app.locator('#identifyBtn').click();

    await expect(app.locator('#idError')).toBeVisible({ timeout: 15000 });
    await expect(app.locator('#idSignupBtn')).toBeVisible();
    // No PaxDB match -> no auto-redirect into signup; stays on the check-in identify step.
    await page.waitForTimeout(1000); // attemptTopRedirect_'s fallback window is 400ms
    expect(page.url()).not.toContain('cmd=signup');
  });

  test('typed identify for a known-but-unregistered PAX auto-redirects into prefilled signup', async ({ page }) => {
    test.skip(!KNOWN_NOT_REGISTERED_FIXTURE_READY, 'known-but-unregistered SIT fixture not yet established — see Stage 4');
    await page.goto(checkinUrl, { waitUntil: 'networkidle' });
    await dismissGasBanner(page);
    const app = page.frameLocator('iframe').frameLocator('iframe');
    await app.locator('#idF3Name').fill(LATE_SIGNUP_PAX.f3Name);
    await app.locator('#idEmail').fill(LATE_SIGNUP_PAX.email);
    await app.locator('#identifyBtn').click();

    await page.waitForURL((url) => url.href.includes('cmd=signup'), { timeout: 15000 });
    const app2 = page.frameLocator('iframe').frameLocator('iframe');
    await expect(app2.locator('#step-info')).toBeVisible({ timeout: 15000 });
    await expect(app2.locator('#infoF3Name')).toHaveText(LATE_SIGNUP_PAX.f3Name);
  });

  test('reopening a stale bookmark for a known-but-unregistered PAX auto-redirects into prefilled signup', async ({ page }) => {
    test.skip(!KNOWN_NOT_REGISTERED_FIXTURE_READY, 'known-but-unregistered SIT fixture not yet established — see Stage 4');
    // Get a token'd URL for the fixture PAX (whatever month it currently resolves against —
    // the token itself only carries f3Name/email, verified fresh server-side on every request).
    await page.goto(checkinUrl, { waitUntil: 'networkidle' });
    await dismissGasBanner(page);
    let app = page.frameLocator('iframe').frameLocator('iframe');
    await app.locator('#idF3Name').fill(LATE_SIGNUP_PAX.f3Name);
    await app.locator('#idEmail').fill(LATE_SIGNUP_PAX.email);
    await app.locator('#identifyBtn').click();
    await page.waitForURL((url) => url.href.includes('cmd=signup'), { timeout: 15000 });
  });
});
