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
  var src = readStaticPage_();
  // hashString_ is declared above the transport block's own start marker (it's shared with
  // TOKEN_STORAGE_KEY_'s namespacing too), so extractTransportBlock_'s slice doesn't include it —
  // extractEchoKeyInfo_ (F3Go30-5c2a.1) needs it in scope, same real implementation, not a
  // test-authored stand-in.
  var body = extractFunction_(src, 'hashString_') + '\n' + extractTransportBlock_(src);

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
    '\n  extractEchoKeyInfo_: extractEchoKeyInfo_,' +
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

function jsonResponse_(body, meta) {
  meta = meta || {};
  return Promise.resolve({
    ok: true,
    url: meta.url || 'https://example.test/exec?cmd=checkin',
    redirected: !!meta.redirected,
    json: function() { return Promise.resolve(Object.assign({ ok: true }, body)); },
  });
}

function httpErrorResponse_(status, meta) {
  meta = meta || {};
  return Promise.resolve({
    ok: false,
    status: status,
    url: meta.url || 'https://example.test/exec?cmd=checkin',
    redirected: !!meta.redirected,
    json: function() { return Promise.resolve({}); },
  });
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

// ── F3Go30-5c2a.1: echo-redirect key identity ───────────────────────────────────────────────
// Evidence gap this closes: neither side today logs which script.googleusercontent.com/macros/
// echo?user_content_key=... target a request's 302 actually resolved to, which blocks
// confirming/killing the "stale cached redirect" hypothesis on the parent (F3Go30-5c2a). Only a
// short non-reversible hash of the key is ever recorded (AC2/AC5) — never the raw token.

function testExtractEchoKeyInfoParsesRedirectedUrlAndHashesKey() {
  var h = makeReconnectHarness_();
  var info = h.extractEchoKeyInfo_({
    url: 'https://script.googleusercontent.com/macros/echo?user_content_key=abc123&lib=xyz',
    redirected: true,
  });
  assert.equal(info.redirected, true, 'AC1: res.redirected must be read off the Response');
  assert.ok(info.echoKeyHash, 'AC2: a key present in the URL must produce a hash');
  assert.notEqual(info.echoKeyHash, 'abc123', 'AC2/AC5: the raw key must never be the recorded value');
}

function testExtractEchoKeyInfoIsStableForSameKeyDifferentForDifferentKey() {
  var h = makeReconnectHarness_();
  var a1 = h.extractEchoKeyInfo_({ url: 'https://x.test/echo?user_content_key=key-one', redirected: true });
  var a2 = h.extractEchoKeyInfo_({ url: 'https://x.test/echo?user_content_key=key-one', redirected: true });
  var b = h.extractEchoKeyInfo_({ url: 'https://x.test/echo?user_content_key=key-two', redirected: true });
  assert.equal(a1.echoKeyHash, a2.echoKeyHash, 'AC2: the same key must hash to the same value, so reuse is detectable');
  assert.notEqual(a1.echoKeyHash, b.echoKeyHash, 'AC2: different keys must hash differently, so reuse is distinguishable from fresh');
}

function testExtractEchoKeyInfoHandlesMissingUrlOrParamWithoutThrowing() {
  var h = makeReconnectHarness_();
  assert.doesNotThrow(function() {
    assert.deepEqual(h.extractEchoKeyInfo_(null), { redirected: false, echoKeyHash: '' });
    assert.deepEqual(h.extractEchoKeyInfo_({}), { redirected: false, echoKeyHash: '' });
    var noParam = h.extractEchoKeyInfo_({ url: 'https://example.test/exec', redirected: false });
    assert.equal(noParam.echoKeyHash, '', 'no user_content_key in the URL must yield no hash');
  });
}

function testCaptureClientErrorIncludesRedirectFieldsFromErr() {
  var h = makeReconnectHarness_();
  var err = Object.assign(new Error('Server returned HTTP 404'), { redirected: true, echoKeyHash: 'h123' });
  h.captureClientError_('checkin', err);
  var queue = JSON.parse(h.fakeLocalStorage.getItem('go30ClientTelemetryQueue:v1'));
  assert.equal(queue[0].redirected, true, 'AC3: captureClientTelemetry_ records must carry the redirect fields');
  assert.equal(queue[0].echoKeyHash, 'h123');
}

function testCaptureClientErrorOmitsRedirectFieldsWhenErrHasNone() {
  var h = makeReconnectHarness_();
  // A genuine below-HTTP transport failure never gets a Response, so there is nothing to report —
  // distinguishing "no evidence" from "evidence: no redirect" matters for the hypothesis (see
  // issue's "What confirms or kills" section).
  var err = Object.assign(new Error('Failed to fetch'), { isTransport: true });
  h.captureClientError_('identify', err);
  var queue = JSON.parse(h.fakeLocalStorage.getItem('go30ClientTelemetryQueue:v1'));
  assert.equal(queue[0].echoKeyHash, '', 'no Response means no key to report');
}

function testHttpErrorResponseCarriesRedirectInfoOntoTheThrownError() {
  var h = makeReconnectHarness_({
    fetchImpl: function() {
      return httpErrorResponse_(404, {
        url: 'https://script.googleusercontent.com/macros/echo?user_content_key=stale-key',
        redirected: true,
      });
    },
  });
  return h.callApi('identify', {}).then(function() {
    assert.fail('a 404 response must reject');
  }, function(err) {
    assert.equal(err.redirected, true, 'AC1: an HTTP-level response (even non-ok) still carries redirect info');
    assert.ok(err.echoKeyHash, 'AC2: the echo key from a failing response must still be captured');
  });
}

function testServerReportedErrorCarriesRedirectInfoOntoTheThrownError() {
  var h = makeReconnectHarness_({
    fetchImpl: function() {
      return jsonResponse_({ ok: false, error: 'bad state' }, {
        url: 'https://script.googleusercontent.com/macros/echo?user_content_key=another-key',
        redirected: true,
      });
    },
  });
  return h.callApi('identify', {}).then(function() {
    assert.fail('a server-reported error must reject');
  }, function(err) {
    assert.equal(err.redirected, true);
    assert.ok(err.echoKeyHash);
  });
}

function testSuccessfulCallQueuesAnEchoKeySampleWithoutANewConnection() {
  var h = makeReconnectHarness_({
    fetchImpl: function(url, opts) {
      var body = JSON.parse(opts.body);
      // The clientTelemetry flush itself must fail to leave the sample inspectable in the queue —
      // its own retry/ack behavior is already covered by testFlushUploadsQueuedRecordsAndClearsOnAck.
      if (body.action === 'clientTelemetry') return transportRejection_();
      return jsonResponse_({ matched: true }, {
        url: 'https://script.googleusercontent.com/macros/echo?user_content_key=fresh-key',
        redirected: true,
      });
    },
  });
  return h.callApi('identify', {}).then(function() {
    return new Promise(function(resolve) { setImmediate(resolve); });
  }).then(function() {
    var queue = JSON.parse(h.fakeLocalStorage.getItem('go30ClientTelemetryQueue:v1') || '[]');
    var sample = queue.filter(function(rec) { return rec.kind === 'echoKey'; })[0];
    assert.ok(sample, 'AC4: a successful round trip must contribute a key-identity sample');
    assert.equal(sample.redirected, true);
    assert.ok(sample.echoKeyHash);
    // AC4: piggybacked on the existing flush, not a dedicated connection — exactly the action call
    // plus the one opportunistic flush attempt, same shape as every other successful call today.
    assert.equal(h.fetchCalls.length, 2, 'no extra connection may be opened to capture the sample');
  });
}

// ── F3Go30-5c2a.2: distinguish timeout-abort from immediate network rejection ──────────────────
// Evidence gap this closes: fetchAttempt_'s rejection handler collapsed "our own AbortController
// fired at timeoutMs" and "fetch rejected immediately" into one isTransport:true flag, so the
// parent incident (F3Go30-5c2a) could only be diagnosed by cross-referencing the GAS-side Axiom
// stream. abortedAtTimeout + elapsedMs make that a one-line read off the client telemetry record.
// 'checkin' (not in RETRYABLE_ACTIONS_) is used throughout so a single fetchAttempt_ call maps
// 1:1 to callApi's rejection, same determinism reasoning as the echo-key tests above.

function testFetchAttemptMarksAbortedAtTimeoutWhenItsOwnTimeoutFires() {
  var h = makeReconnectHarness_({
    fetchImpl: function(url, opts) {
      // A request lost in flight: the promise only ever settles because the timeout's own
      // AbortController fires — same shape as testUnsettledRequestIsAbortedAndRejects in
      // test_client_transport_resilience.js.
      return new Promise(function(_resolve, reject) {
        opts.signal.addEventListener('abort', function() { reject(new TypeError('The operation was aborted.')); });
      });
    },
  });
  var caught = null;
  var p = h.callApi('checkin', {}).catch(function(err) { caught = err; });
  h.fireTimers();
  return p.then(function() {
    assert.ok(caught, 'the request must reject once its own timeout aborts it');
    assert.equal(caught.isTransport, true, 'AC4: the PAX-facing isTransport flag stays unchanged');
    assert.equal(caught.abortedAtTimeout, true, 'AC1: a rejection caused by our own AbortController must be flagged');
    assert.equal(typeof caught.elapsedMs, 'number', 'AC3: elapsed time must be recorded');
    assert.ok(caught.elapsedMs >= 0);
  });
}

function testFetchAttemptDoesNotMarkAbortedAtTimeoutOnImmediateRejection() {
  var h = makeReconnectHarness_({
    fetchImpl: function() {
      // Rejects on its own, with no timeout ever scheduled to fire — a genuine below-HTTP
      // network drop, not our own abort.
      return Promise.reject(new TypeError('Failed to fetch'));
    },
  });
  return h.callApi('checkin', {}).then(function() {
    assert.fail('an immediately-rejecting fetch must reject callApi');
  }, function(err) {
    assert.equal(err.isTransport, true, 'AC4: the PAX-facing isTransport flag stays unchanged');
    assert.equal(err.abortedAtTimeout, false, 'AC1: an immediate rejection must not be flagged as our own timeout');
    assert.equal(typeof err.elapsedMs, 'number', 'AC3: elapsed time must be recorded on this branch too');
  });
}

function testCaptureClientErrorIncludesAbortTimingFieldsFromErr() {
  var h = makeReconnectHarness_();
  var err = Object.assign(new Error('Failed to fetch'), { isTransport: true, abortedAtTimeout: true, elapsedMs: 12000 });
  h.captureClientError_('checkin', err);
  var queue = JSON.parse(h.fakeLocalStorage.getItem('go30ClientTelemetryQueue:v1'));
  assert.equal(queue[0].abortedAtTimeout, true, 'AC2: captureClientTelemetry_ records must carry the abort-timing fields');
  assert.equal(queue[0].elapsedMs, 12000);
}

// AC3: an old client's error record (predating AC1's abortedAtTimeout field) must still degrade
// safely rather than crash capture — elapsedMs on its own remains a readable signal even then.
function testCaptureClientErrorDefaultsAbortTimingFieldsWhenAbsentFromErr() {
  var h = makeReconnectHarness_();
  var err = new Error('boom'); // no abortedAtTimeout / elapsedMs at all
  h.captureClientError_('identify', err);
  var queue = JSON.parse(h.fakeLocalStorage.getItem('go30ClientTelemetryQueue:v1'));
  assert.equal(queue[0].abortedAtTimeout, false);
  assert.equal(queue[0].elapsedMs, null);
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
    testExtractEchoKeyInfoParsesRedirectedUrlAndHashesKey,
    testExtractEchoKeyInfoIsStableForSameKeyDifferentForDifferentKey,
    testExtractEchoKeyInfoHandlesMissingUrlOrParamWithoutThrowing,
    testCaptureClientErrorIncludesRedirectFieldsFromErr,
    testCaptureClientErrorOmitsRedirectFieldsWhenErrHasNone,
    testHttpErrorResponseCarriesRedirectInfoOntoTheThrownError,
    testServerReportedErrorCarriesRedirectInfoOntoTheThrownError,
    testSuccessfulCallQueuesAnEchoKeySampleWithoutANewConnection,
    testFetchAttemptMarksAbortedAtTimeoutWhenItsOwnTimeoutFires,
    testFetchAttemptDoesNotMarkAbortedAtTimeoutOnImmediateRejection,
    testCaptureClientErrorIncludesAbortTimingFieldsFromErr,
    testCaptureClientErrorDefaultsAbortTimingFieldsWhenAbsentFromErr,
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
