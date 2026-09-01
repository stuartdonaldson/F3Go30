const assert = require('node:assert/strict');
const { readStaticPage_, extractFunction_ } = require('./helpers/staticPageExtract');

// F3Go30-enwp.1: the first few days of a new month have little or no real data — Scorecard
// should default-open on the previous month during that window instead of the real current
// month, since it's the only one with anything meaningful to show. F3Go30-csfe.2 already stops
// the podium/ladder from rendering on an all-zero board, but a PAX opening Scorecard on the 2nd
// of the month still had to manually page back one month every time to see anything ranked.
function loadScorecardDefaultMonthKey_() {
  var src = readStaticPage_();
  var body = extractFunction_(src, 'monthKeyOf_') + '\n' + extractFunction_(src, 'scorecardDefaultMonthKey_');
  var fn = new Function(body + '\nreturn scorecardDefaultMonthKey_;');
  return fn();
}

var MONTHS_ = [
  { monthKey: '2026-07', label: 'July 2026' },
  { monthKey: '2026-08', label: 'August 2026' },
  { monthKey: '2026-09', label: 'September 2026' },
];

function testDefaultsToPreviousMonthOnDay1() {
  var scorecardDefaultMonthKey_ = loadScorecardDefaultMonthKey_();
  assert.equal(scorecardDefaultMonthKey_(new Date(2026, 8, 1), MONTHS_), '2026-08');
}

function testDefaultsToPreviousMonthOnDay5() {
  var scorecardDefaultMonthKey_ = loadScorecardDefaultMonthKey_();
  assert.equal(scorecardDefaultMonthKey_(new Date(2026, 8, 5), MONTHS_), '2026-08');
}

function testDefaultsToCurrentMonthOnDay6() {
  var scorecardDefaultMonthKey_ = loadScorecardDefaultMonthKey_();
  assert.equal(scorecardDefaultMonthKey_(new Date(2026, 8, 6), MONTHS_), '2026-09');
}

function testDefaultsToCurrentMonthLaterInMonth() {
  var scorecardDefaultMonthKey_ = loadScorecardDefaultMonthKey_();
  assert.equal(scorecardDefaultMonthKey_(new Date(2026, 8, 20), MONTHS_), '2026-09');
}

function testFallsBackToCurrentMonthWithNoEarlierMonth() {
  var scorecardDefaultMonthKey_ = loadScorecardDefaultMonthKey_();
  // AC3: current month is the FIRST entry in availableMonths — no previous month exists.
  var onlyMonth = [{ monthKey: '2026-09', label: 'September 2026' }];
  assert.equal(scorecardDefaultMonthKey_(new Date(2026, 8, 2), onlyMonth), '2026-09');
}

function testFallsBackToCurrentMonthWhenAvailableMonthsMissingOrEmpty() {
  var scorecardDefaultMonthKey_ = loadScorecardDefaultMonthKey_();
  assert.equal(scorecardDefaultMonthKey_(new Date(2026, 8, 2), []), '2026-09');
  assert.equal(scorecardDefaultMonthKey_(new Date(2026, 8, 2), null), '2026-09');
}

function run() {
  const tests = [
    testDefaultsToPreviousMonthOnDay1,
    testDefaultsToPreviousMonthOnDay5,
    testDefaultsToCurrentMonthOnDay6,
    testDefaultsToCurrentMonthLaterInMonth,
    testFallsBackToCurrentMonthWithNoEarlierMonth,
    testFallsBackToCurrentMonthWhenAvailableMonthsMissingOrEmpty,
  ];
  tests.forEach(function(t) { t(); });
  console.log('test_scorecard_default_month.js: all assertions passed');
}

run();
