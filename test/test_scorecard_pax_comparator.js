const assert = require('node:assert/strict');
const { readStaticPage_, extractFunction_ } = require('./helpers/staticPageExtract');

// F3Go30-enwp.2: renderLadder_ used to sort tied scores straight to alphabetical name
// (`(b[metric]||0) - (a[metric]||0) || a.name.localeCompare(b.name)`) — Stuart's ask: break a
// tie on the active ranking metric by longest streak first, THEN fall back to name for a full
// tie. Extracted into its own comparator factory so the tiebreak rule is unit-testable without
// the DOM-heavy podium/ladder-row building the rest of renderLadder_ does.
function loadScorecardPaxComparator_() {
  var src = readStaticPage_();
  var body = extractFunction_(src, 'scorecardPaxComparator_');
  var fn = new Function(body + '\nreturn scorecardPaxComparator_;');
  return fn();
}

function testTiedScoreBrokenByLongerStreak() {
  var scorecardPaxComparator_ = loadScorecardPaxComparator_();
  var pax = [
    { name: 'Bystander', score: 10, streak: 3 },
    { name: 'Anchor', score: 10, streak: 7 },
  ];
  pax.sort(scorecardPaxComparator_('score'));
  assert.deepEqual(pax.map(function(p) { return p.name; }), ['Anchor', 'Bystander'],
    'AC1: the longer streak must rank first on a tied score, even though "Anchor" alphabetically outranks "Bystander" too — this must not be a name-sort coincidence');
}

function testFullTieFallsBackToName() {
  var scorecardPaxComparator_ = loadScorecardPaxComparator_();
  var pax = [
    { name: 'Zebra', score: 10, streak: 5 },
    { name: 'Anchor', score: 10, streak: 5 },
  ];
  pax.sort(scorecardPaxComparator_('score'));
  assert.deepEqual(pax.map(function(p) { return p.name; }), ['Anchor', 'Zebra'],
    'AC1: metric AND streak both tied must fall back to alphabetical name');
}

function testNoTieIgnoresStreakEntirely() {
  var scorecardPaxComparator_ = loadScorecardPaxComparator_();
  var pax = [
    { name: 'LowScoreLongStreak', score: 5, streak: 30 },
    { name: 'HighScoreShortStreak', score: 20, streak: 1 },
  ];
  pax.sort(scorecardPaxComparator_('score'));
  assert.deepEqual(pax.map(function(p) { return p.name; }), ['HighScoreShortStreak', 'LowScoreLongStreak'],
    'AC3: streak must never override an outright higher score — it only breaks a genuine tie');
}

function testTiebreakAppliesToWhicheverMetricIsActive() {
  var scorecardPaxComparator_ = loadScorecardPaxComparator_();
  var pax = [
    { name: 'Bystander', rawScore: 4, streak: 2 },
    { name: 'Anchor', rawScore: 4, streak: 9 },
  ];
  pax.sort(scorecardPaxComparator_('rawScore'));
  assert.deepEqual(pax.map(function(p) { return p.name; }), ['Anchor', 'Bystander']);
}

function run() {
  const tests = [
    testTiedScoreBrokenByLongerStreak,
    testFullTieFallsBackToName,
    testNoTieIgnoresStreakEntirely,
    testTiebreakAppliesToWhicheverMetricIsActive,
  ];
  tests.forEach(function(t) { t(); });
  console.log('test_scorecard_pax_comparator.js: all assertions passed');
}

run();
