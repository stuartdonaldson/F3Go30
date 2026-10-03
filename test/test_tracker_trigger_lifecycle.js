const assert = require('node:assert/strict');

const {
  planTrackerTriggerSync_,
  clearAllPerTrackerTriggersBySheetId_,
  ttlMonthStart_,
  ttlMergeTrackerRowsAcrossNamespaces_
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

// A row two or more months ahead (past the "next month" window) is cleaned up as not-yet-active,
// even if it already carries an edit trigger — the onEdit window is prev/current/next only.
(function() {
  var rows = [{ sheetId: 'far-future', startDate: new Date('2026-09-01T00:00:00') }];
  var plan = planTrackerTriggerSync_(rows, ['far-future'], today, noneTrashed_);
  assert.deepEqual(plan.backfill, []);
  assert.deepEqual(plan.cleanup, [{ sheetId: 'far-future', reason: 'not_yet_active' }]);
})();

// A far-future row with no existing trigger is also not backfilled.
(function() {
  var rows = [{ sheetId: 'far-future-2', startDate: new Date('2026-10-01T00:00:00') }];
  var plan = planTrackerTriggerSync_(rows, [], today, noneTrashed_);
  assert.deepEqual(plan.backfill, []);
  assert.deepEqual(plan.cleanup, [{ sheetId: 'far-future-2', reason: 'not_yet_active' }]);
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

// ── removeRetiredFormSubmitTriggers_ — ADR-024 (F3Go30-61ln.2): the HC Form is retired, so the
// sweep deletes every form-submit trigger (current + legacy handler names) on ANY source, and
// nothing else ─────────────────────────────────────────────────────────────────────────────
(function() {
  const { removeRetiredFormSubmitTriggers_ } = require('../script/TrackerTriggerLifecycle.js');
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
        makeFakeTrigger('handleFormSubmit_', 'tracker-live'),
        makeFakeTrigger('onFormSubmit', 'tracker-old'),
        makeFakeTrigger('autoGenerateNextMonthTracker', 'template')
      ];
    },
    deleteTrigger: function(trigger) { deleted.push(trigger); }
  };
  var removed = removeRetiredFormSubmitTriggers_();
  assert.deepEqual(removed, [
    { handlerFunction: 'handleFormSubmit_', sourceId: 'tracker-a' },
    { handlerFunction: 'handleFormSubmit_', sourceId: 'tracker-live' },
    { handlerFunction: 'onFormSubmit', sourceId: 'tracker-old' },
  ]);
  assert.deepEqual(deleted.map(function(t) { return t.getHandlerFunction(); }),
    ['handleFormSubmit_', 'handleFormSubmit_', 'onFormSubmit'], 'edit and other triggers untouched');
})();

// ── ttlMergeTrackerRowsAcrossNamespaces_ — multi-namespace sweep (F3Go30-jykq) ──────────────
// syncTrackerTriggers_ only ever read the bound (Template) spreadsheet's own TrackerDB, so a
// tracker created inside an ADR-014 namespace-provisioned copy (tools/smokeTestNamespace.js)
// was invisible to the sweep and its per-tracker triggers could never be cleaned up. This merge
// step unions the bound spreadsheet's TrackerDB rows with every registered namespace's own
// TrackerDB rows before handing the combined list to planTrackerTriggerSync_ (unchanged) — same
// "enumerate NamespaceDB, best-effort per namespace" shape as PaxCache.js's
// collectKnownTrackerSheetIds_ (F3Go30-440b.2 follow-up).

// Unions bound + every namespace's rows, deduped by sheetId (first sighting wins).
(function testMergeUnionsBoundAndEveryNamespace() {
  var boundState = { bySheetId: { 'bound-1': { sheetId: 'bound-1', startDate: new Date('2026-07-01') } } };
  var namespaceRows = [
    { namespace: 'sit-smoke', templateId: 'ns-tmpl-1' },
    { namespace: 'sit-demo', templateId: 'ns-tmpl-2' }
  ];
  function readNamespaceTrackerStateFn(templateId) {
    if (templateId === 'ns-tmpl-1') {
      return { bySheetId: { 'ns1-tracker': { sheetId: 'ns1-tracker', startDate: new Date('2026-07-01') } } };
    }
    if (templateId === 'ns-tmpl-2') {
      return { bySheetId: { 'ns2-tracker': { sheetId: 'ns2-tracker', startDate: new Date('2026-07-01') } } };
    }
    throw new Error('unexpected templateId: ' + templateId);
  }
  var rows = ttlMergeTrackerRowsAcrossNamespaces_(boundState, namespaceRows, readNamespaceTrackerStateFn);
  assert.deepEqual(rows.map(function(r) { return r.sheetId; }).sort(),
    ['bound-1', 'ns1-tracker', 'ns2-tracker']);
})();

// A namespace whose spreadsheet can no longer be opened (trashed, or torn down but a stray
// NamespaceDB row survives) contributes nothing and is reported via the callback, not thrown —
// one unreachable namespace must never abort the whole sweep.
(function testMergeSkipsUnreachableNamespaceAndReportsIt() {
  var boundState = { bySheetId: { 'bound-1': { sheetId: 'bound-1', startDate: new Date('2026-07-01') } } };
  var namespaceRows = [{ namespace: 'gone', templateId: 'ns-tmpl-gone' }];
  function readNamespaceTrackerStateFn() { throw new Error('spreadsheet not found'); }
  var unreachable = [];
  var rows = ttlMergeTrackerRowsAcrossNamespaces_(boundState, namespaceRows, readNamespaceTrackerStateFn,
    function(nsRow, err) { unreachable.push({ namespace: nsRow.namespace, error: err.message }); });
  assert.deepEqual(rows.map(function(r) { return r.sheetId; }), ['bound-1']);
  assert.deepEqual(unreachable, [{ namespace: 'gone', error: 'spreadsheet not found' }]);
})();

// Same sheetId appearing in two sources (should never happen in practice — each tracker belongs
// to exactly one TrackerDB — but dedup must not double-count if it ever did) keeps one entry.
(function testMergeDedupesSameSheetIdAcrossSources() {
  var boundState = { bySheetId: { 'dup': { sheetId: 'dup', startDate: new Date('2026-06-01') } } };
  var namespaceRows = [{ namespace: 'ns', templateId: 'ns-tmpl' }];
  function readNamespaceTrackerStateFn() {
    return { bySheetId: { 'dup': { sheetId: 'dup', startDate: new Date('2026-08-01') } } };
  }
  var rows = ttlMergeTrackerRowsAcrossNamespaces_(boundState, namespaceRows, readNamespaceTrackerStateFn);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].startDate.getTime(), new Date('2026-06-01').getTime(), 'first sighting (bound) wins');
})();

// A namespace row with no templateId (malformed registry row) is skipped without attempting a read.
(function testMergeSkipsNamespaceRowWithNoTemplateId() {
  var boundState = { bySheetId: {} };
  var namespaceRows = [{ namespace: 'broken', templateId: '' }];
  function readNamespaceTrackerStateFn() { throw new Error('should never be called'); }
  var rows = ttlMergeTrackerRowsAcrossNamespaces_(boundState, namespaceRows, readNamespaceTrackerStateFn);
  assert.deepEqual(rows, []);
})();

// No namespaces registered at all — behaves exactly like the old single-spreadsheet read.
(function testMergeWithNoNamespacesReturnsJustBoundRows() {
  var boundState = { bySheetId: { 'bound-only': { sheetId: 'bound-only', startDate: new Date('2026-07-01') } } };
  var rows = ttlMergeTrackerRowsAcrossNamespaces_(boundState, [], function() { throw new Error('should never be called'); });
  assert.deepEqual(rows.map(function(r) { return r.sheetId; }), ['bound-only']);
})();

console.log('test_tracker_trigger_lifecycle.js: all assertions passed');
