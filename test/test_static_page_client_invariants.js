const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// F3Go30-giqm: static-pages/src/index.html is a "faithful port" of CheckinApp.html +
// IdentityCore.html (per static-checkin.spec.js's header) — same client-side invariants that
// test_context_date_client_roundtrip.js / test_ns_client_roundtrip.js / test_checkin_monthcache_
// invalidation.js / test_checkin_token_inline_identify.js already assert against the GAS HTML
// source, but nothing previously read this file at all, so a regression here only surfaces in
// the live-browser Playwright spec, which doesn't run in npm test. This harness re-asserts the
// same static-shape invariants against the static page's single inlined script, plus the
// documented divergences (no include boundary, no attemptTopRedirect_, per-call `cmd`) so they
// are asserted rather than assumed.

function readStaticPage_() {
  return fs.readFileSync(path.join(__dirname, '..', 'static-pages', 'src', 'index.html'), 'utf8');
}

function readScript_(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'script', name), 'utf8');
}

// ── NS_ / CONTEXT_DATE_ round trip (mirrors test_ns_client_roundtrip.js / ────────────────────
//    test_context_date_client_roundtrip.js, but there is no IdentityCore include boundary on
//    this single-file page — the equivalent ordering constraint is "declared before callApi is
//    defined", since callApi's body closes over them.

(function testStaticPageDeclaresNsBeforeCallApiIsDefined() {
  var src = readStaticPage_();
  var declIndex = src.search(/var NS_\s*=/);
  var callApiIndex = src.indexOf('function callApi(');
  assert.notEqual(declIndex, -1, 'index.html must declare NS_ from the URL query string');
  assert.notEqual(callApiIndex, -1, 'callApi not found in index.html');
  assert.ok(declIndex < callApiIndex, 'NS_ must be declared before callApi is defined');
})();

(function testStaticPageDeclaresContextDateBeforeCallApiIsDefined() {
  var src = readStaticPage_();
  var declIndex = src.search(/var CONTEXT_DATE_\s*=/);
  var callApiIndex = src.indexOf('function callApi(');
  assert.notEqual(declIndex, -1, 'index.html must declare CONTEXT_DATE_ from the URL query string');
  assert.notEqual(callApiIndex, -1, 'callApi not found in index.html');
  assert.ok(declIndex < callApiIndex, 'CONTEXT_DATE_ must be declared before callApi is defined');
})();

(function testStaticPageCallApiEchoesNsAndContextDate() {
  var src = readStaticPage_();
  var fnMatch = src.match(/function callApi\([\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'callApi function body not found in index.html');
  assert.match(fnMatch[0], /NS_/, 'callApi body must reference NS_ so ns round-trips on every POST');
  assert.match(fnMatch[0], /CONTEXT_DATE_/, 'callApi body must reference CONTEXT_DATE_ so contextDate round-trips on every POST');
})();

// ── NS_ / CONTEXT_DATE_ coverage extends to the signup step, not only SignupApp.html ──────────
//    (F3Go30-833s.12 AC 3). callApi always echoes NS_/CONTEXT_DATE_ regardless of which cmd is
//    passed (asserted above), so it's enough to confirm the signup step's own call sites route
//    through callApi at all — unlike SignupApp.html, this page has no second, separate client
//    plumbing file for the signup step to bypass that echo through.

(function testStaticPageSignupIdentifyRoutesThroughCallApi() {
  var src = readStaticPage_();
  var fnMatch = src.match(/function runSignupIdentify_\([\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'runSignupIdentify_ not found in index.html');
  assert.match(fnMatch[0], /callApi\('identify', \{ f3Name: f3Name, email: email \}, 'signup'\)/,
    "runSignupIdentify_ must call callApi(...,'signup') so NS_/CONTEXT_DATE_ echo onto the signup step's identify request");
})();

(function testStaticPageSignupSaveRoutesThroughCallApi() {
  var src = readStaticPage_();
  var fnMatch = src.match(/function performSignupSave_\([\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'performSignupSave_ not found in index.html');
  assert.match(fnMatch[0], /\}, 'signup'\)\.then\(/,
    "performSignupSave_ must call callApi(...,'signup') so NS_/CONTEXT_DATE_ echo onto the signup step's save request");
})();

// ── Documented divergence: callApi takes a per-call `cmd` override on this page (one page, two ─
//    server dispatchers — handleCheckinPost_ vs handleSignupPost_), where the GAS callApi always
//    posts to the page-level CMD_ constant. Asserted rather than assumed (AC 3).

(function testStaticPageCallApiAcceptsPerCallCmdDivergingFromGasIdentityCore() {
  var staticSrc = readStaticPage_();
  var staticFnMatch = staticSrc.match(/function callApi\([\s\S]*?\n  \}/);
  assert.ok(staticFnMatch, 'callApi function body not found in index.html');
  assert.match(staticFnMatch[0], /function callApi\(action, payload, cmd\)/, 'index.html callApi must accept a per-call cmd override');
  assert.match(staticFnMatch[0], /\?cmd=' \+ \(cmd \|\| CMD_\)/, 'index.html callApi must fall back to CMD_ when no per-call cmd is given');

  var gasSrc = readScript_('IdentityCore.html');
  var gasFnMatch = gasSrc.match(/function callApi\([\s\S]*?\n  \}/);
  assert.ok(gasFnMatch, 'callApi function body not found in IdentityCore.html');
  assert.match(gasFnMatch[0], /function callApi\(action, payload\)/, 'IdentityCore.html callApi must NOT take a per-call cmd (only one dispatcher per page)');
})();

// ── Documented divergence: attemptTopRedirect_ exists in the GAS shared include (escapes the ──
//    HtmlService sandbox iframe) but is deliberately omitted from the static page, which is
//    already the top-level document.

(function testStaticPageOmitsAttemptTopRedirectPresentInGasIdentityCore() {
  var gasSrc = readScript_('IdentityCore.html');
  assert.match(gasSrc, /function attemptTopRedirect_\(/, 'IdentityCore.html must still define attemptTopRedirect_ (GAS sandbox-iframe escape)');

  var staticSrc = readStaticPage_();
  assert.doesNotMatch(staticSrc, /function attemptTopRedirect_\(/, 'index.html must not define attemptTopRedirect_ — this document is already top-level');
  // index.html's own comments reference the name while documenting the omission (not a call),
  // so only reject an actual invocation shape: attemptTopRedirect_( preceded by non-comment text.
  var callSites = staticSrc.match(/^(?!\s*\/\/).*attemptTopRedirect_\(/gm) || [];
  assert.equal(callSites.length, 0, 'index.html must never call attemptTopRedirect_');
})();

// ── Month-cache write-through (mirrors test_checkin_monthcache_invalidation.js) ────────────────

(function testStaticPageInvalidateMonthCacheForDropsTheAffectedMonthKey() {
  var src = readStaticPage_();
  var fnMatch = src.match(/function invalidateMonthCacheFor_\([\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'invalidateMonthCacheFor_ not found in index.html');
  assert.match(fnMatch[0], /delete state\.monthCache\[/, 'invalidateMonthCacheFor_ must delete the affected monthCache entry');
})();

(function testStaticPageApplyOwnDayWritePatchesCacheOrQueuesPending() {
  var src = readStaticPage_();
  var fnMatch = src.match(/function applyOwnDayWrite_\([\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'applyOwnDayWrite_ not found in index.html');
  assert.match(fnMatch[0], /patchOwnDayIntoPayload_\(/, 'applyOwnDayWrite_ must patch an already-cached payload');
  assert.match(fnMatch[0], /state\.pendingSelfWrites\[dateIso\] = value/, 'applyOwnDayWrite_ must queue the write when no month is cached yet');
})();

(function testStaticPageSubmitCheckinAppliesWriteThroughBeforeCallApiAndRevertsOnFailure() {
  var src = readStaticPage_();
  var fnMatch = src.match(/function submitCheckin_\([\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'submitCheckin_ not found in index.html');
  var body = fnMatch[0];
  var applyIdx = body.indexOf('applyOwnDayWrite_(dateIso, value)');
  var callApiIdx = body.indexOf('callApi(');
  assert.ok(applyIdx !== -1, 'submitCheckin_ must call applyOwnDayWrite_(dateIso, value)');
  assert.ok(applyIdx < callApiIdx, 'submitCheckin_ must call applyOwnDayWrite_ synchronously before callApi');
  assert.doesNotMatch(body, /\.then\(function\(\) \{[\s\S]*invalidateMonthCacheFor_/,
    'submitCheckin_ success handler must not invalidate the whole cached month (write-through only)');
  assert.match(body, /revertOwnDayWrite_\(dateIso\);/, 'submitCheckin_ failure handler must call revertOwnDayWrite_(dateIso)');
})();

(function testStaticPageSubmitSelectionCheckinAppliesWriteThroughBeforeCallApiAndRevertsOnFailure() {
  var src = readStaticPage_();
  var fnMatch = src.match(/function submitSelectionCheckin_\([\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'submitSelectionCheckin_ not found in index.html');
  var body = fnMatch[0];
  var applyIdx = body.indexOf('applyOwnDayWrite_(dateIso, value)');
  var callApiIdx = body.indexOf('callApi(');
  assert.ok(applyIdx !== -1, 'submitSelectionCheckin_ must call applyOwnDayWrite_(dateIso, value)');
  assert.ok(applyIdx < callApiIdx, 'submitSelectionCheckin_ must call applyOwnDayWrite_ synchronously before callApi');
  assert.doesNotMatch(body, /\.then\(function\(\) \{[\s\S]*invalidateMonthCacheFor_/,
    'submitSelectionCheckin_ success handler must not invalidate the whole cached month (write-through only)');
  assert.match(body, /revertOwnDayWrite_\(dateIso\);/, 'submitSelectionCheckin_ failure handler must call revertOwnDayWrite_(dateIso)');
})();

// ── F3Go30-k5fn.3 AC1: the month-to-month navigation model, executed (not just pattern-matched) ─
// The static shape checks above (regex over function bodies) can't prove renderCalMonthNav_'s
// backward/forward stop arithmetic or loadCalMonth_'s signup-gate routing are actually correct —
// only that certain tokens appear. This extracts the real F3Go30-k5fn.2 nav block out of
// index.html and runs it in a vm sandbox with a minimal `$`/state/callApi stand-in, so these
// three tests execute the SAME source the browser does.

function extractCalNavBlock_() {
  var src = readStaticPage_();
  var startMarker = '// ── Step: checkin — Month-to-month navigation (F3Go30-k5fn.2) ──────────';
  var endMarker = "$('calPrevMonthBtn').addEventListener";
  var startIdx = src.indexOf(startMarker);
  var endIdx = src.indexOf(endMarker);
  assert.ok(startIdx !== -1 && endIdx !== -1, 'cal-nav block markers not found in index.html — extraction markers may have drifted');
  return src.slice(startIdx, endIdx);
}

// Builds the extracted block as a same-realm function (via `Function`, not `vm` — vm.createContext
// runs in a SEPARATE realm with its own Array/Object constructors, which breaks assert/strict's
// deepEqual on any array the block builds, e.g. `state.monthGrid = []`) against a caller-supplied
// `state`, plus bare stand-ins for the DOM/network seams the block touches ($ elements, callApi,
// renderCalendar_, hideApiError_) — none of which are under test here (AC1 is the navigation
// model itself).
function makeCalNavHarness_(state, callApiImpl) {
  var elements = {};
  function fakeEl_(id) {
    if (!elements[id]) {
      var classes = {};
      elements[id] = {
        disabled: false, textContent: '', innerHTML: '',
        classList: {
          add: function(c) { classes[c] = true; },
          remove: function(c) { delete classes[c]; },
          has: function(c) { return !!classes[c]; },
        },
        querySelector: function() { return null; },
      };
    }
    return elements[id];
  }
  var factory = new Function('state', '$', 'callApi', 'hideApiError_', 'renderCalendar_', 'renderSelectionPanel_', 'showApiError_',
    extractCalNavBlock_() + '\nreturn { renderCalMonthNav_: renderCalMonthNav_, loadCalMonth_: loadCalMonth_, navigateCalMonth_: navigateCalMonth_ };'
  );
  var fns = factory(
    state, fakeEl_,
    callApiImpl || function() { throw new Error('callApi should not have been called'); },
    function() {}, function() {}, function() {},
    function(action, err) { throw err; } // surface a real API-call failure as a test failure, not a silent UI toast
  );
  return { fns: fns, elements: elements };
}

function baseNavState_() {
  return {
    calLoading: false,
    calMonthKey: null,
    availableMonths: [
      { monthKey: '2026-05', label: 'May 2026' },
      { monthKey: '2026-06', label: 'June 2026' },
      { monthKey: '2026-07', label: 'July 2026' },
      { monthKey: '2026-08', label: 'August 2026' },
    ],
    registeredMonthKeys: ['2026-06', '2026-07'],
    calGridCache: {},
    monthGrid: [],
    selectedDateIso: null,
    todayIso: '2026-07-15',
  };
}

// AC1a: BACKWARD is disabled exactly at the PAX's earliest registered month, even though earlier
// (unregistered) months still exist in availableMonths.
(function testCalNavBackwardStopsAtEarliestRegisteredMonth() {
  var state = baseNavState_();
  state.calMonthKey = '2026-06'; // earliest registered month
  var h = makeCalNavHarness_(state);
  h.fns.renderCalMonthNav_();
  assert.equal(h.elements.calPrevMonthBtn.disabled, true, 'backward must be disabled at the earliest registered month');
  assert.equal(h.elements.calNextMonthBtn.disabled, false, 'forward must still be available (more months exist ahead)');

  // One month later (still registered) — backward becomes available again.
  state.calMonthKey = '2026-07';
  h.fns.renderCalMonthNav_();
  assert.equal(h.elements.calPrevMonthBtn.disabled, false, 'backward must be available once past the earliest registered month');
})();

// AC1b: FORWARD is disabled exactly at the latest EXISTING tracker month (availableMonths' last
// entry), regardless of registration — forward never runs out of months to page through, it just
// stops existing.
(function testCalNavForwardStopsAtLatestExistingMonth() {
  var state = baseNavState_();
  state.calMonthKey = '2026-08'; // latest existing month (index 3, last)
  // callApi throws if invoked at all — proves navigateCalMonth_(1) from the last month is a
  // true no-op (never reaches loadCalMonth_'s fetch branch), not merely a UI-disabled affordance.
  var h = makeCalNavHarness_(state, function() { throw new Error('navigateCalMonth_ must not page past the last existing month'); });
  h.fns.renderCalMonthNav_();
  assert.equal(h.elements.calNextMonthBtn.disabled, true, 'forward must be disabled at the latest existing tracker month');

  h.fns.navigateCalMonth_(1);
  assert.equal(state.calMonthKey, '2026-08', 'calMonthKey must not change — there is no month beyond the last existing one');
})();

// AC1c: navigating FORWARD into an existing month the PAX is NOT registered in renders the
// signup prompt (never calls callApi/monthGrid — no network round trip needed to know this).
(function testCalNavForwardIntoUnregisteredMonthYieldsSignupPrompt() {
  var state = baseNavState_();
  state.calMonthKey = '2026-07'; // registered; '2026-08' (next) is existing but NOT registered
  var h = makeCalNavHarness_(state, function() { throw new Error('monthGrid must not be fetched for an unregistered month — the signup gate short-circuits it'); });

  h.fns.navigateCalMonth_(1);

  assert.equal(state.calMonthKey, '2026-08', 'navigation still advances calMonthKey to the target month');
  assert.equal(h.elements.calEditableArea.classList.has('hidden'), true, 'signup-gated month must hide the editable grid area');
  assert.equal(h.elements.calSignupPrompt.classList.has('hidden'), false, 'signup-gated month must reveal the signup prompt');
  assert.deepEqual(state.monthGrid, [], 'signup-gated month must not populate an editable grid');
  assert.equal(h.elements.calSignupPromptText.textContent, "You're not signed up for August 2026 yet.");
})();

// AC1d: navigating FORWARD into an existing REGISTERED month with no cache fetches via the
// monthGrid action (F3Go30-k5fn.1) — proves the registered branch is reachable and distinct from
// AC1c's signup-gated branch (same navigateCalMonth_ call site, different outcome by registration).
(function testCalNavForwardIntoRegisteredMonthFetchesMonthGrid() {
  var state = baseNavState_();
  state.calMonthKey = '2026-05';
  state.registeredMonthKeys = ['2026-05', '2026-06'];
  var calledWith = null;
  var h = makeCalNavHarness_(state, function(action, payload) {
    calledWith = { action: action, payload: payload };
    return Promise.resolve({ ok: true, monthGrid: [{ dateIso: '2026-06-01', status: 'done' }], registered: true });
  });

  // navigateCalMonth_ doesn't propagate loadCalMonth_'s promise to its own caller (fire-and-forget,
  // matching the real click-handler usage) — call loadCalMonth_ directly so this test can await it.
  return h.fns.loadCalMonth_('2026-06').then(function() {
    assert.ok(calledWith, 'callApi must be invoked for a registered month with no cache');
    assert.equal(calledWith.action, 'monthGrid');
    assert.equal(calledWith.payload.monthKey, '2026-06');
    assert.deepEqual(state.monthGrid, [{ dateIso: '2026-06-01', status: 'done' }]);
  });
})();

// ── F3Go30-ubwl.4 AC3: the "this link moved" bookmark advisory (F3Go30-ubwl.3) — extracted and ──
//    executed the same way the cal-nav block above is (real source, minimal DOM/storage stand-
//    ins), so these prove the actual init-time behavior rather than just pattern-matching tokens.

function extractGasMovedBlock_() {
  var src = readStaticPage_();
  var startMarker = '// F3Go30-ubwl.3: "this link moved" advisory';
  var endMarker = '\n\n  function showStep(name)';
  var startIdx = src.indexOf(startMarker);
  var endIdx = src.indexOf(endMarker);
  assert.ok(startIdx !== -1 && endIdx !== -1, 'gas-moved-banner block markers not found in index.html — extraction markers may have drifted');
  return src.slice(startIdx, endIdx);
}

// Runs the extracted block as a same-realm function (see makeCalNavHarness_'s comment on why
// `Function`, not `vm`, is used) against a fake `$`/localStorage/history/location — none of
// which are under test here (AC3 is the banner's show/strip/dismiss behavior itself).
function makeGasMovedHarness_(fromGas, opts) {
  opts = opts || {};
  var elements = {};
  function fakeEl_(id) {
    if (!elements[id]) {
      var classes = {};
      var listeners = {};
      elements[id] = {
        classList: {
          add: function(c) { classes[c] = true; },
          remove: function(c) { delete classes[c]; },
          has: function(c) { return !!classes[c]; },
        },
        addEventListener: function(evt, fn) { listeners[evt] = fn; },
        click: function() { if (listeners.click) listeners.click(); },
      };
    }
    return elements[id];
  }
  var storage = Object.assign({}, opts.storage || {});
  var fakeLocalStorage = {
    getItem: function(k) { return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
    setItem: function(k, v) { storage[k] = v; },
  };
  var replaceStateCalls = [];
  var fakeHistory = { replaceState: function(state, title, url) { replaceStateCalls.push(String(url)); } };
  var fakeLocation = { href: opts.href || 'https://pax.example.github.io/f3go30/sit/?from=gas&id=sess-1' };

  var factory = new Function('FROM_GAS_', '$', 'localStorage', 'history', 'location', 'URL',
    extractGasMovedBlock_() + '\nreturn { isGasMovedDismissed_: isGasMovedDismissed_ };'
  );
  var fns = factory(fromGas, fakeEl_, fakeLocalStorage, fakeHistory, fakeLocation, URL);
  return { fns: fns, elements: elements, storage: storage, replaceStateCalls: replaceStateCalls };
}

(function testGasMovedBannerShowsWhenFromGasAndNotDismissed() {
  var h = makeGasMovedHarness_(true);
  assert.equal(h.elements.gasMovedBanner.classList.has('hidden'), false, 'banner must be shown on a from=gas arrival');
})();

(function testGasMovedBannerStaysHiddenWhenFromGasAbsent() {
  var h = makeGasMovedHarness_(false);
  assert.equal(h.elements.gasMovedBanner === undefined || h.elements.gasMovedBanner.classList.has('hidden') !== false, true,
    'banner must not be shown when the arrival did not come from a GAS redirect');
  assert.equal(h.replaceStateCalls.length, 0, 'no address-bar rewrite when there is nothing to strip');
})();

(function testGasMovedBannerStaysHiddenWhenPreviouslyDismissed() {
  var h = makeGasMovedHarness_(true, { storage: { go30GasMovedDismissed: '1' } });
  assert.equal(h.elements.gasMovedBanner === undefined || h.elements.gasMovedBanner.classList.has('hidden') !== false, true,
    'a PAX who already dismissed the advisory must not see it again');
  assert.equal(h.replaceStateCalls.length, 0, 'no address-bar rewrite when the banner never rendered');
})();

(function testGasMovedMarkerIsStrippedFromTheAddressBarAfterRendering() {
  var h = makeGasMovedHarness_(true, { href: 'https://pax.example.github.io/f3go30/sit/?from=gas&id=sess-1' });
  assert.equal(h.replaceStateCalls.length, 1, 'history.replaceState must be called exactly once');
  var strippedUrl = new URL(h.replaceStateCalls[0]);
  assert.equal(strippedUrl.searchParams.has('from'), false, 'from=gas must be stripped once the advisory has rendered');
  assert.equal(strippedUrl.searchParams.get('id'), 'sess-1', 'stripping from must not disturb other query params');
})();

(function testGasMovedDismissalHidesTheBannerAndPersists() {
  var h = makeGasMovedHarness_(true);
  assert.equal(h.elements.gasMovedBanner.classList.has('hidden'), false, 'sanity: banner shown before dismissal');
  h.elements.gasMovedDismissBtn.click();
  assert.equal(h.elements.gasMovedBanner.classList.has('hidden'), true, 'dismiss button must hide the banner');
  assert.equal(h.storage.go30GasMovedDismissed, '1', 'dismissal must persist to localStorage so it is not shown again');
})();

console.log('test_static_page_client_invariants.js: all assertions passed');
