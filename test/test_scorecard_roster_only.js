const assert = require('node:assert/strict');
const { readStaticPage_, extractFunction_ } = require('./helpers/staticPageExtract');

// F3Go30-csfe.2: renderScorecard_ used to decide board-only vs. ranked view with a calendar-date
// heuristic (scorecardMonthIsFuture_) that breaks at every month boundary — "next month" becomes
// "today" the instant the real clock rolls over, at which point the heuristic silently flips and
// the ranked ladder/podium render for a month nobody has real scores in. It also missed a second
// real case: a REGISTERED PAX on day 1 of a freshly-started month, where everyone is still at
// zero — ranking 0-vs-0 is just as meaningless as ranking an unregistered month's empty board.
//
// scorecardIsRosterOnly_ replaces the calendar guess with two server-grounded checks: the
// viewer's actual registration state (`registered`, F3Go30-csfe.1) and whether the board has any
// nonzero score/rawScore/bonus at all — neither depends on what date the client's clock reports.
function loadScorecardIsRosterOnly_() {
  var src = readStaticPage_();
  var body = extractFunction_(src, 'bonusTotalOf_') + '\n' + extractFunction_(src, 'scorecardBoardHasAnyScore_') + '\n' + extractFunction_(src, 'scorecardIsRosterOnly_');
  var fn = new Function(body + '\nreturn scorecardIsRosterOnly_;');
  return fn();
}

function paxBoardWithScores_(scores) {
  return [{ name: 'Crucible', members: scores.map(function(s, i) {
    return { name: 'Pax' + i, score: s.score || 0, rawScore: s.rawScore || 0, bonusByType: s.bonusByType || {} };
  }) }];
}

function testRosterOnlyWhenNotRegistered() {
  var scorecardIsRosterOnly_ = loadScorecardIsRosterOnly_();
  // Even if (implausibly) some scores exist, non-registration alone forces roster-only.
  assert.equal(scorecardIsRosterOnly_({ registered: false, paxBoard: paxBoardWithScores_([{ score: 5 }]) }), true);
}

// AC2: the case the original fix missed — registered, day 1, everyone still at zero.
function testRosterOnlyWhenRegisteredButEveryoneIsAllZero() {
  var scorecardIsRosterOnly_ = loadScorecardIsRosterOnly_();
  var d = { registered: true, paxBoard: paxBoardWithScores_([{ score: 0, rawScore: 0 }, { score: 0, rawScore: 0 }]) };
  assert.equal(scorecardIsRosterOnly_(d), true, 'AC2: a 0-vs-0 board must not render a ranked podium');
}

// AC3: registered AND at least one real nonzero score anywhere (score, rawScore, or bonus).
function testRankedViewWhenRegisteredAndSomeoneHasAScore() {
  var scorecardIsRosterOnly_ = loadScorecardIsRosterOnly_();
  assert.equal(scorecardIsRosterOnly_({ registered: true, paxBoard: paxBoardWithScores_([{ score: 3 }]) }), false);
  assert.equal(scorecardIsRosterOnly_({ registered: true, paxBoard: paxBoardWithScores_([{ rawScore: 1 }]) }), false);
  assert.equal(scorecardIsRosterOnly_({ registered: true, paxBoard: paxBoardWithScores_([{ bonusByType: { pushups: 2 } }]) }), false);
}

function testRankedViewIndependentOfCalendarDate() {
  var scorecardIsRosterOnly_ = loadScorecardIsRosterOnly_();
  // The original regression: a registered PAX with real scores in a month calendar math might
  // call "the future" (client clock skew, or the month boundary having just passed) must still
  // get the ranked view.
  var d = { registered: true, monthKey: '2099-01', paxBoard: paxBoardWithScores_([{ score: 7 }]) };
  assert.equal(scorecardIsRosterOnly_(d), false);
}

function run() {
  const tests = [
    testRosterOnlyWhenNotRegistered,
    testRosterOnlyWhenRegisteredButEveryoneIsAllZero,
    testRankedViewWhenRegisteredAndSomeoneHasAScore,
    testRankedViewIndependentOfCalendarDate,
  ];
  tests.forEach(function(t) { t(); });
  console.log('test_scorecard_roster_only.js: all assertions passed');
}

run();
