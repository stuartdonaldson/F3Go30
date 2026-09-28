const assert = require('node:assert/strict');

// In-memory stand-in for PropertiesService.getScriptProperties() — same fake shape used by
// test_pax_cache.js and test_dashboard_webapp.js for the same GAS service.
function makeFakeProperties_() {
  var store = {};
  return {
    getProperty: function(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    setProperty: function(key, value) { store[key] = value; },
    _store: store,
  };
}

var fakeProps = makeFakeProperties_();
global.PropertiesService = { getScriptProperties: function() { return fakeProps; } };

// CacheService stand-in (F3Go30-ga01: per-id dedupe keys). expire() simulates the 6h TTL lapsing.
function makeFakeCache_() {
  var store = {};
  return {
    getAll: function(keys) { var out = {}; keys.forEach(function(k) { if (Object.prototype.hasOwnProperty.call(store, k)) out[k] = store[k]; }); return out; },
    putAll: function(map, ttl) { Object.keys(map).forEach(function(k) { store[k] = map[k]; }); this.lastTtl = ttl; },
    expire: function() { Object.keys(store).forEach(function(k) { delete store[k]; }); },
    _store: store,
  };
}
var fakeCache = makeFakeCache_();
global.CacheService = { getScriptCache: function() { return fakeCache; } };

var loggedEntries = [];
global.GasLogger = {
  log: function(tag, data) { loggedEntries.push({ tag: tag, data: data }); },
};

const {
  handleClientTelemetryBatch_,
  handleClientTelemetryPost_,
  logPiggybackedClientTelemetry_,
  attachTelemetryAck_,
} = require('../script/ClientTelemetryLog.js');

function reset_() {
  fakeProps = makeFakeProperties_();
  global.PropertiesService = { getScriptProperties: function() { return fakeProps; } };
  fakeCache = makeFakeCache_();
  loggedEntries = [];
}

// AC (F3Go30-xyri): a captured record is logged, tagged distinctly ('clientTelemetry') so it's
// queryable/aggregable separately from normal request logs.
function testLogsANewRecord() {
  reset_();
  var result = handleClientTelemetryBatch_([{ id: 'a1', ts: '2026-08-19T10:00:00.000Z', kind: 'error', action: 'identify', errorText: 'boom' }]);
  assert.equal(result.logged, 1);
  assert.equal(result.skipped, 0);
  assert.equal(loggedEntries.length, 1);
  assert.equal(loggedEntries[0].tag, 'clientTelemetry');
  assert.equal(loggedEntries[0].data.action, 'identify');
}

// AC (F3Go30-xyri): the server does not double-log the same unique id if uploaded more than once
// within the dedupe window — a client retrying an upload it never got an ack for must not spam
// Axiom with duplicate rows.
function testDedupesRepeatedIdWithinWindow() {
  reset_();
  handleClientTelemetryBatch_([{ id: 'dup-1', ts: new Date().toISOString(), kind: 'error', action: 'checkin' }]);
  var second = handleClientTelemetryBatch_([{ id: 'dup-1', ts: new Date().toISOString(), kind: 'error', action: 'checkin' }]);
  assert.equal(second.logged, 0);
  assert.equal(second.skipped, 1);
  assert.equal(loggedEntries.length, 1, 'the duplicate id must not produce a second logged entry');
}

// A record's id is only ever logged once, even across many upload attempts.
function testSameIdNeverLoggedTwiceAcrossManyRetries() {
  reset_();
  for (var i = 0; i < 5; i++) {
    handleClientTelemetryBatch_([{ id: 'retry-1', ts: new Date().toISOString(), kind: 'reconnectPoll', action: 'identify' }]);
  }
  assert.equal(loggedEntries.length, 1);
}

// Once an id's CacheService key expires (6h TTL), a re-upload of that same id is logged again —
// an accepted tradeoff: with acks (F3Go30-ga01) a record is dequeued within one round trip, so a
// re-send after 6h means the client never received any ack in that time.
function testExpiredIdIsLoggedAgain() {
  reset_();
  handleClientTelemetryBatch_([{ id: 'expired-1', ts: new Date().toISOString(), kind: 'error', action: 'dashboard' }]);
  assert.ok(fakeCache.lastTtl > 0 && fakeCache.lastTtl <= 6 * 60 * 60, 'dedupe keys carry a TTL at or under 6h');
  fakeCache.expire();
  var result = handleClientTelemetryBatch_([{ id: 'expired-1', ts: new Date().toISOString(), kind: 'error', action: 'dashboard' }]);
  assert.equal(result.logged, 1);
}

// Malformed batch entries (no id, or the whole payload not an array) are skipped, never thrown —
// a client-supplied batch is untrusted input.
function testMalformedRecordsAreSkippedNotThrown() {
  reset_();
  assert.doesNotThrow(function() {
    var result = handleClientTelemetryBatch_([null, {}, { id: 'ok-1', ts: new Date().toISOString() }]);
    assert.equal(result.logged, 1);
    assert.equal(result.skipped, 2);
  });
  assert.doesNotThrow(function() { handleClientTelemetryBatch_(undefined); });
  assert.doesNotThrow(function() { handleClientTelemetryBatch_('not-an-array'); });
}

// AC (F3Go30-xyri addendum #2): PAX identity is captured, but masked the same way every other
// GasLogger entry masks PII (file header rule) — not logged raw.
function testF3NameIsMaskedBeforeLogging() {
  reset_();
  handleClientTelemetryBatch_([{ id: 'pii-1', ts: new Date().toISOString(), kind: 'error', action: 'checkin', f3Name: 'Little John' }]);
  assert.equal(loggedEntries[0].data.f3Name, 'L...n');
}

// Batch size is capped independent of the client's own queue cap, defensively.
function testBatchIsCappedAtMax() {
  reset_();
  var records = [];
  for (var i = 0; i < 40; i++) records.push({ id: 'r' + i, ts: new Date().toISOString() });
  var result = handleClientTelemetryBatch_(records);
  assert.equal(result.logged, 25);
  assert.equal(result.skipped, 0); // the 15 dropped by the cap aren't even reached, not "skipped"
}

// handleClientTelemetryPost_ is the dispatcher-facing entry point (handleCheckinPost_'s
// `clientTelemetry` action) — wraps handleClientTelemetryBatch_ with an {ok:true,...} response
// shape matching every other action handler's jsonOutput_ contract.
function testHandlePostReturnsOkShape() {
  reset_();
  var res = handleClientTelemetryPost_({ ns: 'testns', records: [{ id: 'p1', ts: new Date().toISOString() }] });
  assert.equal(res.ok, true);
  assert.equal(res.logged, 1);
  assert.equal(loggedEntries[0].data.ns, 'testns');
}

// F3Go30-ga01 AC7: dedupe is per-id CacheService keys, and both a fresh and an already-seen id
// are acked (the client may dequeue either); a record with no id is never acked.
function testAckIdsCoverLoggedAndAlreadySeen() {
  reset_();
  handleClientTelemetryBatch_([{ id: 'seen-1', ts: new Date().toISOString() }]);
  var res = handleClientTelemetryBatch_([{ id: 'seen-1' }, { id: 'new-1' }, { kind: 'error' }]);
  assert.deepEqual(res.ackIds, ['seen-1', 'new-1']);
  assert.equal(res.logged, 1);
  assert.ok(Object.keys(fakeCache._store).every(function(k) { return k.indexOf('ctlSeen:') === 0; }));
  assert.equal(fakeProps.getProperty('CLIENT_TELEMETRY_DEDUPE_SEEN_IDS'), null, 'no whole-blob Script Property any more');
}

// A duplicate id inside ONE batch logs once.
function testDuplicateIdWithinOneBatchLogsOnce() {
  reset_();
  var res = handleClientTelemetryBatch_([{ id: 'x' }, { id: 'x' }]);
  assert.equal(res.logged, 1);
  assert.equal(loggedEntries.length, 1);
}

// CacheService unavailable: records are still logged (no dedupe) rather than dropped.
function testCacheFailureStillLogs() {
  reset_();
  global.CacheService = { getScriptCache: function() { throw new Error('cache down'); } };
  try {
    var res = handleClientTelemetryBatch_([{ id: 'c1' }]);
    assert.equal(res.logged, 1);
    assert.deepEqual(res.ackIds, ['c1']);
  } finally {
    global.CacheService = { getScriptCache: function() { return fakeCache; } };
  }
}

// F3Go30-ga01: piggyback — records ride payload.telemetry.records on a normal action, are
// stamped with the carrier's action + clientRequestId, and the ids come back for telemetryAck.
function testPiggybackLogsAndReturnsAckIds() {
  reset_();
  var ack = logPiggybackedClientTelemetry_({ action: 'dashboard', ns: 'n', clientRequestId: 'req-1',
    telemetry: { records: [{ id: 'pb1', kind: 'error' }] } });
  assert.deepEqual(ack, ['pb1']);
  assert.equal(loggedEntries[0].data.carrierAction, 'dashboard');
  assert.equal(loggedEntries[0].data.carrierRequestId, 'req-1');
}

// No records carried (old client) -> null, so no telemetryAck field is added to the response.
function testPiggybackAbsentReturnsNull() {
  reset_();
  assert.equal(logPiggybackedClientTelemetry_({ action: 'identify' }), null);
  assert.equal(logPiggybackedClientTelemetry_({ action: 'identify', telemetry: { records: [] } }), null);
  assert.equal(logPiggybackedClientTelemetry_({ action: 'clientTelemetry', telemetry: { records: [{ id: 'z' }] } }), null);
  var resp = { ok: true, x: 1 };
  assert.equal(attachTelemetryAck_(resp, null), resp);
}

// AC4/AC5: telemetryAck rides ok:true and ok:false alike, and a throw inside telemetry logging
// never changes the action's response — it acks nothing, so the records ride the next request.
function testPiggybackFailureNeverAffectsTheActionResponse() {
  reset_();
  var realLog = global.GasLogger.log;
  global.GasLogger.log = function() { throw new Error('logger down'); };
  var ack;
  try {
    ack = logPiggybackedClientTelemetry_({ action: 'checkin', telemetry: { records: [{ id: 'f1' }] } });
  } finally {
    global.GasLogger.log = realLog;
  }
  assert.deepEqual(ack, []);
  var actionResult = { ok: true, saved: true };
  assert.deepEqual(attachTelemetryAck_(actionResult, ack), { ok: true, saved: true, telemetryAck: [] });
  assert.deepEqual(attachTelemetryAck_({ ok: false, error: 'server_error' }, ['a']), { ok: false, error: 'server_error', telemetryAck: ['a'] });
  assert.deepEqual(actionResult, { ok: true, saved: true }, 'the action result object itself is not mutated');
}

function run() {
  const tests = [
    testLogsANewRecord,
    testDedupesRepeatedIdWithinWindow,
    testSameIdNeverLoggedTwiceAcrossManyRetries,
    testExpiredIdIsLoggedAgain,
    testMalformedRecordsAreSkippedNotThrown,
    testF3NameIsMaskedBeforeLogging,
    testBatchIsCappedAtMax,
    testHandlePostReturnsOkShape,
    testAckIdsCoverLoggedAndAlreadySeen,
    testDuplicateIdWithinOneBatchLogsOnce,
    testCacheFailureStillLogs,
    testPiggybackLogsAndReturnsAckIds,
    testPiggybackAbsentReturnsNull,
    testPiggybackFailureNeverAffectsTheActionResponse,
  ];
  for (const test of tests) {
    test();
    console.log(`  ok - ${test.name}`);
  }
  console.log('test_client_telemetry_log.js: all tests passed');
}

run();
