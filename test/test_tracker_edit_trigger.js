const assert = require('node:assert/strict');

// GAS global stubs — must be set before require. Mirrors test_form_submit_dispatch.js's
// convention for the sibling setup/clear trigger pair, extended with the PropertiesService/
// CacheService/DriveApp stand-ins test_pax_cache.js already uses, since C10 (F3Go30-o39s.11)
// now exercises PaxCache.js's real per-PAX-row read/write path, not just its wipe/markFresh
// entry points.
global.Logger = { log: function() {} };
global.GasLogger = { log: function() {}, run: function(name, fn) { return fn(); } };

var openByIdCalls = [];
global.SpreadsheetApp = {
  getActiveSpreadsheet: function() {
    throw new Error('handleTrackerEdit_ must not use the active spreadsheet (ADR-010)');
  },
  openById: function(id) { openByIdCalls.push(id); return { getId: function() { return id; } }; }
};

// In-memory stand-in for PropertiesService.getScriptProperties() — same contract as
// test_pax_cache.js's makeFakeProperties_.
function makeFakeProperties_() {
  var store = {};
  return {
    getProperty: function(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    setProperty: function(key, value) { store[key] = value; },
    setProperties: function(properties) {
      Object.keys(properties || {}).forEach(function(key) { store[key] = properties[key]; });
    },
    deleteProperty: function(key) { delete store[key]; },
    getKeys: function() { return Object.keys(store); },
  };
}
var fakeProps = makeFakeProperties_();
global.PropertiesService = { getScriptProperties: function() { return fakeProps; } };

global.DriveApp = {
  getFileById: function() { return { getLastUpdated: function() { return new Date(0); } }; }
};
global.LockService = {
  getScriptLock: function() { return { waitLock: function() {}, releaseLock: function() {} }; }
};

// In-memory stand-in for CacheService.getScriptCache().
function makeFakeCache_() {
  var store = {};
  return {
    get: function(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    put: function(key, value) { store[key] = value; },
    remove: function(key) { delete store[key]; },
  };
}
var fakeCache = makeFakeCache_();
global.CacheService = { getScriptCache: function() { return fakeCache; } };

// PaxCache.js is required for real here (unlike the earlier stub-everything version of this
// test) so tryPatchSinglePaxRow_te_'s use of getPaxCacheRow_/setPaxCacheRow_/getPaxRosterIndex_/
// paxCacheNormalizeName_ exercises the real read-modify-write path. Only
// wipePaxCacheAndRelatedCachesForSheet_/markPaxCacheFreshNow_ are wrapped with call-recording
// spies (still backed by the real implementation) so the existing whole-sheet-wipe assertions
// keep working unchanged.
var wipeCalls = [];
var markFreshCalls = [];
var paxCacheModulePath = require.resolve('../script/PaxCache.js');
var realPaxCache = require(paxCacheModulePath);
var realWipe = realPaxCache.wipePaxCacheAndRelatedCachesForSheet_;
var realMarkFresh = realPaxCache.markPaxCacheFreshNow_;
require.cache[paxCacheModulePath].exports = Object.assign({}, realPaxCache, {
  wipePaxCacheAndRelatedCachesForSheet_: function(sheetId) { wipeCalls.push(sheetId); return realWipe(sheetId); },
  markPaxCacheFreshNow_: function(sheetId) { markFreshCalls.push(sheetId); return realMarkFresh(sheetId); }
});

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
  realPaxCache.resetPaxCacheFreshnessMemo_();
}

// ── handleTrackerEdit_ — whole-sheet wipe fallback (pre-existing behavior) ──────────────────

function makeFakeEditEvent_(sheetName, spreadsheetId, opts) {
  opts = opts || {};
  var spreadsheet = { getId: function() { return spreadsheetId; } };
  var sheet = {
    getName: function() { return sheetName; },
    getParent: function() { return spreadsheet; },
    getRange: opts.getRange || function() { throw new Error('sheet.getRange not stubbed for this test'); }
  };
  var range = {
    getSheet: function() { return sheet; },
    getRow: function() { return opts.row; },
    getColumn: function() { return opts.col; },
    getNumRows: function() { return opts.numRows === undefined ? 1 : opts.numRows; },
    getNumColumns: function() { return opts.numCols === undefined ? 1 : opts.numCols; },
    getValue: function() { return opts.newValue; }
  };
  return { range: range, sheet: sheet };
}

// AC3: an edit on the Tracker, Responses, or Bonus Tracker sheet with no patchable single-PAX
// row (no range details stubbed here) wipes PaxCache for that sheetId and stamps it fresh
// (F3Go30-o39s.2 extended this beyond Tracker-only).
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

// ── C10 (F3Go30-o39s.11): per-row patch instead of whole-sheet wipe ─────────────────────────

// Single-cell Tracker edit on a known PAX row patches only that PAX's cached row — no wipe.
resetCalls_();
(function() {
  var sheetId = 'tracker-patch-1';
  realPaxCache.setPaxRosterIndex_('tracker', sheetId, { 'dredd': 0 });
  var initialRow = ['Dredd', 'e@x.com', 'Team1', 'x', 'y', 'z', 'w', 10, 0, 1, null];
  realPaxCache.setPaxCacheRow_('tracker', sheetId, 'Dredd', initialRow);

  var e = makeFakeEditEvent_('Tracker', sheetId, {
    row: 4, col: 9, numRows: 1, numCols: 1, newValue: 1,
    getRange: function(row, col) {
      assert.equal(row, 4);
      assert.equal(col, 1);
      return { getValue: function() { return 'Dredd'; } };
    }
  });

  handleTrackerEdit_(e);

  assert.deepEqual(wipeCalls, [], 'a patchable single-cell Tracker edit does not wipe the whole sheet');
  assert.deepEqual(markFreshCalls, [], 'a patchable single-cell Tracker edit does not need a fresh-stamp (nothing was wiped)');
  var patched = realPaxCache.getPaxCacheRow_('tracker', sheetId, 'Dredd');
  assert.equal(patched[8], 1, 'the touched column (0-based index 8, sheet col 9) reflects the new value');
  assert.equal(patched[0], 'Dredd', 'every other column is untouched');
  assert.equal(patched[7], 10, 'every other column is untouched');
})();

// Other PAX rows on the same sheet stay warm (untouched) across a patched edit.
resetCalls_();
(function() {
  var sheetId = 'tracker-patch-2';
  realPaxCache.setPaxRosterIndex_('tracker', sheetId, { 'dredd': 0, 'anderson': 1 });
  realPaxCache.setPaxCacheRow_('tracker', sheetId, 'Dredd', ['Dredd', 0, 0, 0, 0, 0, 0, 0, 0]);
  realPaxCache.setPaxCacheRow_('tracker', sheetId, 'Anderson', ['Anderson', 1, 1, 1, 1, 1, 1, 1, 1]);

  var e = makeFakeEditEvent_('Tracker', sheetId, {
    row: 4, col: 9, numRows: 1, numCols: 1, newValue: 1,
    getRange: function() { return { getValue: function() { return 'Dredd'; } }; }
  });
  handleTrackerEdit_(e);

  assert.deepEqual(wipeCalls, [], 'no wipe for the patchable edit');
  var other = realPaxCache.getPaxCacheRow_('tracker', sheetId, 'Anderson');
  assert.deepEqual(other, ['Anderson', 1, 1, 1, 1, 1, 1, 1, 1], 'an untouched pax\'s cached row is left exactly as it was — no cold rebuild');
})();

// Multi-cell range (paste) falls back to the whole-sheet wipe.
resetCalls_();
(function() {
  var sheetId = 'tracker-multi';
  realPaxCache.setPaxRosterIndex_('tracker', sheetId, { 'dredd': 0 });
  realPaxCache.setPaxCacheRow_('tracker', sheetId, 'Dredd', ['Dredd', 0]);
  var e = makeFakeEditEvent_('Tracker', sheetId, { row: 4, col: 9, numRows: 2, numCols: 1, newValue: 1 });
  handleTrackerEdit_(e);
  assert.deepEqual(wipeCalls, [sheetId], 'a multi-row edit cannot be mapped to one pax row — falls back to wipe');
})();

// Header-row edit falls back to the whole-sheet wipe.
resetCalls_();
(function() {
  var sheetId = 'tracker-header';
  var e = makeFakeEditEvent_('Tracker', sheetId, { row: 2, col: 9, numRows: 1, numCols: 1, newValue: 'x' });
  handleTrackerEdit_(e);
  assert.deepEqual(wipeCalls, [sheetId], 'a Tracker header-row (row < 4) edit falls back to wipe');
})();
(function() {
  resetCalls_();
  var sheetId = 'responses-header';
  var e = makeFakeEditEvent_('Responses', sheetId, { row: 1, col: 2, numRows: 1, numCols: 1, newValue: 'x' });
  handleTrackerEdit_(e);
  assert.deepEqual(wipeCalls, [sheetId], 'a Responses header-row (row < 2) edit falls back to wipe');
})();

// A row whose live name doesn't match the cached roster index at that offset (e.g. a row
// insert/delete shifted a different pax into the touched row) falls back to wipe rather than
// risking patching the wrong pax's cache.
resetCalls_();
(function() {
  var sheetId = 'tracker-shifted';
  realPaxCache.setPaxRosterIndex_('tracker', sheetId, { 'dredd': 0 });
  realPaxCache.setPaxCacheRow_('tracker', sheetId, 'Dredd', ['Dredd', 0]);
  var e = makeFakeEditEvent_('Tracker', sheetId, {
    row: 4, col: 9, numRows: 1, numCols: 1, newValue: 1,
    getRange: function() { return { getValue: function() { return 'SomeoneElse'; } }; }
  });
  handleTrackerEdit_(e);
  assert.deepEqual(wipeCalls, [sheetId], 'a row->name mismatch against the cached roster index falls back to wipe');
})();

// No cached roster index at all (cold cache) falls back to wipe.
resetCalls_();
(function() {
  var sheetId = 'tracker-cold';
  var e = makeFakeEditEvent_('Tracker', sheetId, {
    row: 4, col: 9, numRows: 1, numCols: 1, newValue: 1,
    getRange: function() { return { getValue: function() { return 'Dredd'; } }; }
  });
  handleTrackerEdit_(e);
  assert.deepEqual(wipeCalls, [sheetId], 'no cached roster index to cross-check against falls back to wipe');
})();

// Responses edit with no cached column layout falls back to wipe (resolving it live would
// defeat the point of a cheap patch).
resetCalls_();
(function() {
  var sheetId = 'responses-no-layout';
  var e = makeFakeEditEvent_('Responses', sheetId, { row: 2, col: 3, numRows: 1, numCols: 1, newValue: 'x' });
  handleTrackerEdit_(e);
  assert.deepEqual(wipeCalls, [sheetId], 'no cached Responses layout falls back to wipe');
})();

// Responses edit with a cached column layout patches the per-pax row AND the full-roster
// CacheService blob (dashboardWebapp.js's responsesValuesCacheKey_) when it's warm.
resetCalls_();
(function() {
  var sheetId = 'responses-patch';
  fakeCache.put('go30dash:responsesLayout:' + sheetId, JSON.stringify({ columns: { F3_NAME: 0, WHO: 3 } }));
  realPaxCache.setPaxRosterIndex_('responses', sheetId, { 'dredd': 0 });
  realPaxCache.setPaxCacheRow_('responses', sheetId, 'Dredd', ['Dredd', 'e@x.com', 'Team1', 'old-who']);
  fakeCache.put('go30dash:responsesValues:' + sheetId, JSON.stringify([
    ['Dredd', 'e@x.com', 'Team1', 'old-who']
  ]));

  var e = makeFakeEditEvent_('Responses', sheetId, {
    row: 2, col: 4, numRows: 1, numCols: 1, newValue: 'new-who',
    getRange: function(row, col) {
      assert.equal(row, 2);
      assert.equal(col, 1);
      return { getValue: function() { return 'Dredd'; } };
    }
  });
  handleTrackerEdit_(e);

  assert.deepEqual(wipeCalls, [], 'a patchable Responses edit does not wipe');
  var patchedRow = realPaxCache.getPaxCacheRow_('responses', sheetId, 'Dredd');
  assert.equal(patchedRow[3], 'new-who', 'the per-pax cached Responses row reflects the new value');

  var blob = JSON.parse(fakeCache.get('go30dash:responsesValues:' + sheetId));
  assert.equal(blob[0][3], 'new-who', 'the full-roster CacheService blob is patched in place, not wiped');
})();

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
