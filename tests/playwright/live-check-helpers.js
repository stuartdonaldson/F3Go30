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
async function clickThroughAnnouncement_(locator, opts) {
  const page = locator.page();
  try {
    await locator.click(opts);
  } catch (e) {
    await dismissAnnouncementIfPresent_(page, { timeout: 500 });
    await locator.click(opts);
  }
}

module.exports = { dismissAnnouncementIfPresent_, clickThroughAnnouncement_ };
