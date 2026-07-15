const assert = require('node:assert/strict');

// In-memory stand-in for PropertiesService.getScriptProperties() — same shape/behavior contract
// (getProperty/setProperty/deleteProperty/getKeys) the real GAS service exposes.
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
    _store: store,
  };
}

var fakeProps;
global.PropertiesService = {
  getScriptProperties: function() { return fakeProps; },
};

// In-memory stand-in for DriveApp.getFileById(id).getLastUpdated() — the Drive-modtime
// freshness gate's only external dependency. fakeDriveModTimes maps sheetId -> ms.
var fakeDriveModTimes;
global.DriveApp = {
  getFileById: function(id) {
    return { getLastUpdated: function() { return new Date(fakeDriveModTimes[id] || 0); } };
  },
};

// In-memory stand-in for LockService.getScriptLock() — single-process tests never contend, so
// this just needs to satisfy the waitLock/releaseLock contract patchPaxRosterIndex_ relies on.
global.LockService = {
  getScriptLock: function() {
    return { waitLock: function() {}, releaseLock: function() {} };
  },
};
global.GasLogger = { log: function() {}, run: function(name, fn) { return fn(); } };

// In-memory stand-in for CacheService.getScriptCache() — ensurePaxCacheFresh_ also clears
// dashboardWebapp.js's full-roster cache keys (go30dash:trackerValues:/go30dash:responsesValues:)
// on a modtime-detected change; this just needs to satisfy get/put/remove.
var fakeCache_;
function makeFakeCache_() {
  var store = {};
  return {
    get: function(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    put: function(key, value) { store[key] = value; },
    remove: function(key) { delete store[key]; },
    _store: store,
  };
}
fakeCache_ = makeFakeCache_();
global.CacheService = { getScriptCache: function() { return fakeCache_; } };

const {
  paxCacheNormalizeName_,
  getPaxCacheRow_,
  setPaxCacheRow_,
  setPaxCacheRowsBulk_,
  deletePaxCacheRow_,
  getPaxRosterIndex_,
  setPaxRosterIndex_,
  patchPaxRosterIndex_,
  wipePaxCacheForSheet_,
  resolvePaxRowIndex_,
  ensurePaxCacheFresh_,
  markPaxCacheFreshNow_,
  resetPaxCacheFreshnessMemo_,
} = require('../script/PaxCache.js');

function resetProps_() {
  fakeProps = makeFakeProperties_();
  fakeDriveModTimes = {};
  resetPaxCacheFreshnessMemo_();
}

// ── per-PAX row cache ────────────────────────────────────────────────────
(function testPerPaxRowCacheRoundTrip() {
  resetProps_();
  assert.equal(getPaxCacheRow_('tracker', 'sheet1', 'Crazy Ivan'), null);
  setPaxCacheRow_('tracker', 'sheet1', 'Crazy Ivan', ['Crazy Ivan', 'Crucible', 1, 0, '']);
  var cached = getPaxCacheRow_('tracker', 'sheet1', 'crazy ivan'); // name lookup is case/space-insensitive
  assert.deepEqual(cached, ['Crazy Ivan', 'Crucible', 1, 0, '']);
  deletePaxCacheRow_('tracker', 'sheet1', 'Crazy Ivan');
  assert.equal(getPaxCacheRow_('tracker', 'sheet1', 'Crazy Ivan'), null);
})();

(function testPerPaxRowCacheRoundTripsDates() {
  resetProps_();
  var ts = new Date(2026, 5, 1, 12, 30);
  setPaxCacheRow_('responses', 'sheet1', 'Little John', [ts, 'Little John', 'lj@example.com']);
  var cached = getPaxCacheRow_('responses', 'sheet1', 'Little John');
  assert.ok(cached[0] instanceof Date);
  assert.equal(cached[0].getTime(), ts.getTime());
})();

(function testPerPaxCacheIsolatedByKindAndSheet() {
  resetProps_();
  setPaxCacheRow_('tracker', 'sheetA', 'Same Name', ['tracker-A']);
  setPaxCacheRow_('responses', 'sheetA', 'Same Name', ['responses-A']);
  setPaxCacheRow_('tracker', 'sheetB', 'Same Name', ['tracker-B']);
  assert.deepEqual(getPaxCacheRow_('tracker', 'sheetA', 'Same Name'), ['tracker-A']);
  assert.deepEqual(getPaxCacheRow_('responses', 'sheetA', 'Same Name'), ['responses-A']);
  assert.deepEqual(getPaxCacheRow_('tracker', 'sheetB', 'Same Name'), ['tracker-B']);
})();

(function testSetPaxCacheRowsBulkWritesRowsAndRosterIndexInOneCall() {
  resetProps_();
  var setPropertyCalls = 0;
  var realSetProperty = fakeProps.setProperty;
  fakeProps.setProperty = function() { setPropertyCalls++; return realSetProperty.apply(this, arguments); };

  setPaxCacheRowsBulk_('tracker', 'sheet1', {
    'Crazy Ivan': ['Crazy Ivan', 'Crucible', 1],
    'Little John': ['Little John', 'Crucible', 0],
  }, { 'crazy ivan': 0, 'little john': 1 });

  assert.equal(setPropertyCalls, 0); // went through setProperties, not per-key setProperty
  assert.deepEqual(getPaxCacheRow_('tracker', 'sheet1', 'Crazy Ivan'), ['Crazy Ivan', 'Crucible', 1]);
  assert.deepEqual(getPaxCacheRow_('tracker', 'sheet1', 'Little John'), ['Little John', 'Crucible', 0]);
  assert.deepEqual(getPaxRosterIndex_('tracker', 'sheet1'), { 'crazy ivan': 0, 'little john': 1 });
})();

(function testSetPaxCacheRowsBulkDoesNotDisturbUnrelatedProperties() {
  resetProps_();
  setPaxCacheRow_('tracker', 'sheetOther', 'Someone Else', ['untouched']);
  setPaxCacheRowsBulk_('tracker', 'sheet1', { 'Crazy Ivan': ['v1'] }, { 'crazy ivan': 0 });
  assert.deepEqual(getPaxCacheRow_('tracker', 'sheetOther', 'Someone Else'), ['untouched']);
})();

// ── roster index ─────────────────────────────────────────────────────────
(function testResolvePaxRowIndexRebuildsOnMiss() {
  resetProps_();
  var reads = 0;
  var readNameColumn = function() { reads++; return ['Little John', 'Crazy Ivan', '', 'Splinter']; };

  assert.equal(resolvePaxRowIndex_('tracker', 'sheet1', 'Crazy Ivan', readNameColumn), 1);
  assert.equal(reads, 1);

  // Second lookup (different name, same sheet) hits the now-cached index — no second scan.
  assert.equal(resolvePaxRowIndex_('tracker', 'sheet1', 'Splinter', readNameColumn), 3);
  assert.equal(reads, 1);
})();

(function testResolvePaxRowIndexNeverCachesAMiss() {
  resetProps_();
  var reads = 0;
  var readNameColumn = function() { reads++; return ['Little John']; };

  assert.equal(resolvePaxRowIndex_('tracker', 'sheet1', 'Nobody', readNameColumn), -1);
  assert.equal(reads, 1);
  // A second lookup for the same never-found name re-scans rather than trusting a cached miss —
  // a brand-new signup that lands between these two calls must be found immediately.
  assert.equal(resolvePaxRowIndex_('tracker', 'sheet1', 'Nobody', readNameColumn), -1);
  assert.equal(reads, 2);
})();

(function testPatchPaxRosterIndexNoopWhenNothingCached() {
  resetProps_();
  patchPaxRosterIndex_('responses', 'sheet1', 'New Guy', 5);
  assert.equal(getPaxRosterIndex_('responses', 'sheet1'), null);
})();

(function testPatchPaxRosterIndexUpdatesExistingIndex() {
  resetProps_();
  setPaxRosterIndex_('responses', 'sheet1', { 'little john': 0 });
  patchPaxRosterIndex_('responses', 'sheet1', 'New Guy', 1);
  assert.deepEqual(getPaxRosterIndex_('responses', 'sheet1'), { 'little john': 0, 'new guy': 1 });
})();

// ── bulk wipe ────────────────────────────────────────────────────────────
(function testWipePaxCacheForSheetClearsRowsAndIndexOnlyForThatSheet() {
  resetProps_();
  setPaxCacheRow_('tracker', 'sheetA', 'PAX One', ['a']);
  setPaxCacheRow_('tracker', 'sheetA', 'PAX Two', ['b']);
  setPaxRosterIndex_('tracker', 'sheetA', { 'pax one': 0, 'pax two': 1 });
  setPaxCacheRow_('tracker', 'sheetB', 'PAX Three', ['c']);
  setPaxRosterIndex_('tracker', 'sheetB', { 'pax three': 0 });

  wipePaxCacheForSheet_('tracker', 'sheetA');

  assert.equal(getPaxCacheRow_('tracker', 'sheetA', 'PAX One'), null);
  assert.equal(getPaxCacheRow_('tracker', 'sheetA', 'PAX Two'), null);
  assert.equal(getPaxRosterIndex_('tracker', 'sheetA'), null);
  // sheetB is untouched.
  assert.deepEqual(getPaxCacheRow_('tracker', 'sheetB', 'PAX Three'), ['c']);
  assert.deepEqual(getPaxRosterIndex_('tracker', 'sheetB'), { 'pax three': 0 });
})();

(function testPaxCacheNormalizeName() {
  assert.equal(paxCacheNormalizeName_('  Crazy Ivan  '), 'crazy ivan');
  assert.equal(paxCacheNormalizeName_(''), '');
  assert.equal(paxCacheNormalizeName_(null), '');
})();

// ── Drive-modtime freshness gate (replaces the onEdit trigger, which can't reach this store —
// see PaxCache.js file header) ──────────────────────────────────────────────────────────────
(function testFreshnessGateTrustsCacheWhenModTimeUnchanged() {
  resetProps_();
  fakeDriveModTimes['sheet1'] = 1000;
  ensurePaxCacheFresh_('sheet1'); // establishes the asOf baseline for this modtime
  setPaxCacheRow_('tracker', 'sheet1', 'Crazy Ivan', ['v1']);
  resetPaxCacheFreshnessMemo_(); // simulate a new execution re-checking the same sheet
  assert.deepEqual(getPaxCacheRow_('tracker', 'sheet1', 'Crazy Ivan'), ['v1']);
})();

(function testFreshnessGateWipesSheetWhenModTimeAdvances() {
  resetProps_();
  fakeDriveModTimes['sheet1'] = 1000;
  setPaxCacheRow_('tracker', 'sheet1', 'Crazy Ivan', ['v1']);
  ensurePaxCacheFresh_('sheet1'); // records asOf = 1000 for this (fresh) execution

  resetPaxCacheFreshnessMemo_(); // next execution
  fakeDriveModTimes['sheet1'] = 2000; // someone edited the sheet directly in the Sheets UI
  assert.equal(getPaxCacheRow_('tracker', 'sheet1', 'Crazy Ivan'), null);
})();

(function testFreshnessGateWipesBothKindsSharingAFile() {
  resetProps_();
  fakeDriveModTimes['sheet1'] = 1000;
  setPaxCacheRow_('tracker', 'sheet1', 'Crazy Ivan', ['t']);
  setPaxCacheRow_('responses', 'sheet1', 'Crazy Ivan', ['r']);
  ensurePaxCacheFresh_('sheet1');

  resetPaxCacheFreshnessMemo_();
  fakeDriveModTimes['sheet1'] = 2000;
  ensurePaxCacheFresh_('sheet1');

  assert.equal(getPaxCacheRow_('tracker', 'sheet1', 'Crazy Ivan'), null);
  assert.equal(getPaxCacheRow_('responses', 'sheet1', 'Crazy Ivan'), null);
})();

(function testFreshnessGateClearsDashboardWebappFullRosterCacheKeysOnModTimeAdvance() {
  resetProps_();
  fakeCache_ = makeFakeCache_();
  global.CacheService = { getScriptCache: function() { return fakeCache_; } };

  fakeDriveModTimes['sheet1'] = 1000;
  ensurePaxCacheFresh_('sheet1'); // records asOf = 1000 for this (fresh) execution
  fakeCache_.put('go30dash:trackerValues:sheet1', 'stale-tracker');
  fakeCache_.put('go30dash:responsesValues:sheet1', 'stale-responses');

  resetPaxCacheFreshnessMemo_();
  fakeDriveModTimes['sheet1'] = 2000;
  ensurePaxCacheFresh_('sheet1');

  assert.equal(fakeCache_.get('go30dash:trackerValues:sheet1'), null);
  assert.equal(fakeCache_.get('go30dash:responsesValues:sheet1'), null);
})();

(function testFreshnessGateLeavesDashboardWebappCacheKeysAloneWhenModTimeUnchanged() {
  resetProps_();
  fakeCache_ = makeFakeCache_();
  global.CacheService = { getScriptCache: function() { return fakeCache_; } };

  fakeDriveModTimes['sheet1'] = 1000;
  ensurePaxCacheFresh_('sheet1');
  fakeCache_.put('go30dash:trackerValues:sheet1', 'fresh-tracker');

  resetPaxCacheFreshnessMemo_();
  ensurePaxCacheFresh_('sheet1'); // same modtime — no change detected

  assert.equal(fakeCache_.get('go30dash:trackerValues:sheet1'), 'fresh-tracker');
})();

// F3Go30-nzi0: a manual Bonus Tracker edit must clear the un-gated bonus caches
// (go30dash:bonusEntries:/go30dash:bonusRows:) too, not just the roster caches — otherwise the
// dashboard keeps serving pre-edit bonus totals for up to BONUS_ENTRIES_CACHE_TTL_SECONDS_.
(function testFreshnessGateClearsBonusCacheKeysOnModTimeAdvance() {
  resetProps_();
  fakeCache_ = makeFakeCache_();
  global.CacheService = { getScriptCache: function() { return fakeCache_; } };

  fakeDriveModTimes['sheet1'] = 1000;
  ensurePaxCacheFresh_('sheet1'); // records asOf = 1000 for this (fresh) execution
  fakeCache_.put('go30dash:bonusEntries:sheet1', 'stale-bonus-entries');
  fakeCache_.put('go30dash:bonusRows:sheet1', 'stale-bonus-rows');

  resetPaxCacheFreshnessMemo_();
  fakeDriveModTimes['sheet1'] = 2000;
  ensurePaxCacheFresh_('sheet1');

  assert.equal(fakeCache_.get('go30dash:bonusEntries:sheet1'), null);
  assert.equal(fakeCache_.get('go30dash:bonusRows:sheet1'), null);
})();

(function testFreshnessGateLeavesBonusCacheKeysAloneWhenModTimeUnchanged() {
  resetProps_();
  fakeCache_ = makeFakeCache_();
  global.CacheService = { getScriptCache: function() { return fakeCache_; } };

  fakeDriveModTimes['sheet1'] = 1000;
  ensurePaxCacheFresh_('sheet1');
  fakeCache_.put('go30dash:bonusEntries:sheet1', 'fresh-bonus-entries');

  resetPaxCacheFreshnessMemo_();
  ensurePaxCacheFresh_('sheet1'); // same modtime — no change detected

  assert.equal(fakeCache_.get('go30dash:bonusEntries:sheet1'), 'fresh-bonus-entries');
})();

(function testFreshnessGateIsMemoizedPerExecution() {
  resetProps_();
  var calls = 0;
  var realGetFileById = global.DriveApp.getFileById;
  global.DriveApp.getFileById = function(id) { calls++; return realGetFileById(id); };
  try {
    fakeDriveModTimes['sheet1'] = 1000;
    getPaxCacheRow_('tracker', 'sheet1', 'Crazy Ivan');
    getPaxCacheRow_('tracker', 'sheet1', 'Little John');
    resolvePaxRowIndex_('tracker', 'sheet1', 'Splinter', function() { return ['Splinter']; });
    assert.equal(calls, 1); // one DriveApp call for the whole execution, not one per lookup
  } finally {
    global.DriveApp.getFileById = realGetFileById;
  }
})();

(function testFreshnessGateFailsOpenWhenDriveUnavailable() {
  resetProps_();
  var realDriveApp = global.DriveApp;
  delete global.DriveApp;
  try {
    setPaxCacheRow_('tracker', 'sheet1', 'Crazy Ivan', ['v1']); // write path doesn't touch DriveApp
  } finally {
    global.DriveApp = realDriveApp;
  }
  delete global.DriveApp;
  try {
    // A read with no DriveApp available must not throw, and must trust the existing cache.
    assert.deepEqual(getPaxCacheRow_('tracker', 'sheet1', 'Crazy Ivan'), ['v1']);
  } finally {
    global.DriveApp = realDriveApp;
  }
})();

// ── markPaxCacheFreshNow_ (F3Go30-qi26.4) ────────────────────────────────
// Stamps asOf without a Drive round trip, for callers that just read live. A subsequent
// ensurePaxCacheFresh_ for the same sheet in the same execution must then be a no-op (memo set),
// and a fresh execution must see the stamped asOf so an unchanged sheet is NOT re-wiped.
(function testMarkFreshNowStampsAsOfWithoutDriveCall() {
  resetProps_();
  fakeCache_ = makeFakeCache_();
  global.CacheService = { getScriptCache: function() { return fakeCache_; } };

  var calls = 0;
  var realGetFileById = global.DriveApp.getFileById;
  global.DriveApp.getFileById = function(id) { calls++; return realGetFileById(id); };
  try {
    var before = Date.now();
    markPaxCacheFreshNow_('sheet1');
    assert.equal(calls, 0); // no DriveApp.getFileById — that's the whole point

    // asOf was written from the script clock (>= now), so a same-modtime re-check never wipes.
    var storedAsOf = Number(fakeProps.getProperty('go30asof:sheet1'));
    assert.ok(storedAsOf >= before);

    // Same execution: memo is set, so ensurePaxCacheFresh_ short-circuits (still zero Drive calls).
    fakeCache_.put('go30dash:trackerValues:sheet1', 'freshly-read');
    ensurePaxCacheFresh_('sheet1');
    assert.equal(calls, 0);
    assert.equal(fakeCache_.get('go30dash:trackerValues:sheet1'), 'freshly-read');

    // New execution, sheet unedited (modtime <= stamped asOf) — cache survives, not re-wiped.
    resetPaxCacheFreshnessMemo_();
    fakeDriveModTimes['sheet1'] = before - 1000;
    ensurePaxCacheFresh_('sheet1');
    assert.equal(calls, 1); // one probe this new execution
    assert.equal(fakeCache_.get('go30dash:trackerValues:sheet1'), 'freshly-read');
  } finally {
    global.DriveApp.getFileById = realGetFileById;
  }
})();

console.log('test_pax_cache.js: all assertions passed');
