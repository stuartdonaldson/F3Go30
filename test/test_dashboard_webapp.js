const assert = require('node:assert/strict');

function makeFakeScriptCache_() {
  var store = {};
  return {
    get: function(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    put: function(key, value) { store[key] = value; },
    _store: store,
  };
}

var fakeScriptCache_ = makeFakeScriptCache_();
global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };

const {
  classifyTrackerColumns_,
  findDateColumnIndex_,
  findTrackerRowIndexByName_,
  computeStreak_,
  computeMaxStreak_,
  countOutcomes_,
  needsYesterdayCheckin_,
  dayValueStatus_,
  groupByTeam_,
  buildBonusByType_,
  buildDaySegments_,
  buildRollingAverage_,
  buildRollingAverageWithLookback_,
  getCachedTrackerLayoutOnly_,
  trackerLayoutCacheKey_,
  serializeRow3ForCache_,
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

// ── computeMaxStreak_ ────────────────────────────────────────────────────
(function testComputeMaxStreak() {
  // Longest run of 1's anywhere in the array, not just the trailing run (contrast computeStreak_).
  assert.equal(computeMaxStreak_([1, 1, 0, 1, 1, 1, 0, 1]), 3);
  assert.equal(computeMaxStreak_([1, 1, 1, '', '']), 3); // trailing blanks trimmed first
  assert.equal(computeMaxStreak_([]), 0);
  assert.equal(computeMaxStreak_([0, -1, 0]), 0);
  // windowDays restricts to the trailing N reported values — "max streak in the last 30 days".
  var monthOfOnes = new Array(40).fill(1);
  monthOfOnes[5] = 0;
  assert.equal(computeMaxStreak_(monthOfOnes, 30), 30); // last 30 entries (idx 10..39) are unaffected by idx 5
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

// ── dayValueStatus_ ──────────────────────────────────────────────────────
(function testDayValueStatus() {
  assert.equal(dayValueStatus_(1), 'done');
  assert.equal(dayValueStatus_(0), 'missed');
  assert.equal(dayValueStatus_(-1), 'absent');
  // Blank/not-yet-reported is 'pending' — never treated as an error or as the -1 outcome.
  assert.equal(dayValueStatus_(''), 'pending');
  assert.equal(dayValueStatus_(undefined), 'pending');
  assert.equal(dayValueStatus_(null), 'pending');
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
(function testBuildBonusByType() {
  // Columns A-H: Name, Team, Fellowship, Q-Point, Inspire, EHing FNG, Raw Score, Score.
  var trackerRow = ['Crazy Ivan', 'Crucible', 3, 2, 1, 5, 11, 25];
  var byType = buildBonusByType_(trackerRow);
  assert.deepEqual(byType, { fe: 3, q: 2, ins: 1, eh: 5 });
})();

(function testBuildBonusByTypeDefaultsBlankCellsToZero() {
  var trackerRow = ['Little John', 'Crucible', '', '', '', '', 8, 8];
  assert.deepEqual(buildBonusByType_(trackerRow), { fe: 0, q: 0, ins: 0, eh: 0 });
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

// ── buildRollingAverageWithLookback_ ────────────────────────────────────────
(function testBuildRollingAverageWithLookbackCrossesMonthBoundary() {
  // Day 2 of a new month: without lookback this would only average [1, 0] (window of 2).
  // With 5 trailing days from last month prepended, it should be a true 7-day window.
  var priorTail = [1, 1, 1, 1, 1]; // last 5 days of the previous month, all done
  var thisMonth = [1, 0]; // first 2 days of the new month
  var series = buildRollingAverageWithLookback_(thisMonth, 7, priorTail);
  assert.equal(series.length, thisMonth.length); // aligned to thisMonth, not the combined array
  // Day 1: window = last 5 prior + day1 = [1,1,1,1,1,1] -> 1
  assert.equal(series[0], 1);
  // Day 2: window = last 5 prior + day1 + day2 = [1,1,1,1,1,1,0] (7 days) -> 6/7
  assert.ok(Math.abs(series[1] - 6 / 7) < 1e-9);
})();

(function testBuildRollingAverageWithLookbackNoPriorMonth() {
  // No prior tracker (e.g. the very first month ever) — behaves exactly like buildRollingAverage_.
  var values = [1, 0, 1];
  assert.deepEqual(buildRollingAverageWithLookback_(values, 7, []), buildRollingAverage_(values, 7));
  assert.deepEqual(buildRollingAverageWithLookback_(values, 7, undefined), buildRollingAverage_(values, 7));
})();

(function testBuildRollingAverageWithLookbackOnlyUsesTrailingWindowMinusOneDays() {
  // A long prior-month tail is trimmed to windowSize-1 — older days shouldn't leak in further
  // than a true rolling window would ever reach.
  var longTail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1]; // 13 days, only last 2 matter for window=3
  var series = buildRollingAverageWithLookback_([1], 3, longTail);
  // window = last 2 of tail ([1,1]) + [1] = [1,1,1] -> 1, not dragged down by the older 0s.
  assert.equal(series[0], 1);
})();

// ── getCachedTrackerLayoutOnly_ ──────────────────────────────────────────
// This is the fast-path check getPriorMonthTailValues_ uses to decide whether it can skip
// SpreadsheetApp.openById entirely on a repeat view of a prior month's tracker.
(function testGetCachedTrackerLayoutOnlyMiss() {
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };
  assert.equal(getCachedTrackerLayoutOnly_('no-such-sheet'), null);
})();

(function testGetCachedTrackerLayoutOnlyHit() {
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };
  var row2 = ['', 1, 2];
  var row3 = ['F3 Name', new Date(2026, 5, 1), 'Bonus'];
  fakeScriptCache_.put(trackerLayoutCacheKey_('sheetA'), JSON.stringify({
    row2: row2, row3: serializeRow3ForCache_(row3),
  }));

  var layout = getCachedTrackerLayoutOnly_('sheetA');
  assert.deepEqual(layout.row2, row2);
  assert.equal(layout.row3[0], 'F3 Name');
  assert.ok(layout.row3[1] instanceof Date);
  assert.equal(layout.row3[1].getTime(), row3[1].getTime());
})();

(function testGetCachedTrackerLayoutOnlyCorruptEntryIsTreatedAsMiss() {
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };
  fakeScriptCache_.put(trackerLayoutCacheKey_('sheetB'), 'not json');
  assert.equal(getCachedTrackerLayoutOnly_('sheetB'), null);
})();

(function testGetCachedTrackerLayoutOnlyIsSheetIdScoped() {
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };
  fakeScriptCache_.put(trackerLayoutCacheKey_('sheetA'), JSON.stringify({ row2: ['x'], row3: ['y'] }));
  assert.equal(getCachedTrackerLayoutOnly_('sheetC'), null);
})();

console.log('test_dashboard_webapp.js: all assertions passed');
