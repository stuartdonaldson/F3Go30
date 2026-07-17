const assert = require('node:assert/strict');

const {
  planTrackerTriggerSync_,
  clearAllPerTrackerTriggersBySheetId_,
  ttlMonthStart_
} = require('../script/TrackerTriggerLifecycle.js');

// ── planTrackerTriggerSync_ — pure decision function ────────────────────────────────────────

var today = new Date('2026-07-17T00:00:00');

function noneTrashed_() { return false; }

// AC1: an active row (current month) with no existing edit trigger is backfilled.
(function() {
  var rows = [{ sheetId: 'current', startDate: new Date('2026-07-01T00:00:00') }];
  var plan = planTrackerTriggerSync_(rows, [], today, noneTrashed_);
  assert.deepEqual(plan.backfill, ['current']);
  assert.deepEqual(plan.cleanup, []);
})();

// An active row that already has an edit trigger is left alone (no duplicate backfill).
(function() {
  var rows = [{ sheetId: 'current', startDate: new Date('2026-07-01T00:00:00') }];
  var plan = planTrackerTriggerSync_(rows, ['current'], today, noneTrashed_);
  assert.deepEqual(plan.backfill, []);
  assert.deepEqual(plan.cleanup, []);
})();

// Previous and next month rows are still "active" — backfilled, not cleaned up.
(function() {
  var rows = [
    { sheetId: 'prev', startDate: new Date('2026-06-01T00:00:00') },
    { sheetId: 'next', startDate: new Date('2026-08-01T00:00:00') }
  ];
  var plan = planTrackerTriggerSync_(rows, [], today, noneTrashed_);
  assert.deepEqual(plan.backfill.sort(), ['next', 'prev']);
  assert.deepEqual(plan.cleanup, []);
})();

// AC2b: a row older than the previous month (aged out) is cleaned up, even if it has an
// existing edit trigger and isn't trashed.
(function() {
  var rows = [{ sheetId: 'stale', startDate: new Date('2026-05-01T00:00:00') }];
  var plan = planTrackerTriggerSync_(rows, ['stale'], today, noneTrashed_);
  assert.deepEqual(plan.backfill, []);
  assert.deepEqual(plan.cleanup, [{ sheetId: 'stale', reason: 'aged_out' }]);
})();

// AC2a: a trashed row is cleaned up regardless of its StartDate (even a current-month row).
(function() {
  var rows = [{ sheetId: 'trashed-current', startDate: new Date('2026-07-01T00:00:00') }];
  var plan = planTrackerTriggerSync_(rows, [], today, function(id) { return id === 'trashed-current'; });
  assert.deepEqual(plan.backfill, []);
  assert.deepEqual(plan.cleanup, [{ sheetId: 'trashed-current', reason: 'trashed' }]);
})();

// Trashed takes priority over aged-out in the reported reason (both true — still one entry).
(function() {
  var rows = [{ sheetId: 'both', startDate: new Date('2025-01-01T00:00:00') }];
  var plan = planTrackerTriggerSync_(rows, [], today, function() { return true; });
  assert.deepEqual(plan.cleanup, [{ sheetId: 'both', reason: 'trashed' }]);
})();

// Rows without a sheetId are skipped entirely.
(function() {
  var rows = [{ sheetId: '', startDate: new Date('2026-07-01') }];
  var plan = planTrackerTriggerSync_(rows, [], today, noneTrashed_);
  assert.deepEqual(plan.backfill, []);
  assert.deepEqual(plan.cleanup, []);
})();

// A row with no parseable StartDate is treated as not aged-out (never cleaned up for aging),
// only for trash — same conservative default as other TrackerDB readers in this codebase.
(function() {
  var rows = [{ sheetId: 'no-date', startDate: '' }];
  var plan = planTrackerTriggerSync_(rows, [], today, noneTrashed_);
  assert.deepEqual(plan.backfill, ['no-date']);
  assert.deepEqual(plan.cleanup, []);
})();

// ttlMonthStart_ — first-of-month arithmetic used to compute the "previous month" cutoff.
assert.equal(ttlMonthStart_(new Date('2026-07-17T00:00:00'), -1).getTime(), new Date('2026-06-01T00:00:00').getTime());
assert.equal(ttlMonthStart_(new Date('2026-01-05T00:00:00'), -1).getTime(), new Date('2025-12-01T00:00:00').getTime());

// ── clearAllPerTrackerTriggersBySheetId_ — direct ScriptApp filtering, no spreadsheet open ──

(function() {
  var deleted = [];
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
        makeFakeTrigger('handleFormSubmit_', 'tracker-a'),
        makeFakeTrigger('onFormSubmit', 'tracker-a'), // legacy handler name
        makeFakeTrigger('handleTrackerEdit_', 'tracker-b'),
        makeFakeTrigger('someOtherHandler_', 'tracker-a')
      ];
    },
    deleteTrigger: function(trigger) { deleted.push(trigger); }
  };

  var removed = clearAllPerTrackerTriggersBySheetId_('tracker-a');
  assert.equal(removed, 3, 'removes edit + form-submit + legacy form-submit triggers for tracker-a only');
  assert.deepEqual(deleted.map(function(t) { return t.getHandlerFunction(); }).sort(),
    ['handleFormSubmit_', 'handleTrackerEdit_', 'onFormSubmit']);
})();

console.log('test_tracker_trigger_lifecycle.js: all assertions passed');
