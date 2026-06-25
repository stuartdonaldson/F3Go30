const assert = require('node:assert/strict');

// GAS global stubs — must be set before require.
global.GasLogger = { log: function() {}, run: function(name, fn) { return fn(); } };
global.LockService = { getScriptLock: function() { return { waitLock: function() {}, releaseLock: function() {} }; } };

const {
  _mergeTrackerDbRowsForScan_,
  _carryForwardLifecycleFields_,
  resolveTrackerDbRowForContextDate_,
  upsertPaxDbRow_,
  findMostRecentPaxRecordForName_,
  findMostRecentPaxRecordForEmail_,
  deletePaxDbRowsBySheetId_,
  _readPaxDbRowsBySheetId_
} = require('../script/go30tools.js');

// Scanned row wins over an existing row for the same SheetId.
assert.deepEqual(
  _mergeTrackerDbRowsForScan_(
    { 'sheet-a': { sheetId: 'sheet-a', totalPax: 5 } },
    [{ sheetId: 'sheet-a', totalPax: 12 }]
  ),
  [{ sheetId: 'sheet-a', totalPax: 12 }]
);

// A pre-existing row not touched by this scan (e.g. upserted directly by
// CreateNewTracker.js for a spreadsheet outside the scanned folder) survives.
assert.deepEqual(
  _mergeTrackerDbRowsForScan_(
    {
      'sheet-a': { sheetId: 'sheet-a', totalPax: 5 },
      'sheet-b': { sheetId: 'sheet-b', totalPax: 0, lastSignupAt: '2026-06-01' }
    },
    [{ sheetId: 'sheet-a', totalPax: 12 }]
  ),
  [
    { sheetId: 'sheet-a', totalPax: 12 },
    { sheetId: 'sheet-b', totalPax: 0, lastSignupAt: '2026-06-01' }
  ]
);

// No pre-existing rows -> scanned rows pass through unchanged.
assert.deepEqual(
  _mergeTrackerDbRowsForScan_({}, [{ sheetId: 'sheet-a', totalPax: 12 }]),
  [{ sheetId: 'sheet-a', totalPax: 12 }]
);

// Lifecycle timestamps carry forward unchanged when a tracker is re-scanned for an
// unrelated reason (e.g. its Tracker sheet was modified) — the scan itself never sets them.
assert.deepEqual(
  _carryForwardLifecycleFields_({
    sheetId: 'sheet-a',
    lastSignupAt: '2026-06-01',
    triggersInitializedAt: '2026-05-15',
    lastMinusOneRunAt: '2026-06-22',
    lastNagRunAt: '2026-06-20'
  }),
  {
    lastSignupAt: '2026-06-01',
    triggersInitializedAt: '2026-05-15',
    lastMinusOneRunAt: '2026-06-22',
    lastNagRunAt: '2026-06-20'
  }
);

// Missing existing row or missing fields default to '' rather than throwing.
assert.deepEqual(
  _carryForwardLifecycleFields_(null),
  { lastSignupAt: '', triggersInitializedAt: '', lastMinusOneRunAt: '', lastNagRunAt: '' }
);
assert.deepEqual(
  _carryForwardLifecycleFields_({ sheetId: 'sheet-a', lastSignupAt: '2026-06-01' }),
  { lastSignupAt: '2026-06-01', triggersInitializedAt: '', lastMinusOneRunAt: '', lastNagRunAt: '' }
);

// resolveTrackerDbRowForContextDate_ — ADR-010 TrackerDB date-range matching rule (F3Go30-vr80)

const TRACKER_ROWS = [
  { sheetId: 'sheet-april', startDate: '2026-04-01' },
  { sheetId: 'sheet-may', startDate: '2026-05-01' },
  { sheetId: 'sheet-june', startDate: '2026-06-01' }
];

// Exact match: a context date inside a row's active range (its StartDate up to the
// next row's StartDate) resolves to that single row.
assert.equal(
  resolveTrackerDbRowForContextDate_(TRACKER_ROWS, new Date(2026, 4, 15)).sheetId,
  'sheet-may'
);

// Exact match on the boundary date itself.
assert.equal(
  resolveTrackerDbRowForContextDate_(TRACKER_ROWS, new Date(2026, 5, 1)).sheetId,
  'sheet-june'
);

// Exact match: the latest row's range is open-ended (no later row to bound it).
assert.equal(
  resolveTrackerDbRowForContextDate_(TRACKER_ROWS, new Date(2027, 0, 1)).sheetId,
  'sheet-june'
);

// No match: a context date before the earliest row's StartDate fails loudly.
assert.throws(
  function() { resolveTrackerDbRowForContextDate_(TRACKER_ROWS, new Date(2026, 2, 1)); },
  /no TrackerDB row matches/
);

// No match: empty TrackerDB.
assert.throws(
  function() { resolveTrackerDbRowForContextDate_([], new Date(2026, 4, 15)); },
  /no TrackerDB row matches/
);

// Overlapping-range ambiguity: two rows share the same StartDate (e.g. a tracker was
// re-created for the same month) — any context date in that range must fail loudly,
// never silently pick one.
const AMBIGUOUS_ROWS = [
  { sheetId: 'sheet-may', startDate: '2026-05-01' },
  { sheetId: 'sheet-may-v2', startDate: '2026-05-01' },
  { sheetId: 'sheet-june', startDate: '2026-06-01' }
];
assert.throws(
  function() { resolveTrackerDbRowForContextDate_(AMBIGUOUS_ROWS, new Date(2026, 4, 15)); },
  /ambiguous match/
);

// --- upsertPaxDbRow_ / findMostRecentPaxRecordForName_ — incremental PaxDB writes/reads,
// replacing the old Config 'Last Month Tracker' + cross-spreadsheet walk-back ---

const PAX_DB_TEST_HEADERS = [
  'SheetId', 'Date', 'F3 Name', 'Team', 'WHO', 'WHAT', 'HOW', 'Comments',
  'Hit', 'Miss', 'NoCheckin', 'Fellowship', 'Q Point', 'Inspire', 'EHing FNG',
  'Email', 'Team Type', 'Other Team', 'Phone', 'NAG Email'
];

function makeFakePaxDbSheet(initialDataRows, headersOverride) {
  var headers = (headersOverride || PAX_DB_TEST_HEADERS).slice();
  var rows = (initialDataRows || []).map(function(r) { return r.slice(); });

  function rangeAt(row, col, numRows, numCols) {
    numRows = numRows || 1;
    numCols = numCols || 1;
    return {
      getValues: function() {
        var out = [];
        for (var r = 0; r < numRows; r++) {
          var rowIndex = row + r;
          var sourceRow = rowIndex === 1 ? headers : rows[rowIndex - 2];
          var slice = (sourceRow || []).slice(col - 1, col - 1 + numCols);
          while (slice.length < numCols) slice.push('');
          out.push(slice);
        }
        return out;
      },
      setValues: function(values) {
        for (var r = 0; r < values.length; r++) {
          var rowIndex = row + r;
          var target = rowIndex === 1 ? headers : null;
          if (rowIndex > 1) {
            var bodyIdx = rowIndex - 2;
            while (rows.length <= bodyIdx) rows.push(new Array(headers.length).fill(''));
            target = rows[bodyIdx];
          }
          for (var c = 0; c < values[r].length; c++) target[col - 1 + c] = values[r][c];
        }
        return this;
      },
      setValue: function(value) {
        return this.setValues([[value]]);
      },
      setFontWeight: function() { return this; },
      clearContent: function() {
        var startBodyRow = row - 2;
        if (startBodyRow >= 0) rows.splice(startBodyRow, numRows);
        return this;
      }
    };
  }

  return {
    getLastRow: function() { return rows.length + 1; },
    getMaxRows: function() { return rows.length + 1; },
    getLastColumn: function() { return headers.length; },
    getRange: rangeAt,
    getDataRange: function() { return rangeAt(1, 1, rows.length + 1, headers.length); },
    _rows: rows,
    _headers: headers
  };
}

function makeFakePaxDbSpreadsheet(sheet) {
  return {
    getSheetByName: function(name) { return name === 'PaxDB' ? sheet : null; },
    insertSheet: function() { throw new Error('insertSheet should not be called when PaxDB already exists'); }
  };
}

// Creates a new row when no (SheetId, F3 Name) match exists.
{
  var sheet = makeFakePaxDbSheet([]);
  var ss = makeFakePaxDbSpreadsheet(sheet);
  var result = upsertPaxDbRow_(ss, { sheetId: 'sheet-july', f3Name: 'Anchor', team: 'Crucible', who: 'A leader' });
  assert.deepEqual(result, { created: true, row: 2 });
  assert.equal(sheet._rows[0][0], 'sheet-july');
  assert.equal(sheet._rows[0][2], 'Anchor');
  assert.equal(sheet._rows[0][3], 'Crucible');
  assert.equal(sheet._rows[0][4], 'A leader');
}

// Updates only the fields provided, preserving everything else already on the row —
// case-insensitive F3 Name match, exact SheetId match.
{
  var existingRow = new Array(PAX_DB_TEST_HEADERS.length).fill('');
  existingRow[0] = 'sheet-july'; existingRow[2] = 'anchor'; existingRow[3] = 'Crucible'; existingRow[8] = 5;
  var sheet2 = makeFakePaxDbSheet([existingRow]);
  var ss2 = makeFakePaxDbSpreadsheet(sheet2);
  var result2 = upsertPaxDbRow_(ss2, { sheetId: 'sheet-july', f3Name: 'Anchor', who: 'Updated WHO' });
  assert.deepEqual(result2, { created: false, row: 2 });
  assert.equal(sheet2._rows[0][3], 'Crucible', 'untouched field preserved');
  assert.equal(sheet2._rows[0][8], 5, 'untouched numeric field preserved');
  assert.equal(sheet2._rows[0][4], 'Updated WHO', 'provided field written');
}

// Same F3 Name, different SheetId -> no match, creates a separate row (different month).
{
  var otherMonthRow = new Array(PAX_DB_TEST_HEADERS.length).fill('');
  otherMonthRow[0] = 'sheet-june'; otherMonthRow[2] = 'Anchor';
  var sheet3 = makeFakePaxDbSheet([otherMonthRow]);
  var ss3 = makeFakePaxDbSpreadsheet(sheet3);
  var result3 = upsertPaxDbRow_(ss3, { sheetId: 'sheet-july', f3Name: 'Anchor', team: 'NewTeam' });
  assert.equal(result3.created, true);
  assert.equal(sheet3._rows.length, 2);
}

// Self-heal: a PaxDB sheet predating the Email/Team Type/etc. columns must not silently drop
// that data — it should warn (via GasLogger, not asserted here) and add the missing column,
// same convention as ensureResponseColumn_ for the Responses sheet.
{
  var oldHeaders = ['SheetId', 'Date', 'F3 Name', 'Team', 'WHO', 'WHAT', 'HOW', 'Comments', 'Hit', 'Miss', 'NoCheckin', 'Fellowship', 'Q Point', 'Inspire', 'EHing FNG'];
  var sheet5 = makeFakePaxDbSheet([], oldHeaders);
  var ss5 = makeFakePaxDbSpreadsheet(sheet5);
  upsertPaxDbRow_(ss5, { sheetId: 'sheet-july', f3Name: 'Anchor', email: 'anchor@example.com' });
  assert.ok(sheet5._headers.indexOf('Email') !== -1, 'missing column gets added rather than the value being dropped');
  assert.equal(sheet5._rows[0][sheet5._headers.indexOf('Email')], 'anchor@example.com');
}

// findMostRecentPaxRecordForName_ — most recent by Date, excluding the caller's own sheetId.
{
  var rowJune = new Array(PAX_DB_TEST_HEADERS.length).fill('');
  rowJune[0] = 'sheet-june'; rowJune[1] = '2026-06-01'; rowJune[2] = 'Anchor'; rowJune[3] = 'JuneTeam';
  var rowMay = new Array(PAX_DB_TEST_HEADERS.length).fill('');
  rowMay[0] = 'sheet-may'; rowMay[1] = '2026-05-01'; rowMay[2] = 'Anchor'; rowMay[3] = 'MayTeam';
  var rowJulySelf = new Array(PAX_DB_TEST_HEADERS.length).fill('');
  rowJulySelf[0] = 'sheet-july'; rowJulySelf[1] = '2026-07-01'; rowJulySelf[2] = 'Anchor'; rowJulySelf[3] = 'JulyTeam';
  var sheet4 = makeFakePaxDbSheet([rowJune, rowMay, rowJulySelf]);
  var ss4 = makeFakePaxDbSpreadsheet(sheet4);

  var mostRecent = findMostRecentPaxRecordForName_(ss4, 'anchor', 'sheet-july');
  assert.equal(mostRecent.sheetId, 'sheet-june', 'most recent prior to the excluded (current) sheetId');
  assert.equal(mostRecent.team, 'JuneTeam');

  assert.equal(findMostRecentPaxRecordForName_(ss4, 'Nobody', 'sheet-july'), null);
  assert.equal(findMostRecentPaxRecordForName_(ss4, '', 'sheet-july'), null, 'blank name returns null without throwing');
}

// findMostRecentPaxRecordForEmail_ — same lookup, matched on Email instead of F3 Name (for
// admin utilities that only have an email address, e.g. applyPaxDbSettingsToCurrentTracker).
{
  var rowMay2 = new Array(PAX_DB_TEST_HEADERS.length).fill('');
  rowMay2[0] = 'sheet-may'; rowMay2[1] = '2026-05-01'; rowMay2[2] = 'Anchor'; rowMay2[15] = 'anchor@example.com';
  var sheet6 = makeFakePaxDbSheet([rowMay2]);
  var ss6 = makeFakePaxDbSpreadsheet(sheet6);

  var byEmail = findMostRecentPaxRecordForEmail_(ss6, 'Anchor@Example.com', 'sheet-july');
  assert.equal(byEmail.sheetId, 'sheet-may', 'case-insensitive email match');
  assert.equal(findMostRecentPaxRecordForEmail_(ss6, 'nobody@example.com', 'sheet-july'), null);
}

// deletePaxDbRowsBySheetId_ — removes all PaxDB rows for a given sheetId and rewrites the sheet.
{
  // Throws when sheetId is absent.
  var sheetDel0 = makeFakePaxDbSheet([]);
  var ssDel0 = makeFakePaxDbSpreadsheet(sheetDel0);
  assert.throws(function() { deletePaxDbRowsBySheetId_(ssDel0, ''); }, /sheetId required/);

  // Returns 0 when sheetId not present in PaxDB.
  var rowOther = new Array(PAX_DB_TEST_HEADERS.length).fill('');
  rowOther[0] = 'sheet-other';
  var sheetDel1 = makeFakePaxDbSheet([rowOther]);
  var ssDel1 = makeFakePaxDbSpreadsheet(sheetDel1);
  assert.equal(deletePaxDbRowsBySheetId_(ssDel1, 'sheet-gone'), 0, 'returns 0 for unknown sheetId');
  assert.equal(sheetDel1._rows.length, 1, 'unrelated row preserved');

  // Removes rows for the target sheetId, preserves rows for other sheetIds, returns count.
  var rowA1 = new Array(PAX_DB_TEST_HEADERS.length).fill('');
  rowA1[0] = 'sheet-smoke'; rowA1[2] = 'Alpha';
  var rowA2 = new Array(PAX_DB_TEST_HEADERS.length).fill('');
  rowA2[0] = 'sheet-smoke'; rowA2[2] = 'Beta';
  var rowB = new Array(PAX_DB_TEST_HEADERS.length).fill('');
  rowB[0] = 'sheet-keep'; rowB[2] = 'Gamma';
  var sheetDel2 = makeFakePaxDbSheet([rowA1, rowA2, rowB]);
  var ssDel2 = makeFakePaxDbSpreadsheet(sheetDel2);
  var deleted = deletePaxDbRowsBySheetId_(ssDel2, 'sheet-smoke');
  assert.equal(deleted, 2, 'returns count of removed rows');
  var remaining = _readPaxDbRowsBySheetId_(ssDel2);
  assert.ok(!remaining.bySheetId['sheet-smoke'], 'smoke rows removed');
  assert.ok(remaining.bySheetId['sheet-keep'], 'keep rows preserved');
  assert.equal(remaining.bySheetId['sheet-keep'].length, 1);
}

console.log('test_go30tools.js: PASS');
