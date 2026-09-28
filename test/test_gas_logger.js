const assert = require('node:assert/strict');

const {
  buildAxiomRows_,
  maskPiiForLog_,
  maskRecipientListForLog_,
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

// target defaults to 'unknown' when an entry predates the version/target stamp.
assert.equal(rows[0].target, 'unknown');

// An entry already stamped with its own version/target (by GasLogger.log()) wins over
// the fallback passed to buildAxiomRows_ — Template vs TEST stay distinguishable even
// in a shared dataset.
const stampedRows = buildAxiomRows_(
  [{ ts: '2026-06-24T00:00:00.000Z', tag: 'x', data: {}, version: '2.2.2', target: 'TEST' }],
  '9.9.9'
);
assert.equal(stampedRows[0].version, '2.2.2');
assert.equal(stampedRows[0].target, 'TEST');

// maskPiiForLog_ — names: first/last character kept, middle collapsed to '...'.
assert.equal(maskPiiForLog_('Little John'), 'L...n');
assert.equal(maskPiiForLog_('Jo'), 'J...o');
assert.equal(maskPiiForLog_('J'), 'J');
assert.equal(maskPiiForLog_(''), '');
assert.equal(maskPiiForLog_(null), '');

// maskPiiForLog_ — emails: only the local part is masked, domain stays fully visible.
assert.equal(maskPiiForLog_('stuart.donaldson@gmail.com'), 's...n@gmail.com');
assert.equal(maskPiiForLog_('a@b.com'), 'a@b.com');

// maskRecipientListForLog_ — plain comma-separated addresses.
assert.equal(
  maskRecipientListForLog_('stuart.donaldson@gmail.com,a@b.com'),
  's...n@gmail.com,a@b.com'
);

// maskRecipientListForLog_ — 'Display Name <email>' form, both parts masked.
assert.equal(
  maskRecipientListForLog_('Little John <stuart.donaldson@gmail.com>'),
  'L...n <s...n@gmail.com>'
);

assert.equal(maskRecipientListForLog_(''), '');
assert.equal(maskRecipientListForLog_(null), '');

console.log('test_gas_logger.js: PASS');

// F3Go30-u7nk: an Axiom ingest rejection (256-field limit) must surface as a query-able event,
// not vanish. The retry row uses only long-established fields.
{
  const { buildIngestRejectedRow_ } = require('../script/GasLogger.js');
  const registry = require('./fixtures/axiomFieldRegistry.json');
  const rejected = buildIngestRejectedRow_(
    [{ name: 'doPost', version: '2.6.5.1', target: 'TEST', execId: 'e1' }, { name: 'x' }],
    400, 'field limit exceeded ' + 'y'.repeat(500));
  assert.equal(rejected.name, 'gasLogger.ingestRejected');
  assert.equal(rejected.count, 2);
  assert.equal(rejected.execId, 'e1');
  assert.ok(rejected.error.startsWith('400: field limit'));
  assert.ok(rejected.error.length <= 205);
  const envelope = ['_time', 'name', 'side', 'version', 'target', 'execId'];
  Object.keys(rejected).filter(k => !envelope.includes(k)).forEach(k =>
    assert.ok(registry.fields.includes(k), k + ' must be a registered field or the rejection row can itself be rejected'));

  // _postToAxiom: rejected batch -> exactly one retry carrying only the rejection row.
  const vm = require('node:vm');
  const fs = require('node:fs');
  const calls = [];
  const ctx = vm.createContext({
    Logger: { log() {} }, console, Object, Array, JSON, Date, String,
    UrlFetchApp: { fetch(url, opts) {
      calls.push(JSON.parse(opts.payload));
      const code = calls.length === 1 ? 400 : 200;
      return { getResponseCode: () => code, getContentText: () => 'nope' };
    } },
  });
  vm.runInContext(fs.readFileSync(require.resolve('../script/GasLogger.js'), 'utf8') + '\nthis.GL = GasLogger;', ctx);
  ctx.GL._axiomConfig = { token: 't', dataset: 'd' };
  ctx.GL._postToAxiom([{ ts: '2026-09-28T00:00:00.000Z', tag: 'doPost', data: { a: 1 }, execId: 'e9' }]);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].length, 1);
  assert.equal(calls[1][0].name, 'gasLogger.ingestRejected');
  assert.equal(calls[1][0].count, 1);

  // Accepted batch -> no retry.
  calls.length = 0;
  ctx.UrlFetchApp.fetch = (u, o) => { calls.push(1); return { getResponseCode: () => 200, getContentText: () => '' }; };
  ctx.GL._postToAxiom([{ ts: 't', tag: 'x', data: {} }]);
  assert.equal(calls.length, 1);
}
