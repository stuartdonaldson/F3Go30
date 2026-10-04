const assert = require('node:assert/strict');
const test = require('node:test');
const { readStaticPage_, extractFunction_ } = require('./helpers/staticPageExtract');

// F3Go30-qeuu.7: the "probably the same team" rule exists twice — in the sign-up page (the
// "Did you mean" prompt, static-pages/src/index.html) and on the server (TeamDB Possible Duplicate,
// script/teamRoster.js). They run in different runtimes and cannot share code, so this runs both on
// the same pairs. The page's findNearTeam_ deliberately stays silent for names the server snaps
// anyway (same name ignoring case/whitespace); everything else must agree.
const page = new Function(['teamNearKey_', 'teamEditDistance_', 'findNearTeam_']
  .map((n) => extractFunction_(readStaticPage_(), n)).join('\n') + '\nreturn { findNearTeam_ };')();
const server = require('../script/teamRoster.js');

const PAIRS = [
  ['Hawks Nest', "Hawk's Nest"], ['Thunderdom', 'Thunderdome'], ['Crucibel', 'Crucible'],
  ['Meditaiton', 'Meditation'], ['Balard', 'Ballard'], ['PBX', 'PBJ'], ['P.B.J.', 'PBJ'],
  ['Crucible', 'Thunderdome'], ['Morning Rucks', 'Crucible'], ['Log Boom', 'Log Boon'],
  ['The Pit', 'The Pits'], ['Shield Lock', 'Shieldlock'], ['SOLO (no team)', 'Solo no team'],
];

test('page findNearTeam_ and server isTeamNear_ agree on every pair (except server-snapped respellings)', () => {
  PAIRS.forEach(([typed, known]) => {
    const snapped = typed.replace(/\s+/g, '').toLowerCase() === known.replace(/\s+/g, '').toLowerCase();
    const pageSays = page.findNearTeam_([known], typed) === known;
    const serverSays = server.isTeamNear_(typed, known) && !snapped;
    assert.equal(pageSays, serverSays, `${typed} vs ${known}: page=${pageSays} server=${serverSays}`);
  });
});

test('server flags server-snapped respellings as duplicates too (two rows that differ only in spacing/case)', () => {
  assert.equal(server.isTeamNear_('Shield Lock', 'Shieldlock'), true);
});
