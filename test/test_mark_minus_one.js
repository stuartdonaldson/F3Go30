const assert = require('node:assert/strict');

// GAS global stubs — must be set before require.
global.Logger = { log: function() {} };
global.GasLogger = { log: function() {}, run: function(name, fn) { return fn(); } };

global.Utilities = {
  formatDate: function(date, tz, pattern) {
    return String(date.getMonth() + 1).padStart(2, '0') + '/' +
      String(date.getDate()).padStart(2, '0') + '/' +
      date.getFullYear();
  }
};

// Builds a fake Tracker sheet. `dateRow` is the row-3 header (dates) array (1 = col A).
// `rows` is an array of { f3Name, valueAtThresholdCol, formulaAtThresholdCol } from row 4 on.
function makeFakeTrackerSheet(dateRow, rows) {
  var lastColumn = dateRow.length;
  var setValuesCalls = [];

  return {
    getParent: function() { return { getSpreadsheetTimeZone: function() { return 'America/Los_Angeles'; } }; },
    getLastColumn: function() { return lastColumn; },
    getLastRow: function() { return rows.length + 3; },
    getRange: function(row, col, numRows, numCols) {
      if (row === 3) {
        return { getValues: function() { return [dateRow]; } };
      }
      if (row === 4 && numCols === 1 && col === 1) {
        return { getValues: function() { return rows.map(function(r) { return [r.f3Name]; }); } };
      }
      if (row === 4 && numCols === 1) {
        return {
          getValues: function() { return rows.map(function(r) { return [r.valueAtThresholdCol]; }); },
          getFormulas: function() { return rows.map(function(r) { return [r.formulaAtThresholdCol || '']; }); },
          setValues: function(values) { setValuesCalls.push(values); }
        };
      }
      throw new Error('Unexpected getRange(' + row + ', ' + col + ', ' + numRows + ', ' + numCols + ')');
    },
    _setValuesCalls: setValuesCalls
  };
}

function makeFakeSpreadsheet(sheetsByName) {
  return {
    getId: function() { return 'fake-spreadsheet-id'; },
    getSheetByName: function(name) { return sheetsByName[name] || null; }
  };
}

const { markEmptyCellsAsMinusOne_, applyMinusOneToTrackerSheet_ } = require('../script/markMinusOne.js');

// A context date two years in the future (a "future TrackerDB row") with an explicit
// SheetId — proves the dispatch path resolves via TrackerDB + openById, not the active
// spreadsheet, per ADR-010 / F3Go30-bga1's AC.
const FUTURE_CONTEXT_DATE = new Date(2028, 8, 15); // Sept 15, 2028
const THRESHOLD_DATE = new Date(2028, 8, 13); // contextDate - 2 days
const FUTURE_SHEET_ID = 'future-tracker-sheet-id';

const dateRow = ['', '', '', '', THRESHOLD_DATE]; // threshold date lands at column 5
const trackerRows = [
  { f3Name: 'Anchor', valueAtThresholdCol: '' },                          // blank, has name -> marked -1
  { f3Name: '', valueAtThresholdCol: '' },                                // no name -> left alone
  { f3Name: 'Sapper', valueAtThresholdCol: '', formulaAtThresholdCol: '=A1' }, // formula cell -> never overwritten
  { f3Name: 'Torch', valueAtThresholdCol: 1 }                             // already has a value -> untouched
];

const fakeSheet = makeFakeTrackerSheet(dateRow, trackerRows);
const fakeFutureSpreadsheet = makeFakeSpreadsheet({ Tracker: fakeSheet });

global.refreshPaxDbForTracker_ = function() {};

global.resolveTrackerForContextDate = function(targetDate) {
  // Must dispatch on (contextDate - 2 days) — the date actually being marked — not
  // contextDate itself, or a run on the 1st/2nd of a month resolves to the wrong
  // (brand-new) tracker instead of the one with that day's column (month-boundary bug).
  assert.equal(targetDate.getTime(), THRESHOLD_DATE.getTime(), 'lookup is called with contextDate - 2 days, not contextDate');
  return { sheetId: FUTURE_SHEET_ID, startDate: '2028-09-01' };
};
global.SpreadsheetApp = {
  openById: function(sheetId) {
    assert.equal(sheetId, FUTURE_SHEET_ID, 'opens the SheetId resolved by the TrackerDB lookup, not the active spreadsheet');
    return fakeFutureSpreadsheet;
  },
  getActiveSpreadsheet: function() {
    throw new Error('markEmptyCellsAsMinusOne_ must not use the active spreadsheet (ADR-010)');
  }
};

markEmptyCellsAsMinusOne_(FUTURE_CONTEXT_DATE);

assert.equal(fakeSheet._setValuesCalls.length, 1, 'writes the marked column back once');
assert.deepEqual(fakeSheet._setValuesCalls[0], [[-1], [''], [''], [1]],
  'only the blank, non-formula, named row is marked -1; others are left as-is');

// resolveTrackerForContextDate lookup failures (handled by F3Go30-vr80) propagate rather
// than being swallowed — no remaining getActiveSpreadsheet() fallback.
global.resolveTrackerForContextDate = function() {
  throw new Error('resolveTrackerDbRowForContextDate_: no TrackerDB row matches context date');
};
assert.throws(
  function() { markEmptyCellsAsMinusOne_(FUTURE_CONTEXT_DATE); },
  /no TrackerDB row matches/
);

// applyMinusOneToTrackerSheet_ accepts an already-resolved spreadsheet directly (the shape
// the dispatcher calls it with) and is otherwise pure date-math against the given contextDate.
const fakeSheet2 = makeFakeTrackerSheet(dateRow, trackerRows);
applyMinusOneToTrackerSheet_(makeFakeSpreadsheet({ Tracker: fakeSheet2 }), FUTURE_CONTEXT_DATE);
assert.equal(fakeSheet2._setValuesCalls.length, 1);

// --- F3Go30-o39s.3: nightly sweep keeps PaxCache coherent for BOTH current + prior month ---

// A fake Tracker sheet that also supports a full-range (row4:lastRow, all cols) read, needed
// by refreshPaxCacheForSheet_'s repopulate path — `rows` is an array of { cells: [...] }
// (one entry per data row, one value per column, column A = F3 Name).
function makeFakeFullTrackerSheet(dateRow, rows) {
  var lastColumn = dateRow.length;
  var grid = rows.map(function(r) { return r.cells.slice(); });
  var setValuesCalls = [];

  return {
    getParent: function() { return { getSpreadsheetTimeZone: function() { return 'America/Los_Angeles'; } }; },
    getLastColumn: function() { return lastColumn; },
    getLastRow: function() { return grid.length + 3; },
    getRange: function(row, col, numRows, numCols) {
      if (row === 3 && col === 1 && numCols === lastColumn) {
        return { getValues: function() { return [dateRow]; } };
      }
      if (row === 4 && numCols === 1 && numRows === grid.length) {
        var colIdx = col - 1;
        return {
          getValues: function() { return grid.map(function(r) { return [r[colIdx]]; }); },
          getFormulas: function() { return grid.map(function() { return ['']; }); },
          setValues: function(values) {
            setValuesCalls.push(values);
            values.forEach(function(v, i) { grid[i][colIdx] = v[0]; });
          }
        };
      }
      if (row === 4 && col === 1 && numCols === lastColumn && numRows === grid.length) {
        return { getValues: function() { return grid.map(function(r) { return r.slice(); }); } };
      }
      throw new Error('Unexpected getRange(' + row + ', ' + col + ', ' + numRows + ', ' + numCols + ')');
    },
    _setValuesCalls: setValuesCalls
  };
}

{
  const CURRENT_SHEET_ID = 'current-month-sheet';
  const PRIOR_SHEET_ID = 'prior-month-sheet';
  const TODAY = new Date(2029, 2, 2);      // March 2, 2029
  const THRESHOLD = new Date(2029, 1, 28); // Feb 28, 2029 == today - 2 days == day-0-of-March

  const priorSheet = makeFakeFullTrackerSheet(
    ['', '', '', '', THRESHOLD],
    [
      { cells: ['Anchor', 'x', 'y', 'z', ''] }, // blank at threshold col -> marked -1
      { cells: ['Torch', 'a', 'b', 'c', 1] }
    ]
  );
  const priorSpreadsheet = { getId: function() { return PRIOR_SHEET_ID; }, getSheetByName: function(name) { return name === 'Tracker' ? priorSheet : null; } };

  const currentSheet = makeFakeFullTrackerSheet(
    ['', '', '', '', ''],
    [{ cells: ['Bandit', 'p', 'q', 'r', 5] }]
  );
  const currentSpreadsheet = { getId: function() { return CURRENT_SHEET_ID; }, getSheetByName: function(name) { return name === 'Tracker' ? currentSheet : null; } };

  global.resolveTrackerForContextDate = function(targetDate) {
    if (targetDate.getTime() === THRESHOLD.getTime()) return { sheetId: PRIOR_SHEET_ID, startDate: '2029-02-01' };
    if (targetDate.getTime() === TODAY.getTime()) return { sheetId: CURRENT_SHEET_ID, startDate: '2029-03-01' };
    throw new Error('resolveTrackerForContextDate: unexpected date ' + targetDate.toISOString());
  };
  global.SpreadsheetApp = {
    openById: function(sheetId) {
      if (sheetId === PRIOR_SHEET_ID) return priorSpreadsheet;
      if (sheetId === CURRENT_SHEET_ID) return currentSpreadsheet;
      throw new Error('openById: unexpected sheetId ' + sheetId);
    },
    getActiveSpreadsheet: function() { throw new Error('markEmptyCellsAsMinusOne_ must not use the active spreadsheet (ADR-010)'); }
  };

  const bulkWriteCalls = [];
  const cacheWriteCalls = [];
  const wipeCalls = [];
  global.setPaxCacheRowsBulk_ = function(kind, sheetId, rowsByName, rosterIndex) {
    bulkWriteCalls.push({ kind: kind, sheetId: sheetId, rowsByName: rowsByName, rosterIndex: rosterIndex });
  };
  global.setCachedSheetValues_ = function(cacheKey, values) {
    cacheWriteCalls.push({ cacheKey: cacheKey, values: values });
  };
  global.trackerValuesCacheKey_ = function(sheetId) { return 'go30dash:trackerValues:' + sheetId; };
  global.paxCacheNormalizeName_ = function(name) { return String(name || '').trim().toLowerCase(); };
  global.wipePaxCacheAndRelatedCachesForSheet_ = function(sheetId) { wipeCalls.push(sheetId); };

  markEmptyCellsAsMinusOne_(TODAY);

  assert.equal(priorSheet._setValuesCalls.length, 1, 'the prior-month tracker (active for threshold day) gets marked');
  assert.equal(bulkWriteCalls.length, 2, 'both current-month and prior-month PaxCache get repopulated, not only the marked tracker');

  const bulkBySheet = {};
  bulkWriteCalls.forEach(function(c) { bulkBySheet[c.sheetId] = c; });

  assert.ok(bulkBySheet[PRIOR_SHEET_ID], 'prior-month tracker repopulated');
  assert.equal(bulkBySheet[PRIOR_SHEET_ID].rowsByName['Anchor'][4], -1,
    'repopulated prior-month PaxCache row reflects the just-marked -1 value, not the stale blank');
  assert.deepEqual(bulkBySheet[PRIOR_SHEET_ID].rosterIndex, { anchor: 0, torch: 1 });

  assert.ok(bulkBySheet[CURRENT_SHEET_ID], 'current-month tracker also repopulated even though markMinusOne only marked the prior month');
  assert.deepEqual(bulkBySheet[CURRENT_SHEET_ID].rosterIndex, { bandit: 0 });

  assert.equal(cacheWriteCalls.length, 2, 'the CacheService full-roster blob is refreshed for both months too');
  assert.equal(wipeCalls.length, 0, 'the repopulate path is used, not the wipe fallback, when the bulk-write helpers are available');

  console.log('test_mark_minus_one.js: F3Go30-o39s.3 repopulate-both-months PASS');
}

// --- Fallback: when the PaxCache bulk-write helpers aren't loaded, both months are fully
// wiped instead (ACCEPTABLE fallback per the AC) rather than left stale. ---
{
  const CURRENT_SHEET_ID = 'current-month-sheet-2';
  const PRIOR_SHEET_ID = 'prior-month-sheet-2';
  const TODAY = new Date(2029, 2, 2);
  const THRESHOLD = new Date(2029, 1, 28);

  const priorSheet = makeFakeFullTrackerSheet(
    ['', '', '', '', THRESHOLD],
    [{ cells: ['Ranger', '', '', '', ''] }]
  );
  const priorSpreadsheet = { getId: function() { return PRIOR_SHEET_ID; }, getSheetByName: function(name) { return name === 'Tracker' ? priorSheet : null; } };

  const currentSheet = makeFakeFullTrackerSheet(
    ['', '', '', '', ''],
    [{ cells: ['Digger', 'a', 'b', 'c', 2] }]
  );
  const currentSpreadsheet = { getId: function() { return CURRENT_SHEET_ID; }, getSheetByName: function(name) { return name === 'Tracker' ? currentSheet : null; } };

  global.resolveTrackerForContextDate = function(targetDate) {
    if (targetDate.getTime() === THRESHOLD.getTime()) return { sheetId: PRIOR_SHEET_ID, startDate: '2029-02-01' };
    if (targetDate.getTime() === TODAY.getTime()) return { sheetId: CURRENT_SHEET_ID, startDate: '2029-03-01' };
    throw new Error('resolveTrackerForContextDate: unexpected date ' + targetDate.toISOString());
  };
  global.SpreadsheetApp = {
    openById: function(sheetId) {
      if (sheetId === PRIOR_SHEET_ID) return priorSpreadsheet;
      if (sheetId === CURRENT_SHEET_ID) return currentSpreadsheet;
      throw new Error('openById: unexpected sheetId ' + sheetId);
    },
    getActiveSpreadsheet: function() { throw new Error('markEmptyCellsAsMinusOne_ must not use the active spreadsheet (ADR-010)'); }
  };

  // Simulate the bulk-write helpers not being loaded (this file's own unit tests, or a script
  // project state where dashboardWebapp.js/PaxCache.js weren't wired) — the fallback wipe path
  // must be used instead of silently leaving the cache stale.
  delete global.setPaxCacheRowsBulk_;
  delete global.paxCacheNormalizeName_;
  const wipeCalls = [];
  global.wipePaxCacheAndRelatedCachesForSheet_ = function(sheetId) { wipeCalls.push(sheetId); };

  markEmptyCellsAsMinusOne_(TODAY);

  assert.equal(priorSheet._setValuesCalls.length, 1, 'marking still happens regardless of PaxCache wiring');
  assert.deepEqual(wipeCalls.slice().sort(), [CURRENT_SHEET_ID, PRIOR_SHEET_ID].sort(),
    'falls back to a full wipe for both months when the repopulate helpers are unavailable');

  console.log('test_mark_minus_one.js: F3Go30-o39s.3 fallback-wipe-both-months PASS');
}

console.log('test_mark_minus_one.js: PASS');
