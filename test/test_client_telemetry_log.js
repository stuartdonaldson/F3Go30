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

var loggedEntries = [];
global.GasLogger = {
  log: function(tag, data) { loggedEntries.push({ tag: tag, data: data }); },
};

const {
  pruneClientTelemetrySeenIds_,
  handleClientTelemetryBatch_,
  handleClientTelemetryPost_,
} = require('../script/ClientTelemetryLog.js');

function reset_() {
  fakeProps = makeFakeProperties_();
  global.PropertiesService = { getScriptProperties: function() { return fakeProps; } };
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

// pruneClientTelemetrySeenIds_ is the pure function the dedupe store is built on — verified in
// isolation (no PropertiesService involved) so the ~2-day window logic is directly testable.
function testPruneDropsEntriesOlderThanWindow() {
  var now = Date.parse('2026-08-19T12:00:00.000Z');
  var map = {
    fresh: '2026-08-19T11:00:00.000Z', // 1h old — kept
    old: '2026-08-16T12:00:00.000Z', // 3 days old — pruned (window is 2 days)
  };
  var pruned = pruneClientTelemetrySeenIds_(map, now);
  assert.deepEqual(Object.keys(pruned), ['fresh']);
}

// Once an id ages out of the dedupe window, a re-upload of that same id is logged again (this is
// an accepted tradeoff of a time-bounded store, not a bug — the client's own queue is long since
// flushed by the time 2 days have passed in any real scenario).
function testExpiredIdIsLoggedAgain() {
  reset_();
  var oldTs = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  fakeProps.setProperty('CLIENT_TELEMETRY_DEDUPE_SEEN_IDS', JSON.stringify({ 'expired-1': oldTs }));
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

function run() {
  const tests = [
    testLogsANewRecord,
    testDedupesRepeatedIdWithinWindow,
    testSameIdNeverLoggedTwiceAcrossManyRetries,
    testPruneDropsEntriesOlderThanWindow,
    testExpiredIdIsLoggedAgain,
    testMalformedRecordsAreSkippedNotThrown,
    testF3NameIsMaskedBeforeLogging,
    testBatchIsCappedAtMax,
    testHandlePostReturnsOkShape,
  ];
  for (const test of tests) {
    test();
    console.log(`  ok - ${test.name}`);
  }
  console.log('test_client_telemetry_log.js: all tests passed');
}

run();
