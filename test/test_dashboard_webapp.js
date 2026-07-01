const assert = require('node:assert/strict');

const {
  classifyTrackerColumns_,
  findDateColumnIndex_,
  findTrackerRowIndexByName_,
  computeStreak_,
  countOutcomes_,
  needsYesterdayCheckin_,
  groupByTeam_,
  buildWeeklyBonuses_,
  buildDaySegments_,
  buildRollingAverage_,
} = require('../script/dashboardWebapp.js');

// ── classifyTrackerColumns_ ──────────────────────────────────────────────
// Row layout mirrors CreateNewTracker.js populateTrackerSheet: columns A-H (idx 0-7) are
// fixed (Name, Team, Fellowship, Q-Point, Inspire, EHing FNG, Raw Score, Score); day columns
// start at idx 8 (column I); a 'Bonus' column (row3='Bonus', row2=period number) follows each
// Saturday's date column and a trailing one follows the last day of the month.
(function testClassifyTrackerColumns() {
  var row2 = ['', '', '', '', '', '', '', '', '', '', '', 1, '', '', 2];
  var row3 = [
    'F3 Name', 'Goal / Team', '', '', '', '', 'Raw Score', 'Score',
    new Date(2026, 5, 1), new Date(2026, 5, 2), new Date(2026, 5, 3),
    'Bonus',
    new Date(2026, 5, 4), new Date(2026, 5, 5),
    'Bonus',
  ];
  var result = classifyTrackerColumns_(row2, row3);
  assert.equal(result.dayCols.length, 5);
  assert.deepEqual(result.dayCols.map(function(d) { return d.col; }), [8, 9, 10, 12, 13]);
  assert.equal(result.bonusCols.length, 2);
  assert.deepEqual(result.bonusCols.map(function(b) { return b.col; }), [11, 14]);
  assert.equal(result.bonusCols[0].period, 1);
  assert.equal(result.bonusCols[1].period, 2);
})();

// ── findDateColumnIndex_ ──────────────────────────────────────────────────
(function testFindDateColumnIndex() {
  var dayCols = [
    { col: 8, date: new Date(2026, 5, 1) },
    { col: 9, date: new Date(2026, 5, 2) },
    { col: 10, date: new Date(2026, 5, 3) },
  ];
  assert.equal(findDateColumnIndex_(dayCols, new Date(2026, 5, 2)), 9);
  // Time-of-day on the target date must not matter — only the calendar date.
  assert.equal(findDateColumnIndex_(dayCols, new Date(2026, 5, 2, 23, 59)), 9);
  assert.equal(findDateColumnIndex_(dayCols, new Date(2026, 5, 30)), -1);
})();

// ── findTrackerRowIndexByName_ ────────────────────────────────────────────
(function testFindTrackerRowIndexByName() {
  var names = ['Dredd', 'Blaze', ''];
  assert.equal(findTrackerRowIndexByName_(names, ' blaze '), 1);
  assert.equal(findTrackerRowIndexByName_(names, 'Nobody'), -1);
})();

// ── computeStreak_ ─────────────────────────────────────────────────────────
(function testComputeStreak() {
  // Trailing blanks (not-yet-reported days) are ignored; streak counts backward from the
  // last reported day while it's a 1, stopping at the first 0/-1.
  assert.equal(computeStreak_([1, 1, 1, 0, -1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]), 13);
  assert.equal(computeStreak_([1, 1, 0]), 0);
  assert.equal(computeStreak_([1, 1, 1, '', '']), 3);
  assert.equal(computeStreak_(['', '', '']), 0);
  assert.equal(computeStreak_([]), 0);
})();

// ── countOutcomes_ ─────────────────────────────────────────────────────────
(function testCountOutcomes() {
  assert.deepEqual(countOutcomes_([1, 1, 1, 0, -1, 1, '']), { done: 4, missed: 1, absent: 1 });
  assert.deepEqual(countOutcomes_([]), { done: 0, missed: 0, absent: 0 });
})();

// ── needsYesterdayCheckin_ ───────────────────────────────────────────────
(function testNeedsYesterdayCheckin() {
  assert.equal(needsYesterdayCheckin_(''), true);
  assert.equal(needsYesterdayCheckin_(undefined), true);
  assert.equal(needsYesterdayCheckin_(0), false);
  assert.equal(needsYesterdayCheckin_(1), false);
  assert.equal(needsYesterdayCheckin_(-1), false);
})();

// ── groupByTeam_ ───────────────────────────────────────────────────────────
(function testGroupByTeam() {
  var rows = [
    { name: 'Dredd', team: 'Alpha', score: 12 },
    { name: 'Blaze', team: 'alpha ', score: 18 },
    { name: 'Cowboy', team: 'Bravo', score: 5 },
    { name: 'Archie', team: '', score: 3 },
  ];
  var groups = groupByTeam_(rows);
  // Groups sorted by average score descending; blank team collected under 'Unassigned'.
  assert.equal(groups.length, 3);
  assert.equal(groups[0].name, 'Alpha');
  assert.equal(groups[0].members.length, 2);
  // Members within a group sorted by score descending.
  assert.equal(groups[0].members[0].name, 'Blaze');
  assert.equal(groups[1].name, 'Bravo');
  assert.equal(groups[2].name, 'Unassigned');
})();

// ── buildWeeklyBonuses_ ────────────────────────────────────────────────────
(function testBuildWeeklyBonuses() {
  var bonusCols = [
    { col: 11, period: 1, precedingDate: new Date(2026, 5, 6) },
    { col: 14, period: 2, precedingDate: new Date(2026, 5, 13) },
  ];
  var bonusValues = [2, 0];
  var weeks = buildWeeklyBonuses_(bonusCols, bonusValues, new Date(2026, 5, 10));
  assert.equal(weeks.length, 2);
  assert.equal(weeks[0].label, 'WK 1');
  assert.equal(weeks[0].value, 2);
  assert.equal(weeks[0].status, 'earned');
  assert.equal(weeks[1].status, 'upcoming');
})();

// ── buildDaySegments_ ──────────────────────────────────────────────────────
(function testBuildDaySegments() {
  // Reported days map to their outcome; days beyond what's been reported (future days, or a
  // total-days count longer than what's been read so far) are 'upcoming'.
  assert.deepEqual(
    buildDaySegments_([1, 0, -1], 5),
    ['done', 'missed', 'absent', 'upcoming', 'upcoming']
  );
  // A blank cell within the reported range (e.g. today's own cell before check-in) is
  // 'pending' — distinct from 'absent' (an explicit −1) and 'upcoming' (day hasn't arrived).
  assert.deepEqual(buildDaySegments_([1, ''], 3), ['done', 'pending', 'upcoming']);
  assert.deepEqual(buildDaySegments_([], 2), ['upcoming', 'upcoming']);
})();

// ── buildRollingAverage_ ───────────────────────────────────────────────────
(function testBuildRollingAverage() {
  var raw = [1, 1, 1, 0, -1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
  var series = buildRollingAverage_(raw, 7);
  assert.equal(series.length, raw.length);
  assert.equal(series[0], 1);
  assert.equal(series[3], 0.75); // window [1,1,1,0]
  assert.ok(Math.abs(series[4] - 0.4) < 1e-9); // window [1,1,1,0,-1]
  assert.equal(series[17], 1); // last 7 days all 1s

  // Blank cells (not-yet-reported) within the window are excluded from the average, not
  // treated as 0.
  var withBlank = [1, '', 0];
  var series2 = buildRollingAverage_(withBlank, 2);
  assert.equal(series2[0], 1);
  assert.equal(series2[1], 1); // window [1, ''] -> only 1 counts
  assert.equal(series2[2], 0); // window ['', 0] -> only 0 counts
})();

console.log('test_dashboard_webapp.js: all assertions passed');
