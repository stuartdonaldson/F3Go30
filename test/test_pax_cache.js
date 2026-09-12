const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

// F3Go30-taag/F3Go30-emwk.14: the PropertiesService / CacheService / LockService / GasLogger
// stand-ins come from test/helpers/gasEnv.js — this file used to carry its own copies, and they
// were the copies every other test file cloned. Each case is now its own `it`, so a failure names
// the behaviour rather than the file.
const { makeFakeProperties_, makeFakeCache_, makeFakeLogger_, makeFakeLock_ } = require('./helpers/gasEnv.js');
const { invalidateScriptPropertiesSnapshot_ } = require('../script/ScriptProperties.js');

var fakeProps;
global.PropertiesService = { getScriptProperties: function() { return fakeProps; } };

var fakeLock_ = makeFakeLock_();
global.LockService = { getScriptLock: function() { return fakeLock_; } };

var fakeLogger_ = makeFakeLogger_();
global.GasLogger = fakeLogger_;

// wipePaxCacheAndRelatedCachesForSheet_ also clears dashboardWebapp.js's full-roster cache keys
// (go30dash:trackerValues:/go30dash:responsesValues:), so the cache fake has to be live here too.
var fakeCache_ = makeFakeCache_();
global.CacheService = { getScriptCache: function() { return fakeCache_; } };

const {
  paxCacheNormalizeName_,
  getPaxCacheRow_,
  setPaxCacheRow_,
  wipeAllPaxCache_,
  setPaxCacheRowsBulk_,
  deletePaxCacheRow_,
  getPaxRosterIndex_,
  setPaxRosterIndex_,
  patchPaxRosterIndex_,
  refreshPaxCacheRowFromSheet_,
  refreshPaxCacheRowAndAdvanceHistoryForCheckin_,
  wipePaxCacheForSheet_,
  resolvePaxRowIndex_,
  getPaxCacheRequestStats_,
  resetPaxCacheRequestStats_,
  purgeStalePaxCache_,
  purgeStalePaxCache,
  PAX_CACHE_PURGE_RETENTION_DAYS_,
  collectKnownTrackerSheetIds_,
  extractSheetIdFromPaxCacheKey_,
  PAX_HISTORY_WINDOW_DAYS_,
  paxHistoryEncodeValue_,
  paxHistoryDecodeChar_,
  paxHistoryDaysToValues_,
  paxHistoryFormatIsoLocal_,
  paxHistoryDayDiff_,
  PAX_HISTORY_BACKFILL_DAYS_,
  setPaxHistoryEntriesBulk_,
  advancePaxHistoryEntry_,
  anchorPaxHistoryValues_,
  getPaxHistoryEntry_,
  getPaxHistoryEntriesBulk_,
  setPaxHistoryEntry_,
  advancePaxHistoryDay_,
  getPaxGoalsEntry_,
  setPaxGoalsEntry_,
  upsertPaxGoalsEntry_,
  findPaxGoalsForMonth_,
  getPaxGoalsForMonth_,
  upsertPaxGoalsForMonth_,
  wipePaxGoalsForScope_,
} = require('../script/PaxCache.js');

function resetProps_() {
  fakeProps = makeFakeProperties_();
  resetPaxCacheRequestStats_();
}

describe('PaxCache script-properties cache', function() {

// ── per-PAX row cache ────────────────────────────────────────────────────
it('per pax row cache round trip', function() {
  resetProps_();
  assert.equal(getPaxCacheRow_('tracker', 'sheet1', 'Crazy Ivan'), null);
  setPaxCacheRow_('tracker', 'sheet1', 'Crazy Ivan', ['Crazy Ivan', 'Crucible', 1, 0, '']);
  var cached = getPaxCacheRow_('tracker', 'sheet1', 'crazy ivan'); // name lookup is case/space-insensitive
  assert.deepEqual(cached, ['Crazy Ivan', 'Crucible', 1, 0, '']);
  deletePaxCacheRow_('tracker', 'sheet1', 'Crazy Ivan');
  assert.equal(getPaxCacheRow_('tracker', 'sheet1', 'Crazy Ivan'), null);
});

it('per pax row cache round trips dates', function() {
  resetProps_();
  var ts = new Date(2026, 5, 1, 12, 30);
  setPaxCacheRow_('responses', 'sheet1', 'Little John', [ts, 'Little John', 'lj@example.com']);
  var cached = getPaxCacheRow_('responses', 'sheet1', 'Little John');
  assert.ok(cached[0] instanceof Date);
  assert.equal(cached[0].getTime(), ts.getTime());
});

it('per pax cache isolated by kind and sheet', function() {
  resetProps_();
  setPaxCacheRow_('tracker', 'sheetA', 'Same Name', ['tracker-A']);
  setPaxCacheRow_('responses', 'sheetA', 'Same Name', ['responses-A']);
  setPaxCacheRow_('tracker', 'sheetB', 'Same Name', ['tracker-B']);
  assert.deepEqual(getPaxCacheRow_('tracker', 'sheetA', 'Same Name'), ['tracker-A']);
  assert.deepEqual(getPaxCacheRow_('responses', 'sheetA', 'Same Name'), ['responses-A']);
  assert.deepEqual(getPaxCacheRow_('tracker', 'sheetB', 'Same Name'), ['tracker-B']);
});

it('set pax cache rows bulk writes rows and roster index in one call', function() {
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
});

it('set pax cache rows bulk does not disturb unrelated properties', function() {
  resetProps_();
  setPaxCacheRow_('tracker', 'sheetOther', 'Someone Else', ['untouched']);
  setPaxCacheRowsBulk_('tracker', 'sheet1', { 'Crazy Ivan': ['v1'] }, { 'crazy ivan': 0 });
  assert.deepEqual(getPaxCacheRow_('tracker', 'sheetOther', 'Someone Else'), ['untouched']);
});

// F3Go30-n0wr: setPaxCacheRowsBulk_'s catch used to be empty, so a total setProperties() failure
// (the confirmed live SIT defect) was invisible — this is the regression guard for that empty
// catch, not just for this one function's behavior.
it('set pax cache rows bulk logs a swallowed setProperties failure instead of staying silent', function() {
  resetProps_();
  fakeLogger_._logs.length = 0;
  fakeProps._failSetProperties = true;

  assert.doesNotThrow(function() {
    setPaxCacheRowsBulk_('tracker', 'sheet1', { 'Crazy Ivan': ['v1'] }, { 'crazy ivan': 0 });
  });

  var failLog = fakeLogger_._logs.find(function(call) { return call[0] === 'setPaxCacheRowsBulk_.failed'; });
  assert.ok(failLog, 'expected setPaxCacheRowsBulk_.failed to be logged');
  assert.equal(failLog[1].errorName, 'Error');
  assert.equal(failLog[1].error, 'PropertiesService unavailable');
  assert.equal(failLog[1].sheetId, 'sheet1');
});

it('every other PaxCache best-effort write also logs a swallowed setProperties/setProperty failure', function() {
  resetProps_();
  fakeLogger_._logs.length = 0;
  fakeProps.setProperty = function() { throw new Error('quota exceeded'); };

  assert.doesNotThrow(function() { setPaxCacheRow_('tracker', 'sheet1', 'Crazy Ivan', ['v1']); });
  assert.doesNotThrow(function() { setPaxRosterIndex_('tracker', 'sheet1', { 'crazy ivan': 0 }); });

  var names = fakeLogger_._logs.map(function(call) { return call[0]; });
  assert.ok(names.indexOf('setPaxCacheRow_.failed') !== -1);
  assert.ok(names.indexOf('setPaxRosterIndex_.failed') !== -1);
});

// ── roster index ─────────────────────────────────────────────────────────
it('resolve pax row index rebuilds on miss', function() {
  resetProps_();
  var reads = 0;
  var readNameColumn = function() { reads++; return ['Little John', 'Crazy Ivan', '', 'Splinter']; };

  assert.equal(resolvePaxRowIndex_('tracker', 'sheet1', 'Crazy Ivan', readNameColumn), 1);
  assert.equal(reads, 1);

  // Second lookup (different name, same sheet) hits the now-cached index — no second scan.
  assert.equal(resolvePaxRowIndex_('tracker', 'sheet1', 'Splinter', readNameColumn), 3);
  assert.equal(reads, 1);
});

it('resolve pax row index never caches a miss', function() {
  resetProps_();
  var reads = 0;
  var readNameColumn = function() { reads++; return ['Little John']; };

  assert.equal(resolvePaxRowIndex_('tracker', 'sheet1', 'Nobody', readNameColumn), -1);
  assert.equal(reads, 1);
  // A second lookup for the same never-found name re-scans rather than trusting a cached miss —
  // a brand-new signup that lands between these two calls must be found immediately.
  assert.equal(resolvePaxRowIndex_('tracker', 'sheet1', 'Nobody', readNameColumn), -1);
  assert.equal(reads, 2);
});

it('patch pax roster index noop when nothing cached', function() {
  resetProps_();
  patchPaxRosterIndex_('responses', 'sheet1', 'New Guy', 5);
  assert.equal(getPaxRosterIndex_('responses', 'sheet1'), null);
});

it('patch pax roster index updates existing index', function() {
  resetProps_();
  setPaxRosterIndex_('responses', 'sheet1', { 'little john': 0 });
  patchPaxRosterIndex_('responses', 'sheet1', 'New Guy', 1);
  assert.deepEqual(getPaxRosterIndex_('responses', 'sheet1'), { 'little john': 0, 'new guy': 1 });
});

// F3Go30-45qt: getPaxRosterIndex_ now reads through the per-execution whole-store snapshot
// (getScriptPropertiesSnapshot_pc_) instead of its own discrete getProperty() RPC.
describe('getPaxRosterIndex_ reads through the per-execution snapshot (F3Go30-45qt)', function() {

// AC2: a write followed by a read of the SAME key, in the same execution, must observe the
// write — proving the write facade's memo invalidation still covers this read path now that it
// goes through the snapshot instead of a direct getProperty().
it('read-after-write in the same execution returns the new value', function() {
  resetProps_();
  setPaxRosterIndex_('tracker', 'sheet-raw', { 'old guy': 0 });
  assert.deepEqual(getPaxRosterIndex_('tracker', 'sheet-raw'), { 'old guy': 0 });

  setPaxRosterIndex_('tracker', 'sheet-raw', { 'old guy': 0, 'new guy': 1 });
  assert.deepEqual(getPaxRosterIndex_('tracker', 'sheet-raw'), { 'old guy': 0, 'new guy': 1 },
    'a write must be observed by an immediately-following read in the same execution');
});

// AC3: no cached roster index at all is a plain miss — null, never a throw, never {}.
it('miss (no cached roster index) returns null, not a throw or an empty object', function() {
  resetProps_();
  assert.equal(getPaxRosterIndex_('tracker', 'sheet-never-cached'), null);
});

// AC4: behaviour on a PropertiesService failure is unchanged in the ways that matter to callers
// (degrades to null, never throws) — but see the two distinct failure shapes below.
it('a corrupted stored roster value degrades to null and logs via paxCacheLogSwallowedError_', function() {
  resetProps_();
  // Bypass the write facade to seed genuinely-malformed JSON under the roster key — this is the
  // "stored value can't be parsed" failure shape, the one that still reaches getPaxRosterIndex_'s
  // own try/catch after the conversion (JSON.parse throws on the snapshot's string, same as it
  // would have on a direct getProperty() result before this bead).
  fakeProps.setProperty('go30idx:tracker:sheet-corrupt', '{not valid json');
  invalidateScriptPropertiesSnapshot_(); // the direct fakeProps write above bypasses the facade
  var result = getPaxRosterIndex_('tracker', 'sheet-corrupt');
  assert.equal(result, null, 'a corrupt entry must degrade to null, not throw');
  var failLog = fakeLogger_._logs.find(function(args) { return args[0] === 'getPaxRosterIndex_.failed'; });
  assert.ok(failLog, 'the corrupt-entry failure must still be logged via paxCacheLogSwallowedError_');
  assert.equal(failLog[1].kind, 'tracker');
  assert.equal(failLog[1].sheetId, 'sheet-corrupt');
});

// AC4 (documented limitation, not a regression on any existing AC): a whole-store
// PropertiesService.getProperties() failure is absorbed by getScriptPropertiesSnapshot_pc_()
// itself, which degrades to an empty store WITHOUT throwing and WITHOUT logging (see
// ScriptProperties.js header + this exact behaviour already relied on by getPaxCacheRowsBulk_/
// getPaxHistoryEntriesBulk_, test_script_properties_memo.js's failure-handling suite). So after
// this conversion, that specific failure mode reads as a silent miss here too — consistent with
// every other snapshot consumer in this file, but a change from the pre-fix discrete-getProperty
// behaviour, which did log it. Recorded here rather than silently assumed away.
it('a whole-store getProperties() failure degrades to null WITHOUT throwing (no log — matches sibling snapshot readers)', function() {
  resetProps_();
  setPaxRosterIndex_('tracker', 'sheet-outage', { 'someone': 0 });
  fakeProps._failGetProperties = true;
  invalidateScriptPropertiesSnapshot_();
  var result = getPaxRosterIndex_('tracker', 'sheet-outage');
  fakeProps._failGetProperties = false;
  assert.equal(result, null, 'a whole-store fetch failure must still degrade to null, never throw');
});
});

// ── bulk wipe ────────────────────────────────────────────────────────────
it('wipe pax cache for sheet clears rows and index only for that sheet', function() {
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
});

it('pax cache normalize name', function() {
  assert.equal(paxCacheNormalizeName_('  Crazy Ivan  '), 'crazy ivan');
  assert.equal(paxCacheNormalizeName_(''), '');
  assert.equal(paxCacheNormalizeName_(null), '');
});

// ── request stats (F3Go30-440b.1) ────────────────────────────────────────
it('request stats track row hit and miss', function() {
  resetProps_();
  getPaxCacheRow_('tracker', 'sheet1', 'Nobody'); // miss
  setPaxCacheRow_('tracker', 'sheet1', 'Crazy Ivan', ['v1']);
  getPaxCacheRow_('tracker', 'sheet1', 'Crazy Ivan'); // hit
  var stats = getPaxCacheRequestStats_();
  assert.equal(stats.paxRowMiss, 1);
  assert.equal(stats.paxRowHit, 1);
});

it('request stats track roster hit and miss', function() {
  resetProps_();
  var readNameColumn = function() { return ['Crazy Ivan']; };
  resolvePaxRowIndex_('tracker', 'sheet1', 'Crazy Ivan', readNameColumn); // no cached index yet — miss (rebuild)
  resolvePaxRowIndex_('tracker', 'sheet1', 'Crazy Ivan', readNameColumn); // now cached — hit
  var stats = getPaxCacheRequestStats_();
  assert.equal(stats.paxRosterMiss, 1);
  assert.equal(stats.paxRosterHit, 1);
});

// paxCacheWiped has no remaining writer since the Drive-modtime freshness gate was retired
// (F3Go30-o39s.7) — wipes now happen via wipePaxCacheForSheet_/wipePaxCacheAndRelatedCachesForSheet_
// (TrackerEditTrigger.js's onEdit path), which don't set this per-request flag.
it('request stats wipe flag stays false', function() {
  resetProps_();
  resetPaxCacheRequestStats_();
  getPaxCacheRow_('tracker', 'sheet1', 'Nobody');
  assert.equal(getPaxCacheRequestStats_().paxCacheWiped, false);
});

it('request stats reset clears all counters', function() {
  resetProps_();
  getPaxCacheRow_('tracker', 'sheet1', 'Nobody');
  resolvePaxRowIndex_('tracker', 'sheet1', 'Nobody', function() { return []; });
  resetPaxCacheRequestStats_();
  assert.deepEqual(getPaxCacheRequestStats_(), {
    paxCacheWiped: false, paxRosterHit: 0, paxRosterMiss: 0, paxRowHit: 0, paxRowMiss: 0,
    paxLockFailed: 0, paxLockWaitMs: 0,
  });
});

// F3Go30-dyj9: lockFailed count + lock wait duration, folded into the same stats snapshot the
// cache hit/miss counters use, so a check-in's own telemetry event can answer whether the single
// global script lock is actually contended at current scale.
it('request stats track lock wait duration on success', function() {
  resetProps_();
  global.SpreadsheetApp = { flush: function() {} };
  var fakeRange_ = { getValues: function() { return [['Crazy Ivan']]; } };
  var fakeSheet_ = { getLastColumn: function() { return 1; }, getRange: function() { return fakeRange_; } };
  refreshPaxCacheRowFromSheet_('tracker', 'sheet1', 'Crazy Ivan', fakeSheet_, 4);
  var stats = getPaxCacheRequestStats_();
  assert.equal(stats.paxLockFailed, 0);
  assert.equal(typeof stats.paxLockWaitMs, 'number');
  assert.ok(stats.paxLockWaitMs >= 0);
  delete global.SpreadsheetApp;
});

it('refresh pax cache row from sheet lock failure counts as a failure with wait duration recorded', function() {
  resetProps_();
  var realLock = global.LockService;
  global.LockService = { getScriptLock: function() { return { waitLock: function() { throw new Error('busy'); }, releaseLock: function() {} }; } };
  refreshPaxCacheRowFromSheet_('tracker', 'sheet1', 'Crazy Ivan', { getLastColumn: function() { throw new Error('must not be reached'); } }, 4);
  var stats = getPaxCacheRequestStats_();
  assert.equal(stats.paxLockFailed, 1);
  assert.equal(typeof stats.paxLockWaitMs, 'number');
  assert.ok(stats.paxLockWaitMs >= 0);
  assert.equal(getPaxCacheRow_('tracker', 'sheet1', 'Crazy Ivan'), null, 'entry must still be dropped, unchanged from before this bead');
  global.LockService = realLock;
});

// ── check-in write path: combined single-lock refresh + history advance (F3Go30-y0pw D4) ──
describe('refreshPaxCacheRowAndAdvanceHistoryForCheckin_', function() {

function makeFakeCheckinSheet_(rowValues) {
  var fakeRange_ = { getValues: function() { return [rowValues.slice()]; } };
  return { getLastColumn: function() { return rowValues.length; }, getRange: function() { return fakeRange_; } };
}

it('AC3: refreshes the row and advances history under exactly ONE lock acquisition', function() {
  resetProps_();
  global.SpreadsheetApp = { flush: function() {} };
  var realLock = global.LockService;
  var waits = 0, releases = 0;
  global.LockService = { getScriptLock: function() { return { waitLock: function() { waits++; }, releaseLock: function() { releases++; } }; } };

  var sheet = makeFakeCheckinSheet_(['Crazy Ivan', 'Crucible', 1]);
  refreshPaxCacheRowAndAdvanceHistoryForCheckin_('tracker', 'sheet1', 'Crazy Ivan', sheet, 4, 'scope-a', new Date(2026, 7, 1), 1, '2026-08-01');

  assert.equal(waits, 1, 'exactly one waitLock() call, not one per operation');
  assert.equal(releases, 1);
  assert.deepEqual(getPaxCacheRow_('tracker', 'sheet1', 'Crazy Ivan'), ['Crazy Ivan', 'Crucible', 1]);
  assert.deepEqual(getPaxHistoryEntry_('scope-a', 'Crazy Ivan'), { historyEndDate: '2026-08-01', days: '1' });

  global.LockService = realLock;
  delete global.SpreadsheetApp;
});

it('AC4: a lock failure deletes the cached row AND skips the history advance — both fallbacks fire off one failed attempt', function() {
  resetProps_();
  setPaxCacheRow_('tracker', 'sheet1', 'Crazy Ivan', ['stale']);
  var realLock = global.LockService;
  var waits = 0;
  global.LockService = { getScriptLock: function() { return { waitLock: function() { waits++; throw new Error('busy'); }, releaseLock: function() {} }; } };

  refreshPaxCacheRowAndAdvanceHistoryForCheckin_(
    'tracker', 'sheet1', 'Crazy Ivan', { getLastColumn: function() { throw new Error('must not be reached'); } }, 4,
    'scope-a', new Date(2026, 7, 1), 1, '2026-08-01'
  );

  assert.equal(waits, 1, 'exactly one failed acquisition attempt, not two');
  assert.equal(getPaxCacheRow_('tracker', 'sheet1', 'Crazy Ivan'), null, 'the row-refresh fallback must still fire');
  assert.equal(getPaxHistoryEntry_('scope-a', 'Crazy Ivan'), null, 'the history-advance fallback must still fire');

  global.LockService = realLock;
});

it('AC5: a post-write row whose name no longer matches is deleted-and-logged, never cached', function() {
  resetProps_();
  global.SpreadsheetApp = { flush: function() {} };
  setPaxCacheRow_('tracker', 'sheet1', 'Crazy Ivan', ['stale-but-trusted']);
  var sheet = makeFakeCheckinSheet_(['SomeoneElse', 'Crucible', 1]);

  refreshPaxCacheRowAndAdvanceHistoryForCheckin_('tracker', 'sheet1', 'Crazy Ivan', sheet, 4, 'scope-a', new Date(2026, 7, 1), 1, '2026-08-01');

  assert.equal(getPaxCacheRow_('tracker', 'sheet1', 'Crazy Ivan'), null, 'a name mismatch must delete rather than cache the wrong row');
  var mismatchLog = fakeLogger_._logs.find(function(args) { return args[0] === 'refreshPaxCacheRowFromSheet_.rowNameMismatch'; });
  assert.ok(mismatchLog, 'the mismatch must be logged');
  assert.equal(mismatchLog[1].expected, 'Crazy Ivan');
  assert.equal(mismatchLog[1].actual, 'SomeoneElse');

  delete global.SpreadsheetApp;
});

it('AC6/AC7: the cached row is derived from the POST-write sheet state, never the pre-write snapshot', function() {
  resetProps_();
  global.SpreadsheetApp = { flush: function() {} };
  // A row whose Raw Score/Score-like trailing columns only exist post-write (formula recalc) —
  // there is no pre-write snapshot passed into this function at all, so there is no path by
  // which a stale value could leak in (F3Go30-y0pw D2's rejected alternative).
  var sheet = makeFakeCheckinSheet_(['Crazy Ivan', 'Crucible', 1, 0, 'post-write-score']);
  refreshPaxCacheRowAndAdvanceHistoryForCheckin_('tracker', 'sheet1', 'Crazy Ivan', sheet, 4, 'scope-a', new Date(2026, 7, 1), 1, '2026-08-01');
  assert.deepEqual(getPaxCacheRow_('tracker', 'sheet1', 'Crazy Ivan'), ['Crazy Ivan', 'Crucible', 1, 0, 'post-write-score']);
  delete global.SpreadsheetApp;
});

it('AC8: the future-day clamp is evaluated even when the lock is never acquired — it does not depend on the lock', function() {
  resetProps_();
  var realLock = global.LockService;
  global.LockService = { getScriptLock: function() { return { waitLock: function() { throw new Error('busy'); }, releaseLock: function() {} }; } };

  refreshPaxCacheRowAndAdvanceHistoryForCheckin_(
    'tracker', 'sheet1', 'Crazy Ivan', { getLastColumn: function() { throw new Error('must not be reached'); } }, 4,
    'scope-a', new Date(2026, 7, 6), 1, '2026-08-02' // 4 days in the future relative to todayIso
  );
  var futureLog = fakeLogger_._logs.find(function(args) { return args[0] === 'advancePaxHistoryDay_.futureDaySkipped'; });
  assert.ok(futureLog, 'the future-day clamp must be computed/logged independently of lock acquisition succeeding');

  global.LockService = realLock;
});

it('history advance is skipped for a future day even when the row refresh itself succeeds', function() {
  resetProps_();
  global.SpreadsheetApp = { flush: function() {} };
  var sheet = makeFakeCheckinSheet_(['Crazy Ivan', 'Crucible', 1]);
  refreshPaxCacheRowAndAdvanceHistoryForCheckin_('tracker', 'sheet1', 'Crazy Ivan', sheet, 4, 'scope-a', new Date(2026, 7, 6), 1, '2026-08-02');
  assert.deepEqual(getPaxCacheRow_('tracker', 'sheet1', 'Crazy Ivan'), ['Crazy Ivan', 'Crucible', 1], 'the row refresh must still happen');
  assert.equal(getPaxHistoryEntry_('scope-a', 'Crazy Ivan'), null, 'the history advance must be skipped for a pre-marked future day');
  delete global.SpreadsheetApp;
});
});

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
// boundId defaults to a fixed value — DR-01's go30hist scopeId is the bound spreadsheet's OWN id
// (collectKnownTrackerSheetIds_, purgeStalePaxCache_'s fourth pass), so tests writing
// setPaxHistoryEntry_(scopeId, ...) against a purge fixture must use the same value.
var TEST_BOUND_SCOPE_ID_ = 'bound-scope';
function makeFakeTrackerDbSpreadsheet_(rows, sessionF3Names, namespaces, boundId) {
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
    getId: function() { return boundId || TEST_BOUND_SCOPE_ID_; },
    getSheetByName: function(name) {
      if (name === 'TrackerDB') return trackerDbSheet;
      if (name === 'CheckinSessions') return checkinSessionsSheet;
      if (name === 'NamespaceDB') return namespaceDbSheet;
      return null;
    },
  };
}

it('purge wipes only sheets older than retention', function() {
  resetProps_();
  var now = new Date(2026, 6, 16); // Jul 16 2026
  var oldStart = new Date(now.getTime() - (PAX_CACHE_PURGE_RETENTION_DAYS_ + 5) * 24 * 60 * 60 * 1000);
  var recentStart = new Date(now.getTime() - (PAX_CACHE_PURGE_RETENTION_DAYS_ - 5) * 24 * 60 * 60 * 1000);

  setPaxCacheRow_('tracker', 'sheet-old', 'Crazy Ivan', ['old']);
  setPaxCacheRow_('responses', 'sheet-old', 'Crazy Ivan', ['old-r']);
  setPaxRosterIndex_('tracker', 'sheet-old', { 'crazy ivan': 0 });

  setPaxCacheRow_('tracker', 'sheet-recent', 'Little John', ['recent']);

  var spreadsheet = makeFakeTrackerDbSpreadsheet_([
    { sheetId: 'sheet-old', startDate: oldStart },
    { sheetId: 'sheet-recent', startDate: recentStart },
  ]);

  var result = purgeStalePaxCache_(now, spreadsheet);
  assert.deepEqual(result, { checked: 2, purged: 1, kept: 1, paxRowsPurged: 0, orphanedSheetsPurged: 0, historyEntriesPurged: 0 });

  assert.equal(fakeProps.getKeys().some(function(k) { return k.indexOf('go30pax:tracker:sheet-old:') === 0; }), false);
  assert.equal(fakeProps.getKeys().some(function(k) { return k.indexOf('go30pax:responses:sheet-old:') === 0; }), false);
  assert.equal(fakeProps.getProperty('go30idx:tracker:sheet-old'), null);

  // Current-month entries untouched.
  assert.deepEqual(getPaxCacheRow_('tracker', 'sheet-recent', 'Little John'), ['recent']);
});

it('purge keeps row with unparseable start date', function() {
  resetProps_();
  setPaxCacheRow_('tracker', 'sheet-bad', 'PAX', ['v']);
  var spreadsheet = makeFakeTrackerDbSpreadsheet_([{ sheetId: 'sheet-bad', startDate: 'not-a-date' }]);
  var result = purgeStalePaxCache_(new Date(2026, 6, 16), spreadsheet);
  assert.deepEqual(result, { checked: 1, purged: 0, kept: 1, paxRowsPurged: 0, orphanedSheetsPurged: 0, historyEntriesPurged: 0 });
  assert.deepEqual(getPaxCacheRow_('tracker', 'sheet-bad', 'PAX'), ['v']);
});

it('purge removes pax rows not in checkin sessions', function() {
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
  assert.deepEqual(result, { checked: 1, purged: 0, kept: 1, paxRowsPurged: 2, orphanedSheetsPurged: 0, historyEntriesPurged: 0 });

  assert.deepEqual(getPaxCacheRow_('tracker', 'sheet-recent', 'Crazy Ivan'), ['active']);
  assert.equal(getPaxCacheRow_('tracker', 'sheet-recent', 'Ghost Pax'), null);
  assert.equal(getPaxCacheRow_('responses', 'sheet-recent', 'Ghost Pax'), null);
});

// A missing/empty CheckinSessions sheet means "nobody currently active," per
// listActiveCheckinSessionF3Names_'s own contract (F3Go30 — read-only, never provisions the
// sheet) — so every cached PAX row on a kept sheet is purged, same as any genuinely inactive PAX.
it('purge purges every pax row when no one has a checkin session', function() {
  resetProps_();
  var now = new Date(2026, 6, 16);
  var recentStart = new Date(now.getTime() - (PAX_CACHE_PURGE_RETENTION_DAYS_ - 5) * 24 * 60 * 60 * 1000);

  setPaxCacheRow_('tracker', 'sheet-recent', 'Crazy Ivan', ['active']);
  setPaxRosterIndex_('tracker', 'sheet-recent', { 'crazy ivan': 0 });

  var spreadsheet = makeFakeTrackerDbSpreadsheet_([{ sheetId: 'sheet-recent', startDate: recentStart }]);

  var result = purgeStalePaxCache_(now, spreadsheet);
  assert.deepEqual(result, { checked: 1, purged: 0, kept: 1, paxRowsPurged: 1, orphanedSheetsPurged: 0, historyEntriesPurged: 0 });
  assert.equal(getPaxCacheRow_('tracker', 'sheet-recent', 'Crazy Ivan'), null);
});

it('purge no op when tracker db missing', function() {
  resetProps_();
  var spreadsheet = { getSheetByName: function() { return null; } };
  var result = purgeStalePaxCache_(new Date(2026, 6, 16), spreadsheet);
  assert.deepEqual(result, { checked: 0, purged: 0, kept: 0, paxRowsPurged: 0, orphanedSheetsPurged: 0, historyEntriesPurged: 0 });
});

// ── orphan sweep (F3Go30-440b.2 follow-up) ───────────────────────────────
it('extract sheet id from pax cache key parses both prefixes', function() {
  assert.equal(extractSheetIdFromPaxCacheKey_('go30pax:tracker:sheet1:crazy ivan'), 'sheet1');
  assert.equal(extractSheetIdFromPaxCacheKey_('go30idx:responses:sheet2'), 'sheet2');
  // go30hist: (DR-01) places its discriminator one segment earlier than go30pax:/go30idx: —
  // scopeId:name, not kind:sheetId:name.
  assert.equal(extractSheetIdFromPaxCacheKey_('go30hist:tmpl-scope-1:crazy ivan'), 'tmpl-scope-1');
  assert.equal(extractSheetIdFromPaxCacheKey_('WEBAPP_URL'), null);
});

it('collect known tracker sheet ids unions bound and every namespace', function() {
  var spreadsheet = makeFakeTrackerDbSpreadsheet_(
    [{ sheetId: 'bound-tracker', startDate: new Date(2026, 6, 1) }],
    null,
    [{ namespace: 'sit-smoke', templateId: 'ns-tmpl-1', rows: [{ sheetId: 'ns-tracker-1', startDate: new Date(2026, 6, 1) }] }]
  );
  var known = collectKnownTrackerSheetIds_(spreadsheet);
  assert.deepEqual(known, { 'bound-scope': true, 'bound-tracker': true, 'ns-tmpl-1': true, 'ns-tracker-1': true });
  delete global.SpreadsheetApp;
});

it('collect known tracker sheet ids skips unreachable namespace and logs', function() {
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
  assert.deepEqual(known, { 'bound-scope': true, 'bound-tracker': true, 'ns-tmpl-gone': true });
  assert.ok(logged.some(function(l) { return l.name === 'purgeStalePaxCache_.namespaceUnreachable'; }));

  global.GasLogger.log = realLog;
  delete global.SpreadsheetApp;
});

it('purge orphan sweep wipes entries for deleted tracker', function() {
  resetProps_();
  var now = new Date(2026, 6, 16);
  var recentStart = new Date(now.getTime() - (PAX_CACHE_PURGE_RETENTION_DAYS_ - 5) * 24 * 60 * 60 * 1000);

  // "sheet-deleted" has cache entries but no TrackerDB row at all (as if cleanupTracker already
  // removed it) — the age/CheckinSessions passes above never see it since they only walk
  // TrackerDB rows; only the orphan sweep can catch this.
  setPaxCacheRow_('tracker', 'sheet-deleted', 'Old Pax', ['gone']);
  setPaxRosterIndex_('tracker', 'sheet-deleted', { 'old pax': 0 });

  setPaxCacheRow_('tracker', 'sheet-recent', 'Crazy Ivan', ['active']);
  setPaxRosterIndex_('tracker', 'sheet-recent', { 'crazy ivan': 0 });

  var spreadsheet = makeFakeTrackerDbSpreadsheet_(
    [{ sheetId: 'sheet-recent', startDate: recentStart }],
    ['Crazy Ivan']
  );

  var result = purgeStalePaxCache_(now, spreadsheet);
  assert.deepEqual(result, { checked: 1, purged: 0, kept: 1, paxRowsPurged: 0, orphanedSheetsPurged: 1, historyEntriesPurged: 0 });

  assert.equal(fakeProps.getKeys().some(function(k) { return k.indexOf('go30pax:tracker:sheet-deleted:') === 0; }), false);
  assert.equal(fakeProps.getProperty('go30idx:tracker:sheet-deleted'), null);
  // The still-registered, still-active tracker is untouched.
  assert.deepEqual(getPaxCacheRow_('tracker', 'sheet-recent', 'Crazy Ivan'), ['active']);
});

it('purge orphan sweep does not wipe live namespace tracker cache', function() {
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
});

it('purge orphan sweep skipped when known sheet ids empty', function() {
  resetProps_();
  setPaxCacheRow_('tracker', 'sheet-anything', 'Someone', ['v']);

  // TrackerDB (and NamespaceDB) both missing entirely — collectKnownTrackerSheetIds_ comes back
  // empty. A read failure must never be mistaken for "nothing is live" and wipe everything.
  var spreadsheet = { getSheetByName: function() { return null; } };
  var result = purgeStalePaxCache_(new Date(2026, 6, 16), spreadsheet);
  assert.equal(result.orphanedSheetsPurged, 0);
  assert.deepEqual(getPaxCacheRow_('tracker', 'sheet-anything', 'Someone'), ['v']);
});

// ── f3Name-keyed rolling history window (F3Go30-5uk2) ──────────────────────

it('history encode decode round trip', function() {
  assert.equal(paxHistoryEncodeValue_(1), '1');
  assert.equal(paxHistoryEncodeValue_(0), '0');
  assert.equal(paxHistoryEncodeValue_(-1), 'X');
  assert.equal(paxHistoryEncodeValue_(null), '.');
  assert.equal(paxHistoryEncodeValue_(''), '.');
  assert.deepEqual(paxHistoryDaysToValues_('10X.'), [1, 0, -1, '']);
  assert.equal(paxHistoryDecodeChar_('1'), 1);
  assert.equal(paxHistoryDecodeChar_('Q'), ''); // unknown char degrades to blank, never throws
});

it('history day diff', function() {
  assert.equal(paxHistoryDayDiff_('2026-07-31', '2026-08-01'), 1);
  assert.equal(paxHistoryDayDiff_('2026-08-01', '2026-07-31'), -1);
  assert.equal(paxHistoryDayDiff_('2026-08-01', '2026-08-01'), 0);
});

it('advance entry cold start', function() {
  var next = advancePaxHistoryEntry_(null, '2026-08-01', 1);
  assert.deepEqual(next, { historyEndDate: '2026-08-01', days: '1' });
});

it('advance entry same day rewrite', function() {
  var entry = { historyEndDate: '2026-08-01', days: '110' };
  // A PAX correcting today's own value before month-boundary logic ever advances the day.
  var next = advancePaxHistoryEntry_(entry, '2026-08-01', 1);
  assert.deepEqual(next, { historyEndDate: '2026-08-01', days: '111' });
});

it('advance entry next day appends and shifts', function() {
  var entry = { historyEndDate: '2026-08-01', days: '110' };
  var next = advancePaxHistoryEntry_(entry, '2026-08-02', 0);
  assert.deepEqual(next, { historyEndDate: '2026-08-02', days: '1100' });
});

it('advance entry window caps at max length', function() {
  var days = '';
  for (var i = 0; i < PAX_HISTORY_WINDOW_DAYS_; i++) days += '1';
  var entry = { historyEndDate: '2026-08-01', days: days };
  var next = advancePaxHistoryEntry_(entry, '2026-08-02', 0);
  assert.equal(next.days.length, PAX_HISTORY_WINDOW_DAYS_);
  assert.equal(next.days.slice(-1), '0'); // newest day retained
  assert.equal(next.historyEndDate, '2026-08-02');
});

it('advance entry gap is padded with blanks', function() {
  // Nightly job missed a few runs — the gap between historyEndDate and the new day must be
  // represented as unknown ('.'), not silently skipped (which would misalign every earlier day).
  var entry = { historyEndDate: '2026-08-01', days: '1' };
  var next = advancePaxHistoryEntry_(entry, '2026-08-04', -1);
  assert.deepEqual(next, { historyEndDate: '2026-08-04', days: '1..X' });
});

it('advance entry past day edit within window patches in place', function() {
  // "Yesterday" edited after today's own write already advanced the window past it.
  var entry = { historyEndDate: '2026-08-02', days: '101' };
  var next = advancePaxHistoryEntry_(entry, '2026-08-01', 1);
  assert.deepEqual(next, { historyEndDate: '2026-08-02', days: '111' });
});

it('advance entry past day older than window is ignored', function() {
  var entry = { historyEndDate: '2026-08-02', days: '01' };
  var next = advancePaxHistoryEntry_(entry, '2026-07-01', 1);
  assert.deepEqual(next, entry); // outside the represented window — not silently corrupted
});

// Namespace scope id used by the tests below that don't exercise purge (any two distinct
// namespaces' windows must never collide — DR-01) — purge-specific tests use
// TEST_BOUND_SCOPE_ID_ instead, since the fourth pass now scopes by the bound spreadsheet's id.
var SCOPE_A_ = 'scope-a';
var SCOPE_B_ = 'scope-b';

it('history entry round trip get set', function() {
  resetProps_();
  assert.equal(getPaxHistoryEntry_(SCOPE_A_, 'Crazy Ivan'), null);
  setPaxHistoryEntry_(SCOPE_A_, 'Crazy Ivan', { historyEndDate: '2026-08-01', days: '1' });
  assert.deepEqual(getPaxHistoryEntry_(SCOPE_A_, 'crazy ivan'), { historyEndDate: '2026-08-01', days: '1' }); // case/space-insensitive
});

// Two namespaces sharing the same PropertiesService store (ADR-014) must never collide on the
// same PAX name — the defect DR-01 fixes.
it('history entry is scoped by namespace not just name', function() {
  resetProps_();
  setPaxHistoryEntry_(SCOPE_A_, 'Crazy Ivan', { historyEndDate: '2026-08-01', days: '1' });
  assert.equal(getPaxHistoryEntry_(SCOPE_B_, 'Crazy Ivan'), null);
  setPaxHistoryEntry_(SCOPE_B_, 'Crazy Ivan', { historyEndDate: '2026-08-01', days: '0' });
  assert.deepEqual(getPaxHistoryEntry_(SCOPE_A_, 'Crazy Ivan'), { historyEndDate: '2026-08-01', days: '1' });
  assert.deepEqual(getPaxHistoryEntry_(SCOPE_B_, 'Crazy Ivan'), { historyEndDate: '2026-08-01', days: '0' });
});

it('advance pax history day write through is lock guarded', function() {
  resetProps_();
  advancePaxHistoryDay_(SCOPE_A_, 'Crazy Ivan', new Date(2026, 7, 1), 1);
  advancePaxHistoryDay_(SCOPE_A_, 'Crazy Ivan', new Date(2026, 7, 2), 0);
  assert.deepEqual(getPaxHistoryEntry_(SCOPE_A_, 'Crazy Ivan'), { historyEndDate: '2026-08-02', days: '10' });
});

it('advance pax history day lock failure is best effort', function() {
  resetProps_();
  var realLock = global.LockService;
  global.LockService = { getScriptLock: function() { return { waitLock: function() { throw new Error('busy'); }, releaseLock: function() {} }; } };
  advancePaxHistoryDay_(SCOPE_A_, 'Crazy Ivan', new Date(2026, 7, 1), 1); // must not throw
  assert.equal(getPaxHistoryEntry_(SCOPE_A_, 'Crazy Ivan'), null);
  // F3Go30-dyj9: the same lock failure must also be visible in the per-execution stats snapshot.
  var stats = getPaxCacheRequestStats_();
  assert.equal(stats.paxLockFailed, 1);
  assert.equal(typeof stats.paxLockWaitMs, 'number');
  assert.ok(stats.paxLockWaitMs >= 0);
  global.LockService = realLock;
});

// wipeAllPaxCache_ (the admin invalidateAllCache action's "force a reload" escape hatch, WebApp.js)
// must clear go30hist: entries too, not just the two original PaxCache prefixes — otherwise a
// wrong/stale streak has no way to self-heal short of waiting out a write-through.
it('wipe all pax cache also clears history entries', function() {
  resetProps_();
  setPaxCacheRow_('tracker', 'sheet-x', 'Someone', ['v']);
  setPaxHistoryEntry_(SCOPE_A_, 'Crazy Ivan', { historyEndDate: '2026-08-01', days: '1' });
  var wiped = wipeAllPaxCache_();
  assert.ok(wiped >= 2);
  assert.equal(getPaxCacheRow_('tracker', 'sheet-x', 'Someone'), null);
  assert.equal(getPaxHistoryEntry_(SCOPE_A_, 'Crazy Ivan'), null);
});

// ── F3Go30-uz9e.2: anchoring the stored window to the caller's context date ────────────────
//
// historyEndDate has been stamped on every write since F3Go30-5uk2 but was never read back, so a
// window was silently assumed to end "now" no matter when it was last written. These cover the
// four branches anchorPaxHistoryValues_ has to get right for the read side to mean anything.

it('anchor history values at exact anchor is unchanged', function() {
  assert.deepEqual(anchorPaxHistoryValues_({ historyEndDate: '2026-08-02', days: '1101' }, '2026-08-02'), [1, 1, 0, 1]);
});

it('anchor history values trims window ending after anchor', function() {
  // Advance check-in: the PAX pre-marked Aug 5 on Aug 2, so the write padded Aug 3-4 with '.'
  // and stamped historyEndDate three days into the future. As of the Aug 2 context date, those
  // three characters do not exist yet — dropping them restores the real Aug 2 window.
  var entry = { historyEndDate: '2026-08-05', days: '1111..1' };
  assert.deepEqual(anchorPaxHistoryValues_(entry, '2026-08-02'), [1, 1, 1, 1]);
});

it('anchor history values pads window ending before anchor', function() {
  // Nothing has been written for this PAX for two days (no check-in, nightly job not yet run).
  // Padding at the TAIL specifically is safe: computeStreak_ trims trailing blanks before
  // counting, so "not reported yet" does not read as a broken streak.
  var entry = { historyEndDate: '2026-08-02', days: '111' };
  assert.deepEqual(anchorPaxHistoryValues_(entry, '2026-08-04'), [1, 1, 1, '', '']);
});

it('anchor history values returns null when window cannot reach anchor', function() {
  // Every stored character would be padded away — nothing real is left to tail-align, so the
  // caller must fall through to the tracker rather than serve an all-blank window.
  assert.equal(anchorPaxHistoryValues_({ historyEndDate: '2026-08-02', days: '111' }, '2026-08-05'), null);
  // Same on the other side: a June view in August. Trimming back past the start of the stored
  // window leaves nothing.
  assert.equal(anchorPaxHistoryValues_({ historyEndDate: '2026-08-02', days: '111' }, '2026-06-30'), null);
  assert.equal(anchorPaxHistoryValues_(null, '2026-08-02'), null);
  assert.equal(anchorPaxHistoryValues_({ historyEndDate: '2026-08-02', days: '' }, '2026-08-02'), null);
});

it('anchor history values never exceeds window length', function() {
  var days = '';
  for (var i = 0; i < PAX_HISTORY_WINDOW_DAYS_; i++) days += '1';
  var anchored = anchorPaxHistoryValues_({ historyEndDate: '2026-08-02', days: days }, '2026-08-04');
  assert.equal(anchored.length, PAX_HISTORY_WINDOW_DAYS_);
  assert.deepEqual(anchored.slice(-2), ['', '']);
});

// One PropertiesService round trip for the whole roster instead of one per row — the dashboard
// calls this once per load against a quota'd service.
it('get pax history entries bulk is one properties read', function() {
  resetProps_();
  setPaxHistoryEntry_(SCOPE_A_, 'Crazy Ivan', { historyEndDate: '2026-08-02', days: '11' });
  setPaxHistoryEntry_(SCOPE_A_, 'Little John', { historyEndDate: '2026-08-02', days: '10' });
  fakeProps._getPropertiesCalls = 0;

  var entries = getPaxHistoryEntriesBulk_(SCOPE_A_, ['Crazy Ivan', 'crazy  ivan', 'Little John', 'Never Seen']);
  assert.equal(fakeProps._getPropertiesCalls, 1);
  assert.deepEqual(entries['crazy ivan'], { historyEndDate: '2026-08-02', days: '11' });
  assert.deepEqual(entries['little john'], { historyEndDate: '2026-08-02', days: '10' });
  assert.equal(Object.prototype.hasOwnProperty.call(entries, 'never seen'), false);
});

// Bulk read must not leak another namespace's entry for the same name (DR-01).
it('get pax history entries bulk is scoped by namespace', function() {
  resetProps_();
  setPaxHistoryEntry_(SCOPE_A_, 'Crazy Ivan', { historyEndDate: '2026-08-02', days: '11' });
  setPaxHistoryEntry_(SCOPE_B_, 'Crazy Ivan', { historyEndDate: '2026-08-02', days: '00' });

  var entries = getPaxHistoryEntriesBulk_(SCOPE_A_, ['Crazy Ivan']);
  assert.deepEqual(entries['crazy ivan'], { historyEndDate: '2026-08-02', days: '11' });
});

// Write-side clamp (F3Go30-uz9e.2, symptom 1 at source): a pre-marked FUTURE day must not
// advance the window. Doing so pads the skipped days with '.' and shifts that many days of real
// history off the front permanently — and the '.' gap then reads as a broken streak. The value
// is already on the Tracker; the read side reconciles it back in when the day actually arrives.
it('advance pax history day ignores future days', function() {
  resetProps_();
  advancePaxHistoryDay_(SCOPE_A_, 'Crazy Ivan', new Date(2026, 7, 2), 1, '2026-08-02');
  advancePaxHistoryDay_(SCOPE_A_, 'Crazy Ivan', new Date(2026, 7, 6), 1, '2026-08-02'); // pre-marked, 4 days out
  assert.deepEqual(getPaxHistoryEntry_(SCOPE_A_, 'Crazy Ivan'), { historyEndDate: '2026-08-02', days: '1' });
});

it('advance pax history day still writes today and past days', function() {
  resetProps_();
  advancePaxHistoryDay_(SCOPE_A_, 'Crazy Ivan', new Date(2026, 7, 1), 1, '2026-08-02');
  advancePaxHistoryDay_(SCOPE_A_, 'Crazy Ivan', new Date(2026, 7, 2), 0, '2026-08-02'); // today itself
  assert.deepEqual(getPaxHistoryEntry_(SCOPE_A_, 'Crazy Ivan'), { historyEndDate: '2026-08-02', days: '10' });
});

// go30hist keys carry no sheetId, so the orphan sweep (which ages entries by tracker) could never
// see them — every name that ever checked in, including typos and retired PAX, kept a Script
// Property forever against the 500KB quota. Reaped off the same CheckinSessions activity signal
// the per-PAX row pass already uses.
it('purge reaps history entries for inactive names', function() {
  resetProps_();
  var now = new Date(2026, 6, 16);
  var recentStart = new Date(now.getTime() - (PAX_CACHE_PURGE_RETENTION_DAYS_ - 5) * 24 * 60 * 60 * 1000);

  // The fourth pass scopes to the bound spreadsheet's own id (TEST_BOUND_SCOPE_ID_, DR-01) — the
  // same id makeFakeTrackerDbSpreadsheet_'s default getId() returns.
  setPaxHistoryEntry_(TEST_BOUND_SCOPE_ID_, 'Crazy Ivan', { historyEndDate: '2026-07-15', days: '11' });
  setPaxHistoryEntry_(TEST_BOUND_SCOPE_ID_, 'Ghost Pax', { historyEndDate: '2026-05-01', days: '11' });

  var spreadsheet = makeFakeTrackerDbSpreadsheet_(
    [{ sheetId: 'sheet-recent', startDate: recentStart }],
    ['Crazy Ivan']
  );

  var result = purgeStalePaxCache_(now, spreadsheet);
  assert.equal(result.historyEntriesPurged, 1);
  assert.deepEqual(getPaxHistoryEntry_(TEST_BOUND_SCOPE_ID_, 'Crazy Ivan'), { historyEndDate: '2026-07-15', days: '11' });
  assert.equal(getPaxHistoryEntry_(TEST_BOUND_SCOPE_ID_, 'Ghost Pax'), null);
});

// Same contract the per-PAX row pass already follows (testPurgePurgesEveryPaxRowWhenNoOneHasA
// CheckinSession): a missing/empty CheckinSessions sheet means "nobody currently active", so every
// history entry is reaped. Safe because a reaped window self-heals from the Tracker on the next
// dashboard read — unlike the row cache, this store is derived data end to end.
it('purge reaps every history entry when no one has a checkin session', function() {
  resetProps_();
  var now = new Date(2026, 6, 16);
  var recentStart = new Date(now.getTime() - (PAX_CACHE_PURGE_RETENTION_DAYS_ - 5) * 24 * 60 * 60 * 1000);
  setPaxHistoryEntry_(TEST_BOUND_SCOPE_ID_, 'Ghost Pax', { historyEndDate: '2026-05-01', days: '11' });

  var spreadsheet = makeFakeTrackerDbSpreadsheet_([{ sheetId: 'sheet-recent', startDate: recentStart }]);
  var result = purgeStalePaxCache_(now, spreadsheet);
  assert.equal(result.historyEntriesPurged, 1);
  assert.equal(getPaxHistoryEntry_(TEST_BOUND_SCOPE_ID_, 'Ghost Pax'), null);
});

// DR-01 regression: a namespace's history entries must not be reaped by the BOUND spreadsheet's
// activity signal — only the fourth pass's own scope, or the orphan sweep once that scope is
// actually torn down (see testPurgeOrphanSweepAlsoReapsHistoryForDeletedScope below).
it('purge fourth pass does not touch another scopes history entries', function() {
  resetProps_();
  var now = new Date(2026, 6, 16);
  var recentStart = new Date(now.getTime() - (PAX_CACHE_PURGE_RETENTION_DAYS_ - 5) * 24 * 60 * 60 * 1000);
  setPaxHistoryEntry_('other-namespace-scope', 'Ghost Pax', { historyEndDate: '2026-05-01', days: '11' });

  // "other-namespace-scope" must be a KNOWN, still-live namespace here (registered in
  // NamespaceDB) — this test isolates the fourth pass's own scoping from the orphan sweep, which
  // has its own coverage below (testPurgeOrphanSweepAlsoReapsHistoryForDeletedScope).
  var spreadsheet = makeFakeTrackerDbSpreadsheet_(
    [{ sheetId: 'sheet-recent', startDate: recentStart }],
    null,
    [{ namespace: 'other-ns', templateId: 'other-namespace-scope', rows: [] }]
  );
  var result = purgeStalePaxCache_(now, spreadsheet);
  assert.equal(result.historyEntriesPurged, 0);
  assert.deepEqual(getPaxHistoryEntry_('other-namespace-scope', 'Ghost Pax'), { historyEndDate: '2026-05-01', days: '11' });
  delete global.SpreadsheetApp;
});

// The orphan sweep (third pass) now sees go30hist entries too, since the scoped key gives it a
// discriminator to check against collectKnownTrackerSheetIds_ — a namespace torn down entirely
// (its templateId no longer in NamespaceDB) no longer leaves its history windows behind forever.
it('purge orphan sweep also reaps history for deleted scope', function() {
  resetProps_();
  var now = new Date(2026, 6, 16);
  var recentStart = new Date(now.getTime() - (PAX_CACHE_PURGE_RETENTION_DAYS_ - 5) * 24 * 60 * 60 * 1000);

  // "torn-down-scope" has a go30pax entry (so the orphan sweep's scan even notices the id exists)
  // and a go30hist entry, but no TrackerDB/NamespaceDB row anywhere — as if teardownEnvironment
  // already ran.
  setPaxCacheRow_('tracker', 'torn-down-scope', 'Old Pax', ['gone']);
  setPaxRosterIndex_('tracker', 'torn-down-scope', { 'old pax': 0 });
  setPaxHistoryEntry_('torn-down-scope', 'Old Pax', { historyEndDate: '2026-05-01', days: '11' });

  var spreadsheet = makeFakeTrackerDbSpreadsheet_([{ sheetId: 'sheet-recent', startDate: recentStart }]);
  var result = purgeStalePaxCache_(now, spreadsheet);
  assert.equal(result.orphanedSheetsPurged, 1);
  assert.equal(getPaxHistoryEntry_('torn-down-scope', 'Old Pax'), null);
});

// ── F3Go30-uz9e.3: window length decoupled from the 30-day streak cap ──────────────────────
//
// PAX_HISTORY_WINDOW_DAYS_ was 40, and the rebuild path stored back only MAX_STREAK_WINDOW_DAYS_
// (30) of it, so effective storage was 30 — shorter than the 44 rollingAverage/priorMonthDayValues
// already needed (the "works today only by coincidence" note this issue resolves). The window is
// now a storage cap in its own right, sized for later migration slices; the 30-day streak cap is
// applied at the point streaks are computed instead.

it('history window is long enough for prior plus current month', function() {
  // A rebuild populates back to the start of the previous month — 31 + 31 days, worst case.
  assert.ok(PAX_HISTORY_BACKFILL_DAYS_ >= 62, 'backfill must cover a full prior + current month');
  // The stored window must be able to hold at least everything a rebuild puts in it.
  assert.ok(PAX_HISTORY_WINDOW_DAYS_ >= PAX_HISTORY_BACKFILL_DAYS_,
    'storage cap must be at least the backfill length');
});

it('advance pax history entry trims to storage cap not streak cap', function() {
  // Walk the window past its cap one day at a time, then confirm the trim landed on
  // PAX_HISTORY_WINDOW_DAYS_ — not on 30 (the streak cap) or 40 (the old value).
  var entry = { historyEndDate: '2026-01-01', days: '1' };
  var day = new Date(2026, 0, 1);
  for (var i = 0; i < PAX_HISTORY_WINDOW_DAYS_ + 10; i++) {
    day.setDate(day.getDate() + 1);
    entry = advancePaxHistoryEntry_(entry, paxHistoryFormatIsoLocal_(day), 1);
  }
  assert.equal(entry.days.length, PAX_HISTORY_WINDOW_DAYS_);
  assert.equal(entry.historyEndDate, paxHistoryFormatIsoLocal_(day));
});

// Bulk history write — the post-wipe reload rebuilds a window for every PAX on the roster at
// once, and one setProperty RPC per PAX is exactly the N+1 pattern setPaxCacheRowsBulk_ already
// exists to avoid (same PropertiesService round-trip cost, see getPaxCacheRowsBulk_'s docstring).
it('set pax history entries bulk is one write', function() {
  resetProps_();
  var setPropertyCalls = 0;
  var realSetProperty = fakeProps.setProperty;
  fakeProps.setProperty = function() { setPropertyCalls++; return realSetProperty.apply(this, arguments); };

  setPaxHistoryEntriesBulk_(SCOPE_A_, {
    'Crazy Ivan': { historyEndDate: '2026-08-02', days: '111' },
    'Little John': { historyEndDate: '2026-08-02', days: '101' },
  });

  assert.equal(setPropertyCalls, 0); // went through setProperties, not per-key setProperty
  assert.deepEqual(getPaxHistoryEntry_(SCOPE_A_, 'Crazy Ivan'), { historyEndDate: '2026-08-02', days: '111' });
  assert.deepEqual(getPaxHistoryEntry_(SCOPE_A_, 'crazy ivan'), { historyEndDate: '2026-08-02', days: '111' });
  assert.deepEqual(getPaxHistoryEntry_(SCOPE_A_, 'Little John'), { historyEndDate: '2026-08-02', days: '101' });
});

// ── F3Go30-uz9e.4: f3Name-keyed versioned goals list (PAX data model migration Slice 2) ────

it('upsert pax goals entry appends new month', function() {
  var entry = upsertPaxGoalsEntry_(null, '2026-06', 'Who1', 'What1', 'How1');
  assert.deepEqual(entry, { goals: [{ monthKey: '2026-06', who: 'Who1', what: 'What1', how: 'How1' }] });

  var next = upsertPaxGoalsEntry_(entry, '2026-07', 'Who2', 'What2', 'How2');
  assert.deepEqual(next.goals, [
    { monthKey: '2026-06', who: 'Who1', what: 'What1', how: 'How1' },
    { monthKey: '2026-07', who: 'Who2', what: 'What2', how: 'How2' },
  ]);
  assert.deepEqual(entry.goals.length, 1); // original untouched — pure function
});

it('upsert pax goals entry replaces same month', function() {
  var entry = upsertPaxGoalsEntry_(null, '2026-06', 'Who1', 'What1', 'How1');
  entry = upsertPaxGoalsEntry_(entry, '2026-07', 'Who2', 'What2', 'How2');
  var resaved = upsertPaxGoalsEntry_(entry, '2026-06', 'Who1b', 'What1b', 'How1b');
  assert.deepEqual(resaved.goals, [
    { monthKey: '2026-06', who: 'Who1b', what: 'What1b', how: 'How1b' },
    { monthKey: '2026-07', who: 'Who2', what: 'What2', how: 'How2' },
  ]);
});

it('find pax goals for month is exact match only', function() {
  var entry = upsertPaxGoalsEntry_(null, '2026-06', 'Who1', 'What1', 'How1');
  assert.deepEqual(findPaxGoalsForMonth_(entry, '2026-06'), { who: 'Who1', what: 'What1', how: 'How1' });
  assert.equal(findPaxGoalsForMonth_(entry, '2026-07'), null); // no nearest/most-recent fallback
  assert.equal(findPaxGoalsForMonth_(null, '2026-06'), null);
});

it('pax goals entry round trip and namespace scoping', function() {
  resetProps_();
  assert.equal(getPaxGoalsEntry_(SCOPE_A_, 'Crazy Ivan'), null);
  setPaxGoalsEntry_(SCOPE_A_, 'Crazy Ivan', { goals: [{ monthKey: '2026-06', who: 'W', what: 'X', how: 'Y' }] });
  assert.deepEqual(getPaxGoalsEntry_(SCOPE_A_, 'crazy ivan').goals.length, 1); // case/space-insensitive
  // Same defect class as history's DR-01 — two namespaces sharing this store must never collide.
  assert.equal(getPaxGoalsEntry_(SCOPE_B_, 'Crazy Ivan'), null);
});

it('upsert pax goals for month write through is lock guarded', function() {
  resetProps_();
  var result = upsertPaxGoalsForMonth_(SCOPE_A_, 'Crazy Ivan', '2026-06', 'Who', 'What', 'How');
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(getPaxGoalsForMonth_(SCOPE_A_, 'Crazy Ivan', '2026-06'), { who: 'Who', what: 'What', how: 'How' });

  // Re-save in the same month upserts, not appends.
  upsertPaxGoalsForMonth_(SCOPE_A_, 'Crazy Ivan', '2026-06', 'Who2', 'What2', 'How2');
  assert.deepEqual(getPaxGoalsEntry_(SCOPE_A_, 'Crazy Ivan').goals.length, 1);
  assert.deepEqual(getPaxGoalsForMonth_(SCOPE_A_, 'Crazy Ivan', '2026-06'), { who: 'Who2', what: 'What2', how: 'How2' });
});

// Unlike advancePaxHistoryDay_'s log-and-continue on lock failure, a dropped goal save must be
// reported back to the caller (invariant 3/§5 Slice 2) — not silently swallowed — so
// handleSignupSave_ can surface it.
it('upsert pax goals for month lock failure is reported not swallowed', function() {
  resetProps_();
  var realLock = global.LockService;
  global.LockService = { getScriptLock: function() { return { waitLock: function() { throw new Error('busy'); }, releaseLock: function() {} }; } };
  var result = upsertPaxGoalsForMonth_(SCOPE_A_, 'Crazy Ivan', '2026-06', 'Who', 'What', 'How');
  assert.equal(result.ok, false);
  assert.equal(result.error, 'lock_failed');
  assert.equal(getPaxGoalsEntry_(SCOPE_A_, 'Crazy Ivan'), null); // nothing written
  global.LockService = realLock;
});

it('get pax goals for month miss falls through as null never empty object', function() {
  resetProps_();
  assert.equal(getPaxGoalsForMonth_(SCOPE_A_, 'Nobody Home', '2026-06'), null); // whole entry missing
  upsertPaxGoalsForMonth_(SCOPE_A_, 'Crazy Ivan', '2026-06', 'Who', 'What', 'How');
  assert.equal(getPaxGoalsForMonth_(SCOPE_A_, 'Crazy Ivan', '2027-01'), null); // entry exists, month doesn't
});

// wipeAllPaxCache_ must also clear go30goals: entries, same escape-hatch guarantee as go30hist:.
it('wipe all pax cache also clears goals entries', function() {
  resetProps_();
  setPaxCacheRow_('tracker', 'sheet-x', 'Someone', ['v']);
  upsertPaxGoalsForMonth_(SCOPE_A_, 'Crazy Ivan', '2026-06', 'Who', 'What', 'How');
  var wiped = wipeAllPaxCache_();
  assert.ok(wiped >= 2);
  assert.equal(getPaxCacheRow_('tracker', 'sheet-x', 'Someone'), null);
  assert.equal(getPaxGoalsEntry_(SCOPE_A_, 'Crazy Ivan'), null);
});

it('wipe pax goals for scope only clears that scope', function() {
  resetProps_();
  upsertPaxGoalsForMonth_(SCOPE_A_, 'Crazy Ivan', '2026-06', 'Who', 'What', 'How');
  upsertPaxGoalsForMonth_(SCOPE_B_, 'Crazy Ivan', '2026-06', 'Who', 'What', 'How');
  wipePaxGoalsForScope_(SCOPE_A_);
  assert.equal(getPaxGoalsEntry_(SCOPE_A_, 'Crazy Ivan'), null);
  assert.ok(getPaxGoalsEntry_(SCOPE_B_, 'Crazy Ivan'));
});

// The orphan sweep (purgeStalePaxCache_'s third pass) must reap go30goals: entries for a scope
// whose TrackerDB row(s) are entirely gone, same as it already does for go30hist: — otherwise a
// torn-down namespace's goals entries accumulate against the store cap forever.
it('orphan sweep reaps goals entries for unknown scope', function() {
  resetProps_();
  var now = new Date(2026, 6, 16);
  var recentStart = new Date(now.getTime() - (PAX_CACHE_PURGE_RETENTION_DAYS_ - 5) * 24 * 60 * 60 * 1000);

  // "torn-down-scope" has a go30pax entry (so the orphan sweep's scan even notices the id exists)
  // and a go30goals entry, but no TrackerDB/NamespaceDB row anywhere — as if teardownEnvironment
  // already ran. Mirrors testPurgeOrphanSweepAlsoReapsHistoryForDeletedScope above.
  setPaxCacheRow_('tracker', 'torn-down-scope', 'Old Pax', ['gone']);
  setPaxRosterIndex_('tracker', 'torn-down-scope', { 'old pax': 0 });
  upsertPaxGoalsForMonth_('torn-down-scope', 'Old Pax', '2026-06', 'Who', 'What', 'How');

  var spreadsheet = makeFakeTrackerDbSpreadsheet_([{ sheetId: 'sheet-recent', startDate: recentStart }]);
  var result = purgeStalePaxCache_(now, spreadsheet);
  assert.equal(result.orphanedSheetsPurged, 1);
  assert.equal(getPaxGoalsEntry_('torn-down-scope', 'Old Pax'), null);
});

// The trigger-named wrapper (F3Go30-y8j7.3, see script/PaxCache.js) is what the real installed
// nightly trigger calls (see onOpen.js) and what admin.runPaxCachePurge now calls too (WebApp.js)
// — it must GasLogger.run-wrap the exact same purgeStalePaxCache_ logic, against the active
// spreadsheet, threading an optional pinned "now" through for on-demand verification.
it('purge stale pax cache wrapper runs under trigger name', function() {
  resetProps_();
  var now = new Date(2026, 6, 16);
  var recentStart = new Date(now.getTime() - (PAX_CACHE_PURGE_RETENTION_DAYS_ - 5) * 24 * 60 * 60 * 1000);
  var activeSpreadsheet = makeFakeTrackerDbSpreadsheet_([{ sheetId: 'sheet-recent', startDate: recentStart }]);
  global.SpreadsheetApp = { getActiveSpreadsheet: function() { return activeSpreadsheet; } };

  fakeLogger_._runs.length = 0;
  var result = purgeStalePaxCache(now);
  assert.ok(fakeLogger_._runs.indexOf('purgeStalePaxCache') !== -1, 'expected GasLogger.run to be called with the trigger name');
  assert.equal(result.checked, 1);
  assert.equal(result.purged, 0);

  delete global.SpreadsheetApp;
});

});
