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

/**
 * Fills CheckinApp's identify form and submits it. As of the 2026-07 hardening work this is a
 * real <form target="_top"> POST straight to renderCheckinPageForTypedIdentify_
 * (dashboardWebapp.js) — every submission, matched or not, produces a genuine top-level
 * navigation, but a MATCHED one never shows any "welcome"/bookmark content on this page
 * directly: it immediately attempts a second, automatic redirect to the real token'd URL, and
 * only falls back to a bare step-saveLink tap-through link if that redirect doesn't fire.
 * Playwright's synthetic clicks reliably hit that fallback in headless Chromium (same
 * "activation" quirk documented on attemptTopRedirect_'s history) — this helper follows it
 * through either way and returns the iframe locator for wherever the journey actually ends
 * (step-checkin on a match, or the identify step with idError on a non-match).
 */
async function submitCheckinIdentify(page, f3Name, email) {
  const app = page.frameLocator('iframe').frameLocator('iframe');
  await app.locator('#idF3Name').fill(f3Name);
  await app.locator('#idEmail').fill(email);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }),
    app.locator('#identifyBtn').click(),
  ]);

  let app2 = page.frameLocator('iframe').frameLocator('iframe');
  const saveLink = app2.locator('#saveLinkAnchor');
  if (await saveLink.isVisible({ timeout: 5000 }).catch(() => false)) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }),
      saveLink.click(),
    ]);
    app2 = page.frameLocator('iframe').frameLocator('iframe');
  }
  return app2;
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
    // A typed-identify form POST lands on the bare exec URL (a POST body's fields never show
    // up in the address bar) and immediately attempts an automatic redirect to the real
    // token'd URL — grab that URL from wherever it actually ends up (the address bar if the
    // redirect succeeded, or step-saveLink's fallback link's href if it didn't) WITHOUT using
    // submitCheckinIdentify, which follows the fallback link through to completion — this test
    // needs the URL itself, to simulate a real bookmark reopen: a brand-new navigation straight
    // to it.
    await page.goto(checkinUrl, { waitUntil: 'networkidle' });
    await dismissGasBanner(page);
    const app0 = page.frameLocator('iframe').frameLocator('iframe');
    await app0.locator('#idF3Name').fill(CURRENT_MONTH_PAX.f3Name);
    await app0.locator('#idEmail').fill(CURRENT_MONTH_PAX.email);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }),
      app0.locator('#identifyBtn').click(),
    ]);
    let tokenUrl = page.url();
    if (!tokenUrl.includes('cmd=checkin&id=')) {
      const app1 = page.frameLocator('iframe').frameLocator('iframe');
      await expect(app1.locator('#saveLinkAnchor')).toBeVisible({ timeout: 15000 });
      tokenUrl = await app1.locator('#saveLinkAnchor').getAttribute('href');
    }
    expect(tokenUrl).toContain('cmd=checkin&id=');

    await page.goto(tokenUrl, { waitUntil: 'networkidle' });
    await dismissGasBanner(page);
    const app = page.frameLocator('iframe').frameLocator('iframe');

    // The identify form must never appear on a token'd reopen — the token round-trip
    // (SAVED_IDENTITY_TOKEN, see CheckinApp.html) bypasses it entirely.
    await expect(app.locator('#step-identify')).toBeHidden();
    await expect(app.locator('#step-checkin')).toBeVisible({ timeout: 15000 });
    await expect(app.locator('#checkinHeading')).toContainText(CURRENT_MONTH_PAX.f3Name);
  });

  test('"Not you?" returns to a blank identify form at the bare URL', async ({ page }) => {
    await page.goto(checkinUrl, { waitUntil: 'networkidle' });
    await dismissGasBanner(page);
    let app = await submitCheckinIdentify(page, CURRENT_MONTH_PAX.f3Name, CURRENT_MONTH_PAX.email);
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
  // PAX that's in PaxDB but not on the current tracker's roster — see the bead's "FIXTURE
  // DECISION" note. Established in Stage 4: LateSignupTest/latesignup@example.com signed up
  // for the "next" month (August 2026, created via createTrackerForMonth) using the normal
  // signup webapp save action, then runScanTrackers ingested that tracker into PaxDB. Being
  // registered for next-month-only (not current) is sufficient to be "known but unregistered
  // this month" — findPaxDbMatch_ searches PaxDB across every sheetId, not just prior months,
  // so this is behaviorally identical to a stale prior-month signup for this test's purposes.
  // See docs/OPERATIONS.md's fixture note for the exact setup steps (reusable — don't re-run
  // signup unless the fixture needs re-establishing).
  const LATE_SIGNUP_PAX = { f3Name: 'LateSignupTest', email: 'latesignup@example.com' };
  const KNOWN_NOT_REGISTERED_FIXTURE_READY = true;

  test('typed identify for a truly-unknown name+email shows the sign-up prompt without auto-redirecting', async ({ page }) => {
    await page.goto(checkinUrl, { waitUntil: 'networkidle' });
    await dismissGasBanner(page);
    const app = await submitCheckinIdentify(page, 'TrulyUnknownPax', 'trulyunknownpax@example.com');

    await expect(app.locator('#idError')).toBeVisible({ timeout: 15000 });
    await expect(app.locator('#idSignupBtn')).toBeVisible();
    // No PaxDB match -> no auto-redirect into signup; stays on the check-in identify step.
    expect(page.url()).not.toContain('cmd=signup');
  });

  // As of the 2026-07 hardening work, a known-but-unregistered typed identify no longer
  // auto-redirects into signup (that used attemptTopRedirect_ too — exactly the flaky
  // script-driven-navigation mechanism the form-POST identify flow exists to avoid). It's
  // treated the same as a plain non-match: idError + idSignupBtn shown, and the PAX taps
  // "Sign up" themselves — a direct click-triggered navigation (openSignup_), never flaky
  // since there's no async gap between the click and the navigation it triggers.
  // As of the later 2026-07 hardening work, a known-but-unregistered typed identify auto-
  // redirects straight into a prefilled signup — using the same immediate-on-load redirect
  // trick as the matched path (reliable because it fires the instant this fresh page loads,
  // activated by the form submission itself, not after an async gap). step-signupRedirect's
  // bare tap-through link is only the fallback for whichever browsers still decline it.
  test('typed identify for a known-but-unregistered PAX redirects into prefilled signup', async ({ page }) => {
    test.skip(!KNOWN_NOT_REGISTERED_FIXTURE_READY, 'known-but-unregistered SIT fixture not yet established — see Stage 4');
    await page.goto(checkinUrl, { waitUntil: 'networkidle' });
    await dismissGasBanner(page);
    const app = page.frameLocator('iframe').frameLocator('iframe');
    await app.locator('#idF3Name').fill(LATE_SIGNUP_PAX.f3Name);
    await app.locator('#idEmail').fill(LATE_SIGNUP_PAX.email);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }),
      app.locator('#identifyBtn').click(),
    ]);

    let app2 = page.frameLocator('iframe').frameLocator('iframe');
    const signupRedirectLink = app2.locator('#signupRedirectAnchor');
    if (await signupRedirectLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle' }),
        signupRedirectLink.click(),
      ]);
      app2 = page.frameLocator('iframe').frameLocator('iframe');
    }
    expect(page.url()).toContain('cmd=signup');
    await expect(app2.locator('#step-info')).toBeVisible({ timeout: 15000 });
    await expect(app2.locator('#infoF3Name')).toHaveText(LATE_SIGNUP_PAX.f3Name);
  });
});
