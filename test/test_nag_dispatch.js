const assert = require('node:assert/strict');

// GAS global stubs — must be set before require.
global.Logger = { log: function() {} };
global.GasLogger = { log: function() {}, run: function(name, fn) { return fn(); } };

const { sendNagEmail_ } = require('../script/nag.js');

// A context date two years in the future (a "future TrackerDB row") with an explicit
// SheetId — proves the dispatch path resolves via TrackerDB + openById, not the active
// spreadsheet, per ADR-010 / F3Go30-3sqo's AC.
const FUTURE_CONTEXT_DATE = new Date(2028, 8, 15);
const FUTURE_SHEET_ID = 'future-nag-sheet-id';

var openByIdCalls = [];
var resolveCalls = [];

global.resolveTrackerForContextDate = function(contextDate) {
  resolveCalls.push(contextDate);
  return { sheetId: FUTURE_SHEET_ID, startDate: '2028-09-01' };
};
global.SpreadsheetApp = {
  openById: function(sheetId) {
    openByIdCalls.push(sheetId);
    // No Tracker/Responses sheets on this stub — sendNagEmailForSpreadsheet_ should hit its
    // existing missingSheet early-return rather than throwing, proving the dispatch wiring
    // (resolve + open) works independent of the rest of the nag-email business logic, which
    // is already covered by test_nag.js's pure-function tests.
    return { getSheetByName: function() { return null; } };
  },
  getActiveSpreadsheet: function() {
    throw new Error('sendNagEmail_ must not use the active spreadsheet (ADR-010)');
  }
};

sendNagEmail_(FUTURE_CONTEXT_DATE);

assert.deepEqual(resolveCalls, [FUTURE_CONTEXT_DATE], 'lookup is called with the explicit context date, not "now"');
assert.deepEqual(openByIdCalls, [FUTURE_SHEET_ID], 'opens the SheetId resolved by the TrackerDB lookup, not the active spreadsheet');

// Lookup failures (handled by F3Go30-vr80) propagate rather than being swallowed.
global.resolveTrackerForContextDate = function() {
  throw new Error('resolveTrackerDbRowForContextDate_: no TrackerDB row matches context date');
};
assert.throws(
  function() { sendNagEmail_(FUTURE_CONTEXT_DATE); },
  /no TrackerDB row matches/
);

console.log('test_nag_dispatch.js: PASS');
