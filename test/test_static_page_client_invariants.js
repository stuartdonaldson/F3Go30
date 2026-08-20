const assert = require('node:assert/strict');
const { readStaticPage_ } = require('./helpers/staticPageExtract');

// F3Go30-giqm: static-pages/src/index.html was originally built as a "faithful port" of the
// GAS-hosted CheckinApp.html + IdentityCore.html (per static-checkin.spec.js's header). DR-04
// (2026-08-04, design-review-2026-08-04.md) removed those GAS templates outright — static-pages/
// src/index.html is now the only client — so the invariants below assert against it alone,
// covering what test_checkin_monthcache_invalidation.js/test_client_streak_display.js/
// test_bonus_save_notice.js each also assert for their own slice of behavior. This harness
// covers callApi's ns/contextDate/clientVersion plumbing, the per-call `cmd` override (a
// documented divergence from the retired IdentityCore.html's single-dispatcher shape, kept as a
// historical note in the test below), and the calendar-nav/banner blocks executed for real.
// (F3Go30-lem7: readStaticPage_ now shared via test/helpers/staticPageExtract.js.)

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

(function testStaticPageCallApiStampsClientVersion() {
  // F3Go30-833s.15: every callApi() POST carries the build-stamped STATIC_BUILD_VERSION_ so
  // Axiom can tell which static-page build a PWA client is running.
  var src = readStaticPage_();
  var fnMatch = src.match(/function callApi\([\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'callApi function body not found in index.html');
  assert.match(fnMatch[0], /clientVersion: STATIC_BUILD_VERSION_/,
    'callApi body must stamp clientVersion from STATIC_BUILD_VERSION_ on every POST');
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

// ── callApi takes a per-call `cmd` override on this page (one page, two server dispatchers — ──
//    handleCheckinPost_ vs handleSignupPost_). Historical note: the retired GAS IdentityCore.html
//    include (DR-04, 2026-08-04) posted to a single page-level CMD_ constant instead, since each
//    GAS page only ever dispatched to one of the two — this page can't make that assumption.

(function testStaticPageCallApiAcceptsPerCallCmdOverride() {
  var staticSrc = readStaticPage_();
  var staticFnMatch = staticSrc.match(/function callApi\([\s\S]*?\n  \}/);
  assert.ok(staticFnMatch, 'callApi function body not found in index.html');
  assert.match(staticFnMatch[0], /function callApi\(action, payload, cmd\)/, 'index.html callApi must accept a per-call cmd override');
  assert.match(staticFnMatch[0], /\?cmd=' \+ \(cmd \|\| CMD_\)/, 'index.html callApi must fall back to CMD_ when no per-call cmd is given');
})();

// ── attemptTopRedirect_ was a GAS sandbox-iframe escape (retired IdentityCore.html, DR-04) — ────
//    this page is already the top-level document, so it must never define or call one.

(function testStaticPageOmitsAttemptTopRedirect() {
  var staticSrc = readStaticPage_();
  assert.doesNotMatch(staticSrc, /function attemptTopRedirect_\(/, 'index.html must not define attemptTopRedirect_ — this document is already top-level');
  // index.html's own comments reference the name while documenting the omission (not a call),
  // so only reject an actual invocation shape: attemptTopRedirect_( preceded by non-comment text.
  var callSites = staticSrc.match(/^(?!\s*\/\/).*attemptTopRedirect_\(/gm) || [];
  assert.equal(callSites.length, 0, 'index.html must never call attemptTopRedirect_');
})();

// ── Snapshot-replay must never paint the announcement splash (F3Go30-g9bi) ──────────────────────
//    Regex-level, not the extracted harness above: proves the actual call SITE passes isLive:false
//    on the snapshot-replay path specifically, not just that applyServerConfig_ supports the param.

(function testSnapshotReplayCallSitePassesIsLiveFalse() {
  var src = readStaticPage_();
  assert.match(src, /applyServerConfig_\(checkinSnapshot_\.config, false\)/,
    'the cached/replayed snapshot must call applyServerConfig_ with isLive:false so the announcement splash never paints off stale cached data');
})();

(function testLiveIdentifyCallSitesDoNotSuppressTheAnnouncement() {
  var src = readStaticPage_();
  var liveCallSites = src.match(/applyServerConfig_\((?:result|res)\.config\)/g) || [];
  assert.ok(liveCallSites.length >= 3, 'expected the typed-identify/token-identify/resume-refresh call sites to all call applyServerConfig_ with no isLive override (defaults live)');
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
          // Real DOM's classList API — some code under test reads a hidden state directly (e.g.
          // applySignupReminderState_'s no-collision-with-an-open-announcement check), so the
          // fake needs both spellings.
          contains: function(c) { return !!classes[c]; },
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

// ── The page-banner block: the "this link moved" bookmark advisory (F3Go30-ubwl.3/ubwl.4 AC3) ──
//    and the stale-client update banner + version footer (F3Go30-833s.18), which share one
//    makeDismissibleBanner_ implementation. Extracted and executed the same way the cal-nav block
//    above is (real source, minimal DOM/storage stand-ins), so these prove the actual init-time
//    behavior rather than just pattern-matching tokens.

function extractBannerBlock_() {
  var src = readStaticPage_();
  var startMarker = '// ── Page banners and client-build freshness';
  var endMarker = '\n\n  function showStep(name)';
  var startIdx = src.indexOf(startMarker);
  var endIdx = src.indexOf(endMarker);
  assert.ok(startIdx !== -1 && endIdx !== -1, 'page-banner block markers not found in index.html — extraction markers may have drifted');
  return src.slice(startIdx, endIdx);
}

// Runs the extracted block as a same-realm function (see makeCalNavHarness_'s comment on why
// `Function`, not `vm`, is used) against a fake `$`/localStorage/history/location — none of
// which are under test here (the behavior under test is the banners' own show/strip/dismiss
// logic and the footer text).
function makeBannerHarness_(fromGas, opts) {
  opts = opts || {};
  var elements = {};
  // Both banners ship hidden in the markup (asserted below), so the stand-ins start hidden too —
  // otherwise "was never shown" and "was explicitly shown" would be indistinguishable.
  var INITIALLY_HIDDEN_ = { gasMovedBanner: true, updateBanner: true, announcementModal: true, signupReminderModal: true };
  function fakeEl_(id) {
    if (!elements[id]) {
      var classes = INITIALLY_HIDDEN_[id] ? { hidden: true } : {};
      var listeners = {};
      elements[id] = {
        classList: {
          add: function(c) { classes[c] = true; },
          remove: function(c) { delete classes[c]; },
          has: function(c) { return !!classes[c]; },
          // Real DOM's classList API — some code under test reads a hidden state directly (e.g.
          // applySignupReminderState_'s no-collision-with-an-open-announcement check), so the
          // fake needs both spellings.
          contains: function(c) { return !!classes[c]; },
        },
        addEventListener: function(evt, fn) { listeners[evt] = fn; },
        click: function() { if (listeners.click) listeners.click(); },
        textContent: '',
      };
    }
    return elements[id];
  }
  var storage = Object.assign({}, opts.storage || {});
  var fakeLocalStorage = {
    getItem: function(k) { return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
    setItem: function(k, v) { storage[k] = v; },
  };
  var sessionStore = Object.assign({}, opts.sessionStorage || {});
  var fakeSessionStorage = {
    getItem: function(k) { return Object.prototype.hasOwnProperty.call(sessionStore, k) ? sessionStore[k] : null; },
    setItem: function(k, v) { sessionStore[k] = v; },
  };
  var replaceStateCalls = [];
  var fakeHistory = { replaceState: function(state, title, url) { replaceStateCalls.push(String(url)); } };
  var reloadCallCount = 0;
  var fakeLocation = {
    href: opts.href || 'https://pax.example.github.io/f3go30/sit/?from=gas&id=sess-1',
    reload: function() { reloadCallCount++; },
  };

  var factory = new Function('FROM_GAS_', 'STATIC_BUILD_VERSION_', '$', 'localStorage', 'sessionStorage', 'history', 'location', 'URL',
    extractBannerBlock_() + '\nreturn { applyVersionState_: applyVersionState_, applyAnnouncementState_: applyAnnouncementState_, applySignupReminderState_: applySignupReminderState_ };'
  );
  var fns = factory(
    fromGas,
    Object.prototype.hasOwnProperty.call(opts, 'buildVersion') ? opts.buildVersion : null,
    fakeEl_, fakeLocalStorage, fakeSessionStorage, fakeHistory, fakeLocation, URL
  );
  return {
    fns: fns,
    elements: elements,
    storage: storage,
    sessionStore: sessionStore,
    replaceStateCalls: replaceStateCalls,
    reloadCallCount: function() { return reloadCallCount; },
    // Convenience: what the footer reads and whether the update banner is up, after an identify
    // response carrying `serverVersion` has been applied.
    applyServerVersion: function(serverVersion) {
      fns.applyVersionState_(
        Object.prototype.hasOwnProperty.call(opts, 'buildVersion') ? opts.buildVersion : null,
        serverVersion
      );
    },
    footerText: function() { return fakeEl_('versionFooter').textContent; },
    updateBannerHidden: function() { return fakeEl_('updateBanner').classList.has('hidden'); },
    announcementModalHidden: function() { return fakeEl_('announcementModal').classList.has('hidden'); },
    announcementTitle: function() { return fakeEl_('announcementTitle').textContent; },
    // The real code sets .innerHTML (F3Go30-g9bi follow-up: the body may carry links/formatting).
    announcementHtml: function() { return fakeEl_('announcementText').innerHTML; },
    signupReminderModalHidden: function() { return fakeEl_('signupReminderModal').classList.has('hidden'); },
    signupReminderMonthLabel: function() { return fakeEl_('signupReminderMonthLabel').textContent; },
  };
}

(function testGasMovedBannerShowsWhenFromGasAndNotDismissed() {
  var h = makeBannerHarness_(true);
  assert.equal(h.elements.gasMovedBanner.classList.has('hidden'), false, 'banner must be shown on a from=gas arrival');
})();

(function testGasMovedBannerStaysHiddenWhenFromGasAbsent() {
  var h = makeBannerHarness_(false);
  assert.equal(h.elements.gasMovedBanner === undefined || h.elements.gasMovedBanner.classList.has('hidden') !== false, true,
    'banner must not be shown when the arrival did not come from a GAS redirect');
  assert.equal(h.replaceStateCalls.length, 0, 'no address-bar rewrite when there is nothing to strip');
})();

(function testGasMovedBannerStaysHiddenWhenPreviouslyDismissed() {
  var h = makeBannerHarness_(true, { storage: { go30GasMovedDismissed: '1' } });
  assert.equal(h.elements.gasMovedBanner === undefined || h.elements.gasMovedBanner.classList.has('hidden') !== false, true,
    'a PAX who already dismissed the advisory must not see it again');
  assert.equal(h.replaceStateCalls.length, 0, 'no address-bar rewrite when the banner never rendered');
})();

(function testGasMovedMarkerIsStrippedFromTheAddressBarAfterRendering() {
  var h = makeBannerHarness_(true, { href: 'https://pax.example.github.io/f3go30/sit/?from=gas&id=sess-1' });
  assert.equal(h.replaceStateCalls.length, 1, 'history.replaceState must be called exactly once');
  var strippedUrl = new URL(h.replaceStateCalls[0]);
  assert.equal(strippedUrl.searchParams.has('from'), false, 'from=gas must be stripped once the advisory has rendered');
  assert.equal(strippedUrl.searchParams.get('id'), 'sess-1', 'stripping from must not disturb other query params');
})();

(function testGasMovedDismissalHidesTheBannerAndPersists() {
  var h = makeBannerHarness_(true);
  assert.equal(h.elements.gasMovedBanner.classList.has('hidden'), false, 'sanity: banner shown before dismissal');
  h.elements.gasMovedDismissBtn.click();
  assert.equal(h.elements.gasMovedBanner.classList.has('hidden'), true, 'dismiss button must hide the banner');
  assert.equal(h.storage.go30GasMovedDismissed, '1', 'dismissal must persist to localStorage so it is not shown again');
})();

// ── F3Go30-833s.18: stale installed clients — update-available banner + honest version footer ──
//    An installed PWA may not re-fetch its document for days, so a PAX can run a week-old build
//    against a current server indefinitely. The only signal available is the authoritative
//    cfg.appVersion arriving on every identify, compared against this document's own build stamp.

(function testBothBannersShipHiddenInTheMarkup() {
  // The harness stand-ins start hidden to model this; if the markup ever drops class="hidden",
  // the banners would flash on every load AND the tests below would silently stop proving
  // anything, so assert the markup directly.
  var src = readStaticPage_();
  ['gasMovedBanner', 'updateBanner'].forEach(function(id) {
    var tagMatch = src.match(new RegExp('<div id="' + id + '"[^>]*>'));
    assert.ok(tagMatch, id + ' element not found in index.html');
    assert.match(tagMatch[0], /class="[^"]*\bhidden\b/, id + ' must ship hidden in the markup');
  });
})();

(function testUpdateBannerShownWhenABuiltClientIsBehindTheServer() {
  var h = makeBannerHarness_(false, { buildVersion: '2.4.5' });
  h.applyServerVersion('2.4.7');
  assert.equal(h.updateBannerHidden(), false, 'a built client behind the server version must be offered a reload');
})();

(function testUpdateBannerStaysHiddenWhenTheClientIsCurrent() {
  var h = makeBannerHarness_(false, { buildVersion: '2.4.7' });
  h.applyServerVersion('2.4.7');
  assert.equal(h.updateBannerHidden(), true, 'a current client must not be nagged to reload');
})();

(function testUpdateBannerStaysHiddenForUnbuiltSource() {
  // AC2: STATIC_BUILD_VERSION_ is null when src/ is served directly (local dev + Playwright).
  // That is not a stale client — there is no build to compare — so no banner.
  var h = makeBannerHarness_(false, { buildVersion: null });
  h.applyServerVersion('2.4.7');
  assert.equal(h.updateBannerHidden(), true, 'unbuilt src/ served directly must never show the update banner');
})();

(function testUpdateBannerReloadButtonReloadsTheDocument() {
  var h = makeBannerHarness_(false, { buildVersion: '2.4.5' });
  h.applyServerVersion('2.4.7');
  assert.equal(h.reloadCallCount(), 0, 'sanity: nothing reloads until the PAX asks for it');
  h.elements.updateReloadBtn.click();
  assert.equal(h.reloadCallCount(), 1, 'the reload action must re-fetch the document');
})();

(function testUpdateBannerDismissalIsPerVersion() {
  // AC5: dismissing 2.4.7 must not silence the prompt for 2.4.8.
  var h = makeBannerHarness_(false, { buildVersion: '2.4.5' });
  h.applyServerVersion('2.4.7');
  h.elements.updateDismissBtn.click();
  assert.equal(h.updateBannerHidden(), true, 'dismiss must hide the banner');
  assert.equal(h.storage.go30UpdateDismissed, '2.4.7', 'dismissal must be recorded against the version dismissed, not a flag');

  var same = makeBannerHarness_(false, { buildVersion: '2.4.5', storage: { go30UpdateDismissed: '2.4.7' } });
  same.applyServerVersion('2.4.7');
  assert.equal(same.updateBannerHidden(), true, 'the dismissed version must not prompt again');

  var later = makeBannerHarness_(false, { buildVersion: '2.4.5', storage: { go30UpdateDismissed: '2.4.7' } });
  later.applyServerVersion('2.4.8');
  assert.equal(later.updateBannerHidden(), false, 'a later version must be able to prompt again');
})();

(function testVersionFooterNamesTheClientBuildAndTheServerSeparatelyWhenTheyDiffer() {
  // AC3: the footer previously showed only the SERVER's version, so a stale client displayed the
  // CURRENT version — asking a PAX "what does the footer say?" was guaranteed to mislead.
  var h = makeBannerHarness_(false, { buildVersion: '2.4.5' });
  assert.equal(h.footerText(), 'v2.4.5 (build)', 'before any identify, the footer shows this document\'s own build');
  h.applyServerVersion('2.4.7');
  assert.match(h.footerText(), /2\.4\.5/, 'the footer must keep reporting the CLIENT build a PAX is actually running');
  assert.match(h.footerText(), /2\.4\.7/, 'the footer must also name the server version so the skew is visible');
})();

(function testVersionFooterNamesOnlyTheClientBuildWhenClientAndServerAgree() {
  // No skew to report, so the server version adds nothing — and the footer text must not change
  // when the first identify lands, or a current client appears to "update" mid-session.
  var h = makeBannerHarness_(false, { buildVersion: '2.4.7' });
  assert.equal(h.footerText(), 'v2.4.7 (build)', 'sanity: the load-time paint');
  h.applyServerVersion('2.4.7');
  assert.equal(h.footerText(), 'v2.4.7 (build)', 'an agreeing identify must leave the footer exactly as loaded');
})();

(function testVersionFooterMarksAnUnbuiltClientAsServerReported() {
  var h = makeBannerHarness_(false, { buildVersion: null });
  h.applyServerVersion('2.4.7');
  assert.equal(h.footerText(), 'v2.4.7 (server)',
    'with no client build to report, the footer must say the version it shows came from the server');
})();

// ── F3Go30-g9bi: Config-driven announcement splash ──────────────────────────────────────────
//    Same extracted/executed-for-real harness as the banner tests above (applyAnnouncementState_
//    lives in the same source block). Covers show/hide-unconditionally, value-keyed dismissal,
//    and the remind-later sessionStorage snooze re-checking the live announcement on wake.

(function testAnnouncementModalShipsHiddenInTheMarkup() {
  var src = readStaticPage_();
  var tagMatch = src.match(/<div id="announcementModal"[^>]*>/);
  assert.ok(tagMatch, 'announcementModal element not found in index.html');
  assert.match(tagMatch[0], /class="[^"]*\bhidden\b/, 'announcementModal must ship hidden in the markup');
})();

(function testAnnouncementModalShowsTitleAndHtmlBodyForALiveAnnouncement() {
  // F3Go30-g9bi follow-up: title (Config column B) is a plain-text heading; body (column C) is
  // rendered as HTML so an admin can include links/formatting — deliberately innerHTML, not
  // textContent, verified here by asserting an actual <a> tag survives into the rendered markup.
  var h = makeBannerHarness_(false);
  h.fns.applyAnnouncementState_({ day: 11, title: 'HC Moved', message: 'Moved to <a href="https://example.com">Saturday</a> this week' });
  assert.equal(h.announcementModalHidden(), false);
  assert.equal(h.announcementTitle(), 'HC Moved');
  assert.equal(h.announcementHtml(), 'Moved to <a href="https://example.com">Saturday</a> this week');
})();

(function testAnnouncementModalHandlesABlankBodyAlongsideATitle() {
  // A title-only announcement (blank Config column C) must not throw or render "undefined".
  var h = makeBannerHarness_(false);
  h.fns.applyAnnouncementState_({ day: 11, title: 'Heads up', message: '' });
  assert.equal(h.announcementModalHidden(), false);
  assert.equal(h.announcementTitle(), 'Heads up');
  assert.equal(h.announcementHtml(), '');
})();

(function testAnnouncementModalHidesUnconditionallyWhenAnnouncementIsCleared() {
  // F3Go30-g9bi: applyAnnouncementState_ must hide even when nothing was ever dismissed — an
  // admin clearing/expiring the notice server-side must actively close an already-open splash,
  // not just suppress future opens (mirrors updateBanner_'s show-if-applicable/else-hide shape).
  var h = makeBannerHarness_(false);
  h.fns.applyAnnouncementState_({ day: 11, title: 'HC Moved', message: 'HC moved to Saturday' });
  assert.equal(h.announcementModalHidden(), false, 'sanity: shown first');
  h.fns.applyAnnouncementState_(null);
  assert.equal(h.announcementModalHidden(), true, 'a cleared announcement must actively hide an already-open modal');
})();

(function testAnnouncementDismissalIsValueKeyedByFingerprintNotJustDay() {
  var h = makeBannerHarness_(false);
  h.fns.applyAnnouncementState_({ day: 11, title: 'HC Moved', message: 'HC moved to Saturday' });
  h.elements.announcementDismissBtn.click();
  assert.equal(h.announcementModalHidden(), true, 'dismiss button must hide the modal');
  var recordedFingerprint = h.storage.go30AnnouncementDismissed;
  assert.ok(recordedFingerprint && recordedFingerprint.indexOf('11:') === 0, 'dismissal must be recorded against a day-prefixed fingerprint, not a bare flag');

  var same = makeBannerHarness_(false, { storage: { go30AnnouncementDismissed: recordedFingerprint } });
  same.fns.applyAnnouncementState_({ day: 11, title: 'HC Moved', message: 'HC moved to Saturday' });
  assert.equal(same.announcementModalHidden(), true, 'the exact same dismissed announcement must not prompt again');

  var later = makeBannerHarness_(false, { storage: { go30AnnouncementDismissed: recordedFingerprint } });
  later.fns.applyAnnouncementState_({ day: 14, title: 'Month End', message: 'Month-end reminder' });
  assert.equal(later.announcementModalHidden(), false, "dismissing day 11's notice must not suppress day 14's");

  // F3Go30-g9bi follow-up: a Site Q editing the SAME day's message after a PAX already dismissed
  // it must re-prompt — content is part of the dismissal identity, not just the day number.
  var edited = makeBannerHarness_(false, { storage: { go30AnnouncementDismissed: recordedFingerprint } });
  edited.fns.applyAnnouncementState_({ day: 11, title: 'HC Moved', message: 'Actually, HC is cancelled entirely' });
  assert.equal(edited.announcementModalHidden(), false, 'editing an already-dismissed day\'s content must re-surface it');
})();

(function testAnnouncementRemindLaterSnoozesWithoutRecordingADismissal() {
  var h = makeBannerHarness_(false);
  h.fns.applyAnnouncementState_({ day: 11, title: 'HC Moved', message: 'HC moved to Saturday' });
  h.elements.announcementRemindLaterBtn.click();
  assert.equal(h.announcementModalHidden(), true, 'remind-later must hide the modal immediately');
  assert.equal(h.storage.go30AnnouncementDismissed, undefined, 'remind-later must NOT record a localStorage dismissal');
  assert.ok(h.sessionStore.go30AnnouncementRemindWakeAt, 'remind-later must record a sessionStorage wake-time');

  // Still within the snooze window: the SAME live announcement must stay suppressed.
  var stillSnoozed = makeBannerHarness_(false, { sessionStorage: h.sessionStore });
  stillSnoozed.fns.applyAnnouncementState_({ day: 11, title: 'HC Moved', message: 'HC moved to Saturday' });
  assert.equal(stillSnoozed.announcementModalHidden(), true, 'must stay suppressed until the wake-time passes');

  // But an edit to the content during the snooze window must surface immediately, same rationale
  // as the dismissal case above — the snooze was for a specific notice, not "day 11 forever".
  var editedDuringSnooze = makeBannerHarness_(false, { sessionStorage: h.sessionStore });
  editedDuringSnooze.fns.applyAnnouncementState_({ day: 11, title: 'HC Moved', message: 'Actually, HC is cancelled entirely' });
  assert.equal(editedDuringSnooze.announcementModalHidden(), false, 'an edited announcement must not stay suppressed by an old snooze');
})();

(function testAnnouncementRemindLaterRechecksTheLiveAnnouncementOnWake() {
  // F3Go30-g9bi: firing must re-check the LIVE config.announcement, not replay what was cached at
  // click-time — it may have been cleared or changed since.
  var pastWithFingerprint = String(Date.now() - 1000) + '|11:abc123';
  var expiredWake = makeBannerHarness_(false, { sessionStorage: { go30AnnouncementRemindWakeAt: pastWithFingerprint } });
  expiredWake.fns.applyAnnouncementState_(null); // the notice was cleared server-side while snoozed
  assert.equal(expiredWake.announcementModalHidden(), true, 'a cleared live announcement must not reappear just because the snooze expired');

  var changedWake = makeBannerHarness_(false, { sessionStorage: { go30AnnouncementRemindWakeAt: pastWithFingerprint } });
  changedWake.fns.applyAnnouncementState_({ day: 14, title: 'Different Notice', message: 'A different, newer notice' });
  assert.equal(changedWake.announcementModalHidden(), false, 'an expired snooze must surface whatever is live now');
  assert.equal(changedWake.announcementTitle(), 'Different Notice');
})();

// ── F3Go30-xyvs: SignupReminder popup ────────────────────────────────────────────────────────
//    Same extracted/executed-for-real harness as the banner/announcement tests above
//    (applySignupReminderState_ lives in the same source block). Covers unconditional show/hide,
//    the localStorage-backed (not sessionStorage) daily remind-later, and the no-collision-with-
//    an-open-announcement rule.

(function testSignupReminderModalShipsHiddenInTheMarkup() {
  var src = readStaticPage_();
  var tagMatch = src.match(/<div id="signupReminderModal"[^>]*>/);
  assert.ok(tagMatch, 'signupReminderModal element not found in index.html');
  assert.match(tagMatch[0], /class="[^"]*\bhidden\b/, 'signupReminderModal must ship hidden in the markup');
})();

(function testSignupReminderShowsMonthLabelForALiveReminder() {
  var h = makeBannerHarness_(false);
  h.fns.applySignupReminderState_({ monthLabel: 'August 2026' });
  assert.equal(h.signupReminderModalHidden(), false);
  assert.equal(h.signupReminderMonthLabel(), 'August 2026');
})();

(function testSignupReminderHidesUnconditionallyWhenCleared() {
  // Mirrors applyAnnouncementState_'s own rule: signing up for next month through ANY path
  // (this popup, direct nav, admin action) must close an already-open popup on the very next
  // response, not just suppress future opens.
  var h = makeBannerHarness_(false);
  h.fns.applySignupReminderState_({ monthLabel: 'August 2026' });
  assert.equal(h.signupReminderModalHidden(), false, 'sanity: shown first');
  h.fns.applySignupReminderState_(null);
  assert.equal(h.signupReminderModalHidden(), true, 'a cleared reminder must actively hide an already-open modal');
})();

(function testSignupReminderIsNotPaintedFromANonLiveResponse() {
  // isLive: false is how the instant-paint snapshot path calls in — the reminder must never
  // flash off cached/replayed data, only a live identify (same rule as the announcement splash).
  var h = makeBannerHarness_(false);
  h.fns.applySignupReminderState_({ monthLabel: 'August 2026' }, false);
  assert.equal(h.signupReminderModalHidden(), true, 'a non-live call must never show the popup');
})();

(function testSignupReminderLaterSuppressesForTheRestOfTodayOnly() {
  var h = makeBannerHarness_(false);
  h.fns.applySignupReminderState_({ monthLabel: 'August 2026' });
  h.elements.signupReminderLaterBtn.click();
  assert.equal(h.signupReminderModalHidden(), true, 'remind-later must hide the modal immediately');
  assert.ok(h.storage.go30SignupReminderSnoozedUntil, 'remind-later must persist to localStorage (survives app restart), unlike the announcement splash\'s sessionStorage snooze');

  // Still "today" (per the harness's wake-time, still in the future): the same reminder stays suppressed.
  var stillSnoozed = makeBannerHarness_(false, { storage: h.storage });
  stillSnoozed.fns.applySignupReminderState_({ monthLabel: 'August 2026' });
  assert.equal(stillSnoozed.signupReminderModalHidden(), true, 'must stay suppressed until the next calendar day');

  // A DIFFERENT month's reminder (should never happen in practice, but proves the key is scoped,
  // not a bare flag) must not be suppressed by an old snooze.
  var differentMonth = makeBannerHarness_(false, { storage: h.storage });
  differentMonth.fns.applySignupReminderState_({ monthLabel: 'September 2026' });
  assert.equal(differentMonth.signupReminderModalHidden(), false, "snoozing August's reminder must not suppress September's");
})();

(function testSignupReminderReappearsOnceTheSnoozeWindowHasPassed() {
  var pastWakeAt = String(Date.now() - 1000) + '|August 2026';
  var expired = makeBannerHarness_(false, { storage: { go30SignupReminderSnoozedUntil: pastWakeAt } });
  expired.fns.applySignupReminderState_({ monthLabel: 'August 2026' });
  assert.equal(expired.signupReminderModalHidden(), false, 'an expired snooze must let the still-live reminder reappear');
})();

(function testSignupReminderDoesNotCollideWithAnOpenAnnouncement() {
  var h = makeBannerHarness_(false);
  h.fns.applyAnnouncementState_({ day: 11, title: 'HC Moved', message: 'HC moved to Saturday' });
  h.fns.applySignupReminderState_({ monthLabel: 'August 2026' });
  assert.equal(h.announcementModalHidden(), false, 'sanity: announcement is up');
  assert.equal(h.signupReminderModalHidden(), true, 'the reminder must not stack on top of an active announcement splash');
})();

console.log('test_static_page_client_invariants.js: all assertions passed');
