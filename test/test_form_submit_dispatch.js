const assert = require('node:assert/strict');

// GAS global stubs — must be set before require.
global.Logger = { log: function() {} };
global.GasLogger = { log: function() {}, run: function(name, fn) { return fn(); } };
global.ScriptApp = {};

var openByIdCalls = [];
global.SpreadsheetApp = {
  getActiveSpreadsheet: function() {
    throw new Error('onFormSubmitLocked_ must not use the active spreadsheet (ADR-010)');
  },
  openById: function(id) { openByIdCalls.push(id); return { getId: function() { return id; } }; }
};

const {
  onFormSubmitLocked_,
  resolveFormSubmitSpreadsheet_,
  setupFormSubmitTrigger,
  clearFormSubmitTrigger
} = require('../script/addResponseOnSubmit.js');

// resolveFormSubmitSpreadsheet_ — derives the target spreadsheet directly from the event's
// own range, which always belongs to exactly the spreadsheet whose trigger fired. This is
// what makes form-submit dispatch unambiguous without a date-based TrackerDB lookup: a
// future/test tracker's form submission resolves to that tracker's own spreadsheet, never
// "whichever spreadsheet happens to be active" (F3Go30-5bc5's AC).
const FUTURE_TRACKER_SPREADSHEET = { id: 'future-tracker-spreadsheet', getSheetByName: function() { return null; } };
const fakeFutureRangeSheet = { getParent: function() { return FUTURE_TRACKER_SPREADSHEET; } };
const fakeEvent = { range: { getSheet: function() { return fakeFutureRangeSheet; } } };

assert.equal(resolveFormSubmitSpreadsheet_(fakeEvent), FUTURE_TRACKER_SPREADSHEET);

// onFormSubmitLocked_ uses that resolved spreadsheet (and only it) to look up Responses/
// Tracker — never the active spreadsheet. Both lookups missing is enough to prove dispatch
// happened against the right (future) target without needing the full 5-phase pipeline mocked.
var getSheetByNameCalls = [];
FUTURE_TRACKER_SPREADSHEET.getSheetByName = function(name) {
  getSheetByNameCalls.push(name);
  return null;
};

onFormSubmitLocked_(fakeEvent);

assert.deepEqual(getSheetByNameCalls.sort(), ['Responses', 'Tracker']);

// setupFormSubmitTrigger / clearFormSubmitTrigger — scoped to a specific spreadsheet so that
// once trigger setup is centralized (one project creating triggers for many trackers),
// clearing one tracker's trigger never touches another's.
var deletedTriggers = [];
var createdTriggers = [];

function makeFakeTrigger(handlerFunction, sourceId) {
  return {
    getHandlerFunction: function() { return handlerFunction; },
    getTriggerSourceId: function() { return sourceId; }
  };
}

global.ScriptApp.getProjectTriggers = function() {
  return [
    makeFakeTrigger('handleFormSubmit_', 'tracker-a'),
    makeFakeTrigger('handleFormSubmit_', 'tracker-b'),
    makeFakeTrigger('onFormSubmit', 'tracker-a'), // legacy handler name, same spreadsheet
    makeFakeTrigger('someOtherHandler_', 'tracker-a')
  ];
};
global.ScriptApp.deleteTrigger = function(trigger) { deletedTriggers.push(trigger); };
global.ScriptApp.newTrigger = function(handlerName) {
  var builder = {
    forSpreadsheet: function(ss) { builder._ss = ss; return builder; },
    onFormSubmit: function() { return builder; },
    create: function() { createdTriggers.push({ handlerName: handlerName, ss: builder._ss }); }
  };
  return builder;
};

clearFormSubmitTrigger({ getId: function() { return 'tracker-a'; } });
assert.equal(deletedTriggers.length, 2, 'only tracker-a triggers (current + legacy handler) are removed');
assert.deepEqual(deletedTriggers.map(function(t) { return t.getTriggerSourceId(); }), ['tracker-a', 'tracker-a']);

deletedTriggers = [];
createdTriggers = [];
var targetSpreadsheet = { getId: function() { return 'tracker-b'; } };
setupFormSubmitTrigger(targetSpreadsheet);
assert.equal(createdTriggers.length, 1);
assert.equal(createdTriggers[0].ss, targetSpreadsheet, 'installs the trigger for the explicit target spreadsheet, not the active one');

console.log('test_form_submit_dispatch.js: PASS');
