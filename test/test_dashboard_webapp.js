const assert = require('node:assert/strict');

function makeFakeScriptCache_() {
  var store = {};
  return {
    get: function(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    put: function(key, value) { store[key] = value; },
    remove: function(key) { delete store[key]; },
    _store: store,
  };
}

var fakeScriptCache_ = makeFakeScriptCache_();
global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };
global.GasLogger = { log: function() {}, logError: function() {}, run: function(name, fn) { return fn(); } };

// In-memory stand-in for PropertiesService.getScriptProperties() — needed transitively by
// PaxCache.js/CheckinSessions.js, both of which store state via PropertiesService
// (F3Go30-xj1q.1's handleCheckinIdentify_ PaxDB-fallback tests below).
var fakeScriptProperties_ = { getProperty: function() { return null; } };
global.PropertiesService = { getScriptProperties: function() { return fakeScriptProperties_; } };

// resolveContextDate_ (go30tools.js, F3Go30-31w5.1) isn't required by this file — these tests
// don't exercise contextDate override behavior (see test_context_date.js for that), so a plain
// real-clock stub keeps existing "what day is it" call sites working unchanged.
global.resolveContextDate_ = function() { return new Date(); };

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
  firstActiveDayIndex_,
  buildDashboardPaxRow_,
  buildDaySegments_,
  buildRollingAverage_,
  buildRollingAverageWithLookback_,
  getCachedTrackerLayoutOnly_,
  trackerLayoutCacheKey_,
  serializeRow3ForCache_,
  serializeSheetValuesForCache_,
  deserializeSheetValuesFromCache_,
  getCachedSheetValuesOnly_,
  setCachedSheetValues_,
  trackerValuesCacheKey_,
  responsesValuesCacheKey_,
  invalidateFullRosterCache_,
  handleCheckinIdentify_,
  checkNextMonthRegistration_,
  buildMonthGridEntries_,
  isStrictlyPastCalendarDate_,
  validateCheckinSubmitDayValue_,
  handleCheckinSubmit_,
  handleCheckinDashboard_,
  buildResolvedContextHandle_,
  monthInfoFromHandle_,
  resolveLeanIdentityFromHandle_,
  resolveFullIdentityFromHandle_,
  buildTrackerValuesFromPaxCache_,
  makeLazySpreadsheet_dw_,
  responsesLayoutCacheKey_,
  getCachedResponsesLayoutOnly_,
  getResponsesLayout_,
  resolveCheckinIdentityLean_,
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

// ── buildDashboardPaxRow_ ──────────────────────────────────────────────────
// F3Go30-y55y: the team/board view only ever showed day-grid/score/streak — bonusByType is a
// per-PAX board field, same as score/streak, not something only the logged-in PAX's own tile
// gets (that was the bug: handleCheckinDashboard_ only ever computed it once, for the
// identified PAX, never per-row in the allPaxRows loop this function backs).
(function testBuildDashboardPaxRowIncludesBonusByType() {
  var bonusByType = { fe: 3, q: 2, ins: 1, eh: 5 };
  var row = buildDashboardPaxRow_('Crazy Ivan', 'Crucible', 25, 11, 4, [1, 1, 0, 1], 30, 4, bonusByType);
  assert.deepEqual(row.bonusByType, bonusByType);
})();

(function testBuildDashboardPaxRowDefaultsBonusByTypeWhenOmitted() {
  // A caller that doesn't pass bonusByType (shouldn't happen post-fix, but must not throw)
  // gets the all-zero shape.
  var row = buildDashboardPaxRow_('Little John', 'Crucible', 8, 8, 2, [1, 1], 30, 2);
  assert.deepEqual(row.bonusByType, { fe: 0, q: 0, ins: 0, eh: 0 });
})();

// ── firstActiveDayIndex_ (F3Go30-nhge.1) ────────────────────────────────────
(function testFirstActiveDayIndexFindsFirstOneOrZero() {
  assert.equal(firstActiveDayIndex_([-1, -1, 1, 0, 1]), 2);
  assert.equal(firstActiveDayIndex_([-1, 0, -1]), 1);
  assert.equal(firstActiveDayIndex_(['', '', 1]), 2);
})();

(function testFirstActiveDayIndexReturnsMinusOneWhenNoneFound() {
  assert.equal(firstActiveDayIndex_([-1, -1, -1]), -1);
  assert.equal(firstActiveDayIndex_([]), -1);
  assert.equal(firstActiveDayIndex_(['', '']), -1);
})();

// ── buildDashboardPaxRow_ scorePct: per-PAX denominator (F3Go30-nhge.1) ─────
(function testBuildDashboardPaxRowScorePctAnchoredAtMidMonthJoin() {
  // PAX joined on day 3 (idx 2): days 0-1 are '' (not yet enrolled), day 2 is the first real
  // check-in. Denominator is currentDay(4) - firstActiveIdx(2) = 2, not currentDay(4).
  var row = buildDashboardPaxRow_('Mid Joiner', 'Crucible', 2, 2, 2, ['', '', 1, 1], 30, 4);
  assert.equal(row.scorePct, 100); // score 2 / denom 2 == 100%, not 2/4 == 50%
})();

(function testBuildDashboardPaxRowScorePctUnchangedForDayOneJoiner() {
  // PAX active since day 0 — firstActiveIdx is 0, so denom === currentDay, same as before.
  var row = buildDashboardPaxRow_('Day One', 'Crucible', 3, 3, 3, [1, 1, 1, 0], 30, 4);
  assert.equal(row.scorePct, Math.round((3 / 4) * 100));
})();

(function testBuildDashboardPaxRowScorePctFallsBackWhenNoActiveDay() {
  // No 1/0 found at all (denom -1 -> denom 0 case) keeps the existing score>=0?100:0 fallback.
  var row = buildDashboardPaxRow_('Never Checked In', 'Crucible', 0, 0, 0, ['', '', '', ''], 30, 4);
  assert.equal(row.scorePct, 100);
})();

// ── buildDashboardPaxRow_ scorePct: anchor-through-today denominator (F3Go30-nhge.2) ───────
// Exercises the 8 cases from the parent bug's (F3Go30-nhge) AC, using a 30-day month (indices
// 0..29, idx 29 = today). Cases 2 and 5 assert what the shipped nhge.1 implementation actually
// does, which diverges from the parent bug's literal AC text (no blank-today denom adjustment;
// firstActiveDayIndex_ ignores leading -1 entirely rather than anchoring on it). Per nhge.2
// resolution, nhge.1's simpler shipped behavior was kept rather than reopened/rewritten to
// match the older design — these tests lock in the real behavior, not the aspirational one.
(function testScorePctCanonicalJoinerPerfectIncludingToday() {
  // Case 1: joined day 10 (idx 9), perfect every day through today (idx 29).
  var dayValues = new Array(9).fill('').concat(new Array(21).fill(1));
  var row = buildDashboardPaxRow_('Joiner', 'Crucible', 21, 21, 21, dayValues, 30, 30);
  assert.equal(row.scorePct, 100);
})();

(function testScorePctJoinerPerfectThroughYesterdayBlankToday() {
  // Case 2 (deviates from parent AC's literal "100%"): joined day 10, perfect through
  // yesterday, hasn't checked in yet today (idx 29 blank). The shipped denom has no blank-
  // today adjustment, so today's still-blank cell stays in the denominator -> <100%.
  var dayValues = new Array(9).fill('').concat(new Array(20).fill(1)).concat(['']);
  var row = buildDashboardPaxRow_('Joiner', 'Crucible', 20, 20, 20, dayValues, 30, 30);
  assert.equal(row.scorePct, Math.round((20 / 21) * 100)); // 95, not 100
})();

(function testScorePctActivePaxBlankYesterdayCheckedInToday() {
  // Case 3: active since day 1, blank yesterday (idx 28, not yet marked missed), checked in
  // today (idx 29). Blank yesterday stays in the denominator without adding to the numerator.
  var dayValues = new Array(28).fill(1).concat(['', 1]);
  var row = buildDashboardPaxRow_('Active', 'Crucible', 29, 29, 1, dayValues, 30, 30);
  assert.equal(row.scorePct, Math.round((29 / 30) * 100));
  assert.ok(row.scorePct < 100);
})();

(function testScorePctJoinedTodayCheckedInToday() {
  // Case 4: joined today (idx 29 is the only non-blank cell) -> denom 1, pre-join yesterday
  // (and every earlier day) excluded entirely.
  var dayValues = new Array(29).fill('').concat([1]);
  var row = buildDashboardPaxRow_('Brand New', 'Crucible', 1, 1, 1, dayValues, 30, 30);
  assert.equal(row.scorePct, 100);
})();

(function testScorePctEnrolledSlackerLeadingAbsences() {
  // Case 5 (deviates from parent AC's literal "<100%, penalized"): enrolled since day 1 with
  // 3 leading -1 (no-show) days, then perfect. firstActiveDayIndex_ ignores -1 entirely and
  // anchors at the first 1/0 (idx 3), so the leading -1's fall OUTSIDE the window and are NOT
  // penalized under the shipped behavior.
  var dayValues = [-1, -1, -1].concat(new Array(27).fill(1));
  var row = buildDashboardPaxRow_('Slacker', 'Crucible', 27, 27, 27, dayValues, 30, 30);
  assert.equal(row.scorePct, 100);
})();

(function testScorePctNoRecordedDaysFallback() {
  // Case 6: no recorded days at all -> firstActiveIdx -1 -> denom 0 -> existing fallback.
  var dayValues = new Array(30).fill('');
  var row = buildDashboardPaxRow_('Ghost', 'Crucible', 0, 0, 0, dayValues, 30, 30);
  assert.equal(row.scorePct, 100);
})();

(function testScorePctFullMonthPaxUnchangedFromOldFormula() {
  // Case 7: no leading blanks, active since day 1, mix of hits/misses -> denom === currentDay,
  // matching the pre-nhge score/currentDay formula exactly (no regression for this case).
  var dayValues = new Array(25).fill(1).concat(new Array(5).fill(0));
  var row = buildDashboardPaxRow_('Veteran', 'Crucible', 25, 25, 0, dayValues, 30, 30);
  assert.equal(row.scorePct, Math.round((25 / 30) * 100));
})();

(function testScorePctChangeDoesNotAffectOtherFields() {
  // Case 8: streak/maxStreak30/rollingAverage/daySegments are computed independently of the
  // scorePct/anchor logic -- guard that the anchor computation only changes scorePct.
  var dayValues = new Array(9).fill('').concat(new Array(21).fill(1));
  var row = buildDashboardPaxRow_('Joiner', 'Crucible', 21, 21, 21, dayValues, 30, 30);
  assert.equal(row.streak, 21);
  assert.equal(row.maxStreak30, 21);
  assert.deepEqual(row.daySegments, new Array(9).fill('pending').concat(new Array(21).fill('done')));
  assert.equal(row.rollingAverage.length, dayValues.length);
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

// ── serializeSheetValuesForCache_ / deserializeSheetValuesFromCache_ ─────
(function testSerializeSheetValuesRoundTripsDatesAndPlainValues() {
  var values = [
    ['Little John', 'Crucible', new Date(2026, 6, 1), 1],
    ['Crazy Ivan', '', '', 0],
  ];
  var restored = deserializeSheetValuesFromCache_(JSON.parse(JSON.stringify(serializeSheetValuesForCache_(values))));
  assert.equal(restored[0][0], 'Little John');
  assert.ok(restored[0][2] instanceof Date);
  assert.equal(restored[0][2].getTime(), values[0][2].getTime());
  assert.equal(restored[1][2], '');
  assert.equal(restored[1][3], 0);
})();

// ── getCachedSheetValuesOnly_ / setCachedSheetValues_ / invalidateFullRosterCache_ ──
// Backs resolveCheckinIdentityFull_'s Responses/Tracker full-range reads — see that function's
// doc for why an uncached read here was the dashboard's actual bottleneck ("should be cached,
// nothing's touched it in days" turned out to mean "there is no cache for this path at all").
(function testGetCachedSheetValuesOnlyMissThenHitAfterSet() {
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };

  var key = trackerValuesCacheKey_('sheet-roster');
  assert.equal(getCachedSheetValuesOnly_(key), null);

  var values = [['Little John', 'Crucible', 1, 0, '']];
  setCachedSheetValues_(key, values);
  assert.deepEqual(getCachedSheetValuesOnly_(key), values);
})();

(function testGetCachedSheetValuesOnlyCorruptEntryIsTreatedAsMiss() {
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };
  fakeScriptCache_.put(responsesValuesCacheKey_('sheet-corrupt'), 'not json');
  assert.equal(getCachedSheetValuesOnly_(responsesValuesCacheKey_('sheet-corrupt')), null);
})();

(function testTrackerAndResponsesValuesCacheKeysAreDistinctAndSheetScoped() {
  assert.notEqual(trackerValuesCacheKey_('sheetA'), responsesValuesCacheKey_('sheetA'));
  assert.notEqual(trackerValuesCacheKey_('sheetA'), trackerValuesCacheKey_('sheetB'));
})();

(function testInvalidateFullRosterCacheClearsBothKeysForItsSheetOnly() {
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };

  setCachedSheetValues_(trackerValuesCacheKey_('sheet-x'), [['a']]);
  setCachedSheetValues_(responsesValuesCacheKey_('sheet-x'), [['b']]);
  setCachedSheetValues_(trackerValuesCacheKey_('sheet-y'), [['untouched']]);

  invalidateFullRosterCache_('sheet-x');

  assert.equal(getCachedSheetValuesOnly_(trackerValuesCacheKey_('sheet-x')), null);
  assert.equal(getCachedSheetValuesOnly_(responsesValuesCacheKey_('sheet-x')), null);
  assert.deepEqual(getCachedSheetValuesOnly_(trackerValuesCacheKey_('sheet-y')), [['untouched']]);
})();

// ── handleCheckinIdentify_ PaxDB fallback (F3Go30-xj1q.1) ──────────────────────────────────
// A PAX known to PaxDB from a prior signup, but absent from the CURRENT month's tracker, gets
// knownPaxNotRegistered:true instead of a dead-end "we couldn't find you" — the client uses
// this to auto-carry them into signup instead of stranding them. No TrackerDB sheet means
// getCurrentAndNextMonths_ resolves no current month, so resolveCheckinIdentity_ misses fast
// (dashboardWebapp.js:597) without needing a full Responses/Tracker fixture — exactly what lets
// this test isolate the new PaxDB-fallback branch on its own.
function makeFakePaxDbSpreadsheet_(paxDbRows) {
  return {
    getSheetByName: function(name) {
      if (name === 'PaxDB') {
        return { getDataRange: function() { return { getValues: function() { return paxDbRows; } }; } };
      }
      return null; // no TrackerDB -> months.current undefined -> resolveCheckinIdentity_ misses fast
    },
  };
}

var PAXDB_HEADERS_ = ['F3 Name', 'Email', 'SheetId', 'Team', 'WHO', 'WHAT', 'HOW', 'Team Type', 'Other Team', 'Phone', 'NAG Email'];

(function testHandleCheckinIdentifyPaxDbHitReturnsKnownPaxNotRegistered() {
  var fakeSpreadsheet = makeFakePaxDbSpreadsheet_([
    PAXDB_HEADERS_,
    ['LateSignupTest', 'latesignup@example.com', 'sheet-prior', 'Crucible', 'w', 'wh', 'ho', 'ao', '', '', ''],
  ]);
  var res = handleCheckinIdentify_(fakeSpreadsheet, { f3Name: 'LateSignupTest', email: 'latesignup@example.com' });
  assert.equal(res.matched, false);
  assert.equal(res.knownPaxNotRegistered, true);
  assert.equal(res.f3Name, 'LateSignupTest');
  assert.equal(res.email, 'latesignup@example.com');
  assert.equal(res.tokenInvalid, false);
  // No team/who/what/how leaked — signup re-fetches its own prefill (see the plan's Stage 2 note).
  assert.equal(res.team, undefined);
  assert.equal(res.who, undefined);
})();

(function testHandleCheckinIdentifyPaxDbMissLeavesMatchedFalseUnchanged() {
  var fakeSpreadsheet = makeFakePaxDbSpreadsheet_([PAXDB_HEADERS_]); // header only, no rows
  var res = handleCheckinIdentify_(fakeSpreadsheet, { f3Name: 'TrulyUnknown', email: 'unknown@example.com' });
  assert.equal(res.matched, false);
  assert.equal(res.knownPaxNotRegistered, undefined);
  assert.equal(res.f3Name, undefined);
})();

(function testHandleCheckinIdentifyPaxDbFallbackRequiresExactBothFieldsMatch() {
  // Anti-enumeration: a name-only or email-only match must not trigger the fallback — only an
  // EXACT match on both fields (findPaxDbMatch_'s existing rule, reused as-is here).
  var fakeSpreadsheet = makeFakePaxDbSpreadsheet_([
    PAXDB_HEADERS_,
    ['LateSignupTest', 'latesignup@example.com', 'sheet-prior', 'Crucible', 'w', 'wh', 'ho', 'ao', '', '', ''],
  ]);
  var nameOnly = handleCheckinIdentify_(fakeSpreadsheet, { f3Name: 'LateSignupTest', email: 'someone-else@example.com' });
  assert.equal(nameOnly.knownPaxNotRegistered, undefined);
  var emailOnly = handleCheckinIdentify_(fakeSpreadsheet, { f3Name: 'NotLateSignupTest', email: 'latesignup@example.com' });
  assert.equal(emailOnly.knownPaxNotRegistered, undefined);
})();

(function testHandleCheckinIdentifyTokenInvalidNeverConsultsPaxDb() {
  // The tokenInvalid branch (untrusted client-decoded f3Name/email) must never reach the PaxDB
  // fallback — that would turn it into a name+email enumeration oracle. A malformed token
  // (verifyIdentityToken_ returns null before ever needing a real signing key) exercises this.
  var paxDbCalled = false;
  var fakeSpreadsheet = {
    getSheetByName: function(name) {
      if (name === 'PaxDB') paxDbCalled = true;
      return null;
    },
  };
  var res = handleCheckinIdentify_(fakeSpreadsheet, { token: 'not-a-real-token', f3Name: 'LateSignupTest', email: 'latesignup@example.com' });
  assert.equal(res.matched, false);
  assert.equal(res.tokenInvalid, true);
  assert.equal(res.knownPaxNotRegistered, undefined);
  assert.equal(paxDbCalled, false);
})();

console.log('test_dashboard_webapp.js: PaxDB-fallback assertions passed');

// ── checkNextMonthRegistration_'s nudge-window gate (F3Go30 hardening work 2026-07) ─────────
// Don't push a PAX to sign up for next month more than NEXT_MONTH_SIGNUP_NUDGE_WINDOW_DAYS_ (3)
// days before it starts — showing up 3 weeks early reads as noise, not a helpful reminder.
(function testCheckNextMonthRegistrationSkipsWhenFarInAdvance() {
  var farFuture = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000); // 20 days out
  // No SpreadsheetApp global at all — if the date gate doesn't short-circuit before ever
  // opening a spreadsheet, this throws a ReferenceError and fails loudly rather than silently.
  var result = checkNextMonthRegistration_({ next: { sheetId: 'sheet-next', label: 'August 2026', startDate: farFuture } }, 'Anchor');
  assert.equal(result, null);
})();

(function testCheckNextMonthRegistrationProceedsWithinWindow() {
  var soon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000); // 2 days out — inside the window
  var responsesHeaders = [
    'Timestamp', 'Email Address', 'Are you currently participating in Go30?', 'F3 Name',
    'Team type', 'Team', 'Goal or other team name', 'WHO do you ultimately want to become?',
    'WHAT is your Go30 Challenge?', 'HOW are you going to be successful this month?',
    'Cell Phone Number', 'NAG email?', 'Constructive Comments',
  ];
  var fakeResponsesSheet = {
    getRange: function(row, col, numRows, numCols) {
      if (row === 1) return { getValues: function() { return [responsesHeaders]; } };
      return { getValues: function() { return []; } };
    },
    getLastRow: function() { return 1; }, // header only — this PAX has no row yet
    getLastColumn: function() { return responsesHeaders.length; },
  };
  global.SpreadsheetApp = {
    openById: function() { return { getSheetByName: function(name) { return name === 'Responses' ? fakeResponsesSheet : null; } }; },
  };
  var result = checkNextMonthRegistration_({ next: { sheetId: 'sheet-next', label: 'August 2026', startDate: soon } }, 'Anchor');
  assert.deepEqual(result, { registered: false, monthLabel: 'August 2026' });
  delete global.SpreadsheetApp;
})();

console.log('test_dashboard_webapp.js: nudge-window assertions passed');

// ── buildMonthGridEntries_ (F3Go30-th22.2, Decision 2) ────────────────────
(function testBuildMonthGridEntriesMapsDayColsToStatuses() {
  var dayCols = [
    { col: 8, date: new Date(2026, 5, 1) },
    { col: 9, date: new Date(2026, 5, 2) },
    { col: 10, date: new Date(2026, 5, 3) },
  ];
  var trackerRow = [];
  trackerRow[8] = 1; trackerRow[9] = 0; trackerRow[10] = '';
  var grid = buildMonthGridEntries_(dayCols, trackerRow);
  assert.deepEqual(grid, [
    { dateIso: '2026-06-01', status: 'done' },
    { dateIso: '2026-06-02', status: 'missed' },
    { dateIso: '2026-06-03', status: 'pending' },
  ]);
})();

(function testBuildMonthGridEntriesHandlesFutureAndAbsentDays() {
  var dayCols = [{ col: 8, date: new Date(2026, 5, 30) }];
  var trackerRow = []; trackerRow[8] = -1;
  assert.deepEqual(buildMonthGridEntries_(dayCols, trackerRow), [{ dateIso: '2026-06-30', status: 'absent' }]);
  assert.deepEqual(buildMonthGridEntries_([], []), []);
})();

// ── isStrictlyPastCalendarDate_ (F3Go30-th22.2, Decision 1 -1 date gate) ──
(function testIsStrictlyPastCalendarDate() {
  var today = new Date(2026, 6, 15, 9, 30); // time-of-day must not matter
  assert.equal(isStrictlyPastCalendarDate_(new Date(2026, 6, 14, 23, 59), today), true);
  assert.equal(isStrictlyPastCalendarDate_(new Date(2026, 6, 15, 0, 0), today), false); // today itself
  assert.equal(isStrictlyPastCalendarDate_(new Date(2026, 6, 16), today), false); // future
})();

// ── validateCheckinSubmitDayValue_ (F3Go30-th22.2, Decision 1 write contract) ──
(function testValidateCheckinSubmitDayValueAcceptsTodayYesterdayLiterals() {
  var r1 = validateCheckinSubmitDayValue_({ day: 'today', value: 1 });
  assert.equal(r1.ok, true);
  assert.equal(r1.explicitDate, null);
  var r2 = validateCheckinSubmitDayValue_({ day: 'yesterday', value: 0 });
  assert.equal(r2.ok, true);
  assert.equal(r2.explicitDate, null);
})();

(function testValidateCheckinSubmitDayValueAcceptsExplicitIsoDate() {
  var r = validateCheckinSubmitDayValue_({ day: '2026-06-15', value: -1 });
  assert.equal(r.ok, true);
  assert.ok(r.explicitDate instanceof Date);
  assert.equal(r.explicitDate.getFullYear(), 2026);
  assert.equal(r.explicitDate.getMonth(), 5);
  assert.equal(r.explicitDate.getDate(), 15);
})();

(function testValidateCheckinSubmitDayValueRejectsMalformedDay() {
  assert.deepEqual(validateCheckinSubmitDayValue_({ day: 'tomorrow', value: 1 }), { ok: false, error: 'invalid_day' });
  assert.deepEqual(validateCheckinSubmitDayValue_({ day: '2026-13-40', value: 1 }), { ok: false, error: 'invalid_day' });
  assert.deepEqual(validateCheckinSubmitDayValue_({ day: '', value: 1 }), { ok: false, error: 'invalid_day' });
})();

(function testValidateCheckinSubmitDayValueAcceptsAllFourValues() {
  [0, 1, null, -1].forEach(function(v) {
    assert.equal(validateCheckinSubmitDayValue_({ day: 'today', value: v }).ok, true);
  });
})();

(function testValidateCheckinSubmitDayValueRejectsOtherValues() {
  assert.deepEqual(validateCheckinSubmitDayValue_({ day: 'today', value: 2 }), { ok: false, error: 'invalid_value' });
  assert.deepEqual(validateCheckinSubmitDayValue_({ day: 'today', value: 'yes' }), { ok: false, error: 'invalid_value' });
  assert.deepEqual(validateCheckinSubmitDayValue_({ day: 'today', value: undefined }), { ok: false, error: 'invalid_value' });
})();

console.log('test_dashboard_webapp.js: month-grid / write-contract assertions passed');

// ── Resolved-context handle: identify → checkin/dashboard fast path (F3Go30-qi26.1) ──────────
// identify returns a lightweight handle (target sheetId, PAX rowIndex, monthKey, canonical F3
// name); checkin/dashboard echo it back and, when it still validates, skip resolveMonths + the
// identity re-lookup and go straight to the known row. A stale handle (row no longer names this
// PAX, missing sheet) transparently falls back to full resolution.

// A fuller in-memory PropertiesService than the getProperty-only stub above — PaxCache's
// setPaxCacheRow_/setPaxCacheRowsBulk_ (called on the handle fast path to keep per-PAX rows warm)
// wrap their writes in try/catch, but back them with a real store so a warmed row round-trips.
function installFakePropertiesStore_() {
  var store = {};
  global.PropertiesService = {
    getScriptProperties: function() {
      return {
        getProperty: function(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
        setProperty: function(k, v) { store[k] = String(v); },
        deleteProperty: function(k) { delete store[k]; },
        getProperties: function() { return Object.assign({}, store); },
        getKeys: function() { return Object.keys(store); },
        setProperties: function(batch) { Object.keys(batch).forEach(function(k) { store[k] = String(batch[k]); }); },
      };
    },
  };
  return store;
}

// Minimal Tracker sheet: row2 (bonus period numbers), row3 (F3 Name + date/'Bonus' headers), and
// data rows from row 4. setValue/clearContent record what was written so a submit can be asserted.
function makeFakeTrackerSheet_(row2, row3, paxRows) {
  var width = [row2, row3].concat(paxRows).reduce(function(m, r) { return Math.max(m, r.length); }, 0);
  var writes = [];
  var sheet = {
    getLastRow: function() { return 3 + paxRows.length; },
    getLastColumn: function() { return width; },
    _fullRangeReadCount: 0,
    getRange: function(row, col, numRows) {
      if (row === 4 && numRows > 1) sheet._fullRangeReadCount++;
      return {
        getValues: function() {
          if (row === 2) return [row2.slice()];
          if (row === 3) return [row3.slice()];
          var out = [];
          for (var i = 0; i < (numRows || 1); i++) out.push((paxRows[row - 4 + i] || []).slice());
          return out;
        },
        getFormula: function() { return ''; },
        setValue: function(v) { writes.push({ row: row, col: col, value: v }); },
        clearContent: function() { writes.push({ row: row, col: col, value: null }); },
      };
    },
    _writes: writes,
  };
  return sheet;
}

function installFakeSpreadsheetById_(bySheetId) {
  global.SpreadsheetApp = {
    openById: function(id) {
      if (!Object.prototype.hasOwnProperty.call(bySheetId, id)) throw new Error('no such spreadsheet: ' + id);
      return bySheetId[id];
    },
  };
}

// Shared fixture: a July 2026 tracker with two day columns (Jul 1, Jul 2) and two PAX.
function makeHandleFixture_() {
  var row2 = ['', '', '', '', '', '', '', '', '', ''];
  var row3 = ['F3 Name', 'Goal / Team', '', '', '', '', 'Raw Score', 'Score',
    new Date(2026, 6, 1), new Date(2026, 6, 2)];
  var paxRows = [
    ['Anchor', 'Crucible', '', '', '', '', 5, 0.5, 1, ''],   // rowIndex 0
    ['Slaw', 'Impala', '', '', '', '', 3, 0.3, 0, 1],         // rowIndex 1
  ];
  var trackerSheet = makeFakeTrackerSheet_(row2, row3, paxRows);
  installFakeSpreadsheetById_({ 'sheet-jul': { getSheetByName: function(n) { return n === 'Tracker' ? trackerSheet : null; } } });
  var monthInfo = { sheetId: 'sheet-jul', trackerUrl: 'https://example/jul', label: 'July 2026', startDate: new Date(2026, 6, 1) };
  return { trackerSheet: trackerSheet, monthInfo: monthInfo };
}

// buildResolvedContextHandle_ / monthInfoFromHandle_ round-trip
(function testHandleRoundTrip() {
  var monthInfo = { sheetId: 'sheet-jul', trackerUrl: 'https://x/jul', label: 'July 2026', startDate: new Date(2026, 6, 1) };
  var handle = buildResolvedContextHandle_(monthInfo, 1, 'Anchor');
  assert.equal(handle.sheetId, 'sheet-jul');
  assert.equal(handle.monthKey, '2026-07');
  assert.equal(handle.startDateIso, '2026-07-01');
  assert.equal(handle.rowIndex, 1);
  assert.equal(handle.f3Name, 'Anchor');
  var back = monthInfoFromHandle_(handle);
  assert.equal(back.sheetId, 'sheet-jul');
  assert.equal(back.label, 'July 2026');
  assert.equal(back.startDate.getFullYear(), 2026);
  assert.equal(back.startDate.getMonth(), 6);
  assert.equal(back.startDate.getDate(), 1);
  // A handle missing the fields needed to be trusted yields null (never a half-built monthInfo).
  assert.equal(monthInfoFromHandle_(null), null);
  assert.equal(monthInfoFromHandle_({ sheetId: 'x' }), null);
})();

// resolveLeanIdentityFromHandle_ — valid handle resolves without any month/Responses lookup
(function testLeanFromHandleValid() {
  installFakePropertiesStore_();
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };
  var fx = makeHandleFixture_();
  var handle = buildResolvedContextHandle_(fx.monthInfo, 0, 'Anchor');

  var identity = resolveLeanIdentityFromHandle_(handle);
  assert.ok(identity, 'valid handle should resolve');
  assert.equal(identity.matched, true);
  assert.equal(identity.fromHandle, true);
  assert.equal(identity.trackerRowIndex, 0);
  assert.equal(identity.trackerRow[0], 'Anchor');
  assert.equal(identity.monthInfo.sheetId, 'sheet-jul');
  delete global.SpreadsheetApp;
})();

// resolveLeanIdentityFromHandle_ — stale rowIndex (row no longer names this PAX) → null (fallback)
(function testLeanFromHandleStaleNameMismatch() {
  installFakePropertiesStore_();
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };
  makeHandleFixture_();
  // rowIndex 1 is 'Slaw', but the handle claims 'Anchor' lives there — a roster edit shifted rows.
  var handle = buildResolvedContextHandle_({ sheetId: 'sheet-jul', label: 'July 2026', startDate: new Date(2026, 6, 1) }, 1, 'Anchor');
  assert.equal(resolveLeanIdentityFromHandle_(handle), null);
  delete global.SpreadsheetApp;
})();

// resolveLeanIdentityFromHandle_ — unopenable sheet / out-of-range row / malformed handle → null
(function testLeanFromHandleInvalidInputs() {
  installFakePropertiesStore_();
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };
  makeHandleFixture_();
  assert.equal(resolveLeanIdentityFromHandle_({ sheetId: 'sheet-gone', startDateIso: '2026-07-01', rowIndex: 0, f3Name: 'Anchor' }), null);
  assert.equal(resolveLeanIdentityFromHandle_({ sheetId: 'sheet-jul', startDateIso: '2026-07-01', rowIndex: 99, f3Name: 'Anchor' }), null);
  assert.equal(resolveLeanIdentityFromHandle_({ sheetId: 'sheet-jul', startDateIso: '2026-07-01', f3Name: 'Anchor' }), null); // no rowIndex
  delete global.SpreadsheetApp;
})();

// handleCheckinSubmit_ with a valid handle writes to the known row WITHOUT resolveMonths — proven
// by giving it a templateSpreadsheet whose getSheetByName always throws: any fall-through to
// resolveCheckinIdentity_ (getCurrentAndNextMonths_) would blow up on it, so a clean write means
// the fast path was taken.
(function testSubmitUsesHandleAndSkipsFullResolution() {
  installFakePropertiesStore_();
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };
  global.resolveContextDate_ = function() { return new Date(2026, 6, 2, 9, 0); }; // "today" = Jul 2
  var fx = makeHandleFixture_();
  var handle = buildResolvedContextHandle_(fx.monthInfo, 0, 'Anchor');
  var hostileTemplate = { getSheetByName: function() { throw new Error('full resolution must not run'); } };

  var res = handleCheckinSubmit_(hostileTemplate, { f3Name: 'Anchor', email: 'a@x.com', day: '2026-07-02', value: 1, resolvedContext: handle });
  assert.equal(res.ok, true);
  // Jul 2 is col index 9 (0-based) -> sheet col 10; Anchor is rowIndex 0 -> sheet row 4.
  assert.deepEqual(fx.trackerSheet._writes, [{ row: 4, col: 10, value: 1 }]);
  delete global.SpreadsheetApp;
  global.resolveContextDate_ = function() { return new Date(); };
})();

// handleCheckinSubmit_ with a STALE handle falls back to full resolution transparently — here the
// fallback itself has no TrackerDB (getSheetByName returns null), so it just reports not_found
// rather than erroring: the stale handle produced no user-visible crash.
(function testSubmitStaleHandleFallsBackNoCrash() {
  installFakePropertiesStore_();
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };
  global.resolveContextDate_ = function() { return new Date(2026, 6, 2, 9, 0); };
  makeHandleFixture_();
  // rowIndex 1 is 'Slaw', handle claims 'Anchor' -> stale -> lean-from-handle returns null.
  var staleHandle = buildResolvedContextHandle_({ sheetId: 'sheet-jul', label: 'July 2026', startDate: new Date(2026, 6, 1) }, 1, 'Anchor');
  var noTrackerDbTemplate = { getSheetByName: function() { return null; } };
  var res = handleCheckinSubmit_(noTrackerDbTemplate, { f3Name: 'Anchor', email: 'a@x.com', day: '2026-07-02', value: 1, resolvedContext: staleHandle });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'not_found');
  delete global.SpreadsheetApp;
  global.resolveContextDate_ = function() { return new Date(); };
})();

// resolveFullIdentityFromHandle_ — valid handle returns the full roster + the handle's rowIndex
(function testFullFromHandleValid() {
  installFakePropertiesStore_();
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };
  var fx = makeHandleFixture_();
  var handle = buildResolvedContextHandle_(fx.monthInfo, 1, 'Slaw');
  var identity = resolveFullIdentityFromHandle_(handle);
  assert.ok(identity);
  assert.equal(identity.matched, true);
  assert.equal(identity.rowIndex, 1);
  assert.equal(identity.trackerValues.length, 2);
  assert.equal(identity.trackerValues[identity.rowIndex][0], 'Slaw');
  delete global.SpreadsheetApp;
})();

// resolveFullIdentityFromHandle_ — a shifted rowIndex still resolves by re-deriving from the
// freshly-built roster index (self-heals within the correct month); a wholly-absent PAX → null.
(function testFullFromHandleStaleRowSelfHealsThenNull() {
  installFakePropertiesStore_();
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };
  makeHandleFixture_();
  // Handle says Anchor is at rowIndex 1, but Anchor is really at 0 — re-derive from the roster.
  var shifted = buildResolvedContextHandle_({ sheetId: 'sheet-jul', label: 'July 2026', startDate: new Date(2026, 6, 1) }, 1, 'Anchor');
  var healed = resolveFullIdentityFromHandle_(shifted);
  assert.ok(healed);
  assert.equal(healed.rowIndex, 0);

  var gone = buildResolvedContextHandle_({ sheetId: 'sheet-jul', label: 'July 2026', startDate: new Date(2026, 6, 1) }, 0, 'GhostPax');
  assert.equal(resolveFullIdentityFromHandle_(gone), null);
  delete global.SpreadsheetApp;
})();

// resolveFullIdentityFromHandle_ — the whole-roster read stays (the board needs every PAX's row),
// and never touches DriveApp at all — freshness is solely write-through + onEdit-driven now
// (the per-request Drive-modtime probe was retired, F3Go30-o39s.7).
(function testFullFromHandleNeverProbesDriveOnColdOrWarmCache() {
  installFakePropertiesStore_();
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };
  var driveCalls = 0;
  global.DriveApp = { getFileById: function() { driveCalls++; return { getLastUpdated: function() { return new Date(1000); } }; } };

  var fx = makeHandleFixture_();
  var handle = buildResolvedContextHandle_(fx.monthInfo, 1, 'Slaw');

  var cold = resolveFullIdentityFromHandle_(handle);
  assert.ok(cold);
  assert.equal(cold.trackerValues.length, 2);
  assert.equal(cold.rowIndex, 1);
  assert.equal(driveCalls, 0);

  var warm = resolveFullIdentityFromHandle_(handle);
  assert.ok(warm);
  assert.equal(warm.trackerValues.length, 2);
  assert.equal(driveCalls, 0);

  delete global.DriveApp;
  delete global.SpreadsheetApp;
})();

// ── Lazy spreadsheet open (F3Go30-440b.6) ────────────────────────────────
// A full PaxCache/layout cache hit must never call SpreadsheetApp.openById — that's the whole
// point of the lazy wrapper. Every test below proves it with a throw-if-opened stub, the same
// "hostileTemplate" convention already used for TrackerDB-skip tests in this file.

function installThrowingSpreadsheetApp_() {
  global.SpreadsheetApp = {
    openById: function() { throw new Error('SpreadsheetApp.openById must not be called — full cache hit expected'); },
  };
}

function installCountingSpreadsheetApp_(bySheetId) {
  var calls = [];
  global.SpreadsheetApp = {
    openById: function(id) {
      calls.push(id);
      if (!Object.prototype.hasOwnProperty.call(bySheetId, id)) throw new Error('no such spreadsheet: ' + id);
      return bySheetId[id];
    },
  };
  return calls;
}

(function testMakeLazySpreadsheetOpensOnlyOnFirstGet() {
  var calls = installCountingSpreadsheetApp_({ 'sheet-x': { marker: 'x' } });
  var lazy = makeLazySpreadsheet_dw_('sheet-x');
  assert.equal(lazy.getOpenMs(), 0, 'openMs stays 0 before .get() is ever called');
  assert.equal(calls.length, 0);

  var ss1 = lazy.get();
  assert.equal(ss1.marker, 'x');
  assert.equal(calls.length, 1);
  assert.ok(lazy.getOpenMs() >= 0);

  var ss2 = lazy.get();
  assert.equal(ss2, ss1, 'second .get() reuses the memoized handle');
  assert.equal(calls.length, 1, 'openById is called exactly once regardless of how many times .get() is called');
  delete global.SpreadsheetApp;
})();

// ── Responses header layout cache (F3Go30-440b.6) — mirrors getTrackerLayout_/
// getCachedTrackerLayoutOnly_'s cache-only/full-read split exactly.
var RESPONSES_HEADERS_FIXTURE_ = [
  'Timestamp', 'Email Address', 'Are you currently participating in Go30?', 'F3 Name',
  'Team type', 'Team', 'Goal or other team name', 'WHO do you ultimately want to become?',
  'WHAT is your Go30 Challenge?', 'HOW are you going to be successful this month?',
  'Cell Phone Number', 'NAG email?', 'Constructive Comments',
];

(function testGetCachedResponsesLayoutOnlyMissThenGetResponsesLayoutPopulatesIt() {
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };
  assert.equal(getCachedResponsesLayoutOnly_('sheet-r'), null);

  var readCount = 0;
  var fakeResponsesSheet = {
    getLastColumn: function() { return RESPONSES_HEADERS_FIXTURE_.length; },
    getRange: function() {
      readCount++;
      return { getValues: function() { return [RESPONSES_HEADERS_FIXTURE_]; } };
    },
  };
  var layout = getResponsesLayout_(fakeResponsesSheet, 'sheet-r');
  assert.equal(readCount, 1);
  assert.equal(layout.columns.F3_NAME, 3);
  assert.deepEqual(layout.headers, RESPONSES_HEADERS_FIXTURE_);

  var cached = getCachedResponsesLayoutOnly_('sheet-r');
  assert.deepEqual(cached, layout);
  // A second getResponsesLayout_ call for the same sheetId must not re-read the sheet.
  var again = getResponsesLayout_(fakeResponsesSheet, 'sheet-r');
  assert.equal(readCount, 1, 'cache hit — no second live read');
  assert.deepEqual(again, layout);
})();

(function testGetCachedResponsesLayoutOnlyIsSheetIdScopedAndCorruptIsTreatedAsMiss() {
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };
  fakeScriptCache_.put(responsesLayoutCacheKey_('sheet-a'), JSON.stringify({ headers: ['x'], columns: {} }));
  assert.equal(getCachedResponsesLayoutOnly_('sheet-b'), null);
  fakeScriptCache_.put(responsesLayoutCacheKey_('sheet-c'), 'not json');
  assert.equal(getCachedResponsesLayoutOnly_('sheet-c'), null);
})();

// Fixture: a Responses sheet (one PAX, 'Anchor') + Tracker sheet (reuses makeFakeTrackerSheet_,
// defined below in the handle-fixture section) for exercising resolveCheckinIdentityLean_
// directly, bypassing resolveMonths_ (monthInfo is passed straight in).
function makeLeanIdentityResponsesSheet_(rows) {
  var readCount = { header: 0, rows: 0 };
  return {
    _readCount: readCount,
    getLastColumn: function() { return RESPONSES_HEADERS_FIXTURE_.length; },
    getLastRow: function() { return 1 + rows.length; },
    getRange: function(row, col, numRows) {
      if (row === 1) {
        readCount.header++;
        return { getValues: function() { return [RESPONSES_HEADERS_FIXTURE_]; } };
      }
      readCount.rows++;
      return {
        getValues: function() {
          var out = [];
          for (var i = 0; i < (numRows || 1); i++) out.push((rows[row - 2 + i] || []).slice());
          return out;
        },
      };
    },
  };
}

// resolveCheckinIdentityLean_ — full cache hit (Responses layout + Tracker layout + roster +
// row, both kinds) never calls SpreadsheetApp.openById at all (F3Go30-440b.6).
(function testResolveCheckinIdentityLeanFullCacheHitNeverOpens() {
  installFakePropertiesStore_();
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };

  var monthInfo = { sheetId: 'sheet-lean', trackerUrl: 'https://x/lean', label: 'July 2026', startDate: new Date(2026, 6, 1) };
  var responsesRow = ['', 'anchor@x.com', 'Yes', 'Anchor', '', 'Crucible', '', 'Who', 'What', 'How', '', '', ''];

  // Warm every cache piece via a real (counting) SpreadsheetApp first.
  var opens = installCountingSpreadsheetApp_({
    'sheet-lean': {
      getSheetByName: function(n) {
        if (n === 'Responses') return makeLeanIdentityResponsesSheet_([responsesRow]);
        if (n === 'Tracker') {
          return makeFakeTrackerSheet_(
            ['', '', '', '', '', '', '', '', '', ''],
            ['F3 Name', 'Goal / Team', '', '', '', '', 'Raw Score', 'Score', new Date(2026, 6, 1), new Date(2026, 6, 2)],
            [['Anchor', 'Crucible', '', '', '', '', 5, 0.5, 1, '']]
          );
        }
        return null;
      },
    },
  });
  var warmup = resolveCheckinIdentityLean_(monthInfo, 'Anchor', 'anchor@x.com', null);
  assert.equal(warmup.matched, true);
  assert.ok(opens.length >= 1, 'the warm-up call itself needs a live open');

  // Now swap in a throwing SpreadsheetApp — every piece resolveCheckinIdentityLean_ needs
  // (Responses layout, Tracker layout, roster index for both kinds, per-PAX row for both kinds)
  // is now cache-warm, so a repeat call must resolve WITHOUT ever calling openById.
  installThrowingSpreadsheetApp_();
  var identity = resolveCheckinIdentityLean_(monthInfo, 'Anchor', 'anchor@x.com', null);
  assert.equal(identity.matched, true);
  assert.equal(identity.trackerRow[0], 'Anchor');
  assert.equal(identity.targetSs.getOpenMs(), 0, 'openById was never called on the full-cache-hit path');

  delete global.SpreadsheetApp;
})();

// resolveCheckinIdentityLean_ — a cold cache (nothing warm) opens the spreadsheet exactly once,
// not once per gap (Responses layout miss + Tracker layout miss + two roster misses + two row
// misses would be 6 separate opens without memoization inside the lazy wrapper).
(function testResolveCheckinIdentityLeanColdCacheOpensExactlyOnce() {
  installFakePropertiesStore_();
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };

  var monthInfo = { sheetId: 'sheet-cold', trackerUrl: 'https://x/cold', label: 'July 2026', startDate: new Date(2026, 6, 1) };
  var responsesRow = ['', 'slaw@x.com', 'Yes', 'Slaw', '', 'Impala', '', 'Who', 'What', 'How', '', '', ''];
  var opens = installCountingSpreadsheetApp_({
    'sheet-cold': {
      getSheetByName: function(n) {
        if (n === 'Responses') return makeLeanIdentityResponsesSheet_([responsesRow]);
        if (n === 'Tracker') {
          return makeFakeTrackerSheet_(
            ['', '', '', '', '', '', '', '', '', ''],
            ['F3 Name', 'Goal / Team', '', '', '', '', 'Raw Score', 'Score', new Date(2026, 6, 1), new Date(2026, 6, 2)],
            [['Slaw', 'Impala', '', '', '', '', 3, 0.3, 0, 1]]
          );
        }
        return null;
      },
    },
  });

  var identity = resolveCheckinIdentityLean_(monthInfo, 'Slaw', 'slaw@x.com', null);
  assert.equal(identity.matched, true);
  assert.equal(identity.trackerRow[0], 'Slaw');
  assert.deepEqual(opens, ['sheet-cold'], 'one open reused (memoized) across the Responses AND Tracker live reads');

  delete global.SpreadsheetApp;
})();

// resolveCheckinIdentityLean_(..., needGoals=false) — checkin-submit's fallback and bonus both
// resolve identity/write without ever consuming goals/emailMismatch (F3Go30-o39s.9 audit, F9), so
// passing needGoals=false must skip the per-PAX Responses row fetch entirely (no rows-read, no
// PaxCache 'responses' row write) while still resolving matched/trackerRow via the Responses
// match + Tracker lookup, same as the needGoals=true path.
(function testResolveCheckinIdentityLeanNeedGoalsFalseSkipsResponsesRowRead() {
  installFakePropertiesStore_();
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };

  var monthInfo = { sheetId: 'sheet-needgoals', trackerUrl: 'https://x/needgoals', label: 'July 2026', startDate: new Date(2026, 6, 1) };
  var responsesRow = ['', 'bonus@x.com', 'Yes', 'BonusPax', '', 'Crucible', '', 'Who', 'What', 'How', '', '', ''];
  var responsesSheetInstance = makeLeanIdentityResponsesSheet_([responsesRow]);
  installCountingSpreadsheetApp_({
    'sheet-needgoals': {
      getSheetByName: function(n) {
        if (n === 'Responses') return responsesSheetInstance;
        if (n === 'Tracker') {
          return makeFakeTrackerSheet_(
            ['', '', '', '', '', '', '', '', '', ''],
            ['F3 Name', 'Goal / Team', '', '', '', '', 'Raw Score', 'Score', new Date(2026, 6, 1), new Date(2026, 6, 2)],
            [['BonusPax', 'Crucible', '', '', '', '', 5, 0.5, 1, '']]
          );
        }
        return null;
      },
    },
  });

  var identity = resolveCheckinIdentityLean_(monthInfo, 'BonusPax', 'bonus@x.com', null, false);
  assert.equal(identity.matched, true);
  assert.equal(identity.trackerRow[0], 'BonusPax', 'Tracker resolution still happens without goals');
  assert.equal(identity.goals, undefined, 'goals omitted when needGoals=false');
  assert.equal(identity.emailMismatch, undefined, 'emailMismatch omitted when needGoals=false');
  // 1 read = the roster-index build (needed for matching); the per-PAX row fetch that
  // needGoals=true would additionally pay for never happens.
  assert.equal(responsesSheetInstance._readCount.rows, 1, 'only the roster-index read happens; the per-PAX Responses row fetch is skipped when needGoals=false');

  delete global.SpreadsheetApp;
})();

// ── F3Go30-a2hq: a stale roster index must never bind a PAX to another PAX's row ─────────
// The live defect: signup appends the new PAX at the bottom, patches the roster index with that
// offset, then sortTrackerSheet_ re-sorts the whole sheet — moving the new PAX up and leaving
// the cached offset pointing at whoever now sits at the bottom. identify then reported that
// other PAX's f3Name/team under the caller's own email, and handleCheckinSubmit_ (which writes
// at rowIndex+4) would have written a check-in into their row.
//
// Fixture reproduces the exact post-sort state: 'Newbie' really lives at offset 0, but the
// cached index still says offset 1, where 'Bystander' now sits.
(function testResolveCheckinIdentityLeanRejectsStaleRosterBind() {
  installFakePropertiesStore_();
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };

  var monthInfo = { sheetId: 'sheet-stale', trackerUrl: 'https://x/stale', label: 'July 2026', startDate: new Date(2026, 6, 1) };
  var responsesRows = [
    ['', 'newbie@x.com', 'Yes', 'Newbie', '', 'Crucible', '', 'Who', 'What', 'How', '', '', ''],
    ['', 'bystander@x.com', 'Yes', 'Bystander', '', '', '', 'W2', 'W2', 'W2', '', '', ''],
  ];
  // Post-sort truth: Newbie (team Crucible) sorted above Bystander (blank team sorts last).
  var trackerRows = [
    ['Newbie', 'Crucible', '', '', '', '', 5, 0.5, 1, ''],
    ['Bystander', '', '', '', '', '', 9, 0.9, 1, 1],
  ];
  installCountingSpreadsheetApp_({
    'sheet-stale': {
      getSheetByName: function(n) {
        if (n === 'Responses') return makeLeanIdentityResponsesSheet_(responsesRows);
        if (n === 'Tracker') {
          return makeFakeTrackerSheet_(
            ['', '', '', '', '', '', '', '', '', ''],
            ['F3 Name', 'Goal / Team', '', '', '', '', 'Raw Score', 'Score', new Date(2026, 6, 1), new Date(2026, 6, 2)],
            trackerRows
          );
        }
        return null;
      },
    },
  });

  // Poison exactly as the pre-fix signup+sort sequence left it: Newbie -> the bottom offset.
  var PaxCache = require('../script/PaxCache.js');
  PaxCache.setPaxRosterIndex_('tracker', 'sheet-stale', { newbie: 1, bystander: 0 });

  var identity = resolveCheckinIdentityLean_(monthInfo, 'Newbie', 'newbie@x.com', null);
  assert.equal(identity.matched, true, 'Newbie is on the roster and must still resolve');
  assert.equal(identity.trackerRow[0], 'Newbie', 'must return Newbie\'s own row, never Bystander\'s');
  assert.equal(identity.trackerRowIndex, 0, 'rowIndex drives the check-in WRITE — it must point at Newbie');
  assert.equal(identity.trackerRow[1], 'Crucible', 'team comes from the correct row too');

  // The poisoned index was purged, not merely worked around — otherwise every later request
  // pays the same detour and any path lacking the guard stays exposed.
  var repaired = PaxCache.getPaxRosterIndex_('tracker', 'sheet-stale');
  assert.equal(repaired && repaired.newbie, 0, 'roster index rebuilt with the correct offset');

  delete global.SpreadsheetApp;
})();

// Companion to the above: a PAX genuinely absent from the Tracker must still report a clean
// miss. The retry loop must not turn "not on this roster" into a wrong-row match.
(function testResolveCheckinIdentityLeanStillMissesForAbsentPax() {
  installFakePropertiesStore_();
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };

  var monthInfo = { sheetId: 'sheet-absent', trackerUrl: 'https://x/absent', label: 'July 2026', startDate: new Date(2026, 6, 1) };
  installCountingSpreadsheetApp_({
    'sheet-absent': {
      getSheetByName: function(n) {
        if (n === 'Responses') return makeLeanIdentityResponsesSheet_([['', 'ghost@x.com', 'Yes', 'Ghost', '', 'Crucible', '', 'W', 'W', 'W', '', '', '']]);
        if (n === 'Tracker') {
          return makeFakeTrackerSheet_(
            ['', '', '', '', '', '', '', '', '', ''],
            ['F3 Name', 'Goal / Team', '', '', '', '', 'Raw Score', 'Score', new Date(2026, 6, 1), new Date(2026, 6, 2)],
            [['Someone Else', 'Crucible', '', '', '', '', 5, 0.5, 1, '']]
          );
        }
        return null;
      },
    },
  });

  // Signed up (Responses has Ghost) but never landed on the Tracker, with a stale index
  // pointing at the only row present.
  require('../script/PaxCache.js').setPaxRosterIndex_('tracker', 'sheet-absent', { ghost: 0 });

  var identity = resolveCheckinIdentityLean_(monthInfo, 'Ghost', 'ghost@x.com', null);
  assert.equal(identity.matched, false, 'must report a miss rather than bind to Someone Else');

  delete global.SpreadsheetApp;
})();

// resolveFullIdentityFromHandle_ — full cache hit never calls SpreadsheetApp.openById either.
(function testFullFromHandleFullCacheHitNeverOpens() {
  installFakePropertiesStore_();
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };
  global.DriveApp = { getFileById: function() { return { getLastUpdated: function() { return new Date(1000); } }; } };

  var fx = makeHandleFixture_();
  var handle = buildResolvedContextHandle_(fx.monthInfo, 1, 'Slaw');

  // Cold read warms the Tracker layout cache + PaxCache's roster/rows.
  var cold = resolveFullIdentityFromHandle_(handle);
  assert.ok(cold);

  // Warm repeat call must never open the spreadsheet.
  installThrowingSpreadsheetApp_();
  var warm = resolveFullIdentityFromHandle_(handle);
  assert.ok(warm);
  assert.equal(warm.trackerValues.length, 2);
  assert.equal(warm.targetSs.getOpenMs(), 0, 'openById was never called on the full-cache-hit path');

  delete global.DriveApp;
  delete global.SpreadsheetApp;
})();

// handleCheckinDashboard_ wiring: a valid handle whose month matches the requested date resolves
// the dashboard WITHOUT ever consulting the TrackerDB (resolveDashboardMonth_). A hostile
// templateSpreadsheet whose getSheetByName throws proves it: resolveDashboardMonth_ would swallow
// that into a no_tracker_for_date miss, so a clean ok:true means the fast path was taken. A
// handle for a DIFFERENT month than the requested date must NOT be used — it falls back to
// resolveDashboardMonth_, which on the hostile template misses.
(function testDashboardUsesHandleForOwnMonthAndFallsBackOffMonth() {
  installFakePropertiesStore_();
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };
  global.resolveContextDate_ = function() { return new Date(2026, 6, 2, 9, 0); }; // "today" = Jul 2
  var fx = makeHandleFixture_();
  var handle = buildResolvedContextHandle_(fx.monthInfo, 0, 'Anchor'); // monthKey '2026-07'
  var hostileTemplate = { getSheetByName: function() { throw new Error('TrackerDB must not be consulted'); } };

  // Requested date (Jul 2) is in the handle's month -> fast path, TrackerDB never touched.
  var ownMonth = handleCheckinDashboard_(hostileTemplate, { f3Name: 'Anchor', email: 'a@x.com', dateISO: '2026-07-02', resolvedContext: handle });
  assert.equal(ownMonth.ok, true);
  assert.equal(ownMonth.f3Name, 'Anchor');
  assert.equal(ownMonth.monthKey, '2026-07');

  // Requested date (Aug 3) is NOT in the handle's month -> must fall back to resolveDashboardMonth_,
  // which on the hostile template resolves nothing -> no_tracker_for_date (never wrongly reuses
  // the handle's July sheet for an August view).
  var offMonth = handleCheckinDashboard_(hostileTemplate, { f3Name: 'Anchor', email: 'a@x.com', dateISO: '2026-08-03', resolvedContext: handle });
  assert.equal(offMonth.ok, false);
  assert.equal(offMonth.error, 'no_tracker_for_date');
  delete global.SpreadsheetApp;
  global.resolveContextDate_ = function() { return new Date(); };
})();

// handleCheckinDashboard_ — a fully warm cache (identity + tracker roster + bonus entries all
// cached) never calls SpreadsheetApp.openById at all, for any reason (F3Go30-440b.6). Proves the
// Bonus Tracker lookup went cache-first too, not just the identity resolution.
(function testHandleCheckinDashboardFullyWarmNeverOpensSpreadsheet() {
  installFakePropertiesStore_();
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };
  global.DriveApp = { getFileById: function() { return { getLastUpdated: function() { return new Date(1000); } }; } };
  global.resolveContextDate_ = function() { return new Date(2026, 6, 2, 9, 0); }; // "today" = Jul 2

  var row2 = ['', '', '', '', '', '', '', '', '', ''];
  var row3 = ['F3 Name', 'Goal / Team', '', '', '', '', 'Raw Score', 'Score', new Date(2026, 6, 1), new Date(2026, 6, 2)];
  var paxRows = [['Anchor', 'Crucible', '', '', '', '', 5, 0.5, 1, '']];
  var trackerSheet = makeFakeTrackerSheet_(row2, row3, paxRows);
  var emptyBonusSheet = { getLastRow: function() { return 1; }, getRange: function() { return { getValues: function() { return []; } }; } };
  installFakeSpreadsheetById_({
    'sheet-warm-dash': {
      getSheetByName: function(n) {
        if (n === 'Tracker') return trackerSheet;
        if (n === 'Bonus Tracker') return emptyBonusSheet;
        return null;
      },
    },
  });
  var monthInfo = { sheetId: 'sheet-warm-dash', trackerUrl: 'https://x/warm', label: 'July 2026', startDate: new Date(2026, 6, 1) };
  var handle = buildResolvedContextHandle_(monthInfo, 0, 'Anchor');

  // Warm-up call populates the Tracker layout cache, PaxCache roster/rows, and the bonus-entries cache.
  var warmup = handleCheckinDashboard_({}, { f3Name: 'Anchor', email: 'a@x.com', dateISO: '2026-07-02', resolvedContext: handle });
  assert.equal(warmup.ok, true);

  // Now swap to a throwing SpreadsheetApp — a fully warm call must resolve without opening anything.
  installThrowingSpreadsheetApp_();
  var warm = handleCheckinDashboard_({}, { f3Name: 'Anchor', email: 'a@x.com', dateISO: '2026-07-02', resolvedContext: handle });
  assert.equal(warm.ok, true);
  assert.equal(warm.f3Name, 'Anchor');

  delete global.DriveApp;
  delete global.SpreadsheetApp;
  global.resolveContextDate_ = function() { return new Date(); };
})();

// ── Write-through PaxCache patch on check-in submit (F3Go30-5nfj.3) ─────────────────────────────
// handleCheckinSubmit_ patches the PAX's own PaxCache row in place instead of deleting it, and
// the dashboard's full-board read builds trackerValues from PaxCache's per-PAX rows + roster
// index instead of a whole-sheet CacheService blob — so a check-in write no longer forces the
// very next dashboard load (for ANY pax on that sheet) to pay for a live full-roster Sheet read.

// handleCheckinSubmit_ patches PaxCache directly — the updated row is readable back from
// PaxCache without any re-read, and the pre-existing full-resolution path is never touched
// (hostileTemplate throws if it is).
(function testSubmitPatchesPaxCacheRowInPlace() {
  var PaxCache = require('../script/PaxCache.js');
  installFakePropertiesStore_();
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };
  global.resolveContextDate_ = function() { return new Date(2026, 6, 2, 9, 0); }; // "today" = Jul 2

  var fx = makeHandleFixture_();
  var handle = buildResolvedContextHandle_(fx.monthInfo, 0, 'Anchor');
  var hostileTemplate = { getSheetByName: function() { throw new Error('full resolution must not run'); } };

  var res = handleCheckinSubmit_(hostileTemplate, { f3Name: 'Anchor', email: 'a@x.com', day: '2026-07-02', value: 1, resolvedContext: handle });
  assert.equal(res.ok, true);

  // Jul 2 is day-col index 9 (0-based) — the patched row must reflect it without deleting the entry.
  var patched = PaxCache.getPaxCacheRow_('tracker', 'sheet-jul', 'Anchor');
  assert.ok(patched, 'PaxCache row should be patched in place, not deleted');
  assert.equal(patched[9], 1);
  // The rest of the pre-write row is preserved untouched (a true patch, not a rebuilt row).
  assert.equal(patched[0], 'Anchor');
  assert.equal(patched[6], 5);

  delete global.SpreadsheetApp;
  global.resolveContextDate_ = function() { return new Date(); };
})();

// handleCheckinSubmit_'s clearContent (value: null) path patches the cache with an empty string,
// matching what a live re-read of an actually-cleared cell would return.
(function testSubmitClearPatchesPaxCacheWithEmptyString() {
  var PaxCache = require('../script/PaxCache.js');
  installFakePropertiesStore_();
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };
  global.resolveContextDate_ = function() { return new Date(2026, 6, 2, 9, 0); };

  var fx = makeHandleFixture_();
  var handle = buildResolvedContextHandle_(fx.monthInfo, 1, 'Slaw'); // Slaw's Jul 2 (col 9) starts at 1
  var res = handleCheckinSubmit_({ getSheetByName: function() { throw new Error('full resolution must not run'); } },
    { f3Name: 'Slaw', email: 's@x.com', day: '2026-07-02', value: null, resolvedContext: handle });
  assert.equal(res.ok, true);
  var patched = PaxCache.getPaxCacheRow_('tracker', 'sheet-jul', 'Slaw');
  assert.equal(patched[9], '');

  delete global.SpreadsheetApp;
  global.resolveContextDate_ = function() { return new Date(); };
})();

// End-to-end: once the dashboard's full-board read has warmed PaxCache's roster index + every
// pax's row (one live full-range read), a check-in submit for one pax followed by another
// dashboard read for the OTHER pax reflects the update WITHOUT any further full-range Sheet read
// — the whole point of this write-through patch (F3Go30-5nfj.3).
(function testCheckinWriteThroughAvoidsFullRosterRebuildOnNextDashboardRead() {
  var PaxCache = require('../script/PaxCache.js');
  installFakePropertiesStore_();
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };
  global.DriveApp = { getFileById: function() { return { getLastUpdated: function() { return new Date(1000); } }; } };
  global.resolveContextDate_ = function() { return new Date(2026, 6, 2, 9, 0); };

  var fx = makeHandleFixture_();

  // Cold dashboard read warms PaxCache's roster index + both pax rows via one live full-range read.
  var coldHandle = buildResolvedContextHandle_(fx.monthInfo, 1, 'Slaw');
  var cold = resolveFullIdentityFromHandle_(coldHandle);
  assert.ok(cold);
  assert.equal(fx.trackerSheet._fullRangeReadCount, 1);

  // Anchor checks in for Jul 2 — write-through patches ONLY Anchor's PaxCache row.
  var anchorHandle = buildResolvedContextHandle_(fx.monthInfo, 0, 'Anchor');
  var submitRes = handleCheckinSubmit_({ getSheetByName: function() { throw new Error('full resolution must not run'); } },
    { f3Name: 'Anchor', email: 'a@x.com', day: '2026-07-02', value: 1, resolvedContext: anchorHandle });
  assert.equal(submitRes.ok, true);

  // Slaw's dashboard read afterward assembles the board purely from PaxCache — zero additional
  // full-range Sheet reads — and sees Anchor's patched value in the assembled roster.
  var slawHandle = buildResolvedContextHandle_(fx.monthInfo, 1, 'Slaw');
  var warm = resolveFullIdentityFromHandle_(slawHandle);
  assert.ok(warm);
  assert.equal(fx.trackerSheet._fullRangeReadCount, 1, 'no additional full-roster read after the write-through patch');
  assert.equal(warm.trackerValues[0][9], 1); // Anchor's rowIndex 0, Jul 2 col 9

  delete global.SpreadsheetApp;
  delete global.DriveApp;
  global.resolveContextDate_ = function() { return new Date(); };
})();

// buildTrackerValuesFromPaxCache_ directly: null on a cold/incomplete cache (no roster index, or
// an indexed pax missing its own row), assembled array in roster order once every row is warm.
(function testBuildTrackerValuesFromPaxCacheDirect() {
  var PaxCache = require('../script/PaxCache.js');
  installFakePropertiesStore_();

  assert.equal(buildTrackerValuesFromPaxCache_('sheet-empty'), null);

  PaxCache.setPaxRosterIndex_('tracker', 'sheet-warm', { anchor: 0, slaw: 1 });
  // Roster index present but Slaw's own row isn't cached yet -> incomplete -> null.
  PaxCache.setPaxCacheRow_('tracker', 'sheet-warm', 'Anchor', ['Anchor', 'Crucible']);
  assert.equal(buildTrackerValuesFromPaxCache_('sheet-warm'), null);

  PaxCache.setPaxCacheRow_('tracker', 'sheet-warm', 'Slaw', ['Slaw', 'Impala']);
  var values = buildTrackerValuesFromPaxCache_('sheet-warm');
  assert.deepEqual(values, [['Anchor', 'Crucible'], ['Slaw', 'Impala']]);
})();

// ── PaxCache stats folded into checkinWebapp.resolveIdentity.timing (F3Go30-440b.1) ─────────────
// resolveLeanIdentityFromHandle_'s own GasLogger.log call must carry the same PaxCache
// hit/miss/wipe counters every other resolveIdentity.timing call site does — verified here by
// intercepting GasLogger.log rather than by inspecting PaxCache state directly, since the point
// of this issue is that the fields land IN the existing per-request log line, not just that
// PaxCache tracks them (that's test_pax_cache.js's job).
(function testResolveIdentityTimingLogCarriesPaxCacheStats() {
  var PaxCache = require('../script/PaxCache.js');
  installFakePropertiesStore_();
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };
  PaxCache.resetPaxCacheRequestStats_();

  var fx = makeHandleFixture_();
  var handle = buildResolvedContextHandle_(fx.monthInfo, 0, 'Anchor');

  var loggedEvents = [];
  var realLog = global.GasLogger.log;
  global.GasLogger.log = function(name, payload) { loggedEvents.push({ name: name, payload: payload }); };
  try {
    var identity = resolveLeanIdentityFromHandle_(handle);
    assert.ok(identity, 'valid handle should resolve');
  } finally {
    global.GasLogger.log = realLog;
  }

  var timingEvent = loggedEvents.find(function(e) { return e.name === 'checkinWebapp.resolveIdentity.timing'; });
  assert.ok(timingEvent, 'resolveIdentity.timing must be logged');
  assert.equal(typeof timingEvent.payload.paxCacheWiped, 'boolean');
  assert.equal(typeof timingEvent.payload.paxRosterHit, 'number');
  assert.equal(typeof timingEvent.payload.paxRosterMiss, 'number');
  assert.equal(typeof timingEvent.payload.paxRowHit, 'number');
  assert.equal(typeof timingEvent.payload.paxRowMiss, 'number');

  delete global.SpreadsheetApp;
  PaxCache.resetPaxCacheRequestStats_();
})();

// Reset the module-level PropertiesService/CacheService stubs the earlier tests relied on, in case
// any later-added assertion in this file expects the original getProperty-only stub.
global.PropertiesService = { getScriptProperties: function() { return { getProperty: function() { return null; } }; } };
delete global.SpreadsheetApp;

console.log('test_dashboard_webapp.js: resolved-context handle assertions passed');

console.log('test_dashboard_webapp.js: all assertions passed');
