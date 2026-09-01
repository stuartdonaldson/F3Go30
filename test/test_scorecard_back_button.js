const assert = require('node:assert/strict');
const { readStaticPage_, extractFunction_ } = require('./helpers/staticPageExtract');

// F3Go30-izly: the header Back button from Scorecard used to hardcode a static 'dashboard'
// target (HEADER_BACK_TARGET_.scorecard), regardless of which step (checkin or dashboard) the
// PAX was actually on when they opened Scorecard from the header menu — reachable from every
// main step. Opening Scorecard straight from Checkin (never having visited Dashboard this
// session) sent Back to an empty, never-rendered Dashboard skeleton (Stuart: "takes me to what
// looks like a dashboard view with no data on it"). Bonus already solved this exact problem with
// a dynamic "last main view" tracker (renamed here from state.bonusReturnStep to
// state.mainViewReturnStep since Scorecard now shares it); this extracts the REAL showStep +
// headerBackBtn click handler to prove Scorecard now uses the same mechanism, not a
// reimplementation of the fix.

function extractHeaderBackTarget_(src) {
  var startMarker = 'var HEADER_BACK_TARGET_ = {';
  var startIdx = src.indexOf(startMarker);
  assert.notEqual(startIdx, -1, 'HEADER_BACK_TARGET_ declaration not found in index.html');
  var endIdx = src.indexOf(';', startIdx) + 1;
  return src.slice(startIdx, endIdx);
}

function extractHeaderBackBtnHandler_(src) {
  var startMarker = "$('headerBackBtn').addEventListener('click', function() {";
  var startIdx = src.indexOf(startMarker);
  assert.notEqual(startIdx, -1, 'headerBackBtn click handler not found in index.html');
  var endIdx = src.indexOf('});', startIdx) + '});'.length;
  return src.slice(startIdx, endIdx);
}

function makeFakeEl_() {
  var elements = {};
  var handlers = {};
  function fakeEl_(id) {
    if (!elements[id]) {
      elements[id] = {
        classList: { hidden: false, toggle: function(token, force) { this.hidden = force; }, contains: function() { return this.hidden; } },
        addEventListener: function(evt, fn) { (handlers[id + ':' + evt] = handlers[id + ':' + evt] || []).push(fn); },
        trigger: function(evt) { (handlers[id + ':' + evt] || []).forEach(function(fn) { fn(); }); },
      };
    }
    return elements[id];
  }
  return { fakeEl_: fakeEl_, elements: elements };
}

function loadHarness_(state) {
  var src = readStaticPage_();
  var body = extractHeaderBackTarget_(src) + '\n' +
    extractFunction_(src, 'showStep') + '\n' +
    extractHeaderBackBtnHandler_(src);
  var { fakeEl_, elements } = makeFakeEl_();
  var factory = new Function('state', '$', body + '\nreturn { showStep: showStep };');
  var fns = factory(state, fakeEl_);
  return { fns: fns, elements: elements };
}

function baseState_() {
  return { currentStep: null, mainViewReturnStep: 'checkin' };
}

// AC1: opened from Checkin -> Back returns to Checkin, not Dashboard.
function testBackFromScorecardOpenedFromCheckinReturnsToCheckin() {
  var state = baseState_();
  var h = loadHarness_(state);
  h.fns.showStep('checkin');
  h.fns.showStep('scorecard');
  h.elements.headerBackBtn.trigger('click');
  assert.equal(state.currentStep, 'checkin');
}

// AC2: opened from Dashboard -> Back returns to Dashboard (unchanged).
function testBackFromScorecardOpenedFromDashboardReturnsToDashboard() {
  var state = baseState_();
  var h = loadHarness_(state);
  h.fns.showStep('dashboard');
  h.fns.showStep('scorecard');
  h.elements.headerBackBtn.trigger('click');
  assert.equal(state.currentStep, 'dashboard');
}

// AC3: bonus's existing dynamic back-target behavior is unaffected by the rename/sharing.
function testBackFromBonusStillTracksLastMainViewBothWays() {
  var state = baseState_();
  var h = loadHarness_(state);
  h.fns.showStep('checkin');
  h.fns.showStep('bonus');
  h.elements.headerBackBtn.trigger('click');
  assert.equal(state.currentStep, 'checkin');

  h.fns.showStep('dashboard');
  h.fns.showStep('bonus');
  h.elements.headerBackBtn.trigger('click');
  assert.equal(state.currentStep, 'dashboard');
}

function run() {
  const tests = [
    testBackFromScorecardOpenedFromCheckinReturnsToCheckin,
    testBackFromScorecardOpenedFromDashboardReturnsToDashboard,
    testBackFromBonusStillTracksLastMainViewBothWays,
  ];
  tests.forEach(function(t) { t(); });
  console.log('test_scorecard_back_button.js: all assertions passed');
}

run();
