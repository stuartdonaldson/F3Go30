const assert = require('node:assert/strict');

// GAS global stubs — must be set before require. Mirrors test_form_submit_dispatch.js's
// convention for the sibling setup/clear trigger pair.
global.Logger = { log: function() {} };
global.GasLogger = { log: function() {}, run: function(name, fn) { return fn(); } };

var openByIdCalls = [];
global.SpreadsheetApp = {
  getActiveSpreadsheet: function() {
    throw new Error('handleTrackerEdit_ must not use the active spreadsheet (ADR-010)');
  },
  openById: function(id) { openByIdCalls.push(id); return { getId: function() { return id; } }; }
};

// In-memory PaxCache stand-in — this test only needs to prove handleTrackerEdit_ calls the
// right PaxCache functions with the right sheetId, not PaxCache's own internals (already
// covered by test_pax_cache.js).
var wipeCalls = [];
var markFreshCalls = [];
var paxCacheModulePath = require.resolve('../script/PaxCache.js');
require.cache[paxCacheModulePath] = {
  id: paxCacheModulePath,
  filename: paxCacheModulePath,
  loaded: true,
  exports: {
    wipePaxCacheAndRelatedCachesForSheet_: function(sheetId) { wipeCalls.push(sheetId); },
    markPaxCacheFreshNow_: function(sheetId) { markFreshCalls.push(sheetId); }
  }
};

const {
  setupTrackerEditTrigger_,
  clearTrackerEditTrigger_,
  handleTrackerEdit_,
  resolveTrackerEditSpreadsheet_
} = require('../script/TrackerEditTrigger.js');

function resetCalls_() {
  wipeCalls = [];
  markFreshCalls = [];
  openByIdCalls = [];
}

// ── handleTrackerEdit_ ───────────────────────────────────────────────────

function makeFakeEditEvent_(sheetName, spreadsheetId) {
  var spreadsheet = { getId: function() { return spreadsheetId; } };
  var sheet = {
    getName: function() { return sheetName; },
    getParent: function() { return spreadsheet; }
  };
  return { range: { getSheet: function() { return sheet; } } };
}

// AC3: an edit on the Tracker, Responses, or Bonus Tracker sheet wipes PaxCache for that
// sheetId and stamps it fresh (F3Go30-o39s.2 extended this beyond Tracker-only).
['Tracker', 'Responses', 'Bonus Tracker'].forEach(function(sheetName) {
  resetCalls_();
  handleTrackerEdit_(makeFakeEditEvent_(sheetName, 'tracker-a'));
  assert.deepEqual(wipeCalls, ['tracker-a'], sheetName + '-sheet edit wipes PaxCache for the edited spreadsheet');
  assert.deepEqual(markFreshCalls, ['tracker-a'], sheetName + '-sheet edit stamps the asOf marker fresh');
});

// AC4: an edit on any other sheet is a no-op.
resetCalls_();
handleTrackerEdit_(makeFakeEditEvent_('Config', 'tracker-a'));
assert.deepEqual(wipeCalls, [], 'non-PAX-sheet edit does not wipe PaxCache');
assert.deepEqual(markFreshCalls, [], 'non-PAX-sheet edit does not stamp asOf');

// resolveTrackerEditSpreadsheet_ — derives the spreadsheet id from the event's own range,
// same ADR-010 pattern as resolveFormSubmitSpreadsheet_, never SpreadsheetApp.getActiveSpreadsheet().
assert.equal(
  resolveTrackerEditSpreadsheet_(makeFakeEditEvent_('Tracker', 'future-tracker')).getId(),
  'future-tracker'
);

// ── setupTrackerEditTrigger_ / clearTrackerEditTrigger_ ─────────────────
// Scoped to a specific spreadsheet so that clearing one tracker's edit trigger never touches
// another tracker's — same convention/test shape as clearFormSubmitTrigger's coverage.

var deletedTriggers = [];
var createdTriggers = [];

function makeFakeTrigger(handlerFunction, sourceId) {
  return {
    getHandlerFunction: function() { return handlerFunction; },
    getTriggerSourceId: function() { return sourceId; }
  };
}

global.ScriptApp = {
  getProjectTriggers: function() {
    return [
      makeFakeTrigger('handleTrackerEdit_', 'tracker-a'),
      makeFakeTrigger('handleTrackerEdit_', 'tracker-b'),
      makeFakeTrigger('handleFormSubmit_', 'tracker-a'), // different handler, same spreadsheet
      makeFakeTrigger('someOtherHandler_', 'tracker-a')
    ];
  },
  deleteTrigger: function(trigger) { deletedTriggers.push(trigger); },
  newTrigger: function(handlerName) {
    var builder = {
      forSpreadsheet: function(ss) { builder._ss = ss; return builder; },
      onEdit: function() { return builder; },
      create: function() { createdTriggers.push({ handlerName: handlerName, ss: builder._ss }); }
    };
    return builder;
  }
};

clearTrackerEditTrigger_({ getId: function() { return 'tracker-a'; } });
assert.equal(deletedTriggers.length, 1, 'only tracker-a\'s handleTrackerEdit_ trigger is removed');
assert.equal(deletedTriggers[0].getHandlerFunction(), 'handleTrackerEdit_');
assert.equal(deletedTriggers[0].getTriggerSourceId(), 'tracker-a');

deletedTriggers = [];
createdTriggers = [];
var targetSpreadsheet = { getId: function() { return 'tracker-c'; } };
setupTrackerEditTrigger_(targetSpreadsheet);
assert.equal(createdTriggers.length, 1, 'setupTrackerEditTrigger_ registers exactly one trigger');
assert.equal(createdTriggers[0].handlerName, 'handleTrackerEdit_');
assert.equal(createdTriggers[0].ss, targetSpreadsheet);

console.log('test_tracker_edit_trigger.js: all assertions passed');
