'use strict';

const assert = require('assert');

// RECOMMENDATION.md §3.2 (F3Go30-gas-deploy Stage 1c): assertDeployedVersion_ polls cmd=version
// until the webapp reports the exact version *and* target just stamped, or times out. All paths
// here use an injected fake postFn/sleep — no real network call, no real wall-clock wait.
const { assertDeployedVersion_, queryLiveVersion_ } = require('../tools/manage-deployments.js');

async function testMatchesOnFirstPoll() {
  const calls = [];
  const postFn = async (url, body) => {
    calls.push({ url, body });
    return { ok: true, version: '2.5.0.11', target: 'TEST', deploymentId: 'AKfycbzTEST' };
  };
  const result = await assertDeployedVersion_('AKfycbzTEST', '2.5.0.11', 'TEST', { postFn, log: () => {} });
  assert.deepEqual(result, { ok: true, attempts: 1, version: '2.5.0.11', target: 'TEST', deploymentId: 'AKfycbzTEST' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://script.google.com/macros/s/AKfycbzTEST/exec?cmd=version');
}

async function testSucceedsAfterEdgePropagationDelay() {
  // The classic ~5s edge race (#9): the first poll still sees the previous version, the second
  // sees the new one.
  let attempt = 0;
  const postFn = async () => {
    attempt++;
    if (attempt === 1) return { ok: true, version: '2.5.0.10', target: 'TEST' };
    return { ok: true, version: '2.5.0.11', target: 'TEST' };
  };
  const sleeps = [];
  const sleep = async (ms) => { sleeps.push(ms); };
  const result = await assertDeployedVersion_('AKfycbzTEST', '2.5.0.11', 'TEST', { postFn, sleep, log: () => {} });
  assert.equal(result.attempts, 2);
  assert.deepEqual(sleeps, [5000]);
}

async function testVersionMismatchEventuallyTimesOut() {
  const postFn = async () => ({ ok: true, version: '2.5.0.10', target: 'TEST' });
  let now = 0;
  const realNow = Date.now;
  Date.now = () => now;
  const sleep = async (ms) => { now += ms; };
  try {
    await assert.rejects(
      () => assertDeployedVersion_('AKfycbzTEST', '2.5.0.11', 'TEST', { postFn, sleep, log: () => {}, intervalSec: 5, timeoutSec: 12 }),
      (err) => {
        assert.match(err.message, /timed out/);
        assert.match(err.message, /expected version=2\.5\.0\.11 target=TEST/);
        assert.match(err.message, /last seen version=2\.5\.0\.10 target=TEST/);
        return true;
      }
    );
  } finally {
    Date.now = realNow;
  }
}

async function testTargetMismatchEventuallyTimesOut() {
  // Wrong-environment deploy: version matches but target doesn't — this is the check nothing
  // before Stage 1c could make.
  const postFn = async () => ({ ok: true, version: '2.5.0.11', target: 'TEMPLATE' });
  let now = 0;
  const realNow = Date.now;
  Date.now = () => now;
  const sleep = async (ms) => { now += ms; };
  try {
    await assert.rejects(
      () => assertDeployedVersion_('AKfycbzTEST', '2.5.0.11', 'TEST', { postFn, sleep, log: () => {}, intervalSec: 5, timeoutSec: 12 }),
      (err) => {
        assert.match(err.message, /timed out/);
        assert.match(err.message, /last seen version=2\.5\.0\.11 target=TEMPLATE/);
        return true;
      }
    );
  } finally {
    Date.now = realNow;
  }
}

async function testUnreachableResponseTreatedAsMissAndCanStillTimeOut() {
  // A non-JSON/redirect-race response (post()'s failure mode) rejects rather than returning an
  // object — must be treated as a miss, not thrown out of the poll loop.
  const postFn = async () => { throw new Error('Non-JSON response'); };
  let now = 0;
  const realNow = Date.now;
  Date.now = () => now;
  const sleep = async (ms) => { now += ms; };
  try {
    await assert.rejects(
      () => assertDeployedVersion_('AKfycbzTEST', '2.5.0.11', 'TEST', { postFn, sleep, log: () => {}, intervalSec: 5, timeoutSec: 6 }),
      (err) => {
        assert.match(err.message, /timed out/);
        assert.match(err.message, /last seen \(no response\)/);
        return true;
      }
    );
  } finally {
    Date.now = realNow;
  }
}

async function testQueryLiveVersionReturnsNullOnFailureAndValueOnSuccess() {
  const okPostFn = async () => ({ ok: true, version: '2.5.0.11', target: 'TEST' });
  const ok = await queryLiveVersion_('AKfycbzTEST', { postFn: okPostFn });
  assert.deepEqual(ok, { version: '2.5.0.11', target: 'TEST' });

  const failPostFn = async () => { throw new Error('unreachable'); };
  const fail = await queryLiveVersion_('AKfycbzTEST', { postFn: failPostFn });
  assert.equal(fail, null);

  const notOkPostFn = async () => ('not json — deployment propagation race');
  const notOk = await queryLiveVersion_('AKfycbzTEST', { postFn: notOkPostFn });
  assert.equal(notOk, null);
}

async function run() {
  await testMatchesOnFirstPoll();
  await testSucceedsAfterEdgePropagationDelay();
  await testVersionMismatchEventuallyTimesOut();
  await testTargetMismatchEventuallyTimesOut();
  await testUnreachableResponseTreatedAsMissAndCanStillTimeOut();
  await testQueryLiveVersionReturnsNullOnFailureAndValueOnSuccess();
  console.log('test_assert_deployed_version: all tests passed');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
