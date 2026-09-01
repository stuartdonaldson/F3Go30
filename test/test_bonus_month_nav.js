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

function loadHarness_(state, bonusState, callApiImpl) {
  var src = readStaticPage_();
  var body = 'var BONUS_MAX_MONTHS_BACK_ = 2;\nvar BONUS_MAX_MONTHS_FORWARD_ = 0;\n' + [
    'monthKeyOf_', 'parseIsoDate_', 'isoDate_', 'calMonthIndex_', 'calMonthLabel_',
    'monthNavBounds_', 'bonusMonthBounds_', 'bonusContextDate_', 'renderBonusMonthNav_',
    'renderBonusList_', 'loadBonusList_', 'navigateBonusMonth_', 'setBonusWhenRange_',
  ].map(function(name) { return extractFunction_(src, name); }).join('\n');

  var factory = new Function(
    'state', 'bonusState_', '$', 'callApi', 'hideApiError_', 'showApiError_',
    body + '\nreturn { loadBonusList_: loadBonusList_, navigateBonusMonth_: navigateBonusMonth_, ' +
      'renderBonusMonthNav_: renderBonusMonthNav_, bonusMonthBounds_: bonusMonthBounds_, ' +
      'setBonusWhenRange_: setBonusWhenRange_ };'
  );
  var { fakeEl_, elements } = makeFakeEl_();
  var fns = factory(
    state, bonusState, fakeEl_,
    callApiImpl || function() { throw new Error('callApi should not have been called'); },
    function() {}, function() {}
  );
  return { fns: fns, elements: elements };
}

var MONTHS_ = [
  { monthKey: '2026-07', label: 'July 2026', startDateIso: '2026-07-01' },
  { monthKey: '2026-08', label: 'August 2026', startDateIso: '2026-08-01' },
  { monthKey: '2026-09', label: 'September 2026', startDateIso: '2026-09-01' },
];

// AC2: back capped at BONUS_MAX_MONTHS_BACK_(2) behind real-today's month; forward capped AT
// real-today's month (BONUS_MAX_MONTHS_FORWARD_ = 0 — no future months for new bonus entries).
function testBoundsCapBackTwoAndForwardZero() {
  var state = { availableMonths: MONTHS_ };
  var h = loadHarness_(state, { monthKey: '2026-09', loading: false });
  var bounds = h.fns.bonusMonthBounds_();
  assert.equal(MONTHS_[bounds.minIdx].monthKey, '2026-07', 'AC2: must allow paging back to the earliest month within the 2-month cap');
  assert.equal(MONTHS_[bounds.maxIdx].monthKey, '2026-09', 'AC2: must cap forward at the real current month');
}

// AC1/AC5: nav label reflects the viewed month and buttons disable at the bounds.
function testRenderShowsLabelAndDisablesAtBounds() {
  var state = { availableMonths: MONTHS_ };
  var h = loadHarness_(state, { monthKey: '2026-07', loading: false });
  h.fns.renderBonusMonthNav_();
  assert.equal(h.elements.bonusMonthNavLabel.textContent, 'July 2026');
  assert.equal(h.elements.bonusPrevMonthBtn.disabled, true, 'AC5: prev must disable at the back bound');
  assert.equal(h.elements.bonusNextMonthBtn.disabled, false);
}

function testRenderDisablesNextAtForwardBound() {
  var state = { availableMonths: MONTHS_ };
  var h = loadHarness_(state, { monthKey: '2026-09', loading: false });
  h.fns.renderBonusMonthNav_();
  assert.equal(h.elements.bonusNextMonthBtn.disabled, true, 'AC5: next must disable at the real-current-month forward bound');
}

function testRenderShowsLoadingLabelAndDisablesBothWhileLoading() {
  var state = { availableMonths: MONTHS_ };
  var h = loadHarness_(state, { monthKey: '2026-08', loading: true });
  h.fns.renderBonusMonthNav_();
  assert.match(h.elements.bonusMonthNavLabel.textContent, /Loading/, 'AC5: label must show a loading state');
  assert.equal(h.elements.bonusPrevMonthBtn.disabled, true);
  assert.equal(h.elements.bonusNextMonthBtn.disabled, true);
}

// AC3: navigating fetches that month's entries via bonusList dateISO derived from
// state.availableMonths, not the day-nav's state.viewDate.
function testNavigatePrevFetchesPreviousMonthByDateIso() {
  var state = { availableMonths: MONTHS_, f3Name: 'Crucible', email: 'c@x.com', bonusEntries: [] };
  var bonusState = { monthKey: '2026-09', loading: false };
  var seenPayload = null;
  var callApi = function(action, payload) {
    seenPayload = payload;
    return Promise.resolve({ entries: [] });
  };
  var h = loadHarness_(state, bonusState, callApi);
  return h.fns.navigateBonusMonth_(-1).then(function() {
    assert.equal(bonusState.monthKey, '2026-08', 'AC3: navigating back must move to the previous available month');
    assert.equal(seenPayload.dateISO, '2026-08-01', "AC3: must fetch using that month's startDateIso");
  });
}

// Navigating past a bound, or while already loading, must not fire a fetch.
function testNavigateNextBeyondForwardBoundNoOps() {
  var state = { availableMonths: MONTHS_, bonusEntries: [] };
  var bonusState = { monthKey: '2026-09', loading: false };
  var calls = 0;
  var callApi = function() { calls++; return Promise.resolve({ entries: [] }); };
  var h = loadHarness_(state, bonusState, callApi);
  var result = h.fns.navigateBonusMonth_(1);
  assert.equal(result, undefined);
  assert.equal(calls, 0, 'must not fetch when already at the forward bound');
  assert.equal(bonusState.monthKey, '2026-09');
}

function testNavigateWhileLoadingNoOps() {
  var state = { availableMonths: MONTHS_, bonusEntries: [] };
  var bonusState = { monthKey: '2026-09', loading: true };
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
  var h = loadHarness_(state, { monthKey: '2026-07', loading: false });
  h.fns.setBonusWhenRange_();
  assert.equal(h.elements.bonusWhen.min, '2026-06-01', 'min must be one month before the VIEWED month, not real-today\'s month');
  assert.equal(h.elements.bonusWhen.max, '2026-07-31', 'max must be the end of the VIEWED month');
}

function run() {
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
  return testNavigatePrevFetchesPreviousMonthByDateIso().then(function() {
    console.log('test_bonus_month_nav.js: all assertions passed');
  });
}

run().catch(function(err) { console.error(err); process.exit(1); });
