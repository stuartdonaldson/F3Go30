const assert = require('node:assert/strict');

const {
  BONUS_TYPE_DEFS_,
  bonusTypeDef_,
  bonusTypeNames_,
  bonusTypeRequiresLink_,
  bonusTypeMultiplier_,
  bonusTypeIsWeeklyCapped_,
  bonusTypePillKey_,
  bonusTypeClientRules_,
  bonusTypeDisplayList_,
  emptyBonusPills_,
  weekOfMonth_,
  computeBonusPillsAsOf_,
  groupBonusEntriesByPax_,
  computeBonusSeriesForPax_,
  annotateBonusEntryCountStatus_,
  annotateBonusEntryDuplicateLinkStatus_,
} = require('../script/BonusTypes.js');

// ── registry accessors ───────────────────────────────────────────────────
(function testBonusTypeDefReturnsRegisteredType() {
  var def = bonusTypeDef_('Fellowship');
  assert.equal(def.name, 'Fellowship');
  assert.equal(def.pillKey, 'fe');
  assert.equal(def.weeklyCap, true);
})();

(function testBonusTypeDefReturnsNullForUnknownType() {
  assert.equal(bonusTypeDef_('Made Up Type'), null);
})();

(function testBonusTypeNamesListsEveryRegisteredType() {
  assert.deepEqual(bonusTypeNames_().sort(), ['EHing FNG', 'Fellowship', 'Inspire', 'Q Point'].sort());
})();

(function testBonusTypeRequiresLinkMatchesRegistry() {
  assert.equal(bonusTypeRequiresLink_('Fellowship'), false);
  assert.equal(bonusTypeRequiresLink_('Q Point'), true);
  assert.equal(bonusTypeRequiresLink_('Inspire'), true);
  assert.equal(bonusTypeRequiresLink_('EHing FNG'), true);
  assert.equal(bonusTypeRequiresLink_('Made Up Type'), false);
})();

(function testBonusTypeMultiplierMatchesRegistry() {
  assert.equal(bonusTypeMultiplier_('EHing FNG'), 5);
  assert.equal(bonusTypeMultiplier_('Fellowship'), 1);
  assert.equal(bonusTypeMultiplier_('Made Up Type'), 0);
})();

(function testBonusTypeIsWeeklyCappedMatchesRegistry() {
  assert.equal(bonusTypeIsWeeklyCapped_('Fellowship'), true);
  assert.equal(bonusTypeIsWeeklyCapped_('EHing FNG'), false);
  assert.equal(bonusTypeIsWeeklyCapped_('Made Up Type'), false);
})();

(function testBonusTypePillKeyMatchesRegistry() {
  assert.equal(bonusTypePillKey_('Q Point'), 'q');
  assert.equal(bonusTypePillKey_('Made Up Type'), null);
})();

(function testBonusTypeClientRulesShape() {
  var rules = bonusTypeClientRules_();
  assert.deepEqual(Object.keys(rules).sort(), ['EHing FNG', 'Fellowship', 'Inspire', 'Q Point'].sort());
  assert.deepEqual(rules['Fellowship'], { multiplier: 1, requiresLink: false });
  assert.deepEqual(rules['EHing FNG'], { multiplier: 5, requiresLink: true });
})();

(function testBonusTypeDisplayListMatchesRegistryOrder() {
  assert.deepEqual(bonusTypeDisplayList_(), [
    { key: 'fe', label: 'FE' },
    { key: 'q', label: 'Q' },
    { key: 'ins', label: 'Ins' },
    { key: 'eh', label: 'EH' },
  ]);
})();

(function testEmptyBonusPillsHasOneKeyPerRegisteredType() {
  assert.deepEqual(emptyBonusPills_(), { fe: 0, q: 0, ins: 0, eh: 0 });
})();

// ── weekOfMonth_ ────────────────────────────────────────────────────────────
(function testWeekOfMonthFirstWeekWhenMonthStartsOnSunday() {
  var monthStart = new Date(2026, 10, 1); // Nov 1 2026 is a Sunday
  assert.equal(weekOfMonth_(new Date(2026, 10, 1), monthStart), 1);
  assert.equal(weekOfMonth_(new Date(2026, 10, 7), monthStart), 1); // Saturday, still period 1
  assert.equal(weekOfMonth_(new Date(2026, 10, 8), monthStart), 2); // next Sunday
})();

(function testWeekOfMonthShortFirstPeriodWhenMonthStartsMidWeek() {
  // July 2026 starts on a Wednesday — first period is Jul 1 (Wed) through Jul 4 (Sat) only.
  var monthStart = new Date(2026, 6, 1);
  assert.equal(monthStart.getDay(), 3); // sanity: Wednesday
  assert.equal(weekOfMonth_(new Date(2026, 6, 1), monthStart), 1);
  assert.equal(weekOfMonth_(new Date(2026, 6, 4), monthStart), 1); // Saturday
  assert.equal(weekOfMonth_(new Date(2026, 6, 5), monthStart), 2); // Sunday — new period
})();

(function testWeekOfMonthShortLastPeriodWhenMonthEndsMidWeek() {
  // Same July 2026 tracker: the last period starts on the last Sunday (Jul 26) and runs
  // through Jul 31 (Friday) — a short last period, not padded into August.
  var monthStart = new Date(2026, 6, 1);
  assert.equal(weekOfMonth_(new Date(2026, 6, 26), monthStart), 5);
  assert.equal(weekOfMonth_(new Date(2026, 6, 31), monthStart), 5);
})();

// ── computeBonusPillsAsOf_ ───────────────────────────────────────────────────
(function testComputeBonusPillsAsOfExcludesEntriesAfterViewDate() {
  var monthStart = new Date(2026, 6, 1);
  var entries = [
    { nameNorm: 'crazy ivan', date: new Date(2026, 6, 10), type: 'Fellowship', complete: true },
  ];
  // Scrubbed to a date before the entry — the bonus point must not show or count.
  assert.deepEqual(computeBonusPillsAsOf_(entries, 'crazy ivan', new Date(2026, 6, 9), monthStart), { fe: 0, q: 0, ins: 0, eh: 0 });
  // On or after the entry's date, it counts.
  assert.deepEqual(computeBonusPillsAsOf_(entries, 'crazy ivan', new Date(2026, 6, 10), monthStart), { fe: 1, q: 0, ins: 0, eh: 0 });
})();

(function testComputeBonusPillsAsOfCapsFellowshipQPointInspireAtOnePerPeriod() {
  var monthStart = new Date(2026, 6, 1); // Jul 2026, period 1 = Jul 1-4
  var entries = [
    { nameNorm: 'crazy ivan', date: new Date(2026, 6, 1), type: 'Fellowship', complete: true },
    { nameNorm: 'crazy ivan', date: new Date(2026, 6, 2), type: 'Fellowship', complete: true },
    { nameNorm: 'crazy ivan', date: new Date(2026, 6, 3), type: 'Q Point', complete: true },
    { nameNorm: 'crazy ivan', date: new Date(2026, 6, 4), type: 'Q Point', complete: true },
    { nameNorm: 'crazy ivan', date: new Date(2026, 6, 4), type: 'Inspire', complete: true },
  ];
  var pills = computeBonusPillsAsOf_(entries, 'crazy ivan', new Date(2026, 6, 31), monthStart);
  assert.deepEqual(pills, { fe: 1, q: 1, ins: 1, eh: 0 });
})();

(function testComputeBonusPillsAsOfUncapsEhingFng() {
  var monthStart = new Date(2026, 6, 1);
  var entries = [
    { nameNorm: 'crazy ivan', date: new Date(2026, 6, 1), type: 'EHing FNG', complete: true },
    { nameNorm: 'crazy ivan', date: new Date(2026, 6, 2), type: 'EHing FNG', complete: true },
    { nameNorm: 'crazy ivan', date: new Date(2026, 6, 3), type: 'EHing FNG', complete: true },
  ];
  var pills = computeBonusPillsAsOf_(entries, 'crazy ivan', new Date(2026, 6, 31), monthStart);
  assert.equal(pills.eh, 15); // 3 EHs x 5 points, no weekly cap
})();

(function testComputeBonusPillsAsOfSeparatePeriodsEachGetTheirOwnCap() {
  var monthStart = new Date(2026, 6, 1); // period 1: Jul 1-4, period 2: Jul 5-11
  var entries = [
    { nameNorm: 'crazy ivan', date: new Date(2026, 6, 2), type: 'Fellowship', complete: true },
    { nameNorm: 'crazy ivan', date: new Date(2026, 6, 6), type: 'Fellowship', complete: true },
  ];
  var pills = computeBonusPillsAsOf_(entries, 'crazy ivan', new Date(2026, 6, 31), monthStart);
  assert.equal(pills.fe, 2); // one point per period, two periods = 2
})();

(function testComputeBonusPillsAsOfExcludesIncompleteEntries() {
  var monthStart = new Date(2026, 6, 1);
  var entries = [
    { nameNorm: 'crazy ivan', date: new Date(2026, 6, 2), type: 'Q Point', complete: false },
  ];
  var pills = computeBonusPillsAsOf_(entries, 'crazy ivan', new Date(2026, 6, 31), monthStart);
  assert.equal(pills.q, 0);
})();

(function testComputeBonusPillsAsOfIgnoresOtherPax() {
  var monthStart = new Date(2026, 6, 1);
  var entries = [
    { nameNorm: 'little john', date: new Date(2026, 6, 2), type: 'Fellowship', complete: true },
  ];
  var pills = computeBonusPillsAsOf_(entries, 'crazy ivan', new Date(2026, 6, 31), monthStart);
  assert.deepEqual(pills, { fe: 0, q: 0, ins: 0, eh: 0 });
})();

// ── groupBonusEntriesByPax_ (F3Go30-ja7d) ───────────────────────────────────
(function testGroupBonusEntriesByPaxBucketsByNameNorm() {
  var a = { nameNorm: 'crazy ivan', date: new Date(2026, 6, 2), type: 'Fellowship', complete: true };
  var b = { nameNorm: 'little john', date: new Date(2026, 6, 2), type: 'Fellowship', complete: true };
  var c = { nameNorm: 'crazy ivan', date: new Date(2026, 6, 3), type: 'Q Point', complete: true };
  var byPax = groupBonusEntriesByPax_([a, b, c]);
  assert.deepEqual(byPax['crazy ivan'], [a, c]); // source order preserved within a bucket
  assert.deepEqual(byPax['little john'], [b]);
  assert.equal(byPax['nobody'], undefined);
  assert.deepEqual(Object.keys(groupBonusEntriesByPax_(null)), []);
})();

(function testGroupBonusEntriesByPaxIsPrototypeSafe() {
  // A nameNorm spelling a prototype key must be an ordinary bucket, not a prototype write, and
  // must not make an absent PAX resolve to a function via the prototype chain.
  var evil = { nameNorm: '__proto__', date: new Date(2026, 6, 2), type: 'Fellowship', complete: true };
  var byPax = groupBonusEntriesByPax_([evil]);
  assert.deepEqual(byPax['__proto__'], [evil]);
  assert.equal(byPax['constructor'], undefined);
  assert.equal(({}).polluted, undefined);
})();

// ── computeBonusSeriesForPax_ ────────────────────────────────────────────────
(function testComputeBonusSeriesForPaxTracksDateOfEachEntry() {
  var monthStart = new Date(2026, 6, 1);
  var entries = [
    { nameNorm: 'crazy ivan', date: new Date(2026, 6, 2), type: 'Fellowship', complete: true },
  ];
  var dayDates = [new Date(2026, 6, 1), new Date(2026, 6, 2), new Date(2026, 6, 3)];
  var series = computeBonusSeriesForPax_(groupBonusEntriesByPax_(entries)['crazy ivan'], dayDates, monthStart);
  assert.deepEqual(series.map(function(p) { return p.fe; }), [0, 1, 1]);
})();

// The forward sweep (F3Go30-ja7d) must be output-identical to the per-day computeBonusPillsAsOf_
// rebuild it replaced — that function is the oracle, and it is deliberately left untouched for its
// single-point callers. Exercised over a month with every wrinkle in it at once: both weekly-capped
// and uncapped types, repeats inside one period, repeats across periods, an unknown type, an
// incomplete entry, another PAX's rows, and an entry dated past the last reported day column.
(function testComputeBonusSeriesForPaxMatchesPerDayComputationExactly() {
  var monthStart = new Date(2026, 6, 1); // Jul 2026
  var d = function(day) { return new Date(2026, 6, day); };
  var entries = [
    { nameNorm: 'crazy ivan', date: d(2), type: 'Fellowship', complete: true },
    { nameNorm: 'crazy ivan', date: d(3), type: 'Fellowship', complete: true },  // same period — capped
    { nameNorm: 'crazy ivan', date: d(8), type: 'Fellowship', complete: true },  // next period — counts
    { nameNorm: 'crazy ivan', date: d(8), type: 'Q Point', complete: true },
    { nameNorm: 'crazy ivan', date: d(9), type: 'Q Point', complete: false },    // incomplete
    { nameNorm: 'crazy ivan', date: d(4), type: 'EHing FNG', complete: true },   // uncapped
    { nameNorm: 'crazy ivan', date: d(4), type: 'EHing FNG', complete: true },
    { nameNorm: 'crazy ivan', date: d(6), type: 'Inspire', complete: true },
    { nameNorm: 'crazy ivan', date: d(6), type: 'Not A Real Type', complete: true },
    { nameNorm: 'crazy ivan', date: d(20), type: 'Fellowship', complete: true }, // past the last day column
    { nameNorm: 'little john', date: d(2), type: 'Fellowship', complete: true }, // other PAX
  ];
  var dayDates = [];
  for (var day = 1; day <= 12; day++) dayDates.push(d(day));

  var expected = dayDates.map(function(asOf) {
    return computeBonusPillsAsOf_(entries, 'crazy ivan', asOf, monthStart);
  });
  var actual = computeBonusSeriesForPax_(groupBonusEntriesByPax_(entries)['crazy ivan'], dayDates, monthStart);
  assert.deepEqual(actual, expected);
  // Non-trivial oracle: at least one day must differ from its predecessor, or a series of
  // all-zeroes would pass this comparison vacuously.
  assert.ok(expected.some(function(p) { return p.fe > 0 || p.eh > 0; }));
})();

(function testComputeBonusSeriesForPaxEmitsADistinctPillsObjectPerDay() {
  var monthStart = new Date(2026, 6, 1);
  var dayDates = [new Date(2026, 6, 1), new Date(2026, 6, 2)];
  var series = computeBonusSeriesForPax_(
    [{ nameNorm: 'crazy ivan', date: new Date(2026, 6, 2), type: 'Fellowship', complete: true }],
    dayDates, monthStart);
  assert.notEqual(series[0], series[1]); // scrubbing must not mutate a shared reference
  series[1].fe = 99;
  assert.equal(series[0].fe, 0);
})();

(function testComputeBonusSeriesForPaxHandlesOutOfOrderDayDates() {
  // The sweep needs ascending days; day columns already arrive in calendar order, but an
  // out-of-order caller must still get each day's own answer rather than a mis-summed one.
  var monthStart = new Date(2026, 6, 1);
  var entries = [{ nameNorm: 'crazy ivan', date: new Date(2026, 6, 2), type: 'Fellowship', complete: true }];
  var dayDates = [new Date(2026, 6, 3), new Date(2026, 6, 1), new Date(2026, 6, 2)];
  var series = computeBonusSeriesForPax_(entries, dayDates, monthStart);
  assert.deepEqual(series.map(function(p) { return p.fe; }), [1, 0, 1]);
})();

(function testComputeBonusSeriesForPaxEmptyInputs() {
  var monthStart = new Date(2026, 6, 1);
  assert.deepEqual(computeBonusSeriesForPax_([], [], monthStart), []);
  assert.deepEqual(computeBonusSeriesForPax_(null, null, monthStart), []);
  assert.deepEqual(computeBonusSeriesForPax_(undefined, [new Date(2026, 6, 1)], monthStart),
    [{ fe: 0, q: 0, ins: 0, eh: 0 }]);
})();

(function testComputeBonusSeriesForPaxRejectsTheOldFourArgSignature() {
  // The pre-F3Go30-ja7d call shape would otherwise read f3NameNorm as dayDates and silently
  // return an empty series.
  assert.throws(function() {
    computeBonusSeriesForPax_([], 'crazy ivan', [new Date(2026, 6, 1)], new Date(2026, 6, 1));
  }, /groupBonusEntriesByPax_/);
})();

// ── annotateBonusEntryCountStatus_ ──────────────────────────────────────────
(function testAnnotateBonusEntryCountStatusFlagsSecondCappedEntryInSamePeriodAsExtra() {
  var monthStart = new Date(2026, 6, 1); // Jul 2026, period 1 = Jul 1-4
  var entries = [
    { rowIndex: 2, type: 'Fellowship', whenIso: '2026-07-01', message: 'a', link: '', complete: true },
    { rowIndex: 3, type: 'Fellowship', whenIso: '2026-07-03', message: 'b', link: '', complete: true },
  ];
  var annotated = annotateBonusEntryCountStatus_(entries, monthStart);
  assert.equal(annotated[0].counts, true);
  assert.equal(annotated[1].counts, false); // second Fellowship in the same period — won't count
})();

(function testAnnotateBonusEntryCountStatusGivesEachPeriodItsOwnCap() {
  var monthStart = new Date(2026, 6, 1); // period 1: Jul 1-4, period 2: Jul 5-11
  var entries = [
    { rowIndex: 2, type: 'Fellowship', whenIso: '2026-07-02', message: 'a', link: '', complete: true },
    { rowIndex: 3, type: 'Fellowship', whenIso: '2026-07-06', message: 'b', link: '', complete: true },
  ];
  var annotated = annotateBonusEntryCountStatus_(entries, monthStart);
  assert.equal(annotated[0].counts, true);
  assert.equal(annotated[1].counts, true); // different period — both count
})();

(function testAnnotateBonusEntryCountStatusUncapsEhingFng() {
  var monthStart = new Date(2026, 6, 1);
  var entries = [
    { rowIndex: 2, type: 'EHing FNG', whenIso: '2026-07-01', message: 'a', link: 'https://x', complete: true },
    { rowIndex: 3, type: 'EHing FNG', whenIso: '2026-07-02', message: 'b', link: 'https://x', complete: true },
  ];
  var annotated = annotateBonusEntryCountStatus_(entries, monthStart);
  assert.equal(annotated[0].counts, true);
  assert.equal(annotated[1].counts, true); // EHing FNG has no weekly cap
})();

(function testAnnotateBonusEntryCountStatusLeavesIncompleteEntriesUnflagged() {
  var monthStart = new Date(2026, 6, 1);
  var entries = [
    { rowIndex: 2, type: 'Q Point', whenIso: '2026-07-01', message: 'a', link: '', complete: false },
    { rowIndex: 3, type: 'Q Point', whenIso: '2026-07-02', message: 'b', link: 'https://x', complete: true },
  ];
  var annotated = annotateBonusEntryCountStatus_(entries, monthStart);
  assert.equal(annotated[0].counts, true); // incomplete — not flagged "extra", the pending badge already covers it
  assert.equal(annotated[1].counts, true); // first complete entry this period
})();

// ── annotateBonusEntryDuplicateLinkStatus_ (F3Go30-6faz.1) ──────────────────
(function testAnnotateBonusEntryDuplicateLinkStatusFlagsRepeatedLinkSamePeriodAndType() {
  var monthStart = new Date(2026, 6, 1); // Jul 2026, period 1 = Jul 1-4
  var entries = [
    { rowIndex: 2, type: 'EHing FNG', whenIso: '2026-07-01', message: 'a', link: 'https://slack.com/x', complete: true },
    { rowIndex: 3, type: 'EHing FNG', whenIso: '2026-07-03', message: 'b', link: 'https://slack.com/x', complete: true },
  ];
  var annotated = annotateBonusEntryDuplicateLinkStatus_(entries, monthStart);
  assert.equal(annotated[0].duplicateLink, false);
  assert.equal(annotated[1].duplicateLink, true); // same link, same period+type — reused evidence
})();

(function testAnnotateBonusEntryDuplicateLinkStatusIsCaseAndWhitespaceInsensitive() {
  var monthStart = new Date(2026, 6, 1);
  var entries = [
    { rowIndex: 2, type: 'Q Point', whenIso: '2026-07-01', message: 'a', link: 'https://SLACK.com/X', complete: true },
    { rowIndex: 3, type: 'Q Point', whenIso: '2026-07-02', message: 'b', link: '  https://slack.com/x  ', complete: true },
  ];
  var annotated = annotateBonusEntryDuplicateLinkStatus_(entries, monthStart);
  assert.equal(annotated[1].duplicateLink, true);
})();

(function testAnnotateBonusEntryDuplicateLinkStatusDoesNotFlagDifferentLinks() {
  var monthStart = new Date(2026, 6, 1);
  var entries = [
    { rowIndex: 2, type: 'Inspire', whenIso: '2026-07-01', message: 'a', link: 'https://slack.com/x', complete: true },
    { rowIndex: 3, type: 'Inspire', whenIso: '2026-07-02', message: 'b', link: 'https://slack.com/y', complete: true },
  ];
  var annotated = annotateBonusEntryDuplicateLinkStatus_(entries, monthStart);
  assert.equal(annotated[0].duplicateLink, false);
  assert.equal(annotated[1].duplicateLink, false);
})();

(function testAnnotateBonusEntryDuplicateLinkStatusScopesToPeriodAndType() {
  var monthStart = new Date(2026, 6, 1); // period 1: Jul 1-4, period 2: Jul 5-11
  var entries = [
    { rowIndex: 2, type: 'Q Point', whenIso: '2026-07-01', message: 'a', link: 'https://slack.com/x', complete: true },
    { rowIndex: 3, type: 'Q Point', whenIso: '2026-07-06', message: 'b', link: 'https://slack.com/x', complete: true }, // different period
    { rowIndex: 4, type: 'Inspire', whenIso: '2026-07-01', message: 'c', link: 'https://slack.com/x', complete: true }, // different type
  ];
  var annotated = annotateBonusEntryDuplicateLinkStatus_(entries, monthStart);
  assert.equal(annotated[1].duplicateLink, false);
  assert.equal(annotated[2].duplicateLink, false);
})();

(function testAnnotateBonusEntryDuplicateLinkStatusIgnoresBlankLinks() {
  var monthStart = new Date(2026, 6, 1);
  var entries = [
    { rowIndex: 2, type: 'Fellowship', whenIso: '2026-07-01', message: 'a', link: '', complete: true },
    { rowIndex: 3, type: 'Fellowship', whenIso: '2026-07-02', message: 'b', link: '', complete: true },
  ];
  var annotated = annotateBonusEntryDuplicateLinkStatus_(entries, monthStart);
  assert.equal(annotated[0].duplicateLink, false);
  assert.equal(annotated[1].duplicateLink, false); // no link to compare — never flagged
})();

console.log('test_bonus_types.js: all assertions passed');
