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
 * SCOPE (F3Go30-bkxg), after F3Go30-833s.11 made bare `?cmd=signup` redirect to the static
 * signup by default: this spec's job is split into two describes below —
 *   1. 'GAS signup fallback (?static=0)' — the two tests that navigate straight to
 *      `?cmd=signup` force the `&static=0` opt-out (buildStaticSignupRedirectUrl_,
 *      Utilities.js) so they keep driving the GAS-hosted SignupApp.html end to end. This is
 *      deliberate availability-fallback coverage (ADR-018), not incidental — the opt-out is
 *      what makes it possible to still test the fallback UI at all now that it's no longer
 *      what a real PAX's bare link lands on by default.
 *   2. 'Check-in flow + GAS→static signup handoff' — everything that stays inside
 *      `?cmd=checkin` (no `static=0` needed; these never touch signup), plus the one test
 *      that follows check-in's own signupDeepLinkUrl_ hop (CheckinApp.html) into the static
 *      signup. That hop has no `static=0` opt-out of its own, so it always lands on the
 *      static origin on SIT — this spec asserts only that the handoff URL and landing are
 *      correct; the resulting signup UI's own behavior is static-signup.spec.js's job (see
 *      its "month-boundary: known-but-unregistered PAX..." test, which drives that same UI
 *      from a direct static-origin entry).
 *
 * Usage:
 *   npx playwright test tests/playwright/identity-token-flow.spec.js
 */
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

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
 *
 * F3Go30-bkxg: SignupApp.html's post-save handoff (buildCheckinUrl_) has preferred the static
 * check-in front end whenever it's configured since before F3Go30-833s.11 (the static check-in
 * page shipped in v2.4.0) — confirmed live that on SIT this always fires, landing outside the
 * GAS origin entirely. That destination URL carries `id=<token>` but never `cmd=checkin` (it's
 * the static page's default view, buildStaticCheckinUrl_ never sets `cmd`), so "arrived" is
 * recognized by either the GAS URL shape OR having left script.google.com with an id= in tow.
 */
function checkinHandoffArrived_(url) {
  if (/cmd=checkin&id=/.test(url)) return true;
  try {
    const parsed = new URL(url);
    return parsed.origin !== 'https://script.google.com' && parsed.searchParams.has('id');
  } catch {
    return false;
  }
}

async function followTokenRedirect(page, fallbackLinkLocator, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (checkinHandoffArrived_(page.url())) return;
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
 * Locator root for wherever followTokenRedirect landed — the GAS-nested double iframe when the
 * handoff stayed on script.google.com, or `page` directly once it left for the static front end
 * (see followTokenRedirect's doc comment above).
 */
function appRootAfterCheckinHandoff(page) {
  return new URL(page.url()).origin === 'https://script.google.com'
    ? page.frameLocator('iframe').frameLocator('iframe')
    : page;
}

/**
 * Fills CheckinApp's identify form and submits it. As of the 2026-07 hardening work this is a
 * real <form target="_top"> POST whose own `action` URL already carries this page's session
 * guid (baked in server-side before the form ever rendered — see CheckinSessions.js /
 * renderCheckinPage_'s formGuid) straight to renderCheckinPageForTypedIdentify_
 * (dashboardWebapp.js) — the POST navigation itself lands on the final, already-bookmarkable
 * `cmd=checkin&id=<guid>` URL, with no second redirect step of any kind: a MATCHED result
 * renders step-checkin (with the bookmark note) directly on the page this POST produced. Returns
 * the iframe locator for wherever the single navigation ends (step-checkin on a match, or the
 * identify step with idError on a non-match).
 */
async function submitCheckinIdentify(page, f3Name, email) {
  const app = page.frameLocator('iframe').frameLocator('iframe');
  await app.locator('#idF3Name').fill(f3Name);
  await app.locator('#idEmail').fill(email);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }),
    app.locator('#identifyBtn').click(),
  ]);
  return page.frameLocator('iframe').frameLocator('iframe');
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

// Shared across both describes below — beforeAll in each populates these from the same
// settings, in file declaration order (a single worker runs this whole file sequentially, so
// the fallback describe's fixture-establishing test always completes before anything that
// depends on it — see the handoff describe's own comment).
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

test.describe('GAS signup fallback (?static=0) — availability path, SIT', () => {
  test('current-month signup mints a token and redirects into check-in', async ({ page }) => {
    // This assertion depends on the mint being CURRENT_MONTH_PAX's very first session ever
    // (createdAt === lastUsedAt) — see handleCheckinIdentify_'s exact firstUse comparison
    // (dashboardWebapp.js). Since this fixture is reused across runs, resolveOrCreateCheckinSessionGuid_
    // (CheckinSessions.js) would otherwise find and touch an existing session from a prior run,
    // making firstUse false before the browser even navigates. Reset it first so every run starts
    // from a clean slate, same as a truly-new signup would.
    execFileSync('node', [
      path.join(ROOT, 'tools', 'callWebapp.js'), 'resetCheckinSession',
      '--body', JSON.stringify({ f3Name: CURRENT_MONTH_PAX.f3Name, email: CURRENT_MONTH_PAX.email }),
    ], { stdio: 'pipe' });

    // &static=0 opts out of F3Go30-833s.11's default redirect to the static signup
    // (buildStaticSignupRedirectUrl_, Utilities.js) — deliberately, not incidentally: this test's
    // whole job is exercising the GAS-hosted SignupApp.html end to end (ADR-018's availability
    // fallback), and every downstream test in the OTHER describe below depends on this exact test
    // actually completing CURRENT_MONTH_PAX's current-month signup, which only the GAS fallback
    // UI is being driven to do here.
    await page.goto(signupUrl + '&static=0', { waitUntil: 'networkidle' });
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

    // Lands on the static check-in front end on SIT (see followTokenRedirect's doc comment) —
    // appRootAfterCheckinHandoff picks the right locator root either way.
    const dest = appRootAfterCheckinHandoff(page);
    await expect(dest.locator('#step-checkin')).toBeVisible({ timeout: 15000 });
    // recentlyMinted is true only in the first minute after this exact token was generated —
    // see IDENTITY_TOKEN_FRESH_WINDOW_MS_ (dashboardWebapp.js).
    await expect(dest.locator('#bookmarkHereNote')).toBeVisible();
  });

  test('next-month-only signup does not mint a token or redirect into check-in', async ({ page }) => {
    // Same &static=0 rationale as the test above — this test needs the GAS-hosted
    // SignupApp.html's own #step-done/#step-choose locators, not the static twin's.
    await page.goto(signupUrl + '&static=0', { waitUntil: 'networkidle' });
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
});

test.describe('Check-in flow + GAS→static signup handoff, SIT', () => {
  test('typed identify lands directly on the check-in screen with the bookmark note — no intermediate redirect step', async ({ page }) => {
    await page.goto(checkinUrl, { waitUntil: 'networkidle' });
    await dismissGasBanner(page);
    const app = await submitCheckinIdentify(page, CURRENT_MONTH_PAX.f3Name, CURRENT_MONTH_PAX.email);

    // The single form-POST navigation must already be the final, bookmarkable URL — no
    // separate "tap here to continue" step in between (see submitCheckinIdentify's docstring).
    expect(page.url()).toContain('cmd=checkin&id=');
    await expect(app.locator('#step-checkin')).toBeVisible({ timeout: 15000 });
    await expect(app.locator('#checkinHeading')).toContainText(CURRENT_MONTH_PAX.f3Name);
    // firstUse is exact (Created-At === Last-Used-At) — this is a brand-new session, so the
    // one-time "bookmark this page" nudge must be showing right here, on this same screen.
    await expect(app.locator('#bookmarkHereNote')).toBeVisible();
  });

  test('reopening the bookmarked token link signs in directly, with no identify form', async ({ page }) => {
    await page.goto(checkinUrl, { waitUntil: 'networkidle' });
    await dismissGasBanner(page);
    const app0 = await submitCheckinIdentify(page, CURRENT_MONTH_PAX.f3Name, CURRENT_MONTH_PAX.email);
    await expect(app0.locator('#step-checkin')).toBeVisible({ timeout: 15000 });
    const tokenUrl = page.url();
    expect(tokenUrl).toContain('cmd=checkin&id=');

    // Simulate a real bookmark reopen: a brand-new navigation straight to the saved URL.
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
  // redirects straight into signup — using the same immediate-on-load redirect trick as the
  // matched path (reliable because it fires the instant this fresh page loads, activated by
  // the form submission itself, not after an async gap). step-signupRedirect's bare tap-through
  // link is only the fallback for whichever browsers still decline it.
  //
  // F3Go30-bkxg: signupDeepLinkUrl_ (CheckinApp.html) prefers the static signup front end
  // whenever STATIC_SIGNUP_BASE_URL_ is configured, with no `static=0`-style opt-out of its
  // own (unlike the bare ?cmd=signup entry point) — so on SIT this hop always lands on the
  // static origin, a genuinely different document than the one this test used to assert
  // against. Note that identity does NOT carry across that origin change: signupDeepLinkUrl_
  // only appends targetMonth/autoStart, not f3Name/email (buildStaticSignupUrl_, Utilities.js),
  // and localStorage is per-origin — confirmed live (2026-07) that the static page lands on its
  // own intro/identify step, not a prefilled info step, for exactly this reason. This test's job
  // is therefore the handoff itself: the redirect target is correct and a real signup entry
  // point is reached. The resulting UI's own behavior (prefill, save, etc.) is
  // static-signup.spec.js's job — see its "month-boundary: known-but-unregistered PAX..." test,
  // which drives that same static UI from a direct static-origin entry instead.
  test('typed identify for a known-but-unregistered PAX hands off into the static signup', async ({ page }) => {
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

    const app2 = page.frameLocator('iframe').frameLocator('iframe');
    const signupRedirectLink = app2.locator('#signupRedirectAnchor');
    if (await signupRedirectLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle' }),
        signupRedirectLink.click(),
      ]);
    }

    // The handoff lands on the static origin (no more GAS sandbox iframe to look inside), with
    // the same targetMonth/autoStart contract signupDeepLinkUrl_ always sends.
    const url = new URL(page.url());
    expect(url.origin).toBe('https://f3go30.github.io');
    expect(url.searchParams.get('cmd')).toBe('signup');
    expect(url.searchParams.get('targetMonth')).toBe('current');
    expect(url.searchParams.get('autoStart')).toBe('1');

    // Identity doesn't cross the origin boundary (see this test's header comment above), so the
    // static page opens its own intro/identify step rather than a prefilled info step.
    await expect(page.locator('#su-step-intro')).toBeVisible({ timeout: 15000 });
  });
});
