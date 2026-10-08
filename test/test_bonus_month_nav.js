const assert = require('node:assert/strict');
const { readStaticPage_, extractFunction_ } = require('./helpers/staticPageExtract');

// F3Go30-5ire: Bonus Points had no way to page back and view/edit a previous month's entries —
// loadBonusList_ always scoped to state.viewDate (the check-in day-nav's view date), which the
// bonus page doesn't otherwise share. This adds a month-nav header (bonusPrevMonthBtn/
// bonusMonthNavLabel/bonusNextMonthBtn) matching Scorecard's existing pattern, backed by its own
// bonusState_.monthKey rather than state.viewDate. Extracts the REAL functions out of index.html,
// same technique as test_scorecard_loading_ui.js/test_bonus_save_notice.js.

function makeFakeEl_() {
  var elements = {};
  function fakeEl_(id) {
    if (!elements[id]) {
      elements[id] = {
        classList: { hidden: false, toggle: function(t, f) { this.hidden = f; }, add: function(c) { if (c === 'hidden') this.hidden = true; }, remove: function(c) { if (c === 'hidden') this.hidden = false; }, contains: function() { return this.hidden; } },
        innerHTML: '', textContent: '', disabled: false, value: '', min: '', max: '',
      };
    }
    return elements[id];
  }
  return { fakeEl_: fakeEl_, elements: elements };
}

// F3Go30-kitk: the bounds are relative to the device clock (new Date()), so the harness injects a
// fixed "today" as the extracted functions' Date — a zero-arg new Date() returns that day, every
// other form behaves like the real Date. Without this the fixture months aged out of the cap window.
function makeFixedDate_(todayIso) {
  var parts = todayIso.split('-').map(Number);
  var fixedMs = new Date(parts[0], parts[1] - 1, parts[2], 12).getTime();
  function FixedDate() {
    var args = Array.prototype.slice.call(arguments);
    return args.length ? new (Function.prototype.bind.apply(Date, [null].concat(args)))() : new Date(fixedMs);
  }
  FixedDate.now = function() { return fixedMs; };
  FixedDate.prototype = Date.prototype;
  return FixedDate;
}

var TODAY_ISO_ = null;

function loadHarness_(state, bonusState, callApiImpl) {
  var src = readStaticPage_();
  var body = 'var BONUS_MAX_MONTHS_BACK_ = 2;\nvar BONUS_MAX_MONTHS_FORWARD_ = 0;\n' + [
    'monthKeyOf_', 'parseIsoDate_', 'isoDate_', 'calMonthIndex_', 'calMonthLabel_',
    'monthNavBounds_', 'bonusMonthBounds_', 'bonusContextDate_', 'renderBonusMonthNav_',
    'renderBonusList_', 'loadBonusList_', 'navigateBonusMonth_', 'setBonusWhenRange_',
  ].map(function(name) { return extractFunction_(src, name); }).join('\n');

  var factory = new Function(
    'state', 'bonusState_', '$', 'callApi', 'hideApiError_', 'showApiError_', 'Date',
    body + '\nreturn { loadBonusList_: loadBonusList_, navigateBonusMonth_: navigateBonusMonth_, ' +
      'renderBonusMonthNav_: renderBonusMonthNav_, bonusMonthBounds_: bonusMonthBounds_, ' +
      'setBonusWhenRange_: setBonusWhenRange_ };'
  );
  var { fakeEl_, elements } = makeFakeEl_();
  var fns = factory(
    state, bonusState, fakeEl_,
    callApiImpl || function() { throw new Error('callApi should not have been called'); },
    function() {}, function() {}, makeFixedDate_(TODAY_ISO_)
  );
  return { fns: fns, elements: elements };
}

var MONTH_NAMES_ = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

// The fixture is the injected today's month and the two before it, so the 2-back/0-forward cap
// window always lands on exactly these three months. M0 = earliest, M2 = today's month.
function monthsEndingAt_(todayIso) {
  var parts = todayIso.split('-').map(Number);
  var out = [];
  for (var back = 2; back >= 0; back--) {
    var d = new Date(parts[0], parts[1] - 1 - back, 1);
    var key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    out.push({ monthKey: key, label: MONTH_NAMES_[d.getMonth()] + ' ' + d.getFullYear(), startDateIso: key + '-01' });
  }
  return out;
}

function isoOf_(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

var MONTHS_ = null;
var M0, M1, M2;

// AC2: back capped at BONUS_MAX_MONTHS_BACK_(2) behind real-today's month; forward capped AT
// real-today's month (BONUS_MAX_MONTHS_FORWARD_ = 0 — no future months for new bonus entries).
function testBoundsCapBackTwoAndForwardZero() {
  var state = { availableMonths: MONTHS_ };
  var h = loadHarness_(state, { monthKey: M2.monthKey, loading: false });
  var bounds = h.fns.bonusMonthBounds_();
  assert.equal(MONTHS_[bounds.minIdx].monthKey, M0.monthKey, 'AC2: must allow paging back to the earliest month within the 2-month cap');
  assert.equal(MONTHS_[bounds.maxIdx].monthKey, M2.monthKey, 'AC2: must cap forward at the real current month');
}

// AC1/AC5: nav label reflects the viewed month and buttons disable at the bounds.
function testRenderShowsLabelAndDisablesAtBounds() {
  var state = { availableMonths: MONTHS_ };
  var h = loadHarness_(state, { monthKey: M0.monthKey, loading: false });
  h.fns.renderBonusMonthNav_();
  assert.equal(h.elements.bonusMonthNavLabel.textContent, M0.label);
  assert.equal(h.elements.bonusPrevMonthBtn.disabled, true, 'AC5: prev must disable at the back bound');
  assert.equal(h.elements.bonusNextMonthBtn.disabled, false);
}

function testRenderDisablesNextAtForwardBound() {
  var state = { availableMonths: MONTHS_ };
  var h = loadHarness_(state, { monthKey: M2.monthKey, loading: false });
  h.fns.renderBonusMonthNav_();
  assert.equal(h.elements.bonusNextMonthBtn.disabled, true, 'AC5: next must disable at the real-current-month forward bound');
}

function testRenderShowsLoadingLabelAndDisablesBothWhileLoading() {
  var state = { availableMonths: MONTHS_ };
  var h = loadHarness_(state, { monthKey: M1.monthKey, loading: true });
  h.fns.renderBonusMonthNav_();
  assert.match(h.elements.bonusMonthNavLabel.textContent, /Loading/, 'AC5: label must show a loading state');
  assert.equal(h.elements.bonusPrevMonthBtn.disabled, true);
  assert.equal(h.elements.bonusNextMonthBtn.disabled, true);
}

// AC3: navigating fetches that month's entries via bonusList dateISO derived from
// state.availableMonths, not the day-nav's state.viewDate.
function testNavigatePrevFetchesPreviousMonthByDateIso() {
  var state = { availableMonths: MONTHS_, f3Name: 'Crucible', email: 'c@x.com', bonusEntries: [] };
  var bonusState = { monthKey: M2.monthKey, loading: false };
  var seenPayload = null;
  var callApi = function(action, payload) {
    seenPayload = payload;
    return Promise.resolve({ entries: [] });
  };
  var h = loadHarness_(state, bonusState, callApi);
  return h.fns.navigateBonusMonth_(-1).then(function() {
    assert.equal(bonusState.monthKey, M1.monthKey, 'AC3: navigating back must move to the previous available month');
    assert.equal(seenPayload.dateISO, M1.startDateIso, "AC3: must fetch using that month's startDateIso");
  });
}

// Navigating past a bound, or while already loading, must not fire a fetch.
function testNavigateNextBeyondForwardBoundNoOps() {
  var state = { availableMonths: MONTHS_, bonusEntries: [] };
  var bonusState = { monthKey: M2.monthKey, loading: false };
  var calls = 0;
  var callApi = function() { calls++; return Promise.resolve({ entries: [] }); };
  var h = loadHarness_(state, bonusState, callApi);
  var result = h.fns.navigateBonusMonth_(1);
  assert.equal(result, undefined);
  assert.equal(calls, 0, 'must not fetch when already at the forward bound');
  assert.equal(bonusState.monthKey, M2.monthKey);
}

function testNavigateWhileLoadingNoOps() {
  var state = { availableMonths: MONTHS_, bonusEntries: [] };
  var bonusState = { monthKey: M2.monthKey, loading: true };
  var calls = 0;
  var callApi = function() { calls++; return Promise.resolve({ entries: [] }); };
  var h = loadHarness_(state, bonusState, callApi);
  h.fns.navigateBonusMonth_(-1);
  assert.equal(calls, 0, 'must ignore nav clicks while a fetch is already in flight');
}

// AC3 continued: editing an entry found in a navigated-to month must have a valid form date
// window covering that month (setBonusWhenRange_ must follow the VIEWED month, not real today).
function testWhenRangeFollowsViewedMonthNotRealToday() {
  var state = { availableMonths: MONTHS_ };
  var h = loadHarness_(state, { monthKey: M0.monthKey, loading: false });
  h.fns.setBonusWhenRange_();
  var m0 = new Date(Number(M0.monthKey.slice(0, 4)), Number(M0.monthKey.slice(5)) - 1, 1);
  assert.equal(h.elements.bonusWhen.min, isoOf_(new Date(m0.getFullYear(), m0.getMonth() - 1, 1)), 'min must be one month before the VIEWED month, not real-today\'s month');
  assert.equal(h.elements.bonusWhen.max, isoOf_(new Date(m0.getFullYear(), m0.getMonth() + 1, 0)), 'max must be the end of the VIEWED month');
}

function runAt_(todayIso) {
  TODAY_ISO_ = todayIso;
  MONTHS_ = monthsEndingAt_(todayIso);
  M0 = MONTHS_[0]; M1 = MONTHS_[1]; M2 = MONTHS_[2];
  var sync = [
    testBoundsCapBackTwoAndForwardZero,
    testRenderShowsLabelAndDisablesAtBounds,
    testRenderDisablesNextAtForwardBound,
    testRenderShowsLoadingLabelAndDisablesBothWhileLoading,
    testNavigateNextBeyondForwardBoundNoOps,
    testNavigateWhileLoadingNoOps,
    testWhenRangeFollowsViewedMonthNotRealToday,
  ];
  sync.forEach(function(t) { t(); });
  return testNavigatePrevFetchesPreviousMonthByDateIso();
}

// F3Go30-kitk AC2: the same assertions must hold at dates months apart, including a year boundary
// inside the cap window (2027-01: Nov..Jan) and the real clock.
var DATES_ = ['2026-09-15', '2027-01-10', '2027-03-15', isoOf_(new Date())];

function run() {
  return DATES_.reduce(function(p, iso) { return p.then(function() { return runAt_(iso); }); }, Promise.resolve())
    .then(function() {
      console.log('test_bonus_month_nav.js: all assertions passed at ' + DATES_.join(', '));
    });
}

run().catch(function(err) { console.error('today=' + TODAY_ISO_, err); process.exit(1); });
