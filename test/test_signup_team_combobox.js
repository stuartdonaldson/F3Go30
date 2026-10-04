const assert = require('node:assert/strict');
const test = require('node:test');
const { readStaticPage_, extractFunction_ } = require('./helpers/staticPageExtract');

// F3Go30-qeuu.3 (ADR-023): the sign-up page's single team field — suggestion filtering and the
// "Did you mean …?" near-match check — extracted from static-pages/src/index.html so the matching
// rules are node-tested without a DOM.
function loadTeamHelpers_() {
  const src = readStaticPage_();
  const names = ['teamNearKey_', 'teamEditDistance_', 'filterTeamSuggestions_', 'findNearTeam_'];
  const body = names.map((n) => extractFunction_(src, n)).join('\n');
  return new Function(body + '\nreturn {' + names.join(',') + '};')();
}

const h = loadTeamHelpers_();
const SUGGESTIONS = ['SOLO (no team)', 'Crucible', "Hawk's Nest", 'Meditation', 'Thunderdome'];
const KNOWN = SUGGESTIONS.concat(['Ballard', 'PBJ']);

test('AC1 filterTeamSuggestions_: case-insensitive substring, list order kept, blank query = all', () => {
  assert.deepEqual(h.filterTeamSuggestions_(SUGGESTIONS, 'cru'), ['Crucible']);
  assert.deepEqual(h.filterTeamSuggestions_(SUGGESTIONS, 'DOME'), ['Thunderdome']);
  assert.deepEqual(h.filterTeamSuggestions_(SUGGESTIONS, 'e'), ['SOLO (no team)', 'Crucible', "Hawk's Nest", 'Meditation', 'Thunderdome']);
  assert.deepEqual(h.filterTeamSuggestions_(SUGGESTIONS, '  '), SUGGESTIONS);
  assert.deepEqual(h.filterTeamSuggestions_(SUGGESTIONS, 'zzz'), []);
});

test('findNearTeam_: no prompt when the server would snap it (case/whitespace only) or it is new and unlike any team', () => {
  assert.equal(h.findNearTeam_(KNOWN, 'crucible'), null);
  assert.equal(h.findNearTeam_(KNOWN, 'Thunder Dome'), null);
  assert.equal(h.findNearTeam_(KNOWN, 'Morning Rucks'), null);
  assert.equal(h.findNearTeam_(KNOWN, ''), null);
});

test('AC2 findNearTeam_: punctuation-only and small-typo differences prompt with the roster name', () => {
  assert.equal(h.findNearTeam_(KNOWN, 'Hawks Nest'), "Hawk's Nest");
  assert.equal(h.findNearTeam_(KNOWN, 'Thunderdom'), 'Thunderdome');
  assert.equal(h.findNearTeam_(KNOWN, 'Balard'), 'Ballard');
  assert.equal(h.findNearTeam_(KNOWN, 'Meditaiton'), 'Meditation');
  assert.equal(h.findNearTeam_(KNOWN, 'Crucibel'), 'Crucible', 'adjacent swap');
});

test('findNearTeam_: short names only prompt on punctuation differences, never on a letter change', () => {
  assert.equal(h.findNearTeam_(KNOWN, 'PBX'), null);
  assert.equal(h.findNearTeam_(KNOWN, 'P.B.J.'), 'PBJ');
});

test('teamEditDistance_: Levenshtein, with an adjacent swap counted as one edit', () => {
  assert.equal(h.teamEditDistance_('kitten', 'sitting'), 3);
  assert.equal(h.teamEditDistance_('crucibel', 'crucible'), 1);
  assert.equal(h.teamEditDistance_('', 'abc'), 3);
  assert.equal(h.teamEditDistance_('same', 'same'), 0);
});
