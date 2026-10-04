const assert = require('node:assert/strict');
const test = require('node:test');
const { installGasEnv_ } = require('./helpers/gasEnv.js');

// F3Go30-qeuu.7: editing a TeamDB Team cell reconciles (renames/merges and moves PAX).
installGasEnv_({ logger: true, lock: true });
const { processTeamDbEdit_, ensureTeamDbEditTrigger_, TEAM_DB_EDIT_HANDLER_ } = require('../script/teamDbEditTrigger.js');

function makeEvent_({ sheetName = 'TeamDB', row = 3, col = 1, rows = 1, cols = 1, oldValue, value }) {
  const toasts = [];
  const writes = [];
  const source = { getId: () => 'tpl', toast: (msg) => toasts.push(msg) };
  const range = {
    getSheet: () => ({ getName: () => sheetName }),
    getRow: () => row, getColumn: () => col, getNumRows: () => rows, getNumColumns: () => cols,
    setValue: (v) => writes.push(v),
  };
  return { e: { source, range, oldValue, value }, toasts, writes };
}

function run_(evt) {
  const calls = [];
  const result = processTeamDbEdit_(evt.e, {
    renameFromEdit: (ss, row, oldName, newName, deps) => { calls.push([row, oldName, newName, deps]); return { ok: true, merged: newName === "Hawk's Nest", team: newName, responsesUpdated: 3, paxDbUpdated: 2, trackersChanged: ['cur'] }; },
    buildDeps: () => 'DEPS',
    refreshDuplicates: () => calls.push(['refresh']),
  });
  return { result, calls };
}

test('AC1/AC2 a single Team-cell change reconciles via renameTeamFromEdit_ and toasts the outcome', () => {
  const evt = makeEvent_({ oldValue: 'Hawks Nest', value: "Hawk's Nest" });
  const { result, calls } = run_(evt);
  assert.equal(result.action, 'reconciled');
  assert.deepEqual(calls, [[3, 'Hawks Nest', "Hawk's Nest", 'DEPS']]);
  assert.match(evt.toasts[0], /Merged "Hawks Nest" into "Hawk's Nest" — 3 PAX moved/);
});

test('a rename (no existing team) toasts as a rename', () => {
  const evt = makeEvent_({ oldValue: 'Crucibel', value: 'Crucible Brothers' });
  run_(evt);
  assert.match(evt.toasts[0], /Renamed "Crucibel" to "Crucible Brothers" — 3 PAX updated/);
});

test('AC3 other sheets, other columns, the header row and unchanged values do nothing', () => {
  for (const opts of [{ sheetName: 'Config' }, { col: 2 }, { row: 1 }, { oldValue: 'Crucible', value: ' Crucible ' }]) {
    const evt = makeEvent_(Object.assign({ oldValue: 'Crucible', value: 'X' }, opts));
    const { result, calls } = run_(evt);
    assert.equal(result.action, 'ignored', JSON.stringify(opts));
    assert.deepEqual(calls, []);
    assert.deepEqual(evt.toasts, []);
  }
});

test('AC3 a multi-cell edit touching the Team column is not reconciled, and says so', () => {
  const evt = makeEvent_({ rows: 3 });
  const { result, calls } = run_(evt);
  assert.equal(result.action, 'ignored');
  assert.deepEqual(calls, []);
  assert.match(evt.toasts[0], /one Team cell at a time/);
});

test('AC4 clearing a Team cell restores the old name (use Status=hidden to remove a team)', () => {
  const evt = makeEvent_({ oldValue: 'Crucible', value: undefined });
  const { result, calls } = run_(evt);
  assert.equal(result.action, 'restored');
  assert.deepEqual(evt.writes, ['Crucible']);
  assert.deepEqual(calls, []);
  assert.match(evt.toasts[0], /Status/);
});

test('typing a team into an empty row adds it (no reconcile) and refreshes Possible Duplicate', () => {
  const evt = makeEvent_({ oldValue: undefined, value: 'Morning Rucks' });
  const { result, calls } = run_(evt);
  assert.equal(result.action, 'added');
  assert.deepEqual(calls, [['refresh']]);
});

test('a failed reconcile toasts the error', () => {
  const evt = makeEvent_({ oldValue: 'A', value: 'B' });
  processTeamDbEdit_(evt.e, { renameFromEdit: () => ({ ok: false, error: 'lock_timeout' }), buildDeps: () => 'DEPS', refreshDuplicates: () => {} });
  assert.match(evt.toasts[0], /lock_timeout/);
});

test('AC6 ensureTeamDbEditTrigger_ installs the Template edit trigger once', () => {
  const created = [];
  let triggers = [];
  globalThis.ScriptApp = {
    getProjectTriggers: () => triggers,
    newTrigger: (handler) => ({ forSpreadsheet: (ss) => ({ onEdit: () => ({ create: () => {
      created.push([handler, ss.getId()]);
      triggers = triggers.concat([{ getHandlerFunction: () => handler, getTriggerSourceId: () => ss.getId() }]);
    } }) }) }),
  };
  const tpl = { getId: () => 'tpl' };
  assert.deepEqual(ensureTeamDbEditTrigger_(tpl), { installed: true });
  assert.deepEqual(ensureTeamDbEditTrigger_(tpl), { installed: false });
  assert.deepEqual(created, [[TEAM_DB_EDIT_HANDLER_, 'tpl']]);
});
