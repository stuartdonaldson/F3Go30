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

// In-memory stand-in for LockService.getScriptLock() — single-process tests never contend, so
// this just needs to satisfy the waitLock/releaseLock contract patchPaxRosterIndex_ relies on.
global.LockService = {
  getScriptLock: function() {
    return { waitLock: function() {}, releaseLock: function() {} };
  },
};
global.GasLogger = { log: function() {}, run: function(name, fn) { return fn(); } };

// In-memory stand-in for CacheService.getScriptCache() — wipePaxCacheAndRelatedCachesForSheet_
// also clears dashboardWebapp.js's full-roster cache keys (go30dash:trackerValues:/
// go30dash:responsesValues:); this just needs to satisfy get/put/remove.
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
  markPaxCacheFreshNow_,
  resetPaxCacheFreshnessMemo_,
  getPaxCacheRequestStats_,
  resetPaxCacheRequestStats_,
  purgeStalePaxCache_,
  PAX_CACHE_PURGE_RETENTION_DAYS_,
  collectKnownTrackerSheetIds_,
  extractSheetIdFromPaxCacheKey_,
} = require('../script/PaxCache.js');

function resetProps_() {
  fakeProps = makeFakeProperties_();
  resetPaxCacheFreshnessMemo_();
  resetPaxCacheRequestStats_();
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

// ── markPaxCacheFreshNow_ (F3Go30-qi26.4) ────────────────────────────────
// Stamps asOf without a Drive round trip — no reader consumes this marker anymore (the
// Drive-modtime freshness gate it used to backstop was retired, F3Go30-o39s.7), so this just
// verifies the write itself is still side-effect-free.
(function testMarkFreshNowStampsAsOfWithoutDriveCall() {
  resetProps_();
  var before = Date.now();
  markPaxCacheFreshNow_('sheet1');
  var storedAsOf = Number(fakeProps.getProperty('go30asof:sheet1'));
  assert.ok(storedAsOf >= before);
})();

// ── request stats (F3Go30-440b.1) ────────────────────────────────────────
(function testRequestStatsTrackRowHitAndMiss() {
  resetProps_();
  getPaxCacheRow_('tracker', 'sheet1', 'Nobody'); // miss
  setPaxCacheRow_('tracker', 'sheet1', 'Crazy Ivan', ['v1']);
  getPaxCacheRow_('tracker', 'sheet1', 'Crazy Ivan'); // hit
  var stats = getPaxCacheRequestStats_();
  assert.equal(stats.paxRowMiss, 1);
  assert.equal(stats.paxRowHit, 1);
})();

(function testRequestStatsTrackRosterHitAndMiss() {
  resetProps_();
  var readNameColumn = function() { return ['Crazy Ivan']; };
  resolvePaxRowIndex_('tracker', 'sheet1', 'Crazy Ivan', readNameColumn); // no cached index yet — miss (rebuild)
  resolvePaxRowIndex_('tracker', 'sheet1', 'Crazy Ivan', readNameColumn); // now cached — hit
  var stats = getPaxCacheRequestStats_();
  assert.equal(stats.paxRosterMiss, 1);
  assert.equal(stats.paxRosterHit, 1);
})();

// paxCacheWiped has no remaining writer since the Drive-modtime freshness gate was retired
// (F3Go30-o39s.7) — wipes now happen via wipePaxCacheForSheet_/wipePaxCacheAndRelatedCachesForSheet_
// (TrackerEditTrigger.js's onEdit path), which don't set this per-request flag.
(function testRequestStatsWipeFlagStaysFalse() {
  resetProps_();
  resetPaxCacheRequestStats_();
  getPaxCacheRow_('tracker', 'sheet1', 'Nobody');
  assert.equal(getPaxCacheRequestStats_().paxCacheWiped, false);
})();

(function testRequestStatsResetClearsAllCounters() {
  resetProps_();
  getPaxCacheRow_('tracker', 'sheet1', 'Nobody');
  resolvePaxRowIndex_('tracker', 'sheet1', 'Nobody', function() { return []; });
  resetPaxCacheRequestStats_();
  assert.deepEqual(getPaxCacheRequestStats_(), {
    paxCacheWiped: false, paxRosterHit: 0, paxRosterMiss: 0, paxRowHit: 0, paxRowMiss: 0,
  });
})();

// ── nightly purge (F3Go30-440b.2) ────────────────────────────────────────
var TRACKER_DB_HEADERS_FOR_TEST_ = [
  'Date Modified', 'StartDate', 'SpreadsheetName', 'ShortTracker', 'TrackerURL', 'ShortHC',
  'HC URL', 'SheetId', 'FormId', 'TotalPAX', 'TotalTeams', 'AverageScore', 'LastSignupAt',
  'TriggersInitializedAt', 'LastMinusOneRunAt', 'LastNagRunAt',
];

var CHECKIN_SESSIONS_HEADERS_FOR_TEST_ = ['Session Id', 'F3 Name', 'Email', 'Created At', 'Last Used At'];

var NAMESPACE_DB_HEADERS_FOR_TEST_ = [
  'NameSpace', 'TemplateId', 'Kind', 'NagEnabled', 'MinusOneEnabled', 'AutoGenerateEnabled', 'CleanupSessionsEnabled',
];

function makeFakeTrackerDbSheet_(rows) {
  var values = [TRACKER_DB_HEADERS_FOR_TEST_].concat(rows.map(function(r) {
    return ['', r.startDate, '', '', '', '', '', r.sheetId, '', 0, 0, 0, '', '', '', ''];
  }));
  return { getDataRange: function() { return { getValues: function() { return values; } }; } };
}

// sessionF3Names is optional — omit it to simulate no CheckinSessions sheet at all (different
// from an empty array: listActiveCheckinSessionF3Names_ returns {} either way, but the two paths
// exercise different code in that function). namespaces is optional — array of
// {namespace, templateId, rows}; when present, a NamespaceDB sheet is added and
// global.SpreadsheetApp.openById is wired to resolve each templateId to its own fake spreadsheet
// carrying just its own TrackerDB (F3Go30-440b.2 follow-up: cross-namespace orphan-sweep tests).
function makeFakeTrackerDbSpreadsheet_(rows, sessionF3Names, namespaces) {
  var trackerDbSheet = makeFakeTrackerDbSheet_(rows);

  var checkinSessionsSheet = null;
  if (sessionF3Names) {
    var sessionRows = sessionF3Names.map(function(name) { return [name + '-guid', name, name + '@example.com', 't1', 't2']; });
    checkinSessionsSheet = {
      getLastRow: function() { return sessionRows.length + 1; },
      getRange: function() { return { getValues: function() { return sessionRows; } }; },
    };
  }

  var namespaceDbSheet = null;
  if (namespaces) {
    var nsValues = [NAMESPACE_DB_HEADERS_FOR_TEST_].concat(namespaces.map(function(ns) {
      return [ns.namespace, ns.templateId, ns.kind || 'smoke', '', '', '', ''];
    }));
    namespaceDbSheet = { getDataRange: function() { return { getValues: function() { return nsValues; } }; } };

    var byTemplateId = {};
    namespaces.forEach(function(ns) {
      byTemplateId[ns.templateId] = ns.unreachable ? null : {
        getSheetByName: function(name) { return name === 'TrackerDB' ? makeFakeTrackerDbSheet_(ns.rows || []) : null; },
      };
    });
    global.SpreadsheetApp = global.SpreadsheetApp || {};
    global.SpreadsheetApp.openById = function(id) {
      if (!Object.prototype.hasOwnProperty.call(byTemplateId, id) || byTemplateId[id] === null) {
        throw new Error('namespace spreadsheet unreachable: ' + id);
      }
      return byTemplateId[id];
    };
  }

  return {
    getSheetByName: function(name) {
      if (name === 'TrackerDB') return trackerDbSheet;
      if (name === 'CheckinSessions') return checkinSessionsSheet;
      if (name === 'NamespaceDB') return namespaceDbSheet;
      return null;
    },
  };
}

(function testPurgeWipesOnlySheetsOlderThanRetention() {
  resetProps_();
  var now = new Date(2026, 6, 16); // Jul 16 2026
  var oldStart = new Date(now.getTime() - (PAX_CACHE_PURGE_RETENTION_DAYS_ + 5) * 24 * 60 * 60 * 1000);
  var recentStart = new Date(now.getTime() - (PAX_CACHE_PURGE_RETENTION_DAYS_ - 5) * 24 * 60 * 60 * 1000);

  setPaxCacheRow_('tracker', 'sheet-old', 'Crazy Ivan', ['old']);
  setPaxCacheRow_('responses', 'sheet-old', 'Crazy Ivan', ['old-r']);
  setPaxRosterIndex_('tracker', 'sheet-old', { 'crazy ivan': 0 });
  fakeProps.setProperty('go30asof:sheet-old', '123');

  setPaxCacheRow_('tracker', 'sheet-recent', 'Little John', ['recent']);

  var spreadsheet = makeFakeTrackerDbSpreadsheet_([
    { sheetId: 'sheet-old', startDate: oldStart },
    { sheetId: 'sheet-recent', startDate: recentStart },
  ]);

  var result = purgeStalePaxCache_(now, spreadsheet);
  assert.deepEqual(result, { checked: 2, purged: 1, kept: 1, paxRowsPurged: 0, orphanedSheetsPurged: 0 });

  // Check the asOf marker directly rather than via a read helper that might re-stamp it as a
  // side effect and mask whether the purge actually deleted it.
  assert.equal(fakeProps.getProperty('go30asof:sheet-old'), null);
  assert.equal(fakeProps.getKeys().some(function(k) { return k.indexOf('go30pax:tracker:sheet-old:') === 0; }), false);
  assert.equal(fakeProps.getKeys().some(function(k) { return k.indexOf('go30pax:responses:sheet-old:') === 0; }), false);
  assert.equal(fakeProps.getProperty('go30idx:tracker:sheet-old'), null);

  // Current-month entries untouched.
  assert.deepEqual(getPaxCacheRow_('tracker', 'sheet-recent', 'Little John'), ['recent']);
})();

(function testPurgeKeepsRowWithUnparseableStartDate() {
  resetProps_();
  setPaxCacheRow_('tracker', 'sheet-bad', 'PAX', ['v']);
  var spreadsheet = makeFakeTrackerDbSpreadsheet_([{ sheetId: 'sheet-bad', startDate: 'not-a-date' }]);
  var result = purgeStalePaxCache_(new Date(2026, 6, 16), spreadsheet);
  assert.deepEqual(result, { checked: 1, purged: 0, kept: 1, paxRowsPurged: 0, orphanedSheetsPurged: 0 });
  assert.deepEqual(getPaxCacheRow_('tracker', 'sheet-bad', 'PAX'), ['v']);
})();

(function testPurgeRemovesPaxRowsNotInCheckinSessions() {
  resetProps_();
  var now = new Date(2026, 6, 16);
  var recentStart = new Date(now.getTime() - (PAX_CACHE_PURGE_RETENTION_DAYS_ - 5) * 24 * 60 * 60 * 1000);

  setPaxCacheRow_('tracker', 'sheet-recent', 'Crazy Ivan', ['active']);
  setPaxCacheRow_('tracker', 'sheet-recent', 'Ghost Pax', ['gone']);
  setPaxRosterIndex_('tracker', 'sheet-recent', { 'crazy ivan': 0, 'ghost pax': 1 });
  setPaxCacheRow_('responses', 'sheet-recent', 'Ghost Pax', ['gone-r']);
  setPaxRosterIndex_('responses', 'sheet-recent', { 'ghost pax': 1 });

  // Only "Crazy Ivan" still holds a CheckinSessions row — "Ghost Pax" was pruned there already.
  var spreadsheet = makeFakeTrackerDbSpreadsheet_(
    [{ sheetId: 'sheet-recent', startDate: recentStart }],
    ['Crazy Ivan']
  );

  var result = purgeStalePaxCache_(now, spreadsheet);
  assert.deepEqual(result, { checked: 1, purged: 0, kept: 1, paxRowsPurged: 2, orphanedSheetsPurged: 0 });

  assert.deepEqual(getPaxCacheRow_('tracker', 'sheet-recent', 'Crazy Ivan'), ['active']);
  assert.equal(getPaxCacheRow_('tracker', 'sheet-recent', 'Ghost Pax'), null);
  assert.equal(getPaxCacheRow_('responses', 'sheet-recent', 'Ghost Pax'), null);
})();

// A missing/empty CheckinSessions sheet means "nobody currently active," per
// listActiveCheckinSessionF3Names_'s own contract (F3Go30 — read-only, never provisions the
// sheet) — so every cached PAX row on a kept sheet is purged, same as any genuinely inactive PAX.
(function testPurgePurgesEveryPaxRowWhenNoOneHasACheckinSession() {
  resetProps_();
  var now = new Date(2026, 6, 16);
  var recentStart = new Date(now.getTime() - (PAX_CACHE_PURGE_RETENTION_DAYS_ - 5) * 24 * 60 * 60 * 1000);

  setPaxCacheRow_('tracker', 'sheet-recent', 'Crazy Ivan', ['active']);
  setPaxRosterIndex_('tracker', 'sheet-recent', { 'crazy ivan': 0 });

  var spreadsheet = makeFakeTrackerDbSpreadsheet_([{ sheetId: 'sheet-recent', startDate: recentStart }]);

  var result = purgeStalePaxCache_(now, spreadsheet);
  assert.deepEqual(result, { checked: 1, purged: 0, kept: 1, paxRowsPurged: 1, orphanedSheetsPurged: 0 });
  assert.equal(getPaxCacheRow_('tracker', 'sheet-recent', 'Crazy Ivan'), null);
})();

(function testPurgeNoOpWhenTrackerDbMissing() {
  resetProps_();
  var spreadsheet = { getSheetByName: function() { return null; } };
  var result = purgeStalePaxCache_(new Date(2026, 6, 16), spreadsheet);
  assert.deepEqual(result, { checked: 0, purged: 0, kept: 0, paxRowsPurged: 0, orphanedSheetsPurged: 0 });
})();

// ── orphan sweep (F3Go30-440b.2 follow-up) ───────────────────────────────
(function testExtractSheetIdFromPaxCacheKeyParsesAllThreePrefixes() {
  assert.equal(extractSheetIdFromPaxCacheKey_('go30pax:tracker:sheet1:crazy ivan'), 'sheet1');
  assert.equal(extractSheetIdFromPaxCacheKey_('go30idx:responses:sheet2'), 'sheet2');
  assert.equal(extractSheetIdFromPaxCacheKey_('go30asof:sheet3'), 'sheet3');
  assert.equal(extractSheetIdFromPaxCacheKey_('WEBAPP_URL'), null);
})();

(function testCollectKnownTrackerSheetIdsUnionsBoundAndEveryNamespace() {
  var spreadsheet = makeFakeTrackerDbSpreadsheet_(
    [{ sheetId: 'bound-tracker', startDate: new Date(2026, 6, 1) }],
    null,
    [{ namespace: 'sit-smoke', templateId: 'ns-tmpl-1', rows: [{ sheetId: 'ns-tracker-1', startDate: new Date(2026, 6, 1) }] }]
  );
  var known = collectKnownTrackerSheetIds_(spreadsheet);
  assert.deepEqual(known, { 'bound-tracker': true, 'ns-tmpl-1': true, 'ns-tracker-1': true });
  delete global.SpreadsheetApp;
})();

(function testCollectKnownTrackerSheetIdsSkipsUnreachableNamespaceAndLogs() {
  var logged = [];
  var realLog = global.GasLogger.log;
  global.GasLogger.log = function(name, data) { logged.push({ name: name, data: data }); };

  var spreadsheet = makeFakeTrackerDbSpreadsheet_(
    [{ sheetId: 'bound-tracker', startDate: new Date(2026, 6, 1) }],
    null,
    [{ namespace: 'gone', templateId: 'ns-tmpl-gone', unreachable: true }]
  );
  var known = collectKnownTrackerSheetIds_(spreadsheet);
  // The unreachable namespace's own templateId is still recorded as known (it was registered),
  // but nothing further can be discovered about its trackers — never throws the whole run.
  assert.deepEqual(known, { 'bound-tracker': true, 'ns-tmpl-gone': true });
  assert.ok(logged.some(function(l) { return l.name === 'purgeStalePaxCache_.namespaceUnreachable'; }));

  global.GasLogger.log = realLog;
  delete global.SpreadsheetApp;
})();

(function testPurgeOrphanSweepWipesEntriesForDeletedTracker() {
  resetProps_();
  var now = new Date(2026, 6, 16);
  var recentStart = new Date(now.getTime() - (PAX_CACHE_PURGE_RETENTION_DAYS_ - 5) * 24 * 60 * 60 * 1000);

  // "sheet-deleted" has cache entries but no TrackerDB row at all (as if cleanupTracker already
  // removed it) — the age/CheckinSessions passes above never see it since they only walk
  // TrackerDB rows; only the orphan sweep can catch this.
  setPaxCacheRow_('tracker', 'sheet-deleted', 'Old Pax', ['gone']);
  setPaxRosterIndex_('tracker', 'sheet-deleted', { 'old pax': 0 });
  fakeProps.setProperty('go30asof:sheet-deleted', '999');

  setPaxCacheRow_('tracker', 'sheet-recent', 'Crazy Ivan', ['active']);
  setPaxRosterIndex_('tracker', 'sheet-recent', { 'crazy ivan': 0 });

  var spreadsheet = makeFakeTrackerDbSpreadsheet_(
    [{ sheetId: 'sheet-recent', startDate: recentStart }],
    ['Crazy Ivan']
  );

  var result = purgeStalePaxCache_(now, spreadsheet);
  assert.deepEqual(result, { checked: 1, purged: 0, kept: 1, paxRowsPurged: 0, orphanedSheetsPurged: 1 });

  assert.equal(fakeProps.getProperty('go30asof:sheet-deleted'), null);
  assert.equal(fakeProps.getKeys().some(function(k) { return k.indexOf('go30pax:tracker:sheet-deleted:') === 0; }), false);
  assert.equal(fakeProps.getProperty('go30idx:tracker:sheet-deleted'), null);
  // The still-registered, still-active tracker is untouched.
  assert.deepEqual(getPaxCacheRow_('tracker', 'sheet-recent', 'Crazy Ivan'), ['active']);
})();

(function testPurgeOrphanSweepDoesNotWipeLiveNamespaceTrackerCache() {
  resetProps_();
  var now = new Date(2026, 6, 16);
  var recentStart = new Date(now.getTime() - (PAX_CACHE_PURGE_RETENTION_DAYS_ - 5) * 24 * 60 * 60 * 1000);

  // This tracker's sheetId is NOT in the bound spreadsheet's own TrackerDB — it only exists in
  // a namespace's own TrackerDB. Without namespace fan-out, the orphan sweep would wrongly treat
  // it as deleted and wipe it every night.
  setPaxCacheRow_('tracker', 'ns-tracker-1', 'Namespace Pax', ['alive']);
  setPaxRosterIndex_('tracker', 'ns-tracker-1', { 'namespace pax': 0 });

  var spreadsheet = makeFakeTrackerDbSpreadsheet_(
    [],
    null,
    [{ namespace: 'sit-smoke', templateId: 'ns-tmpl-1', rows: [{ sheetId: 'ns-tracker-1', startDate: recentStart }] }]
  );

  var result = purgeStalePaxCache_(now, spreadsheet);
  assert.equal(result.orphanedSheetsPurged, 0);
  assert.deepEqual(getPaxCacheRow_('tracker', 'ns-tracker-1', 'Namespace Pax'), ['alive']);
  delete global.SpreadsheetApp;
})();

(function testPurgeOrphanSweepSkippedWhenKnownSheetIdsEmpty() {
  resetProps_();
  setPaxCacheRow_('tracker', 'sheet-anything', 'Someone', ['v']);

  // TrackerDB (and NamespaceDB) both missing entirely — collectKnownTrackerSheetIds_ comes back
  // empty. A read failure must never be mistaken for "nothing is live" and wipe everything.
  var spreadsheet = { getSheetByName: function() { return null; } };
  var result = purgeStalePaxCache_(new Date(2026, 6, 16), spreadsheet);
  assert.equal(result.orphanedSheetsPurged, 0);
  assert.deepEqual(getPaxCacheRow_('tracker', 'sheet-anything', 'Someone'), ['v']);
})();

console.log('test_pax_cache.js: all assertions passed');
