const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// F3Go30-5uk2 follow-up: the server now sends historyValues-derived streak/maxStreak30 for every
// myTeam/paxBoard row, but memberViewForIndex_ (and renderDashboard_'s self-tile equivalent) used
// to silently discard that and recompute from this-month-only dayValues, undoing the server fix
// for anything actually rendered on screen. Extracts the REAL memberViewForIndex_ (not a
// re-implementation) from the dashboard client — same extraction pattern as
// test_client_transport_resilience.js (callApi) and test_session_resume_refresh.js. DR-04
// (2026-08-04) retired the GAS-hosted CheckinApp.html this loop used to also cover — the static
// front end (static-pages/src/index.html) is the only remaining copy.

function extractMemberViewBlock_(src, label) {
  var startIdx = src.indexOf('function trimTrailingBlanks_');
  var endIdx = src.indexOf('function renderDateNav_');
  assert.notEqual(startIdx, -1, label + ': trimTrailingBlanks_ (block start marker) not found');
  assert.notEqual(endIdx, -1, label + ': renderDateNav_ (block end marker) not found');
  assert.ok(startIdx < endIdx, label + ': block start must precede block end');
  return src.slice(startIdx, endIdx);
}

function loadMemberViewForIndex_(filePath, label) {
  var src = fs.readFileSync(filePath, 'utf8');
  var body = extractMemberViewBlock_(src, label);
  var MAX_STREAK_WINDOW_DAYS_ = 30;
  var fn = new Function('MAX_STREAK_WINDOW_DAYS_', body + '\nreturn memberViewForIndex_;');
  return fn(MAX_STREAK_WINDOW_DAYS_);
}

[
  { file: path.join(__dirname, '..', 'static-pages', 'src', 'index.html'), label: 'static-pages/src/index.html' },
].forEach(function(target) {
  var memberViewForIndex_ = loadMemberViewForIndex_(target.file, target.label);

  // Viewing the latest day (no date-nav truncation): must use the server's own cross-month
  // streak/maxStreak30, not a same-month-only recompute from dayValues.
  (function testLatestDayUsesServerStreak() {
    var member = {
      name: 'Pogo',
      dayValues: [1, 1], // this month only shows 2 days — a local recompute would cap at 2
      streak: 3,          // server figure: spans the July/August boundary
      maxStreak30: 3,
    };
    var view = memberViewForIndex_(member, 1, 31); // dayIndex 1 => sliced length 2 => latest
    assert.equal(view.streak, 3, target.label + ': latest-day streak must come from the server, not a this-month recompute');
    assert.equal(view.maxStreak30, 3, target.label + ': latest-day maxStreak30 must come from the server');
  })();

  // Date-nav to an earlier day (sliced shorter than the full dayValues array): no fresh server
  // figure exists for that historical point, so the local same-month approximation is correct
  // fallback behavior (unchanged from before this fix).
  (function testEarlierDayFallsBackToLocalRecompute() {
    var member = {
      name: 'Pogo',
      dayValues: [1, 1, 1],
      streak: 5,        // server figure describes TODAY, not the day being navigated to
      maxStreak30: 5,
    };
    var view = memberViewForIndex_(member, 0, 31); // dayIndex 0 => sliced length 1 => not latest
    assert.equal(view.streak, 1, target.label + ': earlier-day streak must be recomputed locally from the sliced values');
    assert.equal(view.maxStreak30, 1, target.label + ': earlier-day maxStreak30 must be recomputed locally from the sliced values');
  })();

  console.log(target.label + ': memberViewForIndex_ streak-display assertions passed');
});

console.log('test_client_streak_display.js: all assertions passed');
