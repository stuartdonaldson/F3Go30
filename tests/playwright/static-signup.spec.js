/**
 * Static signup front end — E2E twin of identity-token-flow.spec.js's signup coverage
 * (F3Go30-833s.12).
 *
 * F3Go30-833s.9 made static-pages/src/index.html's in-page signup step (#step-signup, ported
 * from script/SignupApp.html) the PRIMARY signup UI (ADR-018) — identity-token-flow.spec.js
 * only drives the GAS SignupApp.html fallback, which after .9 is no longer the path most PAX
 * take. Without a twin here the primary path shipped with less coverage than the demoted
 * fallback. Follows static-checkin.spec.js's precedent: same local-static-server pattern
 * (a genuinely different origin from script.google.com, same class of cross-origin boundary
 * a real CDN-hosted deployment would have), same live-SIT backend, locator-for-locator parity
 * with the flow it twins wherever the two front ends share behavior.
 *
 * Per F3Go30-90l5 (SignupApp.html sunset decision), identity-token-flow.spec.js's GAS-signup
 * coverage is a HOLDING ACTION and is NOT touched here — this file only adds the static twin.
 *
 * AC 2: every test below tracks the page's 'load' event count (fires only for a genuine
 * top-level/full-document navigation, never for history.replaceState or a fetch) and asserts
 * it never exceeds 1 — the whole point of the F3Go30-833s.9 rewrite (ADR-018) was to keep
 * signup from ever leaving this document.
 *
 * Usage:
 *   npx playwright test tests/playwright/static-signup.spec.js
 */
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.resolve(__dirname, '../..');
const STATIC_DIR = path.join(ROOT, 'static-pages', 'src');

// A dedicated fixture PAX, distinct from every other spec's fixtures so this file's repeated
// signup saves don't clobber another spec's row. Idempotent: re-running "new signup" below just
// refills the same existing row (same convention as demo-screenshots.spec.js / identity-token-
// flow.spec.js), which is exactly what the "returning-PAX edit" test then exercises on purpose.
const STATIC_SIGNUP_PAX = {
  f3Name: 'StaticSignupTest',
  email: 'staticsignuptest@example.com',
  team: 'Crucible',
  who: 'An available, attentive and engaged partner',
  what: 'No porn, alcohol or sobriety violations. Meditate 10 minutes daily.',
  how: 'Morning meditation; daily check-in with my Go30 team, and with my partner.',
};

// Reused, NOT re-created: identity-token-flow.spec.js's Stage 4 fixture, established as
// "known to PaxDB (registered for next month, August 2026) but absent from the CURRENT month's
// (July 2026) tracker" — exactly the knownPaxNotRegistered / month-boundary case this file's
// third test needs. Per that file's own comment, don't re-run signup for it unless the fixture
// needs re-establishing — so the test below only asserts the redirect target, it never saves.
const LATE_SIGNUP_PAX = { f3Name: 'LateSignupTest', email: 'latesignup@example.com' };

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

/** Fills the su- prefixed team/who/what/how block once su-step-info is showing. Mirrors
 * identity-token-flow.spec.js's fillSignupInfo, adapted to this page's su-prefixed ids. */
async function fillStaticSignupTeamAndGoals(page, pax) {
  await page.locator('#suTtOtherOption').click();
  await page.locator('#suTeamOtherInput').fill(pax.team);
  await page.locator('#suWhoInput').fill(pax.who);
  await page.locator('#suWhatInput').fill(pax.what);
  await page.locator('#suHowInput').fill(pax.how);
}

/** Drives su-step-choose -> su-step-done, same "keep current selected if the step appears"
 * pattern identity-token-flow.spec.js uses for SignupApp.html's step-choose. */
async function saveStaticSignup(page) {
  await page.locator('#suInfoNextBtn').click();
  const chooseVisible = await page.locator('#su-step-choose').isVisible().catch(() => false);
  if (chooseVisible) {
    await page.locator('.month-option[data-key="current"]').click();
    await page.locator('#suSaveBtn').click();
  }
  await expect(page.locator('#su-step-done')).toBeVisible({ timeout: 15000 });
}

test.describe('Static signup front end (client, live SIT) — F3Go30-833s.12', () => {
  let checkinUrl;
  let staticOrigin;
  let server;

  test.beforeAll(async () => {
    const settings = loadSettings();
    const deploymentId = settings.testDeploymentId;
    if (!deploymentId || deploymentId.startsWith('<')) {
      throw new Error('testDeploymentId not set in local.settings.json — run npm run deploy:sit first');
    }
    checkinUrl = `https://script.google.com/macros/s/${deploymentId}/exec`;

    server = await startStaticServer();
    staticOrigin = `http://127.0.0.1:${server.address().port}`;
  });

  test.afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  function signupPageUrl() {
    return `${staticOrigin}/index.html?webapp=${encodeURIComponent(checkinUrl)}&cmd=signup`;
  }

  function checkinPageUrl() {
    return `${staticOrigin}/index.html?webapp=${encodeURIComponent(checkinUrl)}`;
  }

  test('new signup: current-month signup completes end to end on the static page, no top-level navigation', async ({ page }) => {
    let loads = 0;
    page.on('load', () => loads++);

    await page.goto(signupPageUrl());
    await expect(page.locator('#step-signup')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#su-step-intro')).toBeVisible();

    await page.locator('#suIntroNextBtn').click();
    await expect(page.locator('#su-step-identify')).toBeVisible();

    await page.locator('#suF3Name').fill(STATIC_SIGNUP_PAX.f3Name);
    await page.locator('#suEmail').fill(STATIC_SIGNUP_PAX.email);
    await page.locator('#suIdentifyBtn').click();
    await expect(page.locator('#su-step-info')).toBeVisible({ timeout: 15000 });

    await fillStaticSignupTeamAndGoals(page, STATIC_SIGNUP_PAX);
    await saveStaticSignup(page);

    // AC 2: the whole signup flow above must never leave this document.
    expect(loads).toBe(1);
    expect(new URL(page.url()).origin).toBe(staticOrigin);

    // performSignupSave_'s "Continue to check in" resolves the freshly-minted token in place
    // (resolveTokenIntoCheckin_) — the in-page replacement for SignupApp.html's post-save
    // top-level redirect (F3Go30-833s.9) — still no navigation.
    await page.locator('#suDoneCheckinBtn').click();
    await expect(page.locator('#step-checkin')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#checkinHeading')).toContainText(STATIC_SIGNUP_PAX.f3Name);
    expect(loads).toBe(1);
  });

  test('returning-PAX edit: identify prefills the existing registration and allows editing, no top-level navigation', async ({ page }) => {
    let loads = 0;
    page.on('load', () => loads++);

    await page.goto(signupPageUrl());
    await expect(page.locator('#su-step-intro')).toBeVisible({ timeout: 15000 });
    await page.locator('#suIntroNextBtn').click();

    await page.locator('#suF3Name').fill(STATIC_SIGNUP_PAX.f3Name);
    await page.locator('#suEmail').fill(STATIC_SIGNUP_PAX.email);
    await page.locator('#suIdentifyBtn').click();
    await expect(page.locator('#su-step-info')).toBeVisible({ timeout: 15000 });

    // Matched: the "new signup" test above already saved this PAX — prefill must reflect it.
    await expect(page.locator('#suMatchedCallout')).toBeVisible();
    await expect(page.locator('#suInfoF3Name')).toContainText(STATIC_SIGNUP_PAX.f3Name);
    await expect(page.locator('#suWhatInput')).toHaveValue(STATIC_SIGNUP_PAX.what);

    const updatedWhat = STATIC_SIGNUP_PAX.what + ' (edited by static-signup.spec.js)';
    await page.locator('#suWhatInput').fill(updatedWhat);
    await saveStaticSignup(page);

    // Verify server-side, independent of the browser — same pattern static-checkin.spec.js
    // uses for its calendar-probe test.
    const check = await page.request.post(checkinUrl + '?cmd=signup', {
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      data: JSON.stringify({ action: 'identify', f3Name: STATIC_SIGNUP_PAX.f3Name, email: STATIC_SIGNUP_PAX.email }),
      maxRedirects: 5,
    });
    const checkJson = await check.json();
    expect(checkJson.matched).toBe(true);
    expect(checkJson.data.what).toBe(updatedWhat);

    // Restore the fixed fixture value so repeated runs of the first test stay deterministic.
    const restore = await page.request.post(checkinUrl + '?cmd=signup', {
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      data: JSON.stringify({
        action: 'save', f3Name: STATIC_SIGNUP_PAX.f3Name, email: STATIC_SIGNUP_PAX.email,
        targetMonth: 'current', teamType: 'other', team: STATIC_SIGNUP_PAX.team,
        who: STATIC_SIGNUP_PAX.who, what: STATIC_SIGNUP_PAX.what, how: STATIC_SIGNUP_PAX.how,
      }),
      maxRedirects: 5,
    });
    expect((await restore.json()).ok).toBe(true);

    expect(loads).toBe(1);
    expect(new URL(page.url()).origin).toBe(staticOrigin);
  });

  // ── Month-boundary knownPaxNotRegistered path (mirrors identity-token-flow.spec.js's ─────────
  //    "typed identify for a known-but-unregistered PAX redirects into prefilled signup", but the
  //    static page opens the in-page signup step instead of navigating to a different document.
  //    Read-only: never saves, so LATE_SIGNUP_PAX's Stage 4 fixture state is left untouched.
  test('month-boundary: known-but-unregistered PAX auto-opens a prefilled signup for the current month, no top-level navigation', async ({ page }) => {
    let loads = 0;
    page.on('load', () => loads++);

    await page.goto(checkinPageUrl());
    await expect(page.locator('#step-identify')).toBeVisible({ timeout: 15000 });

    await page.locator('#idF3Name').fill(LATE_SIGNUP_PAX.f3Name);
    await page.locator('#idEmail').fill(LATE_SIGNUP_PAX.email);
    await page.locator('#identifyBtn').click();

    // applyTypedIdentifyResult_'s knownPaxNotRegistered branch calls openSignup_('current')
    // in place — no cross-origin hop to script.google.com/…cmd=signup the way GAS's
    // attemptTopRedirect_-driven fallback needs.
    await expect(page.locator('#step-signup')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#su-step-info')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#suInfoF3Name')).toContainText(LATE_SIGNUP_PAX.f3Name);

    expect(loads).toBe(1);
    expect(new URL(page.url()).origin).toBe(staticOrigin);
  });
});
