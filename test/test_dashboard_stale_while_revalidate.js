const assert = require('node:assert/strict');
const { readStaticPage_, extractLoadDashboardBlock_, extractBoardAccessor_, extractLocalStorageBlock_, extractFunction_, makeFakeLocalStorage_ } = require('./helpers/staticPageExtract');

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
function makeDashboardHarness_(state, callApiImpl, opts) {
  opts = opts || {};
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
  var telemetry = [];
  var renderDashboard_ = function(d, dayIndex) { renderCalls.push({ d: d, dayIndex: dayIndex }); };
  var setButtonLoadingCalls = [];
  var setButtonLoading_ = function(btn, isLoading, text) { setButtonLoadingCalls.push({ isLoading: isLoading, text: text }); };

  var src = readStaticPage_();
  var body = extractBoardAccessor_(src) + '\n' + extractLocalStorageBlock_(src) + '\n' +
    // F3Go30-8naq.3: the persisted dashboard-board cache (real source) and the write path that feeds it
    ['boardCacheOwner_', 'persistBoardCache_', 'hydrateBoardFromCache_', 'noteBoardOrigin_', 'captureDashboardPaint_', 'dashboardBoardForPaint_', 'patchOwnDayIntoPayload_', 'applyOwnDayWrite_', 'parseIsoDate_']
      .map(function(n) { return extractFunction_(src, n); }).join('\n') + '\n' +
    extractFunction_(src, 'navigateDashboard_') + '\n' +
    extractDashboardBtnHandlerBody_(src) + '\n' + extractLoadDashboardBlock_(src);
  var factory = new Function(
    'state', '$', 'callApi', 'renderDashboard_', 'setButtonLoading_', 'hideApiError_', 'showApiError_',
    'isoDate_', 'monthKeyOf_', 'renderDateNav_', 'captureDashboardRenderTelemetry_',
    'requestGen_', 'reconcileDashboardWithLocalWrites_', 'restoreWiderBoardDayFacts_',
    'contextToday_', 'contextTodayIso_', 'localStorage', 'SAVED_IDENTITY_TOKEN', 'clearTokenFromStorage_',
    'captureClientTelemetry_', // F3Go30-8naq.5: paint-source / facet-miss records land in h.telemetry
    // The dashboardBtn block is a bare $('dashboardBtn').addEventListener(...) statement, not a
    // named function — running it registers the real click handler onto the fake $ element below,
    // which the test then triggers directly rather than trying to name-bind an anonymous function.
    body + '\nreturn { hydrateBoardFromCache_: hydrateBoardFromCache_, persistBoardCache_: persistBoardCache_, applyOwnDayWrite_: applyOwnDayWrite_, clearCheckinSnapshot_: clearCheckinSnapshot_, boardRecord_: boardRecord_, navigateDashboard_: navigateDashboard_, loadDashboard_: loadDashboard_, prefetchDashboard_: prefetchDashboard_, revalidateDashboard_: revalidateDashboard_ };'
  );
  var fns = factory(
    state, fakeEl_,
    callApiImpl || function() { throw new Error('callApi should not have been called'); },
    renderDashboard_, setButtonLoading_,
    function() {}, function() {},
    function(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); },
    function(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); },
    function() {},
    // F3Go30-5p3z: telemetry capture is exercised by its own dedicated test — a no-op stand-in
    // here keeps this harness scoped to stale-while-revalidate behavior.
    function() {},
    // F3Go30-jsrf: requestGen_/reconcileDashboardWithLocalWrites_/restoreWiderBoardDayFacts_ are
    // exercised by their own dedicated tests (test_checkin_board_consolidation.js) — no-op
    // stand-ins here keep this harness scoped to stale-while-revalidate behavior.
    0, function() {}, function() {},
    // F3Go30-f3fa: this harness never sets a CONTEXT_DATE_ override — real device clock, same as
    // the isoDate_/monthKeyOf_ stand-ins above, so behavior here is unchanged by the context-clock
    // fix (that override path is covered by test_static_page_client_invariants.js's source guard
    // and the context-date-dashboard live-check spec, not this harness).
    function() { return new Date(); }, todayIso_,
    opts.localStorage || makeFakeLocalStorage_(),
    Object.prototype.hasOwnProperty.call(opts, 'token') ? opts.token : 'tokA',
    function() {},
    function(kind, action, extra) { telemetry.push({ kind: kind, action: action, ctx: (extra && extra.ctx) || null }); }
  );
  return { telemetry: telemetry, fns: fns, elements: elements, renderCalls: renderCalls, setButtonLoadingCalls: setButtonLoadingCalls };
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
    // a full dashboard-facet record: carries paxBoard, which only a dashboard payload does
    state.board[monthKey_()] = { monthKey: monthKey_(), dayDates: [todayIso_()], viewDayIndex: 0, paxBoard: [] };
  }
  return state;
}

// F3Go30-8naq.1: a record planted by identify's patchBoardDayFacts_ — day facts only, no paxBoard.
function dayFactsOnlyState_() {
  var state = baseState_(false);
  state.board[monthKey_()] = { monthKey: monthKey_(), dayDates: [todayIso_()], dayValues: [null] };
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

  resolvePrefetch({ monthKey: monthKey_(), dayDates: [todayIso_()], viewDayIndex: 0, paxBoard: [] });
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
  var callApi = function() { callApiCallCount++; return Promise.resolve({ monthKey: monthKey_(), dayDates: [todayIso_()], viewDayIndex: 0, paxBoard: [] }); };
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
  var callApi = function() { return Promise.resolve({ monthKey: monthKey_(), dayDates: [todayIso_()], viewDayIndex: 0, paxBoard: [] }); };
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
  resolveFetch({ monthKey: monthKey_(), dayDates: [todayIso_()], viewDayIndex: 0, paxBoard: [] });

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

  resolveFetch({ monthKey: monthKey_(), dayDates: [todayIso_()], viewDayIndex: 0, paxBoard: [] });

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

// ── F3Go30-8naq.1: facet-aware board accessor + no render from a day-facts-only record ──

(function testBoardRecordFacets() {
  var mk = monthKey_();
  var h = makeDashboardHarness_(dayFactsOnlyState_());
  assert.ok(h.fns.boardRecord_(mk, 'dayFacts'), 'day-facts record satisfies the dayFacts facet');
  assert.equal(h.fns.boardRecord_(mk, 'dashboard'), null, 'day-facts record is a MISS for the dashboard facet');
  assert.equal(h.fns.boardRecord_('1999-01', 'dayFacts'), null, 'absent record is a miss');
  var full = baseState_(true);
  h = makeDashboardHarness_(full);
  assert.ok(h.fns.boardRecord_(mk, 'dashboard'), 'a record carrying paxBoard satisfies the dashboard facet');
  assert.throws(function() { h.fns.boardRecord_(mk, 'nope'); }, /facet/, 'an undeclared facet is a programming error, not a silent miss');
})();

// AC1: dashboardBtn must not render a day-facts-only record; it shows Loading… and renders only
// once a dashboard payload lands.
(function testDashboardBtnDoesNotRenderDayFactsOnlyRecord() {
  var state = dayFactsOnlyState_();
  var resolveFetch;
  var callApi = function() { return new Promise(function(resolve) { resolveFetch = resolve; }); };
  var h = makeDashboardHarness_(state, callApi);
  h.elements.dashboardBtn.trigger('click');
  assert.equal(h.renderCalls.length, 0, 'AC1: must not paint from a day-facts-only record');
  assert.ok(h.setButtonLoadingCalls.length >= 1 && h.setButtonLoadingCalls[0].isLoading === true, 'AC1: shows the loading state');
  resolveFetch({ monthKey: monthKey_(), dayDates: [todayIso_()], viewDayIndex: 0, paxBoard: [] });
  return new Promise(function(r) { setImmediate(r); }).then(function() {
    return new Promise(function(r) { setImmediate(r); });
  }).then(function() {
    assert.equal(h.renderCalls.length, 1, 'AC1: renders once the dashboard payload lands');
    assert.ok(Array.isArray(h.renderCalls[0].d.paxBoard));
  });
})();

// AC1 (chained): with a prefetch in flight that resolves, the click chains onto it and renders the
// landed dashboard payload, not the day-facts record.
(function testDashboardBtnChainsOntoInFlightPrefetch() {
  var state = dayFactsOnlyState_();
  var callApiCount = 0, resolveFetch;
  var callApi = function() { callApiCount++; return new Promise(function(resolve) { resolveFetch = resolve; }); };
  var h = makeDashboardHarness_(state, callApi);
  state.dashboardPrefetchPromise = h.fns.loadDashboard_(undefined, { silent: true });
  h.elements.dashboardBtn.trigger('click');
  assert.equal(h.renderCalls.length, 0);
  resolveFetch({ monthKey: monthKey_(), dayDates: [todayIso_()], viewDayIndex: 0, paxBoard: [] });
  return state.dashboardPrefetchPromise.then(function() {
    return new Promise(function(r) { setImmediate(r); });
  }).then(function() {
    assert.equal(callApiCount, 1, 'chained onto the prefetch, no duplicate fetch');
    assert.equal(h.renderCalls.length, 1);
    assert.ok(Array.isArray(h.renderCalls[0].d.paxBoard));
  });
})();

// AC2: revalidateDashboard_ never renders a record lacking the dashboard facet.
(function testRevalidateDoesNotRenderDayFactsOnlyRecord() {
  var state = dayFactsOnlyState_();
  // a fetch that "lands" without replacing the record (e.g. error path resolved silently)
  var callApi = function() { return Promise.resolve(null).then(function() { throw new Error('boom'); }); };
  var h = makeDashboardHarness_(state, callApi);
  h.fns.revalidateDashboard_();
  return new Promise(function(r) { setImmediate(r); }).then(function() {
    assert.equal(h.renderCalls.length, 0, 'AC2: revalidate must not paint a day-facts-only record');
  });
})();

// AC2: navigateDashboard_ fetches instead of rendering a day-facts-only record.
(function testNavigateDashboardFetchesWhenOnlyDayFacts() {
  var state = dayFactsOnlyState_();
  state.viewDate = new Date();
  var calls = [];
  var callApi = function(action, p) { calls.push(p.dateISO); return new Promise(function() {}); };
  var h = makeDashboardHarness_(state, callApi);
  // the record for the target day's month exists (day facts only) but lacks the dashboard facet
  h.fns.navigateDashboard_(-1);
  assert.equal(h.renderCalls.length, 0, 'AC2: navigate must not render from a day-facts-only record');
  assert.equal(calls.length, 1, 'AC2: navigate fetches instead');
})();

// ── F3Go30-8naq.3: the current month's dashboard board persists to localStorage ──────────────

var BOARD_KEY_ = 'go30DashboardBoard:v1';
function dashboardPayload_(extra) {
  return Object.assign({ monthKey: monthKey_(), dayDates: [todayIso_()], dayValues: [null], viewDayIndex: 0, paxBoard: [{ team: 'Red', members: [] }] }, extra || {});
}
function tick_() { return new Promise(function(r) { setImmediate(r); }); }

// AC1 (+ AC3/AC4 gate): after a dashboard loaded once, a fresh page (empty state.board, network
// stalled) hydrates the persisted record and Dashboard renders at once - no Loading... button.
(function testReloadRendersDashboardFromPersistedRecordWithNetworkStalled() {
  var ls = makeFakeLocalStorage_();
  // page 1: a dashboard load persists the record
  var h1 = makeDashboardHarness_(baseState_(false), function() { return Promise.resolve(dashboardPayload_()); }, { localStorage: ls });
  return h1.fns.loadDashboard_(undefined, { silent: true }).then(function() {
    assert.ok(ls.getItem(BOARD_KEY_), 'loadDashboard_ success persists the current-month board');
    // page 2: cold launch, network never answers
    var state2 = baseState_(false);
    var h2 = makeDashboardHarness_(state2, function() { return new Promise(function() {}); }, { localStorage: ls });
    h2.fns.hydrateBoardFromCache_();
    assert.ok(h2.fns.boardRecord_(monthKey_(), 'dashboard'), 'hydrated as a dashboard-facet record');
    h2.elements.dashboardBtn.trigger('click');
    assert.equal(h2.renderCalls.length, 1, 'AC1: renders immediately from the persisted record');
    assert.equal(h2.setButtonLoadingCalls.length, 0, 'AC1: no Loading... button');
  });
})();

// AC2: a check-in made after the dashboard loaded is reflected in the persisted record.
(function testCheckinAfterLoadIsPersisted() {
  var ls = makeFakeLocalStorage_();
  var state = baseState_(false);
  var h = makeDashboardHarness_(state, function() { return Promise.resolve(dashboardPayload_()); }, { localStorage: ls });
  return h.fns.loadDashboard_(undefined, { silent: true }).then(function() {
    h.fns.applyOwnDayWrite_(todayIso_(), 1);
    var env = JSON.parse(ls.getItem(BOARD_KEY_));
    assert.deepEqual(env.value.dayValues, [1], 'applyOwnDayWrite_ re-persists the patched record');
    var state2 = baseState_(false);
    var h2 = makeDashboardHarness_(state2, null, { localStorage: ls });
    h2.fns.hydrateBoardFromCache_();
    assert.deepEqual(state2.board[monthKey_()].dayValues, [1], 'a reload shows the check-in');
  });
})();

// AC3: never hydrate one PAX's cache for another; logout / not-you clears it.
(function testPersistedRecordIsIdentityBound() {
  var ls = makeFakeLocalStorage_();
  var hX = makeDashboardHarness_(baseState_(false), function() { return Promise.resolve(dashboardPayload_()); }, { localStorage: ls, token: 'tokX' });
  return hX.fns.loadDashboard_(undefined, { silent: true }).then(function() {
    var stateY = baseState_(false);
    var hY = makeDashboardHarness_(stateY, null, { localStorage: ls, token: 'tokY' });
    hY.fns.hydrateBoardFromCache_();
    assert.equal(stateY.board[monthKey_()], undefined, 'PAX Y must not see PAX X\'s cache');
    var stateNone = baseState_(false);
    makeDashboardHarness_(stateNone, null, { localStorage: ls, token: null }).fns.hydrateBoardFromCache_();
    assert.equal(stateNone.board[monthKey_()], undefined, 'no identity, no hydrate');
    hX.fns.clearCheckinSnapshot_();
    assert.equal(ls.getItem(BOARD_KEY_), null, 'logout / not-you clears the persisted board');
  });
})();

(function testNameEmailBindingWhenNoToken() {
  var ls = makeFakeLocalStorage_();
  var a = baseState_(false); a.f3Name = 'Alice'; a.email = 'a@x.org';
  var hA = makeDashboardHarness_(a, function() { return Promise.resolve(dashboardPayload_()); }, { localStorage: ls, token: null });
  return hA.fns.loadDashboard_(undefined, { silent: true }).then(function() {
    assert.ok(ls.getItem(BOARD_KEY_), 'persisted under the f3Name+email binding');
    var same = baseState_(false); same.f3Name = 'alice'; same.email = 'A@X.org';
    makeDashboardHarness_(same, null, { localStorage: ls, token: null }).fns.hydrateBoardFromCache_();
    assert.ok(same.board[monthKey_()], 'same PAX (case-insensitive) hydrates');
    var other = baseState_(false); other.f3Name = 'Bob'; other.email = 'a@x.org';
    makeDashboardHarness_(other, null, { localStorage: ls, token: null }).fns.hydrateBoardFromCache_();
    assert.equal(other.board[monthKey_()], undefined, 'a different f3Name must not hydrate');
  });
})();

// AC4: a record from a prior month, or past the TTL, is ignored; only the current month persists.
(function testPriorMonthAndTtlAreIgnored() {
  var ls = makeFakeLocalStorage_();
  var h = makeDashboardHarness_(baseState_(false), function() { return Promise.resolve(dashboardPayload_()); }, { localStorage: ls });
  return h.fns.loadDashboard_(undefined, { silent: true }).then(function() {
    var env = JSON.parse(ls.getItem(BOARD_KEY_));
    env.value.monthKey = '1999-01';
    ls.setItem(BOARD_KEY_, JSON.stringify(env));
    var s1 = baseState_(false);
    makeDashboardHarness_(s1, null, { localStorage: ls }).fns.hydrateBoardFromCache_();
    assert.equal(s1.board[monthKey_()], undefined, 'a prior-month record is ignored');
    env.value.monthKey = monthKey_();
    env.savedAt -= 15 * 24 * 60 * 60 * 1000;
    ls.setItem(BOARD_KEY_, JSON.stringify(env));
    var s2 = baseState_(false);
    makeDashboardHarness_(s2, null, { localStorage: ls }).fns.hydrateBoardFromCache_();
    assert.equal(s2.board[monthKey_()], undefined, 'a record past CHECKIN_SNAPSHOT_TTL_MS_ is ignored');
  });
})();

(function testOnlyCurrentMonthIsPersistedAndNeverOverwritesLiveBoard() {
  var ls = makeFakeLocalStorage_();
  var other = dashboardPayload_({ monthKey: '1999-01' });
  var h = makeDashboardHarness_(baseState_(false), function() { return Promise.resolve(other); }, { localStorage: ls });
  return h.fns.loadDashboard_('1999-01-05', { silent: true }).then(function() {
    assert.equal(ls.getItem(BOARD_KEY_), null, 'a non-current-month dashboard is not persisted');
    var live = baseState_(true);
    var liveRec = live.board[monthKey_()];
    var ls2 = makeFakeLocalStorage_();
    ls2.setItem(BOARD_KEY_, JSON.stringify({ savedAt: Date.now(), owner: 'token:tokA', value: dashboardPayload_() }));
    makeDashboardHarness_(live, null, { localStorage: ls2 }).fns.hydrateBoardFromCache_();
    assert.equal(live.board[monthKey_()], liveRec, 'hydrate never replaces a live dashboard record');
  });
})();

// AC6: storage throwing / quota exceeded never breaks load or render.
(function testStorageFailuresNeverBreakLoadOrHydrate() {
  var bad = makeFakeLocalStorage_({ throwOnSet: true });
  var state = baseState_(false);
  var h = makeDashboardHarness_(state, function() { return Promise.resolve(dashboardPayload_()); }, { localStorage: bad });
  return h.fns.loadDashboard_(undefined, { silent: true }).then(function() {
    assert.ok(state.board[monthKey_()], 'quota-exceeded write is swallowed; the load still lands');
    bad.getItem = function() { throw new Error('SecurityError'); };
    h.fns.hydrateBoardFromCache_();
  });
})();

// ── F3Go30-8naq.5: paint-source telemetry — where each Dashboard paint came from ─────────────

function paints_(h) { return h.telemetry.filter(function(t) { return t.kind === 'dashboardRender' && t.action === 'paint'; }); }

// AC1/AC2: a hydrated record painted from the dashboard button reports 'persisted' with its age;
// the same record painted again this pageview reports 'memory'. Each paint emits exactly one record.
(function testHydratedPaintIsPersistedThenMemory() {
  var ls = makeFakeLocalStorage_();
  ls.setItem(BOARD_KEY_, JSON.stringify({ savedAt: Date.now() - 5000, owner: 'token:tokA', value: dashboardPayload_() }));
  var h = makeDashboardHarness_(baseState_(false), function() { return new Promise(function() {}); }, { localStorage: ls });
  h.fns.hydrateBoardFromCache_();
  h.elements.dashboardBtn.trigger('click');
  var first = paints_(h);
  assert.equal(first.length, 1, 'AC1: one record for the cache-hit paint');
  assert.equal(first[0].ctx.paintSource, 'persisted', 'AC2: hydrated-then-painted is persisted');
  assert.ok(first[0].ctx.cacheAgeMs >= 5000 && first[0].ctx.cacheAgeMs < 60000, 'AC1: cacheAgeMs is the persisted record age, got ' + first[0].ctx.cacheAgeMs);
  h.elements.dashboardBtn.trigger('click');
  var second = paints_(h);
  assert.equal(second.length, 2, 'AC1: one more record for the second paint');
  assert.equal(second[1].ctx.paintSource, 'memory', 'AC2: same-pageview hit is memory');
  assert.equal(typeof second[1].ctx.cacheAgeMs, 'number');
})();

// AC1: a record loaded off the network this pageview and painted from cache is 'memory'.
(function testNetworkLoadedThenClickIsMemory() {
  var h = makeDashboardHarness_(baseState_(false), function() { return Promise.resolve(dashboardPayload_()); });
  return h.fns.loadDashboard_(undefined, { silent: true }).then(function() {
    h.elements.dashboardBtn.trigger('click');
    var p = paints_(h);
    assert.equal(p.length, 1);
    assert.equal(p[0].ctx.paintSource, 'memory');
    assert.equal(typeof p[0].ctx.cacheAgeMs, 'number');
  });
})();

// AC1: the revalidate repaint is a 'network' paint with no cacheAgeMs; a repaint skipped (viewer
// navigated away) emits nothing.
(function testRevalidateRepaintIsNetworkPaint() {
  var state = baseState_(false);
  var h = makeDashboardHarness_(state, function() { return Promise.resolve(dashboardPayload_()); });
  h.fns.revalidateDashboard_();
  return tick_().then(tick_).then(function() {
    var p = paints_(h);
    assert.equal(h.renderCalls.length, 1);
    assert.equal(p.length, 1, 'AC1: exactly one paint record for the repaint');
    assert.equal(p[0].ctx.paintSource, 'network');
    assert.equal('cacheAgeMs' in p[0].ctx, false, 'a network paint carries no cacheAgeMs');
    var s2 = baseState_(false); s2.currentStep = 'bonus';
    var h2 = makeDashboardHarness_(s2, function() { return Promise.resolve(dashboardPayload_()); });
    h2.fns.revalidateDashboard_();
    return tick_().then(tick_).then(function() { assert.equal(paints_(h2).length, 0, 'no paint, no record'); });
  });
})();

// AC1: dashboardBtn after an in-flight prefetch lands paints the just-fetched payload: 'network'.
(function testDashboardBtnAfterPrefetchIsNetworkPaint() {
  var state = dayFactsOnlyState_();
  var resolveFetch;
  var h = makeDashboardHarness_(state, function() { return new Promise(function(r) { resolveFetch = r; }); });
  state.dashboardPrefetchPromise = h.fns.loadDashboard_(undefined, { silent: true });
  h.elements.dashboardBtn.trigger('click');
  resolveFetch(dashboardPayload_());
  return state.dashboardPrefetchPromise.then(tick_).then(function() {
    var p = paints_(h);
    assert.equal(p.length, 1);
    assert.equal(p[0].ctx.paintSource, 'network');
  });
})();

// AC1: navigateDashboard_ cache hit is one 'memory' paint record; a navigate that fetches emits none.
(function testNavigateCacheHitIsMemoryPaint() {
  var state = baseState_(true);
  var yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  var yIso = yesterday.getFullYear() + '-' + String(yesterday.getMonth() + 1).padStart(2, '0') + '-' + String(yesterday.getDate()).padStart(2, '0');
  if (yIso.slice(0, 7) !== monthKey_()) return; // 1st of the month: yesterday is another month's record
  state.board[monthKey_()].dayDates = [yIso, todayIso_()];
  state.viewDate = new Date();
  var h = makeDashboardHarness_(state, function() { return new Promise(function() {}); });
  h.fns.navigateDashboard_(-1);
  var p = paints_(h);
  assert.equal(h.renderCalls.length, 1);
  assert.equal(p.length, 1, 'AC1: one record for the navigate paint');
  assert.equal(p[0].ctx.paintSource, 'memory');
})();

// AC3: a day-facts-only record rejected for the dashboard facet emits one boardFacetMiss per
// occurrence (dashboardBtn and navigate); an absent record emits none.
(function testBoardFacetMissOnlyForRecordLackingFacet() {
  var h = makeDashboardHarness_(dayFactsOnlyState_(), function() { return new Promise(function() {}); });
  h.elements.dashboardBtn.trigger('click');
  var misses = h.telemetry.filter(function(t) { return t.kind === 'boardFacetMiss'; });
  assert.equal(misses.length, 1, 'AC3: one miss for the rejected day-facts-only record');
  assert.equal(misses[0].ctx.monthKey, monthKey_());
  h.elements.dashboardBtn.trigger('click');
  assert.equal(h.telemetry.filter(function(t) { return t.kind === 'boardFacetMiss'; }).length, 2, 'AC3: one per occurrence');
  assert.equal(paints_(h).length, 0, 'a miss is not a paint');

  var hAbsent = makeDashboardHarness_(baseState_(false), function() { return new Promise(function() {}); });
  hAbsent.elements.dashboardBtn.trigger('click');
  assert.equal(hAbsent.telemetry.filter(function(t) { return t.kind === 'boardFacetMiss'; }).length, 0, 'AC3: no miss for an absent record');
})();

console.log('test_dashboard_stale_while_revalidate.js: all assertions passed');
