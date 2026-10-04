const assert = require('node:assert/strict');
const test = require('node:test');
const { installGasEnv_, makeFakeSheet_ } = require('./helpers/gasEnv.js');

installGasEnv_({ lock: true, logger: true });

const {
  TEAM_DB_SHEET_NAME_,
  TEAM_DB_HEADERS_,
  SOLO_TEAM_LABEL_,
  TEAM_SUGGEST_WINDOW_DAYS_DEFAULT_,
  teamMatchKey_,
  parseTeamDbRows_,
  findTeamEntry_,
  buildTeamSuggestions_,
  planTeamSeed_,
  recordTeamUse_,
  readTeamRosterView_,
  canonicalTeamName_,
  parseTeamListsFromListDbRows_,
  seedTeamDb_,
} = require('../script/teamRoster.js');

const NOW = new Date('2026-10-02T12:00:00Z');
const DAY = 86400000;
const daysAgo = (n) => new Date(NOW.getTime() - n * DAY);

function teamDbValues(rows) {
  return [TEAM_DB_HEADERS_.slice()].concat(rows);
}

function fakeSpreadsheet(sheets) {
  const byName = Object.assign({}, sheets);
  return {
    getSheetByName: (name) => byName[name] || null,
    insertSheet: (name) => {
      byName[name] = makeFakeSheet_([]);
      return byName[name];
    },
    _sheets: byName,
  };
}

// --- matching ---------------------------------------------------------------------------------

test('teamMatchKey_ ignores case and all whitespace', () => {
  assert.equal(teamMatchKey_('  Shield Lock '), 'shieldlock');
  assert.equal(teamMatchKey_('SHIELDLOCK'), 'shieldlock');
  assert.equal(teamMatchKey_(null), '');
});

test('findTeamEntry_ matches on team name or any alias', () => {
  const entries = parseTeamDbRows_(teamDbValues([
    ['Shieldlock', 'Shield-Lock; ShieldLok', 'active', daysAgo(5), 3],
    ['Crucible', '', 'active', daysAgo(5), 1],
  ]));
  assert.equal(findTeamEntry_(entries, 'shield lock').team, 'Shieldlock');
  assert.equal(findTeamEntry_(entries, 'shieldlok').team, 'Shieldlock');
  assert.equal(findTeamEntry_(entries, 'shield-lock').team, 'Shieldlock');
  assert.equal(findTeamEntry_(entries, 'Thunderdome'), null);
});

test('parseTeamDbRows_ tolerates blank cells and string dates, skips blank team rows', () => {
  const entries = parseTeamDbRows_(teamDbValues([
    ['Crucible', '', '', '2026-09-01', ''],
    ['', '', 'active', '', ''],
    ['Matrix', '', 'Hidden', '', 4],
  ]));
  assert.equal(entries.length, 2);
  assert.equal(entries[0].status, 'active');
  assert.ok(entries[0].lastUsed instanceof Date);
  assert.equal(entries[0].useCount, 0);
  assert.equal(entries[0].rowNumber, 2);
  assert.equal(entries[1].status, 'hidden');
  assert.equal(entries[1].lastUsed, null);
  assert.equal(entries[1].rowNumber, 4);
});

// --- suggestions (AC2) -------------------------------------------------------------------------

test('AC2 suggestions: active and used within the window, sorted, Solo pinned first once', () => {
  const entries = parseTeamDbRows_(teamDbValues([
    ['thunderdome', '', 'active', daysAgo(10), 9],
    ['Crucible', '', 'active', daysAgo(89), 2],
    ['Old Team', '', 'active', daysAgo(91), 7],
    ['Hidden Team', '', 'hidden', daysAgo(1), 1],
    ['Never Used', '', 'active', '', 0],
    [SOLO_TEAM_LABEL_, '', 'active', daysAgo(3), 1],
  ]));
  assert.deepEqual(buildTeamSuggestions_(entries, NOW, 90),
    [SOLO_TEAM_LABEL_, 'Crucible', 'thunderdome']);
});

test('suggestions with an empty roster are just the pinned Solo entry', () => {
  assert.deepEqual(buildTeamSuggestions_([], NOW, 90), [SOLO_TEAM_LABEL_]);
});

test('readTeamRosterView_ uses Config TeamSuggestWindowDays, defaulting when absent/invalid', () => {
  const rows = [['Recent', '', 'active', daysAgo(20), 1], ['Older', '', 'active', daysAgo(60), 1]];
  const ss = fakeSpreadsheet({ [TEAM_DB_SHEET_NAME_]: makeFakeSheet_(TEAM_DB_HEADERS_, rows) });
  const suggestions = (lookup) => readTeamRosterView_(ss, NOW, lookup).suggestions;
  assert.equal(TEAM_SUGGEST_WINDOW_DAYS_DEFAULT_, 90);
  assert.deepEqual(suggestions(() => null), [SOLO_TEAM_LABEL_, 'Older', 'Recent']);
  assert.deepEqual(suggestions(() => ({ primary: 'abc' })), [SOLO_TEAM_LABEL_, 'Older', 'Recent']);
  assert.deepEqual(suggestions(() => ({ primary: 30 })), [SOLO_TEAM_LABEL_, 'Recent']);
  assert.deepEqual(readTeamRosterView_(fakeSpreadsheet({}), NOW, () => null),
    { suggestions: [SOLO_TEAM_LABEL_], knownTeams: [], entries: [] });
  assert.equal(readTeamRosterView_(ss, NOW, () => null).entries.length, 2);
});

test('readTeamRosterView_ knownTeams: every non-hidden roster name regardless of age, sorted', () => {
  const rows = [['thunderdome', '', 'active', daysAgo(400), 9], ['Ballard', '', '', '', 0],
    ['Hidden Team', '', 'hidden', daysAgo(1), 1]];
  const ss = fakeSpreadsheet({ [TEAM_DB_SHEET_NAME_]: makeFakeSheet_(TEAM_DB_HEADERS_, rows) });
  assert.deepEqual(readTeamRosterView_(ss, NOW, () => null).knownTeams, ['Ballard', 'thunderdome']);
});

test('canonicalTeamName_: roster spelling for a name/alias match, else the trimmed input', () => {
  const entries = parseTeamDbRows_(teamDbValues([['Shieldlock', 'Shield-Lock', 'hidden', '', 1]]));
  assert.equal(canonicalTeamName_(entries, ' shield lock '), 'Shieldlock');
  assert.equal(canonicalTeamName_(entries, 'shield-lock'), 'Shieldlock');
  assert.equal(canonicalTeamName_(entries, '  New Team '), 'New Team');
  assert.equal(canonicalTeamName_(entries, null), '');
});

test('parseTeamListsFromListDbRows_ reads ListDB AO/Goal columns literally, skipping blanks', () => {
  assert.deepEqual(parseTeamListsFromListDbRows_([
    ['AO Teams', 'Goal Team'], ['Ballard', 'No Complaining'], ['Crucible', 'No Sugar'],
    ['Defiance', ''], ['Goal Based*', null],
  ]), { aoList: ['Ballard', 'Crucible', 'Defiance', 'Goal Based*'], goalList: ['No Complaining', 'No Sugar'] });
  assert.deepEqual(parseTeamListsFromListDbRows_([['AO Teams', 'Goal Team']]), { aoList: [], goalList: [] });
});

// --- recordTeamUse_ (AC1) ----------------------------------------------------------------------

test('AC1 recordTeamUse_: alias/space-insensitive match returns canonical name and bumps usage', () => {
  const sheet = makeFakeSheet_(TEAM_DB_HEADERS_, [
    ['Crucible', '', 'active', daysAgo(40), 1],
    ['Shieldlock', 'Shield-Lock', 'active', daysAgo(30), 2],
  ]);
  const ss = fakeSpreadsheet({ [TEAM_DB_SHEET_NAME_]: sheet });
  const result = recordTeamUse_(ss, 'shield lock ', NOW);
  assert.deepEqual(result, { team: 'Shieldlock', created: false });
  assert.deepEqual(sheet._rows[1], ['Shieldlock', 'Shield-Lock', 'active', NOW, 3]);
  assert.deepEqual(sheet._rows[0], ['Crucible', '', 'active', daysAgo(40), 1], 'other rows untouched');
});

test('AC1 recordTeamUse_: unmatched name appends an active row, verbatim trimmed spelling', () => {
  const sheet = makeFakeSheet_(TEAM_DB_HEADERS_, [['Crucible', '', 'active', daysAgo(40), 1]]);
  const ss = fakeSpreadsheet({ [TEAM_DB_SHEET_NAME_]: sheet });
  assert.deepEqual(recordTeamUse_(ss, '  Morning Rucks ', NOW), { team: 'Morning Rucks', created: true });
  assert.deepEqual(sheet._rows[1].slice(0, 5), ['Morning Rucks', '', 'active', NOW, 1]);
});

test('recordTeamUse_ creates the TeamDB sheet with headers when missing', () => {
  const ss = fakeSpreadsheet({});
  recordTeamUse_(ss, 'Crucible', NOW);
  const sheet = ss._sheets[TEAM_DB_SHEET_NAME_];
  assert.deepEqual(sheet._headers, TEAM_DB_HEADERS_);
  assert.deepEqual(sheet._rows.map((r) => r.slice(0, 5)), [['Crucible', '', 'active', NOW, 1]]);
});

test('recordTeamUse_ on a blank name writes nothing', () => {
  const sheet = makeFakeSheet_(TEAM_DB_HEADERS_, []);
  const ss = fakeSpreadsheet({ [TEAM_DB_SHEET_NAME_]: sheet });
  assert.deepEqual(recordTeamUse_(ss, '   ', NOW), { team: '', created: false });
  assert.equal(sheet._rows.length, 0);
});

test('recordTeamUse_ matching a hidden team keeps it hidden (admin decision stands)', () => {
  const sheet = makeFakeSheet_(TEAM_DB_HEADERS_, [['Matrix', '', 'hidden', daysAgo(200), 4]]);
  const ss = fakeSpreadsheet({ [TEAM_DB_SHEET_NAME_]: sheet });
  assert.deepEqual(recordTeamUse_(ss, 'matrix', NOW), { team: 'Matrix', created: false });
  assert.deepEqual(sheet._rows[0], ['Matrix', '', 'hidden', NOW, 5]);
});

// --- seed (AC3) --------------------------------------------------------------------------------

const LISTDB_ROWS = [
  ['AO Teams', 'Goal Team'],
  ['Crucible', 'Meditation'],
  ['Goal Based*', ''],
  [SOLO_TEAM_LABEL_, ''],
  ['Thunderdome', ''],
];
const PAX_RECORDS = [
  { team: 'Thunderdome', date: new Date('2026-08-01T07:00:00Z') },
  { team: 'thunderdome', date: new Date('2026-09-01T07:00:00Z') },
  { team: 'Hawk\'s Nest', date: new Date('2026-07-01T07:00:00Z') },
  { team: 'Hawks Nest', date: new Date('2026-06-01T07:00:00Z') },
  { team: 'Hawk\'s Nest', date: new Date('2026-05-01T07:00:00Z') },
  { team: 'Goal Based*', date: new Date('2026-09-01T07:00:00Z') },
  { team: '', date: new Date('2026-09-01T07:00:00Z') },
];

test('planTeamSeed_: ListDB spelling wins, PaxDB sets LastUsed/UseCount, sentinels/blanks skipped', () => {
  const plan = planTeamSeed_([], LISTDB_ROWS, PAX_RECORDS);
  assert.deepEqual(plan.updates, []);
  assert.deepEqual(plan.appends, [
    ['Crucible', '', 'active', '', 0],
    ['Hawk\'s Nest', '', 'active', new Date('2026-07-01T07:00:00Z'), 2],
    ['Hawks Nest', '', 'active', new Date('2026-06-01T07:00:00Z'), 1],
    ['Meditation', '', 'active', '', 0],
    [SOLO_TEAM_LABEL_, '', 'active', '', 0],
    ['Thunderdome', '', 'active', new Date('2026-09-01T07:00:00Z'), 2],
  ]);
});

test('planTeamSeed_ against existing rows: raises LastUsed/UseCount, never lowers or renames', () => {
  const existing = parseTeamDbRows_(teamDbValues([
    ['Thunderdome', 'T-Dome', 'hidden', new Date('2026-09-15T07:00:00Z'), 1],
    ['Crucible', '', 'active', '', 5],
  ]));
  const plan = planTeamSeed_(existing, LISTDB_ROWS, PAX_RECORDS);
  assert.deepEqual(plan.updates, [
    { rowNumber: 2, values: ['Thunderdome', 'T-Dome', 'hidden', new Date('2026-09-15T07:00:00Z'), 2, ''] },
  ]);
  assert.deepEqual(plan.appends.map((r) => r[0]), ['Hawk\'s Nest', 'Hawks Nest', 'Meditation', SOLO_TEAM_LABEL_]);
});

test('AC3 seedTeamDb_ run twice yields an identical TeamDB', () => {
  const ss = fakeSpreadsheet({ ListDB: makeFakeSheet_(LISTDB_ROWS[0], LISTDB_ROWS.slice(1)) });
  const first = seedTeamDb_(ss, PAX_RECORDS);
  assert.deepEqual(first, { added: 6, updated: 0, total: 6 });
  const snapshot = JSON.stringify(ss._sheets[TEAM_DB_SHEET_NAME_]._rows);
  const second = seedTeamDb_(ss, PAX_RECORDS);
  assert.deepEqual(second, { added: 0, updated: 0, total: 6 });
  assert.equal(JSON.stringify(ss._sheets[TEAM_DB_SHEET_NAME_]._rows), snapshot);
});

// --- AC4: trackers never get a TeamDB copy -----------------------------------------------------

test('AC4 TeamDB is marked Delete in the tracker sheet disposition', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../script/CreateNewTracker.js'), 'utf8');
  assert.match(src, /'TeamDB':\s*'Delete'/);
});

// --- renameTeam (F3Go30-qeuu.5, ADR-023 Decision 6) --------------------------------------------

const { planTeamRename_, rewriteTeamColumn_, renameTeam_ } = require('../script/teamRoster.js');

test('planTeamRename_ rename: row renamed, old name (and its aliases) kept as aliases', () => {
  const entries = parseTeamDbRows_(teamDbValues([
    ['Crucible', '', 'active', daysAgo(5), 3],
    ['Shield Lock', 'ShieldLok', 'active', daysAgo(2), 4],
  ]));
  const plan = planTeamRename_(entries, 'shield lock', 'Shieldlock Brothers');
  assert.equal(plan.ok, true);
  assert.equal(plan.merged, false);
  assert.equal(plan.team, 'Shieldlock Brothers');
  assert.deepEqual(plan.updates, [{ rowNumber: 3, values: ['Shieldlock Brothers', 'ShieldLok, Shield Lock', 'active', daysAgo(2), 4, ''] }]);
  assert.equal(plan.deleteRowNumber, null);
  assert.deepEqual(plan.matchKeys.sort(), ['shieldlock', 'shieldlok']);
});

test('planTeamRename_ merge: from folds into the existing to row (aliases, max LastUsed, summed UseCount), from row deleted', () => {
  const entries = parseTeamDbRows_(teamDbValues([
    ["Hawk's Nest", '', 'active', daysAgo(30), 10],
    ['Hawks Nest', 'Hawks', 'hidden', daysAgo(3), 2],
  ]));
  const plan = planTeamRename_(entries, 'Hawks Nest', "hawk's nest");
  assert.equal(plan.merged, true);
  assert.equal(plan.team, "Hawk's Nest");
  assert.deepEqual(plan.updates, [{ rowNumber: 2, values: ["Hawk's Nest", 'Hawks, Hawks Nest', 'active', daysAgo(3), 12, ''] }]);
  assert.equal(plan.deleteRowNumber, 3);
  assert.deepEqual(plan.matchKeys.sort(), ['hawks', 'hawksnest']);
});

test('planTeamRename_ respelling onto its own alias renames in place; spellings the match key already covers are not kept as aliases', () => {
  const entries = parseTeamDbRows_(teamDbValues([['Thunder Dome', 'Thunderdome', 'active', '', 1]]));
  const plan = planTeamRename_(entries, 'Thunder Dome', 'Thunderdome');
  assert.equal(plan.merged, false);
  assert.deepEqual(plan.updates, [{ rowNumber: 2, values: ['Thunderdome', '', 'active', '', 1, ''] }]);
  assert.deepEqual(plan.matchKeys, ['thunderdome']);
});

test('planTeamRename_ AC4: unknown from or blank to -> {ok:false}, nothing planned', () => {
  const entries = parseTeamDbRows_(teamDbValues([['Crucible', '', 'active', '', 1]]));
  assert.deepEqual(planTeamRename_(entries, 'Nope', 'Crucible'), { ok: false, error: 'unknown_team' });
  assert.deepEqual(planTeamRename_(entries, 'Crucible', '  '), { ok: false, error: 'to is required' });
});

test('rewriteTeamColumn_ replaces every cell matching a key, case/whitespace-insensitively', () => {
  const values = [['Shield Lock'], ['Crucible'], ['shieldlok '], [''], ['SHIELDLOCK']];
  const changed = rewriteTeamColumn_(values, ['shieldlock', 'shieldlok'], 'Shieldlock Brothers');
  assert.deepEqual(changed, [0, 2, 4]);
  assert.deepEqual(values.map((r) => r[0]), ['Shieldlock Brothers', 'Crucible', 'Shieldlock Brothers', '', 'Shieldlock Brothers']);
});

test('AC1/AC2 renameTeam_: TeamDB, each tracker Responses Team (+Other team) and that tracker\'s PaxDB rows rewritten; changed trackers reported', () => {
  const teamDb = makeFakeSheet_(TEAM_DB_HEADERS_, [
    ['Crucible', '', 'active', daysAgo(5), 3],
    ['Crucibel', '', 'active', daysAgo(1), 1],
  ]);
  const paxDb = makeFakeSheet_(['SheetId', 'Date', 'F3 Name', 'Team'], [
    ['cur', '', 'A', 'crucibel'], ['cur', '', 'B', 'Crucible'], ['old', '', 'C', 'Crucibel'],
  ]);
  const template = fakeSpreadsheet({ [TEAM_DB_SHEET_NAME_]: teamDb, PaxDB: paxDb });
  const responsesHeaders = ['Timestamp', 'Email Address', 'Are you currently participating in Go30?', 'F3 Name',
    'Team type', 'Team', 'Other team name', 'WHO do you ultimately want to become?', 'WHAT is your Go30 Challenge?',
    'HOW are you going to be successful this month?', 'Cell Phone Number'];
  const curResponses = makeFakeSheet_(responsesHeaders, [
    ['', 'a@x', 'Yes', 'A', '', 'Crucibel', 'Crucibel'], ['', 'b@x', 'Yes', 'B', '', 'Crucible', ''],
  ]);
  const trackers = { cur: fakeSpreadsheet({ Responses: curResponses }) };
  const changedSheets = [];
  const result = renameTeam_(template, 'Crucibel', 'Crucible', {
    trackerSheetIds: ['cur'],
    openById: (id) => trackers[id],
    onTrackerChanged: (id) => changedSheets.push(id),
  });
  assert.deepEqual(result, { ok: true, merged: true, team: 'Crucible', responsesUpdated: 1, paxDbUpdated: 1, trackersChanged: ['cur'] });
  assert.deepEqual(teamDb._rows.map((r) => r.slice(0, 5)), [['Crucible', 'Crucibel', 'active', daysAgo(1), 4]]);
  assert.deepEqual(curResponses._rows[0].slice(5), ['Crucible', 'Crucible']);
  assert.deepEqual(paxDb._rows.map((r) => r[3]), ['Crucible', 'Crucible', 'Crucibel'], 'other months keep their historical spelling');
  assert.deepEqual(changedSheets, ['cur']);
});

test('renameTeam_ unknown team changes nothing', () => {
  const teamDb = makeFakeSheet_(TEAM_DB_HEADERS_, [['Crucible', '', 'active', '', 1]]);
  const template = fakeSpreadsheet({ [TEAM_DB_SHEET_NAME_]: teamDb });
  const result = renameTeam_(template, 'Nope', 'X', { trackerSheetIds: [], openById: () => null, onTrackerChanged: () => {} });
  assert.deepEqual(result, { ok: false, error: 'unknown_team' });
  assert.deepEqual(teamDb._rows, [['Crucible', '', 'active', '', 1]]);
});

test('recordTeamUse_ {lockHeld:true} (caller already holds the script lock, e.g. form submit) takes no lock', () => {
  const env = installGasEnv_({ lock: true, logger: true });
  const sheet = makeFakeSheet_(TEAM_DB_HEADERS_, [['Crucible', '', 'active', daysAgo(3), 1]]);
  const ss = fakeSpreadsheet({ [TEAM_DB_SHEET_NAME_]: sheet });
  assert.deepEqual(recordTeamUse_(ss, 'crucible', NOW, { lockHeld: true }), { team: 'Crucible', created: false });
  assert.equal(env.lock._waits, 0);
  assert.equal(env.lock._releases, 0);
  recordTeamUse_(ss, 'crucible', NOW);
  assert.equal(env.lock._waits, 1);
  assert.equal(env.lock._releases, 1);
});


// --- F3Go30-qeuu.7: duplicate detection + edit-to-reconcile ------------------------------------

const { isTeamNear_, planDuplicateFlags_, refreshTeamDbDuplicates_, renameTeamFromEdit_ } = require('../script/teamRoster.js');

test('isTeamNear_: case/space/punctuation-only or small-typo differences; short names only on punctuation', () => {
  assert.equal(isTeamNear_('Hawks Nest', "Hawk's Nest"), true);
  assert.equal(isTeamNear_('Thunder Dome', 'Thunderdome'), true);
  assert.equal(isTeamNear_('Crucibel', 'Crucible'), true);
  assert.equal(isTeamNear_('Meditaiton', 'Meditation'), true);
  assert.equal(isTeamNear_('PBX', 'PBJ'), false);
  assert.equal(isTeamNear_('P.B.J.', 'PBJ'), true);
  assert.equal(isTeamNear_('Crucible', 'Thunderdome'), false);
  assert.equal(isTeamNear_('Crucible', 'Crucible'), false, 'a team is not a duplicate of itself');
});

test('AC5 planDuplicateFlags_: each active row flags its likely duplicate (the more-used one first); hidden rows ignored', () => {
  const entries = parseTeamDbRows_(teamDbValues([
    ["Hawk's Nest", '', 'active', '', 10],
    ['Hawks Nest', '', 'active', '', 1],
    ['Crucible', '', 'active', '', 5],
    ['Crucibel', '', 'hidden', '', 1],
    ['Thunderdome', '', 'active', '', 3],
  ]));
  assert.deepEqual(planDuplicateFlags_(entries), { 2: 'Hawks Nest', 3: "Hawk's Nest", 4: '', 5: '', 6: '' });
});

test('refreshTeamDbDuplicates_ adds the Possible Duplicate header to an older 5-column TeamDB and writes column F', () => {
  const sheet = makeFakeSheet_(TEAM_DB_HEADERS_.slice(0, 5), [
    ["Hawk's Nest", '', 'active', '', 10], ['Hawks Nest', '', 'active', '', 1], ['Crucible', '', 'active', '', 5],
  ]);
  refreshTeamDbDuplicates_(sheet);
  assert.equal(sheet._headers[5], 'Possible Duplicate');
  assert.deepEqual(sheet._rows.map((r) => r[5]), ['Hawks Nest', "Hawk's Nest", '']);
});

function editFixture_() {
  const teamDb = makeFakeSheet_(TEAM_DB_HEADERS_, [
    ["Hawk's Nest", '', 'active', daysAgo(30), 10, ''],
    ["Hawk's Nest", 'Hawks', 'active', daysAgo(3), 2, ''],   // the edited row, AFTER the edit (was "Hawks Nest")
    ['Crucible', '', 'active', daysAgo(5), 4, ''],
  ]);
  const paxDb = makeFakeSheet_(['SheetId', 'Date', 'F3 Name', 'Team'], [['cur', '', 'A', 'Hawks Nest'], ['cur', '', 'B', "Hawk's Nest"]]);
  const template = fakeSpreadsheet({ [TEAM_DB_SHEET_NAME_]: teamDb, PaxDB: paxDb });
  const responses = makeFakeSheet_(['Timestamp', 'Email Address', 'Are you currently participating in Go30?', 'F3 Name',
    'Team type', 'Team', 'Other team name', 'WHO do you ultimately want to become?', 'WHAT is your Go30 Challenge?',
    'HOW are you going to be successful this month?', 'Cell Phone Number'], [
    ['', 'a@x', 'Yes', 'A', '', 'Hawks Nest', ''], ['', 'b@x', 'Yes', 'B', '', "Hawk's Nest", ''], ['', 'c@x', 'Yes', 'C', '', 'hawks', ''],
  ]);
  const trackers = { cur: fakeSpreadsheet({ Responses: responses }) };
  const deps = { trackerSheetIds: ['cur'], openById: (id) => trackers[id], onTrackerChanged: () => {} };
  return { teamDb, paxDb, template, responses, deps };
}

test('AC1 renameTeamFromEdit_: Team cell edited onto an existing team merges the edited row into it and moves its PAX (incl. alias spellings)', () => {
  const f = editFixture_();
  const result = renameTeamFromEdit_(f.template, 3, 'Hawks Nest', "Hawk's Nest", f.deps);
  assert.deepEqual(result, { ok: true, merged: true, team: "Hawk's Nest", responsesUpdated: 2, paxDbUpdated: 1, trackersChanged: ['cur'] });
  assert.deepEqual(f.teamDb._rows.map((r) => r.slice(0, 5)), [
    ["Hawk's Nest", 'Hawks, Hawks Nest', 'active', daysAgo(3), 12],
    ['Crucible', '', 'active', daysAgo(5), 4],
  ]);
  assert.deepEqual(f.responses._rows.map((r) => r[5]), ["Hawk's Nest", "Hawk's Nest", "Hawk's Nest"]);
  assert.deepEqual(f.paxDb._rows.map((r) => r[3]), ["Hawk's Nest", "Hawk's Nest"]);
});

test('AC2 renameTeamFromEdit_: Team cell edited to a brand-new name renames in place, keeping the old name as an alias', () => {
  const f = editFixture_();
  f.teamDb._rows[2][0] = 'Crucible Brothers';   // the edit: "Crucible" -> "Crucible Brothers"
  const result = renameTeamFromEdit_(f.template, 4, 'Crucible', 'Crucible Brothers', f.deps);
  assert.equal(result.merged, false);
  assert.deepEqual(f.teamDb._rows[2].slice(0, 5), ['Crucible Brothers', 'Crucible', 'active', daysAgo(5), 4]);
});

test('renameTeamFromEdit_: an edit that only changes case/spacing is a respelling, not a merge, and rewrites PAX', () => {
  const f = editFixture_();
  f.teamDb._rows[2][0] = 'CRUCIBLE';
  const result = renameTeamFromEdit_(f.template, 4, 'Crucible', 'CRUCIBLE', f.deps);
  assert.equal(result.merged, false);
  assert.equal(f.teamDb._rows[2][0], 'CRUCIBLE');
});
