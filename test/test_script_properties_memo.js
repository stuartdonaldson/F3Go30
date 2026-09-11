const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { installGasEnv_ } = require('./helpers/gasEnv.js');

// F3Go30-h4xt: the per-execution whole-store script-properties memo (script/ScriptProperties.js)
// and its invalidation contract. The memo is only correct because Apps Script runs one execution
// per request with freshly-evaluated globals (see that file's header) — so the ONLY staleness
// window is a write followed by a read inside the same execution, and every test below that
// writes then reads is asserting exactly that window is closed.
//
// F3Go30-taag/F3Go30-emwk.14: the PropertiesService/CacheService/LockService/GasLogger stand-ins
// (including the getProperties() call counter this bead exists to drive down, and the failure
// switch) now come from test/helpers/gasEnv.js instead of a hand-rolled copy, and each case is
// its own `it` so a failure names the behaviour rather than the file.

const gas = installGasEnv_({ properties: true, cache: true, lock: true, logger: true });
const fakeProps = gas.properties;

const {
  getScriptPropertiesSnapshot_,
  invalidateScriptPropertiesSnapshot_,
  scriptPropertiesStore_,
  getScriptPropertiesSnapshotStats_,
  resetScriptPropertiesSnapshot_,
  measureScriptPropertiesSize_,
} = require('../script/ScriptProperties.js');

const {
  setPaxCacheRow_,
  deletePaxCacheRow_,
  setPaxCacheRowsBulk_,
  setPaxRosterIndex_,
  deletePaxRosterIndex_,
  getPaxCacheRowsBulk_,
  setPaxHistoryEntry_,
  setPaxHistoryEntriesBulk_,
  getPaxHistoryEntriesBulk_,
  setPaxGoalsEntry_,
  wipePaxCacheForSheet_,
  resetPaxCacheRequestStats_,
} = require('../script/PaxCache.js');

function freshExecution_() {
  // Stands in for what GAS does for free at the start of every execution: brand-new globals.
  resetScriptPropertiesSnapshot_();
  resetPaxCacheRequestStats_();
  fakeProps._getPropertiesCalls = 0;
  fakeProps._failGetProperties = false;
}

// ---------------------------------------------------------------------------------------------
// 1. One getProperties() per execution, shared by BOTH bulk readers (the bead's headline AC).
// ---------------------------------------------------------------------------------------------
describe('one getProperties() per execution', function() {
it('is shared by both bulk readers, and repeat reads cost nothing', function() {
  freshExecution_();
  setPaxCacheRow_('tracker', 'sheet-1', 'Fizz', ['Fizz', 'Red', 10]);
  setPaxHistoryEntry_('scope-1', 'Fizz', { historyEndDate: '2026-09-10', days: '11' });
  fakeProps._getPropertiesCalls = 0;
  invalidateScriptPropertiesSnapshot_();

  var rows = getPaxCacheRowsBulk_('tracker', 'sheet-1', ['fizz']);
  var history = getPaxHistoryEntriesBulk_('scope-1', ['Fizz']);

  assert.deepEqual(rows.fizz, ['Fizz', 'Red', 10]);
  assert.deepEqual(history.fizz, { historyEndDate: '2026-09-10', days: '11' });
  assert.equal(fakeProps._getPropertiesCalls, 1,
    'both bulk readers must share ONE whole-store fetch per execution');

  // A third, fourth… read still costs nothing.
  getPaxCacheRowsBulk_('tracker', 'sheet-1', ['fizz']);
  getPaxHistoryEntriesBulk_('scope-1', ['Fizz']);
  assert.equal(fakeProps._getPropertiesCalls, 1, 'repeat bulk reads must serve from the memo');

  var stats = getScriptPropertiesSnapshotStats_();
  assert.equal(stats.propsFetches, 1);
  assert.ok(stats.propsMemoHits >= 3, 'memo hits should be counted');
});
});

// ---------------------------------------------------------------------------------------------
// 2. Write-then-read INSIDE one execution sees the fresh value, never the stale memo — once per
//    write wrapper, since a memo whose invalidation path misses one wrapper is the failure this
//    bead's Must-not names.
// ---------------------------------------------------------------------------------------------
function assertWriteInvalidates_(label, primeFn, writeFn, readFn, expected) {
  it(label + ' invalidates the memo, so the read after the write is fresh', function() {
  freshExecution_();
  if (primeFn) primeFn();
  invalidateScriptPropertiesSnapshot_();
  getScriptPropertiesSnapshot_();                       // memo now filled with the pre-write store
  var fetchesBefore = fakeProps._getPropertiesCalls;
  writeFn();
  var actual = readFn();
  assert.deepEqual(actual, expected, label + ': read after write must see the fresh value');
  assert.equal(fakeProps._getPropertiesCalls, fetchesBefore + 1,
    label + ': the write must have invalidated the memo (forcing exactly one re-fetch)');
  });
}

describe('write-then-read inside one execution', function() {

assertWriteInvalidates_('setPaxCacheRow_',
  function() { setPaxCacheRow_('tracker', 'sheet-2', 'Bolt', ['Bolt', 'Blue', 1]); },
  function() { setPaxCacheRow_('tracker', 'sheet-2', 'Bolt', ['Bolt', 'Blue', 99]); },
  function() { return getPaxCacheRowsBulk_('tracker', 'sheet-2', ['bolt']).bolt; },
  ['Bolt', 'Blue', 99]);

assertWriteInvalidates_('deletePaxCacheRow_',
  function() { setPaxCacheRow_('tracker', 'sheet-3', 'Gone', ['Gone', 'Red', 5]); },
  function() { deletePaxCacheRow_('tracker', 'sheet-3', 'Gone'); },
  function() { return getPaxCacheRowsBulk_('tracker', 'sheet-3', ['gone']).gone; },
  undefined);

assertWriteInvalidates_('setPaxCacheRowsBulk_',
  function() { setPaxCacheRow_('tracker', 'sheet-4', 'Bulk', ['Bulk', 'Red', 1]); },
  function() { setPaxCacheRowsBulk_('tracker', 'sheet-4', { Bulk: ['Bulk', 'Red', 42] }, { bulk: 0 }); },
  function() { return getPaxCacheRowsBulk_('tracker', 'sheet-4', ['bulk']).bulk; },
  ['Bulk', 'Red', 42]);

assertWriteInvalidates_('setPaxRosterIndex_',
  function() { setPaxRosterIndex_('tracker', 'sheet-5', { old: 0 }); },
  function() { setPaxRosterIndex_('tracker', 'sheet-5', { fresh: 1 }); },
  function() { return JSON.parse(getScriptPropertiesSnapshot_()['go30idx:tracker:sheet-5']); },
  { fresh: 1 });

assertWriteInvalidates_('deletePaxRosterIndex_',
  function() { setPaxRosterIndex_('tracker', 'sheet-6', { old: 0 }); },
  function() { deletePaxRosterIndex_('tracker', 'sheet-6'); },
  function() { return getScriptPropertiesSnapshot_()['go30idx:tracker:sheet-6']; },
  undefined);

assertWriteInvalidates_('setPaxHistoryEntry_',
  function() { setPaxHistoryEntry_('scope-2', 'Hist', { historyEndDate: '2026-09-01', days: '1' }); },
  function() { setPaxHistoryEntry_('scope-2', 'Hist', { historyEndDate: '2026-09-10', days: '10' }); },
  function() { return getPaxHistoryEntriesBulk_('scope-2', ['Hist']).hist; },
  { historyEndDate: '2026-09-10', days: '10' });

assertWriteInvalidates_('setPaxHistoryEntriesBulk_',
  function() { setPaxHistoryEntry_('scope-3', 'Batch', { historyEndDate: '2026-09-01', days: '1' }); },
  function() { setPaxHistoryEntriesBulk_('scope-3', { Batch: { historyEndDate: '2026-09-11', days: '11' } }); },
  function() { return getPaxHistoryEntriesBulk_('scope-3', ['Batch']).batch; },
  { historyEndDate: '2026-09-11', days: '11' });

assertWriteInvalidates_('setPaxGoalsEntry_',
  function() { setPaxGoalsEntry_('scope-4', 'Goals', { versions: [] }); },
  function() { setPaxGoalsEntry_('scope-4', 'Goals', { versions: [{ month: '2026-09' }] }); },
  function() { return JSON.parse(getScriptPropertiesSnapshot_()['go30goals:scope-4:goals']); },
  { versions: [{ month: '2026-09' }] });

assertWriteInvalidates_('wipePaxCacheForSheet_',
  function() {
    setPaxCacheRow_('tracker', 'sheet-7', 'Wiped', ['Wiped', 'Red', 3]);
    setPaxRosterIndex_('tracker', 'sheet-7', { wiped: 0 });
  },
  function() { wipePaxCacheForSheet_('tracker', 'sheet-7'); },
  function() { return getPaxCacheRowsBulk_('tracker', 'sheet-7', ['wiped']).wiped; },
  undefined);

// The generic facade itself — the one place a non-PaxCache caller (WebApp, GasLogger,
// CheckinSessions, …) writes through — invalidates on every mutating method.
it('the generic facade invalidates on every mutating method', function() {
  ['setProperty', 'setProperties', 'deleteProperty', 'deleteAllProperties'].forEach(function(method) {
    freshExecution_();
    fakeProps.setProperty('SEED', 'seed');
    invalidateScriptPropertiesSnapshot_();
    getScriptPropertiesSnapshot_();
    var before = fakeProps._getPropertiesCalls;
    var store = scriptPropertiesStore_();
    if (method === 'setProperty') store.setProperty('K', 'v1');
    else if (method === 'setProperties') store.setProperties({ K: 'v1' });
    else if (method === 'deleteProperty') store.deleteProperty('SEED');
    else store.deleteAllProperties();
    getScriptPropertiesSnapshot_();
    assert.equal(fakeProps._getPropertiesCalls, before + 1, method + ' must invalidate the memo');
  });
});

it('reads through the facade do not invalidate the memo', function() {
  // Otherwise the memo would never survive a single request.
  freshExecution_();
  getScriptPropertiesSnapshot_();
  var beforeReads = fakeProps._getPropertiesCalls;
  scriptPropertiesStore_().getProperty('SEED');
  scriptPropertiesStore_().getKeys();
  getScriptPropertiesSnapshot_();
  assert.equal(fakeProps._getPropertiesCalls, beforeReads, 'reads must not invalidate the memo');
});
});

// ---------------------------------------------------------------------------------------------
// 3. A PropertiesService failure reads as an empty store and is NOT memoized — a transient error
//    must not blank the store for the rest of the execution.
// ---------------------------------------------------------------------------------------------
describe('PropertiesService failure handling', function() {
it('reads as an empty store and is not memoized', function() {
  freshExecution_();
  fakeProps.setProperty('go30pax:tracker:sheet-8:flaky', JSON.stringify(['Flaky', 'Red', 7]));
  invalidateScriptPropertiesSnapshot_();

  fakeProps._failGetProperties = true;
  assert.deepEqual(getScriptPropertiesSnapshot_(), {}, 'a failed fetch reads as an empty store');
  assert.deepEqual(getPaxCacheRowsBulk_('tracker', 'sheet-8', ['flaky']), {},
    'bulk reader degrades to all-miss on a failed fetch');
  assert.deepEqual(getPaxHistoryEntriesBulk_('scope-8', ['Flaky']), {});

  fakeProps._failGetProperties = false;
  assert.deepEqual(getPaxCacheRowsBulk_('tracker', 'sheet-8', ['flaky']).flaky, ['Flaky', 'Red', 7],
    'the next read after the failure must fetch again, not serve a memoized empty store');
});
});

// ---------------------------------------------------------------------------------------------
// 4. Store sizing — the telemetry gauge added to the dashboard event.
// ---------------------------------------------------------------------------------------------
describe('store sizing telemetry', function() {
it('measureScriptPropertiesSize_ counts key + value characters', function() {
  assert.deepEqual(measureScriptPropertiesSize_({ ab: '123', c: '4' }), { bytes: 2 + 3 + 1 + 1, keys: 2 });
  assert.deepEqual(measureScriptPropertiesSize_(null), { bytes: 0, keys: 0 });
});

it('the snapshot stats report the live store size, fetches and invalidations', function() {
  freshExecution_();
  fakeProps.deleteAllProperties();
  fakeProps.setProperty('kk', 'vvv');
  invalidateScriptPropertiesSnapshot_();
  getScriptPropertiesSnapshot_();
  var stats = getScriptPropertiesSnapshotStats_();
  assert.equal(stats.propsStoreBytes, 5, 'propsStoreBytes counts key + value characters');
  assert.equal(stats.propsStoreKeys, 1);
  assert.equal(stats.propsFetches, 1);
  assert.equal(stats.propsInvalidations, 0, 'invalidating an unfilled memo is not counted');
});
});
