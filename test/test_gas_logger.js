const assert = require('node:assert/strict');

const {
  buildAxiomRows_,
} = require('../script/GasLogger.js');

const entries = [
  { ts: '2026-06-20T09:03:18.000Z', tag: 'autoGenerateNextMonthTracker', data: { spreadsheetId: 'abc123' }, execId: 'exec-1' },
  { ts: '2026-06-20T09:05:18.000Z', tag: 'autoGenerateNextMonthTracker.warning', data: { warning: 'urlShortener failed' }, execId: 'exec-2', runId: 'gaslogger-test' },
];

const rows = buildAxiomRows_(entries, '2.2.1');

assert.equal(rows.length, 2);

assert.equal(rows[0]._time, '2026-06-20T09:03:18.000Z');
assert.equal(rows[0].name, 'autoGenerateNextMonthTracker');
assert.equal(rows[0].side, 'gas');
assert.equal(rows[0].version, '2.2.1');
assert.equal(rows[0].spreadsheetId, 'abc123');
assert.equal(rows[0].execId, 'exec-1');
assert.equal('runId' in rows[0], false);

assert.equal(rows[1].execId, 'exec-2');
assert.equal(rows[1].runId, 'gaslogger-test');
assert.equal(rows[1].warning, 'urlShortener failed');

console.log('test_gas_logger.js: PASS');
