const assert = require('node:assert/strict');
const { readStaticPage_, extractTransportBlock_, extractLoadDashboardBlock_ } = require('./helpers/staticPageExtract');

// F3Go30-5p3z: every dashboard render attempt (loadDashboard_) must emit one client telemetry
// record carrying request-issued/response-received timestamps, whether the response was
// lost/rejected (a below-HTTP transport failure — err.isTransport) vs genuinely received-but-empty,
// and the four length/count fields (dayValues, rollingAverage, priorMonthDayValues, board row
// count) that distinguish a truncated payload from a thin-but-correct one. See F3Go30-5c2a: without
// this a lost response and an empty one look identical from the PAX's chair.

/**
 * Builds a harness around the REAL captureDashboardRenderTelemetry_ (extracted from the transport
 * block, same range test_client_transport_resilience.js already exercises) with localStorage
 * stubbed so queued records can be inspected directly.
 */
function makeTelemetryHarness_() {
  var store = {};
  var fakeLocalStorage = {
    getItem: function(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function(k, v) { store[k] = v; },
  };
  var fakeWindow = { addEventListener: function() {} };
  var fakeNavigator = { onLine: true };

  var body = extractTransportBlock_(readStaticPage_());
  var factory = new Function(
    'WEBAPP_URL', 'CMD_', 'NS_', 'CONTEXT_DATE_', 'STATIC_BUILD_VERSION_', 'state',
    'fetch', 'setTimeout', 'clearTimeout', 'AbortController', '$', 'window', 'localStorage', 'navigator',
    body + '\nreturn { captureDashboardRenderTelemetry_: captureDashboardRenderTelemetry_ };'
  );
  var fns = factory(
    'https://x/exec', 'checkin', 'ns1', '', 'v1', {},
    function() { throw new Error('fetch should not be called by this harness'); },
    function() {}, function() {}, function() {}, function() {}, fakeWindow, fakeLocalStorage, fakeNavigator
  );

  function queue() {
    var raw = fakeLocalStorage.getItem('go30ClientTelemetryQueue:v1');
    return raw ? JSON.parse(raw) : [];
  }

  return { captureDashboardRenderTelemetry_: fns.captureDashboardRenderTelemetry_, queue: queue };
}

// A successful render with a full payload: rejected false, both timestamps present, lengths/count
// taken straight from the payload's own arrays.
(function testSuccessfulRenderCapturesTimestampsAndCounts() {
  var h = makeTelemetryHarness_();
  var issuedTs = Date.now() - 250;
  var payload = {
    dayValues: [1, 0, 1],
    rollingAverage: [0.5, 0.6],
    priorMonthDayValues: [1, 1, 1, 1, 1],
    paxBoard: [
      { name: 'Crucible', members: [{ name: 'A' }, { name: 'B' }] },
      { name: 'Anvil', members: [{ name: 'C' }] },
    ],
  };
  h.captureDashboardRenderTelemetry_(issuedTs, payload, null);

  var records = h.queue();
  assert.equal(records.length, 1);
  var rec = records[0];
  assert.equal(rec.kind, 'dashboardRender');
  assert.equal(rec.action, 'dashboard');
  assert.equal(rec.rejected, false);
  assert.equal(rec.requestIssuedTs, issuedTs);
  assert.equal(typeof rec.responseReceivedTs, 'number');
  assert.ok(rec.responseReceivedTs >= issuedTs, 'response must be recorded at/after the issued timestamp');
  assert.equal(rec.dayValuesLength, 3);
  assert.equal(rec.rollingAverageLength, 2);
  assert.equal(rec.priorMonthDayValuesLength, 5);
  assert.equal(rec.boardRowCount, 3, 'board row count must sum members across every team, not just the first');
})();

// A received-but-empty response (board-only view, viewer unregistered — dayValues/rollingAverage/
// priorMonthDayValues absent, paxBoard present but thin) is NOT "rejected" — a response WAS
// received, it just carries little/nothing. This is the case the rollover defect (F3Go30-b6jy)
// used to render as, and this record must be distinguishable from a genuine transport loss below.
(function testReceivedButEmptyPayloadIsNotRejected() {
  var h = makeTelemetryHarness_();
  var issuedTs = Date.now();
  var payload = { paxBoard: [] };
  h.captureDashboardRenderTelemetry_(issuedTs, payload, null);

  var rec = h.queue()[0];
  assert.equal(rec.rejected, false);
  assert.equal(typeof rec.responseReceivedTs, 'number');
  assert.equal(rec.dayValuesLength, 0);
  assert.equal(rec.rollingAverageLength, 0);
  assert.equal(rec.priorMonthDayValuesLength, 0);
  assert.equal(rec.boardRowCount, 0);
})();

// A below-HTTP transport loss (err.isTransport, no payload) IS rejected — no Response was ever
// received, so responseReceivedTs stays null rather than being stamped at capture time.
(function testTransportLossIsRejectedWithNoResponseTimestamp() {
  var h = makeTelemetryHarness_();
  var issuedTs = Date.now();
  var err = Object.assign(new Error('Failed to fetch'), { isTransport: true });
  h.captureDashboardRenderTelemetry_(issuedTs, null, err);

  var rec = h.queue()[0];
  assert.equal(rec.rejected, true);
  assert.equal(rec.responseReceivedTs, null);
  assert.equal(rec.dayValuesLength, 0);
  assert.equal(rec.boardRowCount, 0);
})();

// A server-answered rejection (HTTP error / json.ok:false) is NOT a transport loss — a Response
// was received, just an unusable one — so it must NOT be flagged `rejected` here (that failure is
// already captured by callApi's own captureClientError_ path via showApiError_; conflating the two
// would double-count it and misreport it as a lost response).
(function testServerAnsweredErrorIsNotFlaggedRejected() {
  var h = makeTelemetryHarness_();
  var err = new Error('Server reported an error with no detail'); // isTransport left undefined
  h.captureDashboardRenderTelemetry_(Date.now(), null, err);

  var rec = h.queue()[0];
  assert.equal(rec.rejected, false);
  assert.equal(typeof rec.responseReceivedTs, 'number');
})();

// loadDashboard_ itself must call captureDashboardRenderTelemetry_ exactly once per attempt, on
// both the success and failure paths, with the issued timestamp captured before the fetch and the
// resolved payload/rejected error passed straight through.
(function testLoadDashboardInvokesTelemetryCaptureOnSuccessAndFailure() {
  var calls = [];
  var captureDashboardRenderTelemetry_ = function(issuedTs, payload, err) { calls.push({ issuedTs: issuedTs, payload: payload, err: err }); };

  function makeLoadDashboardHarness_(callApiImpl) {
    var elements = {};
    function fakeEl_(id) {
      if (!elements[id]) elements[id] = { disabled: false, textContent: '' };
      return elements[id];
    }
    var body = extractLoadDashboardBlock_(readStaticPage_());
    var factory = new Function(
      'state', '$', 'callApi', 'renderDashboard_', 'setButtonLoading_', 'hideApiError_', 'showApiError_',
      'isoDate_', 'monthKeyOf_', 'patchOwnDayIntoPayload_', 'renderDateNav_', 'captureDashboardRenderTelemetry_',
      body + '\nreturn { loadDashboard_: loadDashboard_ };'
    );
    return factory(
      { f3Name: 'Test PAX', email: 't@x.com', resolvedContext: null, board: {}, pendingSelfWrites: {}, dashboardLoading: false, viewDate: new Date() },
      fakeEl_, callApiImpl, function() {}, function() {}, function() {}, function() {},
      function(d) { return d.getFullYear() + '-01-01'; }, function(d) { return d.getFullYear() + '-01'; },
      function() {}, function() {}, captureDashboardRenderTelemetry_
    );
  }

  var okPayload = { monthKey: '2026-09', dayDates: ['2026-09-01'], viewDayIndex: 0, paxBoard: [] };
  var hOk = makeLoadDashboardHarness_(function() { return Promise.resolve(okPayload); });
  return hOk.loadDashboard_('2026-09-01', { silent: true }).then(function() {
    assert.equal(calls.length, 1);
    assert.equal(calls[0].payload, okPayload);
    assert.equal(calls[0].err, null);
    assert.equal(typeof calls[0].issuedTs, 'number');

    var failErr = Object.assign(new Error('Failed to fetch'), { isTransport: true });
    var hFail = makeLoadDashboardHarness_(function() { return Promise.reject(failErr); });
    return hFail.loadDashboard_('2026-09-01', { silent: true }).catch(function() {
      assert.equal(calls.length, 2);
      assert.equal(calls[1].payload, null);
      assert.equal(calls[1].err, failErr);
    });
  });
})();

console.log('test_dashboard_render_telemetry.js: all assertions passed');
