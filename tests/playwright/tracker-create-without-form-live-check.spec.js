/**
 * Live check that tracker creation carries no HC Form (ADR-024, F3Go30-61ln.5).
 *
 * Drives admin.createTrackerForMonth on SIT for a far-future month no real tracker will ever use,
 * then asserts the outcome three ways: the created spreadsheet has no linked Form
 * (linkedFormUrl, read back by the server from the spreadsheet itself), its TrackerDB row has
 * blank ShortHC / HC URL / FormId, and its own Config "Signup HC Form" row is blank. The tracker
 * is always removed afterwards with admin.cleanupTracker (TrackerDB + PaxDB rows, trashed
 * spreadsheet).
 *
 * copy-and-init.spec.js cannot carry this: it runs the copyAndInit menu entry, which prompts for
 * the month, so it never knows which tracker it created.
 *
 * SIT only. Creating a tracker installs triggers — if SIT is at its per-script trigger quota the
 * create fails (bd memory F3Go30-sit-trigger-quota-exceeded).
 *
 * Usage: pnpm exec playwright test tests/playwright/tracker-create-without-form-live-check.spec.js
 */
const { test, expect } = require('@playwright/test');
const { loadSettings, buildPayload_, post, ENV_MAP } = require('../../tools/callWebapp.js');

test.use({ storageState: undefined, headless: true });
test.describe.configure({ timeout: 300000 });

const TEST_MONTH_ISO = '2031-01-01';

async function adminCall(action, extraBody) {
  const settings = loadSettings();
  const { deploymentIdKey, adminSecretKey } = ENV_MAP.sit;
  const url = `https://script.google.com/macros/s/${settings[deploymentIdKey]}/exec?cmd=admin`;
  return post(url, buildPayload_(action, 'admin', extraBody, settings[adminSecretKey]));
}

/** Reads a sheet via admin.getSheet as an array of rows of trimmed cell strings. */
async function readSheetCells(sheetName, sheetId) {
  const result = await adminCall('getSheet', sheetId ? { sheetName, sheetId } : { sheetName });
  expect(result.ok, `getSheet ${sheetName}: ${JSON.stringify(result)}`).toBe(true);
  return result.csv.split('\n').map((l) => l.split('\t').map((c) => c.trim()));
}

/** Reads a sheet with a header row as an array of {header: value} objects. */
async function readSheetRows(sheetName, sheetId) {
  const lines = await readSheetCells(sheetName, sheetId);
  const headers = lines[0];
  return lines.slice(1).map((cells) => {
    const row = {};
    headers.forEach((h, i) => { row[h] = cells[i] || ''; });
    return row;
  });
}

function isTestMonth(startDateCell) {
  const d = new Date(startDateCell);
  return !isNaN(d.getTime()) && d.getFullYear() === 2031 && d.getMonth() === 0;
}

test.describe('Tracker creation without an HC Form — live SIT (F3Go30-61ln.5)', () => {
  test('a created tracker has no linked Form and blank HC columns', async () => {
    // Leftovers from an aborted earlier run would make the create rename them "(Expired)" —
    // remove them first. No real tracker exists for this month.
    for (const row of (await readSheetRows('TrackerDB')).filter((r) => isTestMonth(r.StartDate) && r.SheetId)) {
      console.log(`Removing leftover test tracker ${row.SpreadsheetName} (${row.SheetId})`);
      await adminCall('cleanupTracker', { sheetId: row.SheetId, trashSpreadsheet: true });
    }

    const created = await adminCall('createTrackerForMonth', { startDateIso: TEST_MONTH_ISO });
    const sheetId = created && created.sheetId;
    try {
      expect(created.ok, `createTrackerForMonth: ${JSON.stringify(created)}`).toBe(true);
      expect(sheetId).toBeTruthy();
      expect(created.linkedFormUrl, 'the new spreadsheet must have no linked Form').toBe('');

      const dbRow = (await readSheetRows('TrackerDB')).find((r) => r.SheetId === sheetId);
      expect(dbRow, 'the new tracker must have a TrackerDB row').toBeTruthy();
      expect(isTestMonth(dbRow.StartDate), `StartDate ${dbRow.StartDate}`).toBe(true);
      expect(dbRow.ShortHC, 'TrackerDB ShortHC').toBe('');
      expect(dbRow['HC URL'], 'TrackerDB HC URL').toBe('');
      expect(dbRow.FormId, 'TrackerDB FormId').toBe('');

      // Config has no header row: column A name, B primary, C secondary.
      const hcRow = (await readSheetCells('Config', sheetId)).find((cells) => cells[0] === 'Signup HC Form');
      expect(hcRow, 'tracker Config must carry a "Signup HC Form" row (blanked at creation)').toBeTruthy();
      expect(hcRow[1] || '', 'tracker Config "Signup HC Form" primary').toBe('');
      expect(hcRow[2] || '', 'tracker Config "Signup HC Form" secondary').toBe('');
    } finally {
      if (sheetId) {
        const cleaned = await adminCall('cleanupTracker', { sheetId, trashSpreadsheet: true });
        expect(cleaned.ok, `cleanupTracker: ${JSON.stringify(cleaned)}`).toBe(true);
      }
    }

    const after = (await readSheetRows('TrackerDB')).filter((r) => r.SheetId === sheetId);
    expect(after.length, 'cleanupTracker must remove the TrackerDB row').toBe(0);
  });
});
