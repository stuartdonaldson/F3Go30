/**
 * Shared helpers for live-SIT Playwright specs that drive the static check-in page
 * (static-pages/src/index.html).
 *
 * dismissAnnouncementIfPresent_ — F3Go30-g9bi's `#announcementModal` is a real, live-data-driven
 * blocking overlay: whatever a Site Q currently has configured in Announce.<day> on the SIT
 * Config sheet is what a spec sees too, same as any real PAX would. A spec that drives the page
 * past that point (clicking anything underneath) must dismiss it first, exactly like a real PAX
 * would tap "Got it" before continuing — this is NOT about suppressing or clearing that live
 * Config-sheet row (see the SIT-test-artifacts memory: a live announcement present during a test
 * run is expected SIT-environment state, not something to work around by clearing it).
 *
 * Same story for F3Go30-xyvs's `#signupReminderModal` — resolveSignupReminder_dw_
 * (script/dashboardWebapp.js) fires it whenever a next-month tracker exists and the identified
 * PAX isn't signed up for it yet, which is exactly the state a live SIT next-month tracker
 * (created ahead of month-end, or by createTrackerForMonth) puts the fixture PAX in. Real PAX
 * see it too, and dismiss it the same way (tap "Remind me later"), so this helper dismisses both
 * live-data-driven overlays rather than suppressing either one.
 *
 * `applyServerConfig_`/`applyAnnouncementState_`/`applySignupReminderState_`
 * (static-pages/src/index.html) only ever run from two triggers: every identify-family response
 * (typed identify, token identify, live resume) and `silentResumeRefresh_` on `visibilitychange`.
 * The instant-paint snapshot-replay path explicitly passes `isLive:false` and skips both gates, so
 * a snapshot-painted view never shows either modal — only a LIVE identify response can raise one.
 * Call this once after each point in a spec where a live identify response has just landed (a
 * fresh page.goto()'s step-checkin/step-identify visibility wait, or a syncing-note-cleared wait
 * following a delayed live response), before any subsequent interaction with the page underneath.
 */
async function dismissAnnouncementIfPresent_(page, opts) {
  const timeout = (opts && opts.timeout) || 1000;
  await dismissOverlay_(page, '#announcementModal', '#announcementDismissBtn', timeout);
  await dismissOverlay_(page, '#signupReminderModal', '#signupReminderLaterBtn', timeout);
}

async function dismissOverlay_(page, modalSelector, dismissBtnSelector, timeout) {
  const modal = page.locator(modalSelector);
  try {
    await modal.waitFor({ state: 'visible', timeout });
  } catch (e) {
    return; // not shown — nothing to dismiss
  }
  await page.locator(dismissBtnSelector).click();
  await modal.waitFor({ state: 'hidden', timeout: 5000 });
}

/**
 * Clicks `locator`, tolerating the announcement modal (F3Go30-g9bi) arriving in the gap between a
 * page settling and this click firing — a real risk only where a click follows an instant-paint
 * snapshot render without first waiting for the live identify response to land (`#checkinSyncingNote`
 * hidden), since that's exactly the window a live announcement can pop in and intercept the click.
 * Everywhere else, a single dismissAnnouncementIfPresent_ right after the live response has landed
 * is enough — prefer that; reach for this only at a genuinely racy click site.
 */
async function identifyOnce_(request, execUrl, pax, guid) {
  const res = await request.post(execUrl + '?cmd=checkin', {
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    data: JSON.stringify({ action: 'identify', f3Name: pax.f3Name, email: pax.email, guid }),
    maxRedirects: 5,
  });
  return res.json();
}

/**
 * Identifies a shared live-SIT fixture PAX (NoSadClown, Whiplash, …), self-healing the one
 * failure mode every beforeAll hook in this tier used to hit bare and unexplained: a month
 * rollover on SIT that leaves a KNOWN PAX (a PaxDB/Responses record exists from a prior month)
 * un-registered for the now-current month — identify then correctly reports
 * `matched:false, knownPaxNotRegistered:true` (dashboardIdentity.js), which every spec below used
 * to surface only as a bare `expect(json.matched).toBe(true)` failure with no indication that the
 * fix is "sign this PAX up for the current month," not a code regression. Root-caused 2026-09-19:
 * NoSadClown was registered through August but nobody re-signed it up for September, since the
 * one thing that used to do that (demo-screenshots.spec.js's UI-driven signup) is a purpose-
 * exclusion spec (playwright.config.js) never run by test:live/test:regression.
 *
 * Self-heals by calling the real cmd=signup save endpoint (same shape a PAX's own signup submit
 * uses, F3Go30 signupWebapp.js's handleSignupSave_) with `targetMonth: 'current'`, idempotent by
 * design — a re-run against an already-registered PAX just updates its existing row. Any other
 * mismatch (unknown PAX, wrong email, real server error) still fails loudly rather than being
 * silently signed up as something it isn't.
 *
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} execUrl Base `.../exec` URL (no query string).
 * @param {{f3Name:string, email:string, team?:string, teamType?:string, who?:string, what?:string, how?:string}} pax
 * @param {string} guid Session guid this identify call mints/resumes.
 * @returns {Promise<object>} The final, matched identify response.
 */
async function ensureFixturePaxIdentified_(request, execUrl, pax, guid) {
  let json = await identifyOnce_(request, execUrl, pax, guid);
  if (json.matched) return json;

  if (!json.knownPaxNotRegistered) {
    throw new Error(
      `ensureFixturePaxIdentified_: ${pax.f3Name} did not match and isn't a known-but-unregistered ` +
      `PAX either (identify returned ${JSON.stringify(json)}) — this needs a human to look at the ` +
      `SIT fixture, not an auto-signup.`
    );
  }

  const saveRes = await request.post(execUrl + '?cmd=signup', {
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    data: JSON.stringify({
      action: 'save',
      f3Name: pax.f3Name,
      email: pax.email,
      targetMonth: 'current',
      teamType: pax.teamType || 'other',
      team: pax.team || 'Crucible',
      who: pax.who || 'An available, attentive and engaged partner',
      what: pax.what || 'No porn, alcohol or sobriety violations. Meditate 10 minutes daily.',
      how: pax.how || 'Morning meditation; daily check-in with my Go30 team, and with my partner.',
      nag: false,
    }),
    maxRedirects: 5,
  });
  const saveJson = await saveRes.json();
  if (!saveJson.ok) {
    throw new Error(`ensureFixturePaxIdentified_: auto-signup for ${pax.f3Name} failed: ${JSON.stringify(saveJson)}`);
  }

  json = await identifyOnce_(request, execUrl, pax, guid);
  if (!json.matched) {
    throw new Error(`ensureFixturePaxIdentified_: ${pax.f3Name} still didn't match after auto-signup: ${JSON.stringify(json)}`);
  }
  return json;
}

async function clickThroughAnnouncement_(locator, opts) {
  const page = locator.page();
  try {
    await locator.click(opts);
  } catch (e) {
    await dismissAnnouncementIfPresent_(page, { timeout: 500 });
    await locator.click(opts);
  }
}

/**
 * Serves static-pages/src over loopback so a spec drives the CURRENT source (not whatever
 * GitHub Pages has propagated) against the live backend. The one shared implementation
 * (F3Go30-8naq.6): nine older specs still carry their own hand-copied startStaticServer — flagged
 * for consolidation onto this, not migrated here.
 * @returns {Promise<import('http').Server>} listening on an ephemeral 127.0.0.1 port.
 */
function startStaticServer_() {
  const http = require('http');
  const fs = require('fs');
  const path = require('path');
  const staticDir = path.resolve(__dirname, '../..', 'static-pages', 'src');
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = req.url.split('?')[0];
      fs.readFile(path.join(staticDir, rel === '/' ? '/index.html' : rel), (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

module.exports = { dismissAnnouncementIfPresent_, clickThroughAnnouncement_, ensureFixturePaxIdentified_, startStaticServer_ };
