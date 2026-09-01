const assert = require('node:assert/strict');
const { readStaticPage_ } = require('./helpers/staticPageExtract');

// F3Go30-833s.13: dashboardBtn used to be cache-or-wait, not cache-then-update — a cached month
// payload for today rendered instantly ONLY when no prefetch was in flight, then returned with no
// revalidation ever; when a prefetch WAS in flight it showed a blocking "Loading…" button instead
// of the cached copy. The fix always renders the cached copy first, then revalidates (chaining
// onto an in-flight prefetch, or firing a silent fetch of its own) and re-renders in place on
// arrival. This harness extracts the REAL source (not a re-implementation) and executes it against
// minimal $/callApi/renderDashboard_ stand-ins, the same pattern test_static_page_client_
// invariants.js's cal-nav harness uses for k5fn.3.
// (F3Go30-lem7: readStaticPage_ now shared via test/helpers/staticPageExtract.js.)

function extractDashboardBtnHandlerBody_(src) {
  var startMarker = "$('dashboardBtn').addEventListener('click', function() {";
  var endMarker = "$('dMonthProgressTile').addEventListener";
  var startIdx = src.indexOf(startMarker);
  var endIdx = src.indexOf(endMarker);
  assert.ok(startIdx !== -1 && endIdx !== -1, 'dashboardBtn click handler markers not found in index.html');
  return src.slice(startIdx, endIdx);
}

function extractLoadRevalidateBlock_(src) {
  var startMarker = 'function loadDashboard_(dateISO, opts) {';
  var endMarker = 'function navigateDashboard_(deltaDays) {';
  var startIdx = src.indexOf(startMarker);
  var endIdx = src.indexOf(endMarker);
  assert.ok(startIdx !== -1 && endIdx !== -1, 'loadDashboard_/revalidateDashboard_ block markers not found in index.html');
  return src.slice(startIdx, endIdx);
}

function extractPullToRefreshBlock_(src) {
  var startMarker = '(function initDashboardPullToRefresh_() {';
  var startIdx = src.indexOf(startMarker);
  assert.ok(startIdx !== -1, 'initDashboardPullToRefresh_ not found in index.html');
  var endIdx = src.indexOf('})();', startIdx) + '})();'.length;
  return src.slice(startIdx, endIdx);
}

// Builds a same-realm harness (via `Function`, matching the cal-nav precedent) wiring the real
// loadDashboard_/revalidateDashboard_/dashboardBtn-handler source against fakes for the DOM/network
// seams (renderDashboard_, callApi, $ elements) — none of those are under test here.
function makeDashboardHarness_(state, callApiImpl) {
  var elements = {};
  function fakeEl_(id) {
    if (!elements[id]) {
      var handlers = {};
      elements[id] = {
        disabled: false, textContent: '',
        addEventListener: function(evt, fn) { handlers[evt] = handlers[evt] || []; handlers[evt].push(fn); },
        trigger: function(evt, e) { (handlers[evt] || []).forEach(function(fn) { fn(e); }); },
      };
    }
    return elements[id];
  }
  var renderCalls = [];
  var renderDashboard_ = function(d, dayIndex) { renderCalls.push({ d: d, dayIndex: dayIndex }); };
  var setButtonLoadingCalls = [];
  var setButtonLoading_ = function(btn, isLoading, text) { setButtonLoadingCalls.push({ isLoading: isLoading, text: text }); };

  var src = readStaticPage_();
  var body = extractDashboardBtnHandlerBody_(src) + '\n' + extractLoadRevalidateBlock_(src);
  var factory = new Function(
    'state', '$', 'callApi', 'renderDashboard_', 'setButtonLoading_', 'hideApiError_', 'showApiError_',
    'isoDate_', 'monthKeyOf_', 'patchOwnDayIntoPayload_', 'renderDateNav_',
    // The dashboardBtn block is a bare $('dashboardBtn').addEventListener(...) statement, not a
    // named function — running it registers the real click handler onto the fake $ element below,
    // which the test then triggers directly rather than trying to name-bind an anonymous function.
    body + '\nreturn { loadDashboard_: loadDashboard_, prefetchDashboard_: prefetchDashboard_, revalidateDashboard_: revalidateDashboard_ };'
  );
  var fns = factory(
    state, fakeEl_,
    callApiImpl || function() { throw new Error('callApi should not have been called'); },
    renderDashboard_, setButtonLoading_,
    function() {}, function() {},
    function(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); },
    function(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); },
    function(payload, dateIso, value) { /* no pending writes exercised in these tests */ },
    function() {}
  );
  return { fns: fns, elements: elements, renderCalls: renderCalls, setButtonLoadingCalls: setButtonLoadingCalls };
}

function todayIso_() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function monthKey_() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function baseState_(cachedForToday) {
  var state = {
    f3Name: 'Test PAX', email: 'test@example.com', resolvedContext: null,
    board: {}, pendingSelfWrites: {}, viewDate: new Date(),
    dashboardLoading: false, dashboardPrefetchPromise: null, currentStep: 'dashboard',
  };
  if (cachedForToday) {
    state.board[monthKey_()] = { monthKey: monthKey_(), dayDates: [todayIso_()], viewDayIndex: 0 };
  }
  return state;
}

// AC 1/2: a cached copy for today renders INSTANTLY even when a prefetch is in flight (the old
// bug rendered nothing and showed a blocking Loading… button in this exact case), and a
// revalidation fetch is issued (chained onto that same in-flight prefetch, not a duplicate one).
(function testCachedTodayRendersInstantlyEvenWithPrefetchInFlightAndChainsRevalidation() {
  var state = baseState_(true);
  var callApiCallCount = 0;
  var resolvePrefetch;
  var callApi = function() {
    callApiCallCount++;
    return new Promise(function(resolve) { resolvePrefetch = resolve; });
  };
  var h = makeDashboardHarness_(state, callApi);
  // Simulate an in-flight prefetch the way prefetchDashboard_ would have set it up.
  var prefetchPromise = h.fns.loadDashboard_(undefined, { silent: true });
  state.dashboardPrefetchPromise = prefetchPromise;

  h.elements.dashboardBtn.trigger('click');

  assert.equal(h.renderCalls.length, 1, 'cached copy must render instantly on click');
  assert.equal(h.setButtonLoadingCalls.length, 0, 'the blocking Loading… button state must not fire when a cached copy exists');
  assert.equal(callApiCallCount, 1, 'revalidation must chain onto the existing in-flight prefetch, not fire a second fetch');

  resolvePrefetch({ monthKey: monthKey_(), dayDates: [todayIso_()], viewDayIndex: 0 });
  return prefetchPromise.then(function() {
    return new Promise(function(r) { setImmediate(r); });
  }).then(function() {
    assert.equal(h.renderCalls.length, 2, 'revalidation result must re-render in place once the chained prefetch resolves');
  });
})();

// AC1: no prefetch in flight — cached copy still renders instantly and a fresh silent revalidation
// fetch is fired (proves revalidation isn't dependent on a prefetch having been started at all).
(function testCachedTodayWithNoPrefetchInFlightStillRevalidates() {
  var state = baseState_(true);
  var callApiCallCount = 0;
  var callApi = function() { callApiCallCount++; return Promise.resolve({ monthKey: monthKey_(), dayDates: [todayIso_()], viewDayIndex: 0 }); };
  var h = makeDashboardHarness_(state, callApi);

  h.elements.dashboardBtn.trigger('click');

  assert.equal(h.renderCalls.length, 1, 'cached copy must render instantly');
  assert.equal(h.setButtonLoadingCalls.length, 0, 'no blocking Loading… state when a cached copy exists');
  assert.equal(callApiCallCount, 1, 'a revalidation fetch must be issued even with no prior prefetch');
})();

// Regression guard: with nothing cached at all, the blocking Loading… path is still the only
// option (there is nothing to render instantly) — AC2 only removes the blocking path for the
// cached case, not this one.
(function testNoCacheAtAllStillBlocksOnLoading() {
  var state = baseState_(false);
  var callApi = function() { return Promise.resolve({ monthKey: monthKey_(), dayDates: [todayIso_()], viewDayIndex: 0 }); };
  var h = makeDashboardHarness_(state, callApi);

  h.elements.dashboardBtn.trigger('click');

  assert.ok(h.setButtonLoadingCalls.length >= 1 && h.setButtonLoadingCalls[0].isLoading === true,
    'with no cached payload for today, the button must still show a blocking Loading… state');
})();

// F3Go30-e4r0: revalidateDashboard_'s background re-render used to fire unconditionally once its
// silent fetch resolved, with no check on whether the PAX was still even looking at the
// Dashboard step — reproduced live (SepTest, 2026-09-01): opening Scorecard shortly after
// Dashboard got silently bounced back to Dashboard a few seconds later, once a revalidation
// kicked off by the earlier dashboardBtn click finally resolved. Fix: only repaint (and thus
// showStep('dashboard') via renderDashboard_) when state.currentStep is still 'dashboard' at
// resolve time — the same guard repaintCurrentView_ already uses for the reconnect-poll's silent
// repaint ("by the time a poll succeeds the PAX may have navigated on, and repainting a hidden
// view would be wasted work").
(function testRevalidateDoesNotBouncePaxBackToDashboardOnceTheyHaveNavigatedAway() {
  var state = baseState_(true);
  var resolveFetch;
  var callApi = function() { return new Promise(function(resolve) { resolveFetch = resolve; }); };
  var h = makeDashboardHarness_(state, callApi);

  h.elements.dashboardBtn.trigger('click');
  assert.equal(h.renderCalls.length, 1, 'cached copy still renders instantly on click');

  // The PAX navigates to Scorecard before the background revalidation resolves.
  state.currentStep = 'scorecard';
  resolveFetch({ monthKey: monthKey_(), dayDates: [todayIso_()], viewDayIndex: 0 });

  return new Promise(function(r) { setImmediate(r); }).then(function() {
    assert.equal(h.renderCalls.length, 1,
      'AC1/AC2: revalidation must not repaint (and so must not showStep back to dashboard) once the PAX has navigated away');
  });
})();

// AC3: unchanged behavior — a PAX who IS still on the Dashboard step when the revalidation
// resolves still gets the stale-while-revalidate repaint-in-place.
(function testRevalidateStillRepaintsInPlaceWhenPaxIsStillOnDashboard() {
  var state = baseState_(true);
  var resolveFetch;
  var callApi = function() { return new Promise(function(resolve) { resolveFetch = resolve; }); };
  var h = makeDashboardHarness_(state, callApi);

  h.elements.dashboardBtn.trigger('click');
  assert.equal(h.renderCalls.length, 1);

  resolveFetch({ monthKey: monthKey_(), dayDates: [todayIso_()], viewDayIndex: 0 });

  return new Promise(function(r) { setImmediate(r); }).then(function() {
    assert.equal(h.renderCalls.length, 2, 'AC3: still repaints in place when the PAX is still on dashboard');
  });
})();

// ── Pull-to-refresh (AC4): a downward pull past threshold at scrollTop 0 triggers revalidation, ──
//    never a page reload — extracted and executed against the real source.

(function testPullToRefreshTriggersRevalidationNotReload() {
  var src = readStaticPage_();
  var block = extractPullToRefreshBlock_(src);
  assert.doesNotMatch(block, /location\.reload/, 'pull-to-refresh must not trigger a page reload');
  assert.match(block, /revalidateDashboard_\(\)/, 'pull-to-refresh must call revalidateDashboard_()');

  var elements = {};
  function fakeEl_(id) {
    if (!elements[id]) {
      var handlers = {};
      elements[id] = {
        addEventListener: function(evt, fn) { handlers[evt] = handlers[evt] || []; handlers[evt].push(fn); },
        trigger: function(evt, e) { (handlers[evt] || []).forEach(function(fn) { fn(e); }); },
      };
    }
    return elements[id];
  }
  var revalidateCalls = 0;
  var fakeDoc = { scrollingElement: { scrollTop: 0 }, documentElement: { scrollTop: 0 } };
  var factory = new Function('$', 'revalidateDashboard_', 'document', block);
  factory(fakeEl_, function() { revalidateCalls++; }, fakeDoc);

  var step = elements['step-dashboard'];
  step.trigger('touchstart', { touches: [{ clientY: 0 }] });
  step.trigger('touchmove', { touches: [{ clientY: 100 }] }); // past the 70px threshold
  step.trigger('touchend');
  assert.equal(revalidateCalls, 1, 'a pull past the threshold at scrollTop 0 must call revalidateDashboard_ exactly once');

  revalidateCalls = 0;
  step.trigger('touchstart', { touches: [{ clientY: 0 }] });
  step.trigger('touchmove', { touches: [{ clientY: 20 }] }); // under threshold
  step.trigger('touchend');
  assert.equal(revalidateCalls, 0, 'a short pull under the threshold must not trigger revalidation');

  revalidateCalls = 0;
  fakeDoc.scrollingElement.scrollTop = 50; // not at the top — a normal scroll, not pull-to-refresh
  step.trigger('touchstart', { touches: [{ clientY: 0 }] });
  step.trigger('touchmove', { touches: [{ clientY: 100 }] });
  step.trigger('touchend');
  assert.equal(revalidateCalls, 0, 'a pull that does not start at scrollTop 0 must not trigger revalidation');
})();

console.log('test_dashboard_stale_while_revalidate.js: all assertions passed');
