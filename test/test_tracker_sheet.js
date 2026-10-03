const assert = require('node:assert/strict');

// trackerSheet.js (formerly addResponseOnSubmit.js — ADR-024 retired the HC Form submit pipeline;
// these are the tests for what the webapp still shares: the canonical Tracker sort and the
// registration month label).
global.GasLogger = { log: function() {}, init: function() {}, flush: function() {} };

// PaxCache write-through (F3Go30-o39s.4) stubs — in-memory PropertiesService/CacheService/
// LockService, same shape/behavior contract as test_pax_cache.js. DriveApp is deliberately left
// undefined: PaxCache no longer touches it at all (the Drive-modtime poll was retired,
// F3Go30-o39s.7), so a warmed roster index in these tests is never wiped out from under us.
var fakePaxCacheProps_ = {};
global.PropertiesService = {
  getScriptProperties: function() {
    return {
      getProperty: function(key) { return Object.prototype.hasOwnProperty.call(fakePaxCacheProps_, key) ? fakePaxCacheProps_[key] : null; },
      setProperty: function(key, value) { fakePaxCacheProps_[key] = value; },
      deleteProperty: function(key) { delete fakePaxCacheProps_[key]; },
      getKeys: function() { return Object.keys(fakePaxCacheProps_); },
      // F3Go30-45qt: getPaxRosterIndex_/getPaxCacheRow_ now read through ScriptProperties.js's
      // per-execution whole-store memo instead of a discrete getProperty() call.
      getProperties: function() { return Object.assign({}, fakePaxCacheProps_); },
    };
  },
};
global.LockService = {
  getScriptLock: function() { return { waitLock: function() {}, releaseLock: function() {} }; },
};
var fakeScriptCacheStore_ = {};
global.CacheService = {
  getScriptCache: function() {
    return {
      get: function(key) { return Object.prototype.hasOwnProperty.call(fakeScriptCacheStore_, key) ? fakeScriptCacheStore_[key] : null; },
      put: function(key, value) { fakeScriptCacheStore_[key] = value; },
      remove: function(key) { delete fakeScriptCacheStore_[key]; },
    };
  },
};

const { sortTrackerSheet_, formatRegistrationMonth_ } = require('../script/trackerSheet.js');

const {
  setPaxRosterIndex_,
  getPaxRosterIndex_,
  resolvePaxRowIndex_,
  getPaxCacheRow_,
  setPaxCacheRow_,
  patchPaxRosterIndex_,
} = require('../script/PaxCache.js');

// Minimal grid-backed Sheet stand-in: 1-based getRange(row, col, numRows, numCols) over a plain
// 2D array, supporting the getValues/setValues/setValue/getFormulas/copyTo/sort surface that
// onFormSubmitLocked_'s 5-phase pipeline exercises.
function makeGridSheet_(initialRows) {
  var data = initialRows.map(function(r) { return r.slice(); });
  function range(row, col, numRows, numCols) {
    numRows = numRows || 1; numCols = numCols || 1;
    return {
      getValues: function() {
        var out = [];
        for (var r = 0; r < numRows; r++) {
          var srcRow = data[row - 1 + r] || [];
          var rowArr = [];
          for (var c = 0; c < numCols; c++) rowArr.push(srcRow[col - 1 + c] !== undefined ? srcRow[col - 1 + c] : '');
          out.push(rowArr);
        }
        return out;
      },
      setValues: function(vals) {
        for (var r = 0; r < vals.length; r++) {
          while (data.length < row + r) data.push([]);
          for (var c = 0; c < vals[r].length; c++) data[row - 1 + r][col - 1 + c] = vals[r][c];
        }
      },
      setValue: function(v) {
        while (data.length < row) data.push([]);
        data[row - 1][col - 1] = v;
      },
      getFormulas: function() {
        var out = [];
        for (var r = 0; r < numRows; r++) {
          var rowArr = [];
          for (var c = 0; c < numCols; c++) rowArr.push('');
          out.push(rowArr);
        }
        return out;
      },
      getA1Notation: function() { return 'R' + row + 'C' + col; },
      copyTo: function(target) { target.setValues(this.getValues()); },
      // A REAL sort (F3Go30-k5fn.3 TEST TRAP) — earlier versions of this mock had a no-op sort,
      // which meant no test could ever observe a roster-index offset going stale after a sort
      // (F3Go30-a2hq). Mirrors Range.sort()'s column spec: 1-based, absolute sheet columns.
      sort: function(sortSpecs) {
        var slice = [];
        for (var r = 0; r < numRows; r++) slice.push(data[row - 1 + r]);
        slice.sort(function(a, b) {
          for (var i = 0; i < sortSpecs.length; i++) {
            var spec = sortSpecs[i];
            var colIdx = spec.column - 1;
            var av = a[colIdx], bv = b[colIdx];
            if (av < bv) return spec.ascending === false ? 1 : -1;
            if (av > bv) return spec.ascending === false ? -1 : 1;
          }
          return 0;
        });
        for (var r2 = 0; r2 < numRows; r2++) data[row - 1 + r2] = slice[r2];
      },
    };
  }
  return {
    getLastRow: function() { return data.length; },
    getLastColumn: function() { return data.length ? data[0].length : 0; },
    getRange: range,
    getRangeList: function() { return { clearContent: function() {} }; },
    appendRow: function(row) { data.push(row.slice()); },
  };
}

// --- formatRegistrationMonth_ ---
assert.equal(formatRegistrationMonth_(new Date(2026, 5, 1)), 'June 2026');
assert.equal(formatRegistrationMonth_(null), '');
assert.equal(formatRegistrationMonth_(new Date('nope')), '');

// ── F3Go30-a2hq: sortTrackerSheet_ must drop the Tracker roster index ────────────────────
// The sort reassigns every row offset, which is precisely what PaxCache's roster index caches.
// Leaving it behind is what let identify hand one PAX another PAX's row (and would have let
// handleCheckinSubmit_ write a check-in there). Invalidation lives in sortTrackerSheet_ rather
// than at its three call sites so no caller can forget it — signup in particular patches the
// index immediately before sorting.
{
  var sortSheetId = 'sheet-sort-invalidate';
  var sortTracker = makeGridSheet_([
    ['', '', ''],
    ['Period', '', ''],
    ['F3 Name', 'Team', 'Fellowship'],
    ['Zeta', 'Crucible', 0],
    ['Alpha', 'Crucible', 0],
  ]);
  sortTracker.getParent = function() { return { getId: function() { return sortSheetId; } }; };

  setPaxRosterIndex_('tracker', sortSheetId, { zeta: 0, alpha: 1 });
  setPaxCacheRow_('tracker', sortSheetId, 'Zeta', ['Zeta', 'Crucible', 0]);
  assert.notEqual(getPaxRosterIndex_('tracker', sortSheetId), null, 'precondition: roster index is warm');

  sortTrackerSheet_(sortTracker);

  assert.equal(
    getPaxRosterIndex_('tracker', sortSheetId), null,
    'sorting drops the roster index — every offset it holds was just invalidated'
  );
  // Per-PAX rows survive deliberately: a sort moves rows without changing their contents, and
  // those entries are keyed by name, so re-reading them would be pure cost.
  assert.notEqual(
    getPaxCacheRow_('tracker', sortSheetId, 'Zeta'), null,
    'per-PAX row cache is name-keyed and stays valid across a sort'
  );
}

// ── F3Go30-k5fn.3 / F3Go30-a2hq REGRESSION: signup append -> sort -> resolve must not bind a ──
// PAX to another PAX's Tracker row. Reproduces the exact sequence k5fn's forward-gate signup
// drives against signupWebapp.js's handleSignupSave_ — append the new PAX's row, patch the
// roster index at the append offset, then sort — using the SAME production functions
// (patchPaxRosterIndex_, sortTrackerSheet_, resolvePaxRowIndex_) and a sort mock that genuinely
// reorders rows (see makeGridSheet_'s sort above); a no-op sort mock could never observe this.
{
  var regressSheetId = 'sheet-a2hq-regression';
  var regressTracker = makeGridSheet_([
    ['', '', ''],
    ['Period', '', ''],
    ['F3 Name', 'Team', 'Fellowship'],
    ['Delta', 'Z-Team', 0],
    ['Echo', 'Z-Team', 0],
  ]);
  regressTracker.getParent = function() { return { getId: function() { return regressSheetId; } }; };

  // Warm roster index the way a prior identify/dashboard read would — the leak only happens
  // against an already-warm index (an empty/cold one just rebuilds correctly on the next read).
  setPaxRosterIndex_('tracker', regressSheetId, { delta: 0, echo: 1 });

  // signupWebapp.js's handleSignupSave_ sequence for a brand-new PAX ('Charlie'): append the
  // row, copy the row above's Team/Fellowship so it sorts into the SAME group as the existing
  // rows, patch the roster index at the append offset, then sort.
  var nextRow = regressTracker.getLastRow() + 1; // 6
  var appendOffset = nextRow - 4; // 2 — the offset the patch (below) believes Charlie will keep
  regressTracker.getRange(nextRow, 1).setValue('Charlie');
  regressTracker.getRange(nextRow - 1, 2, 1, 2).copyTo(regressTracker.getRange(nextRow, 2, 1, 2));
  patchPaxRosterIndex_('tracker', regressSheetId, 'Charlie', appendOffset);

  // Precondition: immediately after the patch (before the sort), the stale offset IS what a
  // reader would get back — proves the patch really landed, so what follows tests the sort's
  // effect, not a patch that silently no-op'd.
  assert.equal(getPaxRosterIndex_('tracker', regressSheetId).charlie, appendOffset);

  sortTrackerSheet_(regressTracker); // real reorder (Charlie/Delta/Echo, all 'Z-Team') + F3Go30-a2hq's index purge

  // Post-sort ground truth: Charlie < Delta < Echo alphabetically within the same Team, so
  // Charlie is now at offset 0 — NOT the append-time offset (2) the patch recorded. Echo moves
  // INTO that old offset.
  var postSortNames = regressTracker.getRange(4, 1, 3, 1).getValues().map(function(r) { return r[0]; });
  assert.deepEqual(postSortNames, ['Charlie', 'Delta', 'Echo'], 'precondition: the sort actually reordered rows');

  var rebuildReadNameColumn_ = function() {
    return regressTracker.getRange(4, 1, 3, 1).getValues().map(function(r) { return r[0]; });
  };
  var resolved = resolvePaxRowIndex_('tracker', regressSheetId, 'Charlie', rebuildReadNameColumn_);

  // ASSERT ON CACHE STATE, NOT ROW ORDER (bd memory f3go30-tracker-sort-invalidates-roster-index's
  // TEST TRAP note): the correct resolution here only happens because the sort dropped the
  // poisoned index, forcing a live rebuild. If F3Go30-a2hq's purge were reverted, resolved would
  // instead come back as the stale patched value (2) — which post-sort belongs to Echo, not
  // Charlie: exactly the cross-PAX identity leak this bead exists to guard against.
  assert.equal(resolved, 0, 'resolvePaxRowIndex_ must resolve Charlie to her REAL post-sort row, not the pre-sort patched offset');
  assert.notEqual(resolved, appendOffset, 'the stale append-time offset must not be reused after a sort moved rows');

  var rebuiltIndex = getPaxRosterIndex_('tracker', regressSheetId);
  assert.equal(rebuiltIndex.charlie, 0, 'the rebuilt index correctly re-scans post-sort offsets');
  assert.equal(rebuiltIndex.echo, appendOffset, 'Echo (who moved INTO the old append offset) is correctly distinguished from Charlie');
}

// A sheet with no rows to sort must not touch the cache either (the early return), and a sheet
// mock without getParent must not throw — a sort must never fail over cache bookkeeping.
{
  var shortSheetId = 'sheet-sort-too-short';
  setPaxRosterIndex_('tracker', shortSheetId, { solo: 0 });
  var shortSheet = makeGridSheet_([['', '', ''], ['Period', '', ''], ['F3 Name', 'Team', '']]);
  shortSheet.getParent = function() { return { getId: function() { return shortSheetId; } }; };
  sortTrackerSheet_(shortSheet);
  assert.notEqual(getPaxRosterIndex_('tracker', shortSheetId), null, 'nothing sorted, nothing invalidated');

  var parentlessSheet = makeGridSheet_([
    ['', '', ''], ['Period', '', ''], ['F3 Name', 'Team', ''], ['Zeta', 'Crucible', 0], ['Alpha', 'Crucible', 0],
  ]);
  assert.doesNotThrow(function() { sortTrackerSheet_(parentlessSheet); }, 'a sheet with no getParent must not break sorting');
}


console.log('test_tracker_sheet.js: PASS');
