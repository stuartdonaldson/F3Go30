const assert = require('node:assert/strict');
const { readStaticPage_ } = require('./helpers/staticPageExtract');

// F3Go30-833s.14: an installed PWA resumed from background keeps its page alive in memory — no
// pageshow.persisted fires (that only covers bfcache restore) — so without a resume hook a
// session parked all day never refetches pax data. This harness extracts the REAL
// silentResumeRefresh_ source (not a re-implementation) and executes it against minimal
// state/callApi/document/Date stand-ins, the same extraction pattern
// test_dashboard_stale_while_revalidate.js uses for revalidateDashboard_.
// (F3Go30-lem7: readStaticPage_ now shared via test/helpers/staticPageExtract.js.)

function extractResumeRefreshBlock_(src) {
  var startMarker = 'var RESUME_REFRESH_THROTTLE_MS_';
  var endMarker = "document.addEventListener('visibilitychange'";
  var startIdx = src.indexOf(startMarker);
  var midIdx = src.indexOf(endMarker);
  assert.ok(startIdx !== -1 && midIdx !== -1, 'resume-refresh block markers not found in index.html');
  var endIdx = src.indexOf('});', midIdx) + '});'.length;
  return src.slice(startIdx, endIdx);
}

function makeResumeHarness_(callApiImpl, opts) {
  opts = opts || {};
  var src = readStaticPage_();
  var body = extractResumeRefreshBlock_(src);

  var visHandlers = [];
  var fakeDocument = {
    visibilityState: opts.visibilityState || 'visible',
    addEventListener: function(evt, fn) { if (evt === 'visibilitychange') visHandlers.push(fn); },
  };

  var applyIdentifySuccessCalls = [];
  var applyServerConfigCalls = [];
  var signupReminderCalls = [];
  var reconcileCalls = [];
  var saveSnapshotCalls = [];
  var prefetchCallCount = 0;

  var fakeDate = { _now: opts.startNow || 0 };
  fakeDate.now = function() { return fakeDate._now; };

  var state = { checkinReady: opts.checkinReady !== false };

  var factory = new Function(
    'state', 'SAVED_IDENTITY_TOKEN', 'callApi', 'applyServerConfig_', 'applySignupReminderState_',
    'reconcileWithLocalWrites_', 'applyIdentifySuccess_', 'saveCheckinSnapshot_', 'prefetchDashboard_',
    'document', 'Date', 'requestGen_',
    body + '\nreturn { silentResumeRefresh_: silentResumeRefresh_ };'
  );
  var fns = factory(
    state,
    Object.prototype.hasOwnProperty.call(opts, 'token') ? opts.token : 'tok123',
    callApiImpl || function() { throw new Error('callApi should not have been called'); },
    function(cfg) { applyServerConfigCalls.push(cfg); },
    function(reminder) { signupReminderCalls.push(reminder); },
    function(res, issuedGen) { reconcileCalls.push(res); },
    function(res, o) { applyIdentifySuccessCalls.push({ res: res, opts: o }); },
    function(token, res) { saveSnapshotCalls.push({ token: token, res: res }); },
    function() { prefetchCallCount++; },
    fakeDocument,
    fakeDate,
    // F3Go30-os03 D5: silentResumeRefresh_ now does `++requestGen_` to capture this read's
    // issuedGen — a real (if here test-local) module-level counter, not part of what's under test.
    0
  );

  return {
    fns: fns,
    state: state,
    setNow: function(ms) { fakeDate._now = ms; },
    fireVisibilityChange: function(visibilityState) {
      fakeDocument.visibilityState = visibilityState;
      visHandlers.forEach(function(fn) { fn(); });
    },
    applyIdentifySuccessCalls: applyIdentifySuccessCalls,
    applyServerConfigCalls: applyServerConfigCalls,
    signupReminderCalls: signupReminderCalls,
    reconcileCalls: reconcileCalls,
    saveSnapshotCalls: saveSnapshotCalls,
    prefetchCallCount: function() { return prefetchCallCount; },
  };
}

// AC1: past the throttle window, a resume issues a silent identify refetch, reconciles through
// the same preserveView path the startup token-identify uses, and prefetches the dashboard.
(function testPastThrottleWindowRefreshesAndPrefetches() {
  var callApiCalls = [];
  var res = { matched: true, config: { appVersion: '9.9.9' }, f3Name: 'Test PAX' };
  var callApi = function(action, payload) {
    callApiCalls.push({ action: action, payload: payload });
    return Promise.resolve(res);
  };
  var h = makeResumeHarness_(callApi, { startNow: 0 });
  h.setNow(3 * 60 * 1000); // 3 min later, past the 2-min throttle

  h.fns.silentResumeRefresh_();
  return new Promise(function(r) { setImmediate(r); }).then(function() {
    return new Promise(function(r) { setImmediate(r); });
  }).then(function() {
    assert.equal(callApiCalls.length, 1, 'exactly one identify refetch must fire once past the throttle window');
    assert.equal(callApiCalls[0].action, 'identify');
    assert.equal(callApiCalls[0].payload.token, 'tok123');
    assert.equal(h.applyServerConfigCalls.length, 1, 'server config from the refreshed response must be applied');
    assert.equal(h.signupReminderCalls.length, 1, 'F3Go30-xyvs: the SignupReminder popup must be re-evaluated on every resume refresh, not just shown once and cached');
    assert.equal(h.reconcileCalls.length, 1, 'local writes must be reconciled onto the refreshed response');
    assert.equal(h.applyIdentifySuccessCalls.length, 1, 'the refreshed identify result must be applied');
    assert.equal(h.applyIdentifySuccessCalls[0].opts.preserveView, true,
      'must reconcile with preserveView so an open bonus form / calendar position is not clobbered (AC4)');
    assert.equal(h.saveSnapshotCalls.length, 1, 'the fresh snapshot must be persisted');
    assert.equal(h.prefetchCallCount(), 1, 'a dashboard prefetch must be issued alongside the refetch');
  });
})();

// AC2: a resume within the throttle window triggers nothing.
(function testWithinThrottleWindowTriggersNothing() {
  var callApiCallCount = 0;
  var callApi = function() { callApiCallCount++; return Promise.resolve({ matched: true }); };
  var h = makeResumeHarness_(callApi, { startNow: 0 });
  h.setNow(30 * 1000); // 30s later, well under the 2-min throttle

  h.fns.silentResumeRefresh_();

  assert.equal(callApiCallCount, 0, 'a resume inside the throttle window must not issue a refetch');
  assert.equal(h.prefetchCallCount(), 0);
})();

// AC3: a background refresh failure is swallowed silently — nothing throws, no apply/save/prefetch.
(function testFailedRefreshIsSwallowedSilently() {
  var callApi = function() { return Promise.reject(new Error('network down')); };
  var h = makeResumeHarness_(callApi, { startNow: 0 });
  h.setNow(3 * 60 * 1000);

  h.fns.silentResumeRefresh_();
  return new Promise(function(r) { setImmediate(r); }).then(function() {
    return new Promise(function(r) { setImmediate(r); });
  }).then(function() {
    assert.equal(h.applyIdentifySuccessCalls.length, 0, 'a failed refresh must not touch the current display');
    assert.equal(h.prefetchCallCount(), 0, 'a failed refresh must not trigger a dashboard prefetch');
  });
})();

// A revoked/stale token (matched:false) must also leave the current display untouched.
(function testUnmatchedTokenLeavesDisplayUntouched() {
  var callApi = function() { return Promise.resolve({ matched: false }); };
  var h = makeResumeHarness_(callApi, { startNow: 0 });
  h.setNow(3 * 60 * 1000);

  h.fns.silentResumeRefresh_();
  return new Promise(function(r) { setImmediate(r); }).then(function() {
    return new Promise(function(r) { setImmediate(r); });
  }).then(function() {
    assert.equal(h.applyIdentifySuccessCalls.length, 0, 'matched:false must not apply an identify result');
    assert.equal(h.saveSnapshotCalls.length, 0);
    assert.equal(h.prefetchCallCount(), 0);
  });
})();

// Not yet checked in (identity never resolved this pageview) — nothing to refresh.
(function testNotCheckinReadyTriggersNothing() {
  var callApiCallCount = 0;
  var callApi = function() { callApiCallCount++; return Promise.resolve({ matched: true }); };
  var h = makeResumeHarness_(callApi, { startNow: 0, checkinReady: false });
  h.setNow(3 * 60 * 1000);

  h.fns.silentResumeRefresh_();

  assert.equal(callApiCallCount, 0, 'no token-identify session yet resolved means nothing to refresh');
})();

// No saved identity token — nothing to refresh against.
(function testNoTokenTriggersNothing() {
  var callApiCallCount = 0;
  var callApi = function() { callApiCallCount++; return Promise.resolve({ matched: true }); };
  var h = makeResumeHarness_(callApi, { startNow: 0, token: null });
  h.setNow(3 * 60 * 1000);

  h.fns.silentResumeRefresh_();

  assert.equal(callApiCallCount, 0);
})();

// The visibilitychange listener only fires the refresh when the page becomes visible, not when
// it goes hidden — and is wired to the real silentResumeRefresh_, not a copy.
(function testVisibilityChangeListenerOnlyFiresOnVisible() {
  var callApiCallCount = 0;
  var callApi = function() { callApiCallCount++; return Promise.resolve({ matched: true }); };
  var h = makeResumeHarness_(callApi, { startNow: 0 });
  h.setNow(3 * 60 * 1000);

  h.fireVisibilityChange('hidden');
  assert.equal(callApiCallCount, 0, 'going hidden must not trigger a refresh');

  h.fireVisibilityChange('visible');
  assert.equal(callApiCallCount, 1, 'becoming visible past the throttle window must trigger exactly one refresh');
})();

console.log('test_session_resume_refresh.js: all assertions passed');
