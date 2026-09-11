const assert = require('node:assert/strict');
const { readStaticPage_, extractFunction_ } = require('./helpers/staticPageExtract');

// F3Go30-9ywo (REVIEW-260910 finding 6): scorecardTeamColorMap_ used to key a team's colour off
// its index in paxBoard, which groupByTeam_ sorts by avgScore descending — so a team's colour was
// a function of its current rank and swapped between loads whenever rankings moved. It's now
// keyed off a name-sorted team list instead: order-independent (unlike the index it replaces),
// and collision-free up to SCORECARD_TEAM_COLOR_VARS_.length teams. Extracted and run for real
// out of index.html, same pattern as test_scorecard_pax_comparator.js.
function loadScorecardTeamColorMap_() {
  var src = readStaticPage_();
  var varsDecl = src.match(/var SCORECARD_TEAM_COLOR_VARS_ = \[[^\]]*\];/);
  assert.ok(varsDecl, 'SCORECARD_TEAM_COLOR_VARS_ declaration not found in index.html');
  var body = extractFunction_(src, 'scorecardTeamColorMap_');
  var fn = new Function(varsDecl[0] + '\n' + body + '\nreturn scorecardTeamColorMap_;');
  return fn();
}

function board(names) {
  return names.map(function(name) { return { name: name, members: [], avgScore: 0 }; });
}

function testColorAssignmentIsIndependentOfBoardOrder() {
  var scorecardTeamColorMap_ = loadScorecardTeamColorMap_();
  // Same three teams, two different paxBoard orderings (as if rankings flipped between loads).
  var mapRankOrderA = scorecardTeamColorMap_(board(['Crucible', 'Anvil', 'Broadaxe']));
  var mapRankOrderB = scorecardTeamColorMap_(board(['Broadaxe', 'Crucible', 'Anvil']));
  assert.deepEqual(mapRankOrderA, mapRankOrderB,
    'AC: a team must keep the same colour regardless of paxBoard rank order');
}

function testColorAssignmentIsNameKeyedAlphabetically() {
  var scorecardTeamColorMap_ = loadScorecardTeamColorMap_();
  var map = scorecardTeamColorMap_(board(['Crucible', 'Anvil', 'Broadaxe']));
  // Alphabetical: Anvil, Broadaxe, Crucible -> --team-1, --team-2, --team-3.
  assert.equal(map.Anvil, 'var(--team-1)');
  assert.equal(map.Broadaxe, 'var(--team-2)');
  assert.equal(map.Crucible, 'var(--team-3)');
}

function testColorAssignmentStableAcrossRerenderWithUnchangedTeams() {
  var scorecardTeamColorMap_ = loadScorecardTeamColorMap_();
  var teams = ['Foxhole', 'Dogwood', 'Everest'];
  var first = scorecardTeamColorMap_(board(teams));
  var second = scorecardTeamColorMap_(board(teams.slice().reverse()));
  assert.deepEqual(first, second, 'AC: repeated renders of the same team set must produce the same map');
}

function run() {
  const tests = [
    testColorAssignmentIsIndependentOfBoardOrder,
    testColorAssignmentIsNameKeyedAlphabetically,
    testColorAssignmentStableAcrossRerenderWithUnchangedTeams,
  ];
  tests.forEach(function(t) { t(); });
  console.log('test_scorecard_team_color_map.js: all assertions passed');
}

run();
