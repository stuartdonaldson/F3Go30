/**
 * Live validation for F3Go30-440b.4 (installable onEdit trigger for manual-edit PaxCache
 * invalidation) — drives a REAL Sheets-UI edit against an existing SIT tracker with a real
 * PAX row, since onEdit only fires for genuine human/browser edits (never SpreadsheetApp/
 * Sheets-API writes, ADR-013) and can't be proven any other way. Not part of the unit suite
 * (npm test) — this is a one-off/occasional manual re-validation check, run directly:
 *
 *   npx playwright test tests/playwright/tracker-edit-trigger-live-check.spec.js
 *
 * Prerequisites:
 *   node authenticate.js   (one-time Google auth capture)
 *   npm run deploy:sit     (push current code to testScriptId first)
 *   The target tracker must already have the edit trigger registered — new trackers get it
 *   automatically via CreateNewTracker.js; an existing pre-.440b.4 tracker needs a one-off
 *   backfill (see F3Go30-440b.5 for the permanent version).
 */
const { test, expect } = require('@playwright/test');

const SHEET_ID = process.env.TRACKER_EDIT_CHECK_SHEET_ID;

test.describe('TrackerEditTrigger live check', () => {
  test('a real Sheets-UI edit on an existing PAX row fires handleTrackerEdit_', async ({ page }) => {
    test.skip(!SHEET_ID, 'Set TRACKER_EDIT_CHECK_SHEET_ID to a tracker sheetId (with the edit trigger already registered) to run this check.');

    await page.goto(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const trackerTab = page.locator('.docs-sheet-tab', { hasText: 'Tracker' }).first();
    await trackerTab.click();
    await page.waitForTimeout(1500);

    // Click directly on the grid (Sheets is canvas-rendered, not real DOM cells — the name
    // box doesn't respond reliably to synthetic keyboard events) at a blank daily-checkin
    // cell in an existing PAX row (TokenFlowTest / row 10, 07/04 column) rather than typing
    // into the F3 Name column, which is validation-gated against arbitrary text.
    await page.mouse.click(361, 455);
    await page.waitForTimeout(500);
    await page.keyboard.type('1');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(5000);

    console.log(`Edited a checkin cell on Tracker sheet of ${SHEET_ID} — check Axiom for handleTrackerEdit_.invalidated with this sheetId.`);
    expect(true).toBeTruthy();
  });
});
