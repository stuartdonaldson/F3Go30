/**
 * Live validation for TrackerEditTrigger.js's onEdit handler — drives REAL Sheets-UI edits
 * against an existing SIT tracker, since onEdit only fires for genuine human/browser edits
 * (never SpreadsheetApp/Sheets-API writes, ADR-013) and can't be proven any other way. Not part
 * of the unit suite (npm test) — this is a one-off/occasional manual re-validation check, run
 * directly:
 *
 *   TRACKER_EDIT_CHECK_SHEET_ID=<sheetId> npx playwright test tests/playwright/tracker-edit-trigger-live-check.spec.js
 *
 * Prerequisites:
 *   node authenticate.js   (one-time Google auth capture)
 *   npm run deploy:sit     (push current code to testScriptId first)
 *   The target tracker must already have the edit trigger registered — new trackers get it
 *   automatically via CreateNewTracker.js; an existing pre-.440b.4 tracker needs a one-off
 *   backfill (see F3Go30-440b.5 for the permanent version).
 *
 * Each scenario is verified against the actual live Tracker cell value (read back via the
 * getSheet admin action), not just by eyeballing Axiom — a Sheets-UI click/type/Enter sequence
 * can silently no-op (an autocomplete popup swallowing the click, a stray focus change) with no
 * error anywhere, so asserting on the real cell value is what actually proves the edit landed.
 * Each test also logs which Axiom event name to spot-check (.patched vs .invalidated), since the
 * cell value alone can't distinguish those — cache freshness is the thing under test, not the
 * write itself.
 *
 * Before the "patches" scenario, the cache is force-invalidated and then explicitly re-warmed
 * via a live cmd=checkin identify call for a real PAX (TokenFlowTest) — the same live-read path
 * a real check-in takes (resolveCheckinIdentityFull_, dashboardWebapp.js) — so that scenario
 * demonstrates the patch path against a genuinely warm cache. Running this suite immediately
 * after `npm run deploy:sit` without that warm-up used to make the "patches" scenario misleading:
 * a fresh SIT deploy's own invalidateAllCache step wipes the whole PaxCache store, so the very
 * first edit after a deploy always wipes too, no matter how narrow the edit is (observed live on
 * 2026-07-21/22 — see F3Go30-o39s.11/.12).
 *
 * Coverage:
 *  - Tracker single-cell edit on a known PAX row, against a warm cache -> patches (C10,
 *    F3Go30-o39s.11), not a whole-sheet wipe.
 *  - A wipe self-heals the roster index immediately (C11, F3Go30-o39s.12): forces a cold cache,
 *    edits once (expect a wipe that also rebuilds the roster index), then edits again on the
 *    same row (expect a patch, with no live PAX check-in in between the two edits).
 *  - A multi-cell clear (Shift+ArrowRight then Delete) -> wipe fallback (a multi-cell edit can
 *    never be safely narrowed to one PAX row).
 *
 * NOT covered here: Responses-sheet edits, Bonus Tracker edits, and a Tracker header-row edit.
 * Automating those needs pixel coordinates calibrated against each sheet's actual live layout —
 * a header-row edit in particular risks overwriting a real column-label cell that column-
 * resolution logic elsewhere depends on. This suite has no live visual access to calibrate that
 * blind, so rather than guess coordinates against a real spreadsheet, those branches are left to
 * the unit suite instead (test/test_tracker_edit_trigger.js — fully stubbed, no live-data risk):
 * see its "Multi-cell range (paste) falls back to wipe", "Header-row edit falls back to wipe",
 * and "Responses edit with no cached column layout falls back to wipe" cases.
 */
const { test, expect } = require('@playwright/test');
const { loadSettings, buildPayload_, post, ENV_MAP } = require('../../tools/callWebapp.js');

const SHEET_ID = process.env.TRACKER_EDIT_CHECK_SHEET_ID;
const CHECK_ENV = process.env.TRACKER_EDIT_CHECK_ENV || 'sit';

// Same test PAX identity-token-flow.spec.js signs up as (tests/playwright/identity-token-flow.spec.js)
// — used here only to drive a live cmd=checkin identify call that warms PaxCache, not to assert
// anything about the identity/token flow itself.
const WARM_PAX = { f3Name: 'TokenFlowTest', email: 'tokenflowtest@example.com' };

// Pixel coordinates of TokenFlowTest's Fri Jul 03 checkin cell (Tracker sheet row 10, column K)
// on the Sheets grid. Sheets is canvas-rendered, not real DOM cells — this is a calibrated pixel
// click, not a cell reference (the Name Box doesn't respond reliably to synthetic keyboard
// events, so cell-reference navigation isn't a viable alternative here). Recalibrate against a
// screenshot if the tracker layout or viewport (playwright.config.js pins 1280x900) changes.
const TRACKER_CHECKIN_CELL = { x: 361, y: 455 };
// Row/column of that same cell in getSheet's returned values, for read-back verification —
// 0-based to match a plain array index (row: TokenFlowTest's row in the CSV dump; col: K).
const TRACKER_CHECKIN_ROW_PAX_NAME = 'TokenFlowTest';
const TRACKER_CHECKIN_COL_INDEX_ZERO_BASED = 10; // A=0 ... K=10

/** Calls a webapp action on a given cmd endpoint — same request shape as tools/callWebapp.js. */
async function callWebappAction(cmd, action, extraBody) {
  const settings = loadSettings();
  const { deploymentIdKey, adminSecretKey } = ENV_MAP[CHECK_ENV];
  const deploymentId = settings[deploymentIdKey];
  const adminSecret = cmd === 'admin' ? settings[adminSecretKey] : null;
  const url = `https://script.google.com/macros/s/${deploymentId}/exec?cmd=${cmd}`;
  const payload = buildPayload_(action, cmd, extraBody || {}, adminSecret);
  return post(url, payload);
}

async function callAdminAction(action, extraBody) {
  return callWebappAction('admin', action, extraBody);
}

/** Forces a cold PaxCache — same invalidateAllCache admin action npm run deploy:sit calls. */
async function invalidateCache() {
  return callAdminAction('invalidateAllCache');
}

/**
 * Warms PaxCache for SHEET_ID specifically via a live cmd=checkin identify call for a real PAX —
 * the same resolveCheckinIdentityFull_ live-read path a real check-in takes, which rebuilds the
 * roster index + per-PAX rows as a side effect. targetMonth: 'explicit' + targetSheetId pins this
 * to SHEET_ID rather than whatever "current month" would otherwise resolve to.
 */
async function warmPaxCache() {
  return callWebappAction('checkin', 'identify', {
    f3Name: WARM_PAX.f3Name, email: WARM_PAX.email,
    targetMonth: 'explicit', targetSheetId: SHEET_ID,
  });
}

/** Reads TokenFlowTest's live Fri Jul 03 checkin cell value straight off the Tracker sheet. */
async function readCheckinCellValue() {
  const result = await callAdminAction('getSheet', { sheetId: SHEET_ID, sheetName: 'Tracker' });
  const rows = String(result.csv || '').split('\n').map(function(r) { return r.split('\t'); });
  const row = rows.find(function(r) { return r[0] && r[0].trim() === TRACKER_CHECKIN_ROW_PAX_NAME; });
  if (!row) throw new Error(`getSheet returned no Tracker row for ${TRACKER_CHECKIN_ROW_PAX_NAME}`);
  return (row[TRACKER_CHECKIN_COL_INDEX_ZERO_BASED] || '').trim();
}

async function openTrackerTab(page) {
  await page.goto(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const trackerTab = page.locator('.docs-sheet-tab', { hasText: 'Tracker' }).first();
  await trackerTab.click();
  await page.waitForTimeout(1500);
}

/**
 * Clicks TokenFlowTest's checkin cell, types a value, and commits it. Presses Escape after Enter
 * to close any autocomplete/suggestion popover Sheets may have raised — without this, a second
 * edit's click can land on leftover UI chrome instead of the grid and silently no-op (observed
 * live on 2026-07-22: a second same-cell edit produced no Axiom event at all, not even an error).
 */
async function editCheckinCell(page, value) {
  await page.mouse.click(TRACKER_CHECKIN_CELL.x, TRACKER_CHECKIN_CELL.y);
  await page.waitForTimeout(500);
  await page.keyboard.type(String(value));
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(6000);
}

test.describe('TrackerEditTrigger live check', () => {
  test('a real Sheets-UI single-cell edit on a warm cache patches (C10) — not a whole-sheet wipe', async ({ page }) => {
    test.skip(!SHEET_ID, 'Set TRACKER_EDIT_CHECK_SHEET_ID to a tracker sheetId (with the edit trigger already registered) to run this check.');

    await invalidateCache();
    const warmResult = await warmPaxCache();
    expect(warmResult.matched).toBe(true);

    await openTrackerTab(page);
    await editCheckinCell(page, 7);
    await expect.poll(readCheckinCellValue, { timeout: 15000 }).toBe('7');

    console.log(`Edited a checkin cell on Tracker sheet of ${SHEET_ID} against a pre-warmed cache — check Axiom for handleTrackerEdit_.patched (NOT .invalidated) with this sheetId (C10, F3Go30-o39s.11).`);
  });

  test('a wipe self-heals the roster index (C11) — the next edit on the same row patches with no live PAX check-in in between', async ({ page }) => {
    test.skip(!SHEET_ID, 'Set TRACKER_EDIT_CHECK_SHEET_ID to a tracker sheetId (with the edit trigger already registered) to run this check.');

    const invalidateResult = await invalidateCache();
    console.log(`Forced a cold PaxCache on ${CHECK_ENV.toUpperCase()} via invalidateAllCache:`, invalidateResult);

    await openTrackerTab(page);

    await editCheckinCell(page, 8);
    await expect.poll(readCheckinCellValue, { timeout: 15000 }).toBe('8');

    // Second edit on the very same cell — with C11's self-heal working, this now patches; if it
    // regressed, this wipes again (the exact failure mode diagnosed live on 2026-07-21, where a
    // run of manual test edits kept re-wiping because nothing rebuilt the roster index between
    // edits since no PAX was actively checking in).
    await editCheckinCell(page, 9);
    await expect.poll(readCheckinCellValue, { timeout: 15000 }).toBe('9');

    console.log(`Edited the same checkin cell twice on a forced-cold cache for sheetId ${SHEET_ID} — check Axiom for exactly one handleTrackerEdit_.invalidated (the first edit) followed by handleTrackerEdit_.patched (the second edit), not two invalidated events (C11, F3Go30-o39s.12).`);
  });

  test('a multi-cell clear falls back to a whole-sheet wipe', async ({ page }) => {
    test.skip(!SHEET_ID, 'Set TRACKER_EDIT_CHECK_SHEET_ID to a tracker sheetId (with the edit trigger already registered) to run this check.');

    await openTrackerTab(page);

    // Seed a known value first so the Delete below is a verifiable change, not a no-op clear of
    // an already-blank cell.
    await editCheckinCell(page, 6);
    await expect.poll(readCheckinCellValue, { timeout: 15000 }).toBe('6');

    await page.mouse.click(TRACKER_CHECKIN_CELL.x, TRACKER_CHECKIN_CELL.y);
    await page.waitForTimeout(500);
    // Extend the selection one column right (still the same PAX row) — Shift+Arrow only selects
    // a range, never types into anything.
    await page.keyboard.press('Shift+ArrowRight');
    await page.waitForTimeout(300);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(6000);
    await expect.poll(readCheckinCellValue, { timeout: 15000 }).toBe('');

    console.log(`Cleared a 2-cell range on Tracker sheet of ${SHEET_ID} — check Axiom for handleTrackerEdit_.invalidated (a multi-cell edit can never be safely narrowed to one PAX row, so it always wipes).`);
  });
});
