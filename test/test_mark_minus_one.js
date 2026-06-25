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

console.log('test_mark_minus_one.js: PASS');
