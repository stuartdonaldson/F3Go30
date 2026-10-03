/**
 * Static signup front end (F3Go30-833s.12).
 *
 * F3Go30-833s.9 made static-pages/src/index.html's in-page signup step (#step-signup, originally
 * ported from the GAS-hosted script/SignupApp.html) the PRIMARY signup UI (ADR-018). DR-04
 * (2026-08-04, design-review-2026-08-04.md; F3Go30-wjpu) then removed SignupApp.html outright,
 * retiring tests/playwright/identity-token-flow.spec.js's GAS-signup coverage this file used to
 * twin — this is now the only signup E2E coverage. Follows static-checkin.spec.js's precedent:
 * same local-static-server pattern (a genuinely different origin from script.google.com, same
 * class of cross-origin boundary a real CDN-hosted deployment would have), same live-SIT
 * backend.
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
const { dismissAnnouncementIfPresent_, clickThroughAnnouncement_ } = require('./live-check-helpers.js');

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

// Originally identity-token-flow.spec.js's Stage 4 fixture: "known to PaxDB but absent from the
// CURRENT month's tracker" — exactly the knownPaxNotRegistered / month-boundary case this file's
// third test needs. Found on 2026-09-19 to have decayed further than that test's beforeAll (below)
// expected: rather than merely unregistered for the current month, it had NO record in any month
// at all (matched:false with no knownPaxNotRegistered flag either) — a harder rollover-adjacent
// staleness than the knownPaxNotRegistered case ensureFixturePaxIdentified_ (live-check-helpers.js,
// F3Go30-51hy) handles. The describe block's beforeAll below now detects that specific "fully
// unknown" state and re-establishes it via a past-month signup — never a current-month one, which
// would defeat the test — while leaving it exactly alone if it already has any history.
const LATE_SIGNUP_PAX = { f3Name: 'LateSignupTest', email: 'latesignup@example.com' };

// F3Go30-9u68: a dedicated fixture, distinct from STATIC_SIGNUP_PAX above, so the validation
// test's own save doesn't collide with (or get overwritten by) that test's fixture state.
//
// F3Go30-vecg: this identity must be BRAND NEW every run, not a fixed constant. The test's own
// happy-path tail (line ~315, "Everything filled — Continue proceeds and the flow completes
// normally") deliberately completes the save, so once any run finishes that save, a fixed
// f3Name/email becomes a returning PAX on SIT with team+goals already on file — every later run
// then has identify return wasMatched:true with real data prefilled, #suInfoNextBtn just saves
// without validating, and the #suInfoError assertions this test exists to exercise never fire
// again (confirmed live 2026-08-19, bd memories F3Go30-signup-validation-pax-pollution). A fresh
// random suffix per run means each run is always a genuinely new/unmatched PAX, so the blocked-
// validation path is always actually exercised — no server-side cleanup step to forget.
function freshValidationTestPax_() {
  var suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  return { f3Name: 'SignupValidationTest' + suffix, email: 'signupvalidationtest+' + suffix + '@example.com' };
}

// Same reasoning as static-checkin.spec.js's constant of the same name, and the same defect: the
// 15000 waits here predate F3Go30-313u, which bounded the client transport at a 12s read timeout
// plus one retry. A lost read now surfaces at up to 24s and RECOVERS, so 15000 reports correct
// behaviour as a failure — and only when SIT happens to drop a request, so it flakes by load
// rather than by code. Caught doing exactly that on the month-boundary test, 2026-07-28.
// These are "did this wedge?" guards, not latency budgets.
const LIVE_ROUND_TRIP_MS = 30000;

test.use({ storageState: undefined, viewport: { width: 390, height: 844 }, headless: true });

// File-scoped, leaving playwright.config.js's shared 120000 (sized for the slow GAS editor specs)
// alone: these tests chain several LIVE_ROUND_TRIP_MS waits and would otherwise die as
// "Test ended" mid-flow, relocating the same false red rather than removing it.
test.describe.configure({ timeout: 240000 });

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
  await page.locator('#suTeamInput').fill(pax.team);
  await page.locator('#suWhoInput').fill(pax.who);
  await page.locator('#suWhatInput').fill(pax.what);
  await page.locator('#suHowInput').fill(pax.how);
}

/** Drives su-step-choose -> su-step-done: keep "current" selected if the step appears. */
async function saveStaticSignup(page) {
  // F3Go30-g9bi: a live announcement can pop in the gap right after the identify response that
  // just landed #su-step-info — clickThroughAnnouncement_ retries through it rather than dying
  // on "element intercepts pointer events" (see live-check-helpers.js).
  await clickThroughAnnouncement_(page.locator('#suInfoNextBtn'));
  await finishSignupSave_(page);
}

/** After the info step's Continue has fired: pick "current" if the month step shows, then wait for done. */
async function finishSignupSave_(page) {
  const chooseVisible = await page.locator('#su-step-choose').isVisible().catch(() => false);
  if (chooseVisible) {
    await page.locator('.month-option[data-key="current"]').click();
    await page.locator('#suSaveBtn').click();
  }
  await expect(page.locator('#su-step-done')).toBeVisible({ timeout: LIVE_ROUND_TRIP_MS });
}

test.describe('Static signup front end (client, live SIT) — F3Go30-833s.12', () => {
  let checkinUrl;
  let staticOrigin;
  let server;

  test.beforeAll(async ({ request }) => {
    const settings = loadSettings();
    const deploymentId = settings.testDeploymentId;
    if (!deploymentId || deploymentId.startsWith('<')) {
      throw new Error('testDeploymentId not set in local.settings.json — run npm run deploy:sit first');
    }
    checkinUrl = `https://script.google.com/macros/s/${deploymentId}/exec`;

    // LATE_SIGNUP_PAX must stay "known but unregistered for the current month" forever, which
    // needs the OPPOSITE self-heal from ensureFixturePaxIdentified_ (live-check-helpers.js,
    // F3Go30-51hy) — registering it for the current month would break the very test it exists
    // for. Self-heal only the narrower failure actually seen (2026-09-19): the fixture has NO
    // record in ANY month at all (registeredMonthKeys empty AND no knownPaxNotRegistered flag),
    // which happens if it was never (re-)established or aged out of every tracker window. In
    // that case only, sign it up for a definitely-past month via a contextDate override —
    // current-month registration is never touched here. If it already has any history, leave it
    // exactly alone, per this file's existing "don't re-run signup for it" convention below.
    const idRes = await request.post(checkinUrl + '?cmd=checkin', {
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      data: JSON.stringify({ action: 'identify', f3Name: LATE_SIGNUP_PAX.f3Name, email: LATE_SIGNUP_PAX.email, guid: 'late-signup-fixture-probe' }),
      maxRedirects: 5,
    });
    const idJson = await idRes.json();
    if (!idJson.matched && !idJson.knownPaxNotRegistered && (idJson.registeredMonthKeys || []).length === 0) {
      const saveRes = await request.post(checkinUrl + '?cmd=signup', {
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        data: JSON.stringify({
          action: 'save',
          f3Name: LATE_SIGNUP_PAX.f3Name,
          email: LATE_SIGNUP_PAX.email,
          targetMonth: 'current',
          contextDate: '2026-06-15', // any month guaranteed to be in the past
          teamType: 'other',
          team: 'Crucible',
          who: 'An available, attentive and engaged partner',
          what: 'No porn, alcohol or sobriety violations. Meditate 10 minutes daily.',
          how: 'Morning meditation; daily check-in with my Go30 team, and with my partner.',
          nag: false,
        }),
        maxRedirects: 5,
      });
      const saveJson = await saveRes.json();
      if (!saveJson.ok) {
        throw new Error(`LATE_SIGNUP_PAX auto-(re)establish failed: ${JSON.stringify(saveJson)}`);
      }
    }

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
    await expect(page.locator('#step-signup')).toBeVisible({ timeout: LIVE_ROUND_TRIP_MS });
    await expect(page.locator('#su-step-intro')).toBeVisible();

    await page.locator('#suIntroNextBtn').click();
    await expect(page.locator('#su-step-identify')).toBeVisible();

    await page.locator('#suF3Name').fill(STATIC_SIGNUP_PAX.f3Name);
    await page.locator('#suEmail').fill(STATIC_SIGNUP_PAX.email);
    await page.locator('#suIdentifyBtn').click();
    await expect(page.locator('#su-step-info')).toBeVisible({ timeout: LIVE_ROUND_TRIP_MS });
    // F3Go30-g9bi: the live identify response that just landed may carry a live announcement —
    // dismiss it now, before anything below clicks or fills a field underneath.
    await dismissAnnouncementIfPresent_(page);

    await fillStaticSignupTeamAndGoals(page, STATIC_SIGNUP_PAX);
    await saveStaticSignup(page);

    // AC 2: the whole signup flow above must never leave this document.
    expect(loads).toBe(1);
    expect(new URL(page.url()).origin).toBe(staticOrigin);

    // F3Go30-1f75: the done card's personal check-in link. It must be OFFERED — on SIT the block
    // came up hidden, because it was keyed on identityToken, which the server withholds for a
    // next-month save — and it must be a real navigation anchor carrying ?id=, since the card
    // tells the PAX to bookmark it.
    await expect(page.locator('#suDoneCheckinBlock')).toBeVisible();
    const href = await page.locator('#suDoneCheckinLink').getAttribute('href');
    expect(href).toBeTruthy();
    const personal = new URL(href);
    const sessionId = personal.searchParams.get('id');
    expect(sessionId).toBeTruthy();
    expect(personal.searchParams.get('cmd')).toBeNull();

    // The card must not promise check-in is usable today — it isn't, for a next-month signup.
    await expect(page.locator('#su-step-done')).not.toContainText(/continue to check in/i);

    // And the proof that matters: opening that session id on this page lands on check-in, not
    // signup. Driven against the local origin rather than by clicking the anchor, because the
    // server builds it against the configured GitHub Pages host, which is not where this test
    // serves the page from.
    await page.goto(`${staticOrigin}/index.html?webapp=${encodeURIComponent(checkinUrl)}&id=${sessionId}`);
    await expect(page.locator('#step-checkin')).toBeVisible({ timeout: LIVE_ROUND_TRIP_MS });
    await dismissAnnouncementIfPresent_(page);
    await expect(page.locator('#step-signup')).toBeHidden();
    await expect(page.locator('#checkinHeading')).toContainText(STATIC_SIGNUP_PAX.f3Name);

    // applyIdentifySuccess_ leaves the address bar bookmarkable and free of signup routing.
    const landed = new URL(page.url());
    expect(landed.searchParams.get('id')).toBe(sessionId);
    expect(landed.searchParams.get('cmd')).toBeNull();
    expect(landed.searchParams.get('webapp')).toBe(checkinUrl);
  });

  test('returning-PAX edit: identify prefills the existing registration and allows editing, no top-level navigation', async ({ page }) => {
    let loads = 0;
    page.on('load', () => loads++);

    await page.goto(signupPageUrl());
    await expect(page.locator('#su-step-intro')).toBeVisible({ timeout: LIVE_ROUND_TRIP_MS });
    await page.locator('#suIntroNextBtn').click();

    await page.locator('#suF3Name').fill(STATIC_SIGNUP_PAX.f3Name);
    await page.locator('#suEmail').fill(STATIC_SIGNUP_PAX.email);
    await page.locator('#suIdentifyBtn').click();
    await expect(page.locator('#su-step-info')).toBeVisible({ timeout: LIVE_ROUND_TRIP_MS });
    await dismissAnnouncementIfPresent_(page);

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

  // F3Go30-y8j7.1 — signup.feedback had no charter-journey call-site. The static front end has
  // no UI hook for it at all (removed along with SignupApp.html by DR-04), so this drives the
  // server route directly — the same "verify server-side, independent of the browser" pattern
  // the edit test above already uses for its own assertions, just with no UI half to drive first.
  // Unlike checkin.siteFeedback / the guide §7 note that assumed the same problem, this handler
  // never calls sendConfiguredEmail_ — it only writes feedbackRating/feedbackComment onto the row
  // already on file, so there is no email side effect to suppress before driving it live.
  test('signup feedback: writes onto the matched row, and is rejected for an unmatched one (direct API, no UI hook exists)', async ({ request }) => {
    const hit = await request.post(checkinUrl + '?cmd=signup', {
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      data: JSON.stringify({
        action: 'feedback', f3Name: STATIC_SIGNUP_PAX.f3Name, email: STATIC_SIGNUP_PAX.email,
        targetMonth: 'current', feedbackRating: 4,
        feedbackComment: 'Playwright live-check — please ignore.',
      }),
      maxRedirects: 5,
    });
    expect((await hit.json()).ok).toBe(true);

    // Proves the handler is doing a real row match rather than unconditionally reporting success:
    // an f3Name/email pair with no Responses row anywhere is rejected, not silently accepted.
    const miss = await request.post(checkinUrl + '?cmd=signup', {
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      data: JSON.stringify({
        action: 'feedback', f3Name: 'NoSuchSignupFeedbackPax', email: 'nosuchsignupfeedback@example.com',
        targetMonth: 'current', feedbackRating: 4, feedbackComment: 'should never be written',
      }),
      maxRedirects: 5,
    });
    const missJson = await miss.json();
    expect(missJson.ok).toBe(false);
    expect(missJson.error).toBe('signup_not_found');
  });

  // ── Month-boundary knownPaxNotRegistered path (mirrors identity-token-flow.spec.js's ─────────
  //    "typed identify for a known-but-unregistered PAX redirects into prefilled signup", but the
  //    static page opens the in-page signup step instead of navigating to a different document.
  //    This test itself never saves — the describe block's beforeAll above is the only place
  //    LATE_SIGNUP_PAX's fixture state can be written, and only when it's decayed to fully unknown.
  test('month-boundary: known-but-unregistered PAX auto-opens a prefilled signup for the current month, no top-level navigation', async ({ page }) => {
    let loads = 0;
    page.on('load', () => loads++);

    await page.goto(checkinPageUrl());
    await expect(page.locator('#step-identify')).toBeVisible({ timeout: LIVE_ROUND_TRIP_MS });

    await page.locator('#idF3Name').fill(LATE_SIGNUP_PAX.f3Name);
    await page.locator('#idEmail').fill(LATE_SIGNUP_PAX.email);
    await page.locator('#identifyBtn').click();

    // applyTypedIdentifyResult_'s knownPaxNotRegistered branch calls openSignup_('current')
    // in place — no cross-origin hop to script.google.com/…cmd=signup the way GAS's
    // attemptTopRedirect_-driven fallback needs.
    await expect(page.locator('#step-signup')).toBeVisible({ timeout: LIVE_ROUND_TRIP_MS });
    await expect(page.locator('#su-step-info')).toBeVisible({ timeout: LIVE_ROUND_TRIP_MS });
    await dismissAnnouncementIfPresent_(page);
    await expect(page.locator('#suInfoF3Name')).toContainText(LATE_SIGNUP_PAX.f3Name);

    expect(loads).toBe(1);
    expect(new URL(page.url()).origin).toBe(staticOrigin);
  });

  test('info step blocks Continue until team and goals are filled in, and the team info button opens its modal — F3Go30-9u68', async ({ page }) => {
    var validationTestPax = freshValidationTestPax_();
    await page.goto(signupPageUrl());
    await expect(page.locator('#su-step-intro')).toBeVisible({ timeout: LIVE_ROUND_TRIP_MS });
    await page.locator('#suIntroNextBtn').click();

    await page.locator('#suF3Name').fill(validationTestPax.f3Name);
    await page.locator('#suEmail').fill(validationTestPax.email);
    await page.locator('#suIdentifyBtn').click();
    await expect(page.locator('#su-step-info')).toBeVisible({ timeout: LIVE_ROUND_TRIP_MS });
    await dismissAnnouncementIfPresent_(page);

    // Team info splash (reuses the announcement overlay's markup/CSS, F3Go30-g9bi): opens on
    // demand, explains WHY a team matters, and closes without leaving the info step.
    await page.locator('#suTeamInfoBtn').click();
    await expect(page.locator('#teamInfoModal')).toBeVisible();
    await expect(page.locator('#teamInfoModal')).toContainText(/accountability/i);
    await page.locator('#teamInfoCloseBtn').click();
    await expect(page.locator('#teamInfoModal')).toBeHidden();

    // Nothing filled in yet — Continue must block on the missing team, with an inline reason.
    await clickThroughAnnouncement_(page.locator('#suInfoNextBtn'));
    await expect(page.locator('#suInfoError')).toBeVisible();
    await expect(page.locator('#suInfoError')).toContainText(/team/i);
    await expect(page.locator('#su-step-info')).toBeVisible();

    // Team filled, goals still blank — must now block on goals instead of silently proceeding.
    await page.locator('#suTeamInput').fill('Crucible');
    await page.locator('#suInfoNextBtn').click();
    await expect(page.locator('#suInfoError')).toBeVisible();
    await expect(page.locator('#suInfoError')).toContainText(/who|what|how/i);
    await expect(page.locator('#su-step-info')).toBeVisible();

    // Everything filled — Continue proceeds and the flow completes normally.
    await page.locator('#suWhoInput').fill('An available, attentive partner');
    await page.locator('#suWhatInput').fill('No alcohol.');
    await page.locator('#suHowInput').fill('Daily check-in with my team.');
    await saveStaticSignup(page);
    await expect(page.locator('#suInfoError')).toBeHidden();
  });

  // ── Team roster (ADR-023, F3Go30-qeuu.3/.6) ──────────────────────────────────────────────────
  async function identifyViaApi_(request, pax) {
    const res = await request.post(checkinUrl + '?cmd=signup', {
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      data: JSON.stringify({ action: 'identify', f3Name: pax.f3Name, email: pax.email }),
      maxRedirects: 5,
    });
    return res.json();
  }

  async function openFreshInfoStep_(page, pax) {
    await page.goto(signupPageUrl());
    await expect(page.locator('#su-step-intro')).toBeVisible({ timeout: LIVE_ROUND_TRIP_MS });
    await page.locator('#suIntroNextBtn').click();
    await page.locator('#suF3Name').fill(pax.f3Name);
    await page.locator('#suEmail').fill(pax.email);
    await page.locator('#suIdentifyBtn').click();
    await expect(page.locator('#su-step-info')).toBeVisible({ timeout: LIVE_ROUND_TRIP_MS });
    await dismissAnnouncementIfPresent_(page);
  }

  async function fillGoals_(page) {
    await page.locator('#suWhoInput').fill('An available, attentive partner');
    await page.locator('#suWhatInput').fill('No alcohol.');
    await page.locator('#suHowInput').fill('Daily check-in with my team.');
  }

  test('team field: suggestions are selectable, and a near-match prompts "Did you mean" whose Use saves the roster spelling', async ({ page, request }) => {
    const pax = freshValidationTestPax_();
    await openFreshInfoStep_(page, pax);

    // signup team-suggestions-selectable — Crucible is used every run by this file's fixtures,
    // so it is always inside SIT's suggestion window.
    await page.locator('#suTeamInput').fill('cruc');
    const option = page.locator('#suTeamListbox li', { hasText: 'Crucible' });
    await expect(option).toBeVisible();
    await option.click();
    await expect(page.locator('#suTeamInput')).toHaveValue('Crucible');
    await expect(page.locator('#suTeamListbox')).toBeHidden();

    // signup team-near-match-prompts — one letter short of a roster team.
    await page.locator('#suTeamInput').fill('Crucibl');
    await fillGoals_(page);
    await clickThroughAnnouncement_(page.locator('#suInfoNextBtn'));
    await expect(page.locator('#suTeamDidYouMean')).toBeVisible();
    await expect(page.locator('#suTeamDidYouMeanText')).toContainText('Crucible');
    await expect(page.locator('#su-step-info')).toBeVisible();
    await page.locator('#suTeamUseNearBtn').click();
    await expect(page.locator('#suTeamInput')).toHaveValue('Crucible');
    await finishSignupSave_(page);

    const idJson = await identifyViaApi_(request, pax);
    expect(idJson.matched).toBe(true);
    expect(idJson.data.team).toBe('Crucible');
  });

  test('team field: a brand-new team saves without a prompt and joins the roster suggestions', async ({ page, request }) => {
    // A fixed name, not per-run: TeamDB has no delete action, so a per-run name would add a new
    // SIT roster row every run. Re-using one keeps it to a single row (UseCount just grows).
    const NEW_TEAM = 'ZZ Playwright Roster Team';
    const pax = freshValidationTestPax_();
    await openFreshInfoStep_(page, pax);

    await page.locator('#suTeamInput').fill(NEW_TEAM);
    await fillGoals_(page);
    await saveStaticSignup(page);
    await expect(page.locator('#suTeamDidYouMean')).toBeHidden();

    const idJson = await identifyViaApi_(request, pax);
    expect(idJson.data.team).toBe(NEW_TEAM);
    expect(idJson.teamList).toContain(NEW_TEAM);
  });
});
