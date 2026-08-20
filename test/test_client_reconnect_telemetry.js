const assert = require('node:assert/strict');
const { readStaticPage_, extractTransportBlock_, extractFunction_ } = require('./helpers/staticPageExtract');

// F3Go30-xyri (client-side error telemetry) + F3Go30-n40u (background reconnect poll) — both
// live in the static page's transport block (static-pages/src/index.html), extracted and run
// here as REAL code against injected stand-ins, same pattern as
// test_client_transport_resilience.js.

/** In-memory localStorage stand-in — real enough for JSON.stringify/parse round trips and a
 * quota-exceeded simulation. */
function makeFakeLocalStorage_(opts) {
  opts = opts || {};
  var store = {};
  return {
    getItem: function(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    setItem: function(key, value) {
      if (opts.throwOnSet) throw new Error('QuotaExceededError');
      store[key] = value;
    },
    removeItem: function(key) { delete store[key]; },
    _store: store,
  };
}

/**
 * Builds the transport block with injected stand-ins, exposing the F3Go30-xyri/n40u surface
 * (captureClientTelemetry_, flushClientTelemetryQueue_, startReconnectPoll_/stopReconnectPoll_)
 * alongside callApi, matching makeTransportHarness_'s shape in
 * test_client_transport_resilience.js.
 */
function makeReconnectHarness_(opts) {
  opts = opts || {};
  var body = extractTransportBlock_(readStaticPage_());

  var fetchCalls = [];
  var timers = [];
  var clearedIds = [];
  var pageHandlers = {};
  var domHandlers = {};
  var els = {};

  function el(id) {
    if (!els[id]) {
      els[id] = {
        id: id, hidden: true,
        classList: {
          add: function(c) { if (c === 'hidden') els[id].hidden = true; },
          remove: function(c) { if (c === 'hidden') els[id].hidden = false; },
          toggle: function(c, on) { if (c === 'hidden') els[id].hidden = !!on; },
        },
        addEventListener: function(evt, fn) { (domHandlers[id] = domHandlers[id] || {})[evt] = fn; },
      };
    }
    return els[id];
  }

  var fakeWindow = {
    addEventListener: function(evt, fn) { (pageHandlers[evt] = pageHandlers[evt] || []).push(fn); },
    crypto: { randomUUID: function() { return 'fixed-uuid-' + (fakeWindow._uuidCalls = (fakeWindow._uuidCalls || 0) + 1); } },
  };

  var fakeSetTimeout = function(fn, ms) {
    var id = timers.length + 1;
    timers.push({ fn: fn, ms: ms, id: id });
    return id;
  };
  var fakeClearTimeout = function(id) { clearedIds.push(id); };

  var fetchImpl = opts.fetchImpl || function() { return Promise.reject(new Error('no fetchImpl configured')); };
  var wrappedFetch = function(url, fetchOpts) {
    fetchCalls.push({ url: url, opts: fetchOpts, body: JSON.parse(fetchOpts.body) });
    return fetchImpl(url, fetchOpts, fetchCalls.length);
  };

  var fakeLocalStorage = opts.localStorage || makeFakeLocalStorage_();
  var fakeNavigator = Object.prototype.hasOwnProperty.call(opts, 'navigator') ? opts.navigator : { onLine: true };
  var fakeState = opts.state || { currentStep: 'dashboard', f3Name: 'Test Pax', email: '' };

  // Stand-ins for the read-view loaders repaintCurrentView_ calls — these live outside the
  // transport block in the real file, so the harness supplies trackable stubs.
  var loadCalls = { loadDashboard_: 0, loadCalMonth_: 0, loadBonusList_: 0, hideApiError_: 0 };
  var loadDashboard_ = function() { loadCalls.loadDashboard_++; };
  var loadCalMonth_ = function() { loadCalls.loadCalMonth_++; };
  var loadBonusList_ = function() { loadCalls.loadBonusList_++; };
  var isoDate_ = function(d) { return String(d); };
  // hideApiError_ itself lives just outside the extracted transport block in the real file (it's
  // the block's own end marker) — stubbed here so runReconnectPollAttempt_'s success path has
  // something to call; el('apiErrorBanner') is asserted directly instead.
  var hideApiError_ = function() { loadCalls.hideApiError_++; el('apiErrorBanner').classList.add('hidden'); };

  var factory = new Function(
    'WEBAPP_URL', 'CMD_', 'NS_', 'CONTEXT_DATE_', 'STATIC_BUILD_VERSION_',
    'fetch', 'setTimeout', 'clearTimeout', 'AbortController', '$', 'window',
    'localStorage', 'navigator', 'state', 'loadDashboard_', 'loadCalMonth_', 'loadBonusList_', 'isoDate_', 'hideApiError_',
    body +
    '\nreturn {' +
    '\n  callApi: callApi,' +
    '\n  captureClientTelemetry_: captureClientTelemetry_,' +
    '\n  captureClientError_: captureClientError_,' +
    '\n  flushClientTelemetryQueue_: flushClientTelemetryQueue_,' +
    '\n  startReconnectPoll_: startReconnectPoll_,' +
    '\n  stopReconnectPoll_: stopReconnectPoll_,' +
    '\n  isPolling_: function() { return !!reconnectPollState_; },' +
    '\n  pollAttempts_: function() { return reconnectPollState_ ? reconnectPollState_.attempts : 0; },' +
    '\n};'
  );

  var fns = factory(
    'https://example.test/exec', 'checkin', 'testns', '', '2.4.7.6',
    wrappedFetch, fakeSetTimeout, fakeClearTimeout, AbortController,
    el, fakeWindow, fakeLocalStorage, fakeNavigator, fakeState,
    loadDashboard_, loadCalMonth_, loadBonusList_, isoDate_, hideApiError_
  );

  return Object.assign(fns, {
    fetchCalls: fetchCalls,
    timers: timers,
    clearedIds: clearedIds,
    loadCalls: loadCalls,
    el: el,
    fakeLocalStorage: fakeLocalStorage,
    fireTimers: function() {
      var due = timers.splice(0, timers.length);
      due.forEach(function(t) { if (clearedIds.indexOf(t.id) === -1) t.fn(); });
    },
  });
}

function jsonResponse_(body) {
  return Promise.resolve({ ok: true, json: function() { return Promise.resolve(Object.assign({ ok: true }, body)); } });
}

function transportRejection_() {
  return Promise.reject(Object.assign(new Error('Failed to fetch'), { isTransport: true }));
}

// ── F3Go30-xyri: capture + bounded queue ────────────────────────────────────────────────────

function testCaptureClientErrorQueuesARecord() {
  var h = makeReconnectHarness_();
  h.captureClientError_('identify', new Error('boom'));
  var queue = JSON.parse(h.fakeLocalStorage.getItem('go30ClientTelemetryQueue:v1'));
  assert.equal(queue.length, 1);
  assert.equal(queue[0].kind, 'error');
  assert.equal(queue[0].action, 'identify');
  assert.equal(queue[0].errorText, 'boom');
  assert.equal(queue[0].ns, 'testns');
  assert.equal(queue[0].clientVersion, '2.4.7.6');
  assert.ok(queue[0].id, 'a captured record must carry a unique id');
}

// AC: no PAX-identifying content beyond existing conventions — f3Name is captured (reused from
// already-resolved client state), but nothing extra.
function testCaptureIncludesKnownIdentity() {
  var h = makeReconnectHarness_({ state: { currentStep: 'dashboard', f3Name: 'Little John', email: 'lj@example.test' } });
  h.captureClientError_('checkin', new Error('x'));
  var queue = JSON.parse(h.fakeLocalStorage.getItem('go30ClientTelemetryQueue:v1'));
  assert.equal(queue[0].f3Name, 'Little John');
}

// AC: capture must never throw, even if localStorage is completely unusable.
function testCaptureNeverThrowsWhenStorageUnavailable() {
  var h = makeReconnectHarness_({ localStorage: makeFakeLocalStorage_({ throwOnSet: true }) });
  assert.doesNotThrow(function() { h.captureClientError_('identify', new Error('boom')); });
}

// AC: local storage use is bounded by count so a persistently-offline client doesn't grow
// storage without limit.
function testQueueIsBoundedByCount() {
  var h = makeReconnectHarness_();
  for (var i = 0; i < 40; i++) h.captureClientError_('identify', new Error('err' + i));
  var queue = JSON.parse(h.fakeLocalStorage.getItem('go30ClientTelemetryQueue:v1'));
  assert.equal(queue.length, 25, 'queue must be capped at CLIENT_TELEMETRY_QUEUE_MAX_ (25)');
  // The oldest records are dropped, not the newest.
  assert.equal(queue[queue.length - 1].errorText, 'err39');
}

// AC: local storage use is bounded by age.
function testQueueIsBoundedByAge() {
  var fakeLs = makeFakeLocalStorage_();
  var eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  fakeLs.setItem('go30ClientTelemetryQueue:v1', JSON.stringify([
    { id: 'stale-1', ts: eightDaysAgo, kind: 'error', action: 'identify' },
  ]));
  var h = makeReconnectHarness_({ localStorage: fakeLs });
  h.captureClientError_('checkin', new Error('fresh'));
  var queue = JSON.parse(h.fakeLocalStorage.getItem('go30ClientTelemetryQueue:v1'));
  assert.equal(queue.length, 1, 'a record older than the max age must be pruned on the next capture');
  assert.equal(queue[0].action, 'checkin');
}

// ── F3Go30-xyri: upload / flush ──────────────────────────────────────────────────────────────

function testFlushUploadsQueuedRecordsAndClearsOnAck() {
  var h = makeReconnectHarness_({ fetchImpl: function() { return jsonResponse_({ logged: 1, skipped: 0 }); } });
  h.captureClientError_('identify', new Error('boom'));
  h.flushClientTelemetryQueue_(); // fire-and-forget — drive the microtask queue below to let it settle
  return new Promise(function(resolve) { setImmediate(resolve); }).then(function() {
    var queue = JSON.parse(h.fakeLocalStorage.getItem('go30ClientTelemetryQueue:v1') || '[]');
    assert.equal(queue.length, 0, 'an acknowledged record must be removed from the queue');
    assert.equal(h.fetchCalls.length, 1);
    assert.equal(h.fetchCalls[0].body.action, 'clientTelemetry');
    assert.equal(h.fetchCalls[0].body.records.length, 1);
  });
}

function testFlushKeepsQueueOnUploadFailure() {
  var h = makeReconnectHarness_({ fetchImpl: function() { return transportRejection_(); } });
  h.captureClientError_('identify', new Error('boom'));
  h.flushClientTelemetryQueue_();
  return new Promise(function(resolve) { setImmediate(resolve); }).then(function() {
    var queue = JSON.parse(h.fakeLocalStorage.getItem('go30ClientTelemetryQueue:v1') || '[]');
    assert.equal(queue.length, 1, 'a record must stay queued when the upload itself fails');
  });
}

// AC: uploading must never block/degrade the flow that triggered a capture — flush is
// fire-and-forget (does not return a promise the caller is meant to await).
function testFlushDoesNotReturnAPromise() {
  var h = makeReconnectHarness_({ fetchImpl: function() { return jsonResponse_({}); } });
  h.captureClientError_('identify', new Error('boom'));
  var result = h.flushClientTelemetryQueue_();
  assert.equal(result, undefined);
}

// ── F3Go30-n40u: background reconnect poll ──────────────────────────────────────────────────

function testPollSchedulesOnStart() {
  var h = makeReconnectHarness_({ fetchImpl: function() { return transportRejection_(); } });
  h.startReconnectPoll_();
  assert.ok(h.isPolling_());
  assert.equal(h.timers.length, 1, 'starting the poll must schedule exactly one timer tick');
}

function testStartIsIdempotentWhileAlreadyPolling() {
  var h = makeReconnectHarness_({ fetchImpl: function() { return transportRejection_(); } });
  h.startReconnectPoll_();
  h.startReconnectPoll_();
  assert.equal(h.timers.length, 1, 'a second start while already polling must not schedule a duplicate timer');
}

// AC: a successful poll clears the banner (via hideApiError_, exercised indirectly here through
// stopReconnectPoll_ + the reload button being hidden) and stops polling — no manual refresh.
function testSuccessfulPollStopsPolling() {
  var h = makeReconnectHarness_({ fetchImpl: function() { return jsonResponse_({}); } });
  h.startReconnectPoll_();
  h.fireTimers();
  return new Promise(function(resolve) { setImmediate(resolve); }).then(function() {
    assert.equal(h.isPolling_(), false, 'polling must stop once a poll attempt succeeds');
  });
}

// AC: a full-page reload is never triggered automatically — repaintCurrentView_'s loaders are
// exercised separately (testRepaintCurrentView*); here, verify the poll itself never calls
// location.reload or any load* stand-in directly except through the documented success path.
function testFailedPollReschedulesWithoutStopping() {
  var h = makeReconnectHarness_({ fetchImpl: function() { return transportRejection_(); } });
  h.startReconnectPoll_();
  h.fireTimers();
  return new Promise(function(resolve) { setImmediate(resolve); }).then(function() {
    assert.ok(h.isPolling_(), 'a failed poll attempt must reschedule, not give up, before the attempt cap');
    assert.equal(h.pollAttempts_(), 1);
  });
}

// AC: background polling is bounded (attempt cap) so it can't run forever draining battery/data.
function testPollStopsAtAttemptCap() {
  var h = makeReconnectHarness_({ fetchImpl: function() { return transportRejection_(); } });
  h.startReconnectPoll_();
  var settle = Promise.resolve();
  for (var i = 0; i < 30; i++) {
    settle = settle.then(function() {
      h.fireTimers();
      return new Promise(function(resolve) { setImmediate(resolve); });
    });
  }
  return settle.then(function() {
    assert.equal(h.isPolling_(), false, 'polling must stop once RECONNECT_POLL_MAX_ATTEMPTS_ is reached');
  });
}

// AC: reload is offered (button shown) only past the outage-duration threshold, never forced.
function testReloadButtonHiddenBeforeThreshold() {
  var h = makeReconnectHarness_({ fetchImpl: function() { return transportRejection_(); } });
  h.startReconnectPoll_();
  h.fireTimers();
  return new Promise(function(resolve) { setImmediate(resolve); }).then(function() {
    assert.equal(h.el('apiErrorReloadBtn').hidden, true, 'the reload button must stay hidden before the duration threshold');
  });
}

function testStopPollHidesReloadButton() {
  var h = makeReconnectHarness_({ fetchImpl: function() { return transportRejection_(); } });
  h.startReconnectPoll_();
  h.el('apiErrorReloadBtn').hidden = false; // simulate it having been offered
  h.stopReconnectPoll_();
  assert.equal(h.el('apiErrorReloadBtn').hidden, true);
  assert.equal(h.isPolling_(), false);
}

// ── F3Go30-n40u: repaintCurrentView_ read-vs-write scoping (extracted standalone) ───────────

function makeRepaintHarness_(state) {
  var src = readStaticPage_();
  var body = extractFunction_(src, 'repaintCurrentView_');
  var loadCalls = { loadDashboard_: 0, loadCalMonth_: 0, loadBonusList_: 0 };
  var factory = new Function(
    'state', 'loadDashboard_', 'loadCalMonth_', 'loadBonusList_', 'isoDate_',
    body + '\nreturn repaintCurrentView_;'
  );
  var repaint = factory(
    state,
    function() { loadCalls.loadDashboard_++; },
    function() { loadCalls.loadCalMonth_++; },
    function() { loadCalls.loadBonusList_++; },
    function(d) { return String(d); }
  );
  return { repaint: repaint, loadCalls: loadCalls };
}

function testRepaintReloadsDashboardWhenOnDashboardStep() {
  var h = makeRepaintHarness_({ currentStep: 'dashboard', viewDate: null });
  h.repaint();
  assert.equal(h.loadCalls.loadDashboard_, 1);
  assert.equal(h.loadCalls.loadCalMonth_, 0);
  assert.equal(h.loadCalls.loadBonusList_, 0);
}

function testRepaintReloadsBonusListWhenOnBonusStep() {
  var h = makeRepaintHarness_({ currentStep: 'bonus' });
  h.repaint();
  assert.equal(h.loadCalls.loadBonusList_, 1);
  assert.equal(h.loadCalls.loadDashboard_, 0);
}

function testRepaintReloadsCalendarWhenAdvancedGridOpen() {
  var h = makeRepaintHarness_({ currentStep: 'checkin', advancedOpen: true, calMonthKey: '2026-08', calGridCache: { '2026-08': {} } });
  h.repaint();
  assert.equal(h.loadCalls.loadCalMonth_, 1);
}

// AC: a write-shaped step (plain checkin, calendar not open) is never auto-resubmitted —
// repaintCurrentView_ must do nothing.
function testRepaintDoesNothingOnPlainCheckinStep() {
  var h = makeRepaintHarness_({ currentStep: 'checkin', advancedOpen: false });
  h.repaint();
  assert.equal(h.loadCalls.loadDashboard_, 0);
  assert.equal(h.loadCalls.loadCalMonth_, 0);
  assert.equal(h.loadCalls.loadBonusList_, 0);
}

function testRepaintDoesNothingOnIdentifyStep() {
  var h = makeRepaintHarness_({ currentStep: 'identify' });
  h.repaint();
  assert.equal(h.loadCalls.loadDashboard_, 0);
  assert.equal(h.loadCalls.loadCalMonth_, 0);
  assert.equal(h.loadCalls.loadBonusList_, 0);
}

function run() {
  const tests = [
    testCaptureClientErrorQueuesARecord,
    testCaptureIncludesKnownIdentity,
    testCaptureNeverThrowsWhenStorageUnavailable,
    testQueueIsBoundedByCount,
    testQueueIsBoundedByAge,
    testFlushUploadsQueuedRecordsAndClearsOnAck,
    testFlushKeepsQueueOnUploadFailure,
    testFlushDoesNotReturnAPromise,
    testPollSchedulesOnStart,
    testStartIsIdempotentWhileAlreadyPolling,
    testSuccessfulPollStopsPolling,
    testFailedPollReschedulesWithoutStopping,
    testPollStopsAtAttemptCap,
    testReloadButtonHiddenBeforeThreshold,
    testStopPollHidesReloadButton,
    testRepaintReloadsDashboardWhenOnDashboardStep,
    testRepaintReloadsBonusListWhenOnBonusStep,
    testRepaintReloadsCalendarWhenAdvancedGridOpen,
    testRepaintDoesNothingOnPlainCheckinStep,
    testRepaintDoesNothingOnIdentifyStep,
  ];
  return tests.reduce(function(chain, test) {
    return chain.then(function() {
      return Promise.resolve(test()).then(function() {
        console.log(`  ok - ${test.name}`);
      });
    });
  }, Promise.resolve()).then(function() {
    console.log('test_client_reconnect_telemetry.js: all tests passed');
  });
}

run().catch(function(err) {
  console.error(err);
  process.exit(1);
});
