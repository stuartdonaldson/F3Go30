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
    { suggestions: [SOLO_TEAM_LABEL_], entries: [] });
  assert.equal(readTeamRosterView_(ss, NOW, () => null).entries.length, 2);
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
  assert.deepEqual(sheet._rows[1], ['Morning Rucks', '', 'active', NOW, 1]);
});

test('recordTeamUse_ creates the TeamDB sheet with headers when missing', () => {
  const ss = fakeSpreadsheet({});
  recordTeamUse_(ss, 'Crucible', NOW);
  const sheet = ss._sheets[TEAM_DB_SHEET_NAME_];
  assert.deepEqual(sheet._headers, TEAM_DB_HEADERS_);
  assert.deepEqual(sheet._rows, [['Crucible', '', 'active', NOW, 1]]);
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
    { rowNumber: 2, values: ['Thunderdome', 'T-Dome', 'hidden', new Date('2026-09-15T07:00:00Z'), 2] },
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
