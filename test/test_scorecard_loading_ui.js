const assert = require('node:assert/strict');
const { readStaticPage_, extractFunction_ } = require('./helpers/staticPageExtract');

// F3Go30-iwms: loadScorecardMonth_'s promise chain ends with
// .finally(() => scorecardLoadingUi_(false)) — which ran AFTER renderScorecard_ had already
// correctly hidden #scPodium/#scMetrics for a roster-only month (F3Go30-csfe.2), but then
// unconditionally force-UNHID them anyway. Since renderLadder_ (the only thing that rebuilds
// #scPodium's innerHTML) never runs for a roster-only month, the podium reappeared showing
// whatever a PREVIOUS ranked month had left in it — reproduced live (SIT, SepTest,
// 2026-09-01): August's podium (Güéŕó 37, Celtic 37, Crazy Ivan 34) stayed visible after
// navigating to September, a real registered month where everyone is still at zero.
//
// This harness extracts the REAL scorecardLoadingUi_ against a minimal fake-element $ + a
// controllable scorecardState_/state, matching the fake-element pattern
// test_dashboard_stale_while_revalidate.js already uses for the equivalent dashboard-side harness.
function makeFakeEl_() {
  var elements = {};
  function fakeEl_(id) {
    if (!elements[id]) {
      elements[id] = { classList: { hidden: false, toggle: function(token, force) { this.hidden = force; }, contains: function() { return this.hidden; } }, innerHTML: '', textContent: '', disabled: false };
    }
    return elements[id];
  }
  return { fakeEl_: fakeEl_, elements: elements };
}

function loadHarness_() {
  var src = readStaticPage_();
  var body = 'var SCORECARD_MAX_MONTHS_BACK_ = 2;\nvar SCORECARD_MAX_MONTHS_FORWARD_ = 1;\n' + [
    'bonusTotalOf_', 'scorecardBoardHasAnyScore_', 'scorecardIsRosterOnly_',
    'monthKeyOf_', 'calMonthIndex_', 'calMonthLabel_', 'scorecardMonthBounds_',
    'renderScorecardMonthNav_', 'scorecardLoadingUi_',
  ].map(function(name) { return extractFunction_(src, name); }).join('\n');

  var factory = new Function(
    'state', 'scorecardState_', '$',
    body + '\nreturn { scorecardLoadingUi_: scorecardLoadingUi_ };'
  );
  return factory;
}

function paxBoardWithScores_(scores) {
  return [{ name: 'Crucible', members: scores.map(function(s, i) {
    return { name: 'Pax' + i, score: s.score || 0, rawScore: s.rawScore || 0, bonusByType: s.bonusByType || {} };
  }) }];
}

// AC1/AC3: switching from a ranked month to a roster-only one — turning the loading spinner off
// must NOT re-reveal the podium/metrics the roster-only month's own render already hid.
function testLoadingOffDoesNotUnhidePodiumForARosterOnlyMonth() {
  var { fakeEl_, elements } = makeFakeEl_();
  var state = { availableMonths: [{ monthKey: '2026-09', label: 'September 2026' }] };
  var scorecardState_ = {
    loading: false,
    // renderScorecard_ already ran and set this to the roster-only September payload before
    // scorecardLoadingUi_(false) is called — same ordering as the real .then()-then-.finally() chain.
    data: { registered: true, monthKey: '2026-09', paxBoard: paxBoardWithScores_([{ score: 0 }, { score: 0 }]) },
    monthKey: '2026-09',
  };
  var factory = loadHarness_();
  var fns = factory(state, scorecardState_, fakeEl_);

  // Simulate renderScorecard_ having already hidden these for the roster-only month.
  elements.scMetrics = { classList: { hidden: true, toggle: function(t, f) { this.hidden = f; }, contains: function() { return this.hidden; } } };
  elements.scPodium = { classList: { hidden: true, toggle: function(t, f) { this.hidden = f; }, contains: function() { return this.hidden; } } };

  fns.scorecardLoadingUi_(false);

  assert.equal(elements.scPodium.classList.contains('hidden'), true,
    'AC1/AC3: turning loading off must not force-unhide the podium for a roster-only month');
  assert.equal(elements.scMetrics.classList.contains('hidden'), true,
    'AC1/AC3: turning loading off must not force-unhide the metrics toggle for a roster-only month');
}

// AC2: the inverse must still work — turning loading off for a RANKED month shows the podium.
function testLoadingOffShowsPodiumForARankedMonth() {
  var { fakeEl_, elements } = makeFakeEl_();
  var state = { availableMonths: [{ monthKey: '2026-08', label: 'August 2026' }] };
  var scorecardState_ = {
    loading: false,
    data: { registered: true, monthKey: '2026-08', paxBoard: paxBoardWithScores_([{ score: 37 }, { score: 34 }]) },
    monthKey: '2026-08',
  };
  var factory = loadHarness_();
  var fns = factory(state, scorecardState_, fakeEl_);

  elements.scMetrics = { classList: { hidden: true, toggle: function(t, f) { this.hidden = f; }, contains: function() { return this.hidden; } } };
  elements.scPodium = { classList: { hidden: true, toggle: function(t, f) { this.hidden = f; }, contains: function() { return this.hidden; } } };

  fns.scorecardLoadingUi_(false);

  assert.equal(elements.scPodium.classList.contains('hidden'), false, 'AC2: a ranked month must still show the podium once loading ends');
  assert.equal(elements.scMetrics.classList.contains('hidden'), false, 'AC2: a ranked month must still show the metrics toggle once loading ends');
}

// Turning loading ON must always hide both, regardless of scorecardState_.data (nothing to show
// meaningfully while a fetch is in flight) — unaffected regression check.
function testLoadingOnAlwaysHidesPodiumAndMetrics() {
  var { fakeEl_, elements } = makeFakeEl_();
  var state = { availableMonths: [] };
  var scorecardState_ = { loading: false, data: { registered: true, monthKey: '2026-08', paxBoard: paxBoardWithScores_([{ score: 37 }]) }, monthKey: '2026-08' };
  var factory = loadHarness_();
  var fns = factory(state, scorecardState_, fakeEl_);

  elements.scMetrics = { classList: { hidden: false, toggle: function(t, f) { this.hidden = f; }, contains: function() { return this.hidden; } } };
  elements.scPodium = { classList: { hidden: false, toggle: function(t, f) { this.hidden = f; }, contains: function() { return this.hidden; } } };

  fns.scorecardLoadingUi_(true);

  assert.equal(elements.scPodium.classList.contains('hidden'), true);
  assert.equal(elements.scMetrics.classList.contains('hidden'), true);
}

function run() {
  const tests = [
    testLoadingOffDoesNotUnhidePodiumForARosterOnlyMonth,
    testLoadingOffShowsPodiumForARankedMonth,
    testLoadingOnAlwaysHidesPodiumAndMetrics,
  ];
  tests.forEach(function(t) { t(); });
  console.log('test_scorecard_loading_ui.js: all assertions passed');
}

run();
