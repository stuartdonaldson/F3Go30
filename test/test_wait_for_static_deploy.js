const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  readCurrentVersion_,
  extractDeployedVersion_,
  parseArgs_,
  waitForStaticDeploy_,
} = require('../tools/wait-for-static-deploy.js');

// ── extractDeployedVersion_ ─────────────────────────────────────────────────────────────────

function testExtractDeployedVersionFindsTheStamp() {
  const html = '<html><script>var STATIC_BUILD_VERSION_ = "2.4.10.38";</script></html>';
  assert.strictEqual(extractDeployedVersion_(html), '2.4.10.38');
}

function testExtractDeployedVersionReturnsNullForUnbuiltSource() {
  // build-static-pages.js's VERSION_PLACEHOLDER is `var STATIC_BUILD_VERSION_ = null;` (a JS
  // literal, not a quoted string) until the build step stamps it — this is what src/index.html
  // itself looks like, and what a stale/never-deployed page would still show.
  const html = 'var STATIC_BUILD_VERSION_ = null;';
  assert.strictEqual(extractDeployedVersion_(html), null);
}

function testExtractDeployedVersionReturnsNullForUnrelatedHtml() {
  assert.strictEqual(extractDeployedVersion_('<html>404 not found</html>'), null);
  assert.strictEqual(extractDeployedVersion_(''), null);
  assert.strictEqual(extractDeployedVersion_(undefined), null);
}

// ── readCurrentVersion_ ──────────────────────────────────────────────────────────────────────

function testReadCurrentVersionParsesAppVersion() {
  const tmpPath = path.join(os.tmpdir(), 'test_wait_for_static_deploy_version_' + process.pid + '.js');
  fs.writeFileSync(tmpPath, "const APP_VERSION      = '2.4.10.38';\nconst APP_VERSION_DATE = 'x';\n", 'utf8');
  try {
    assert.strictEqual(readCurrentVersion_(tmpPath), '2.4.10.38');
  } finally {
    fs.unlinkSync(tmpPath);
  }
}

function testReadCurrentVersionThrowsWhenMissing() {
  const tmpPath = path.join(os.tmpdir(), 'test_wait_for_static_deploy_missing_' + process.pid + '.js');
  fs.writeFileSync(tmpPath, 'const SOMETHING_ELSE = 1;\n', 'utf8');
  try {
    assert.throws(() => readCurrentVersion_(tmpPath), /APP_VERSION/);
  } finally {
    fs.unlinkSync(tmpPath);
  }
}

// ── parseArgs_ ────────────────────────────────────────────────────────────────────────────────

function testParseArgsAppliesDefaults() {
  assert.deepStrictEqual(parseArgs_([]), { env: 'sit', version: null, intervalSec: 5, timeoutSec: 180 });
}

function testParseArgsReadsEachFlag() {
  const args = parseArgs_(['--env', 'prod', '--version', '2.4.11', '--interval', '2', '--timeout', '30']);
  assert.deepStrictEqual(args, { env: 'prod', version: '2.4.11', intervalSec: 2, timeoutSec: 30 });
}

function testParseArgsRejectsAnUnknownEnv() {
  assert.throws(() => parseArgs_(['--env', 'staging']), /--env must be/);
}

function testParseArgsRejectsNonPositiveIntervalOrTimeout() {
  assert.throws(() => parseArgs_(['--interval', '0']), /--interval must be/);
  assert.throws(() => parseArgs_(['--timeout', '-5']), /--timeout must be/);
}

// ── waitForStaticDeploy_ (dependency-injected fetch/sleep — no real network or wall-clock wait) ─

async function testWaitForStaticDeployResolvesImmediatelyWhenAlreadyCurrent() {
  const fetchCalls = [];
  const fetchText = async (url) => { fetchCalls.push(url); return 'var STATIC_BUILD_VERSION_ = "2.4.10.38";'; };
  const result = await waitForStaticDeploy_({
    env: 'sit', version: '2.4.10.38', intervalSec: 1, timeoutSec: 10, fetchText, sleep: async () => {},
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.attempts, 1);
  assert.strictEqual(fetchCalls.length, 1);
  assert.ok(fetchCalls[0].includes('/dist/sit/index.html'));
}

async function testWaitForStaticDeployRetriesUntilTheVersionMatches() {
  // Simulates GitHub Pages' CDN propagation lag: the first two polls still see the old build,
  // the third sees the new one.
  let call = 0;
  const responses = [
    'var STATIC_BUILD_VERSION_ = "2.4.10.37";',
    'var STATIC_BUILD_VERSION_ = "2.4.10.37";',
    'var STATIC_BUILD_VERSION_ = "2.4.10.38";',
  ];
  const fetchText = async () => responses[call++];
  const sleepCalls = [];
  const result = await waitForStaticDeploy_({
    env: 'sit', version: '2.4.10.38', intervalSec: 1, timeoutSec: 10, fetchText,
    sleep: async (ms) => { sleepCalls.push(ms); },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.attempts, 3);
  assert.deepStrictEqual(sleepCalls, [1000, 1000]); // slept between attempts 1->2 and 2->3, not after success
}

async function testWaitForStaticDeployToleratesAFetchFailureAndKeepsPolling() {
  // A transient network hiccup on one poll must not abort the whole wait — the next poll can
  // still succeed.
  let call = 0;
  const fetchText = async () => {
    call++;
    if (call === 1) throw new Error('ECONNRESET');
    return 'var STATIC_BUILD_VERSION_ = "2.4.10.38";';
  };
  const result = await waitForStaticDeploy_({
    env: 'sit', version: '2.4.10.38', intervalSec: 1, timeoutSec: 10, fetchText, sleep: async () => {},
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.attempts, 2);
}

async function testWaitForStaticDeployThrowsOnTimeout() {
  const fetchText = async () => 'var STATIC_BUILD_VERSION_ = "2.4.10.37";'; // never matches
  await assert.rejects(
    waitForStaticDeploy_({
      env: 'sit', version: '2.4.10.38', intervalSec: 1, timeoutSec: 2, fetchText, sleep: async () => {},
    }),
    /Timed out/
  );
}

async function run() {
  const syncTests = [
    testExtractDeployedVersionFindsTheStamp,
    testExtractDeployedVersionReturnsNullForUnbuiltSource,
    testExtractDeployedVersionReturnsNullForUnrelatedHtml,
    testReadCurrentVersionParsesAppVersion,
    testReadCurrentVersionThrowsWhenMissing,
    testParseArgsAppliesDefaults,
    testParseArgsReadsEachFlag,
    testParseArgsRejectsAnUnknownEnv,
    testParseArgsRejectsNonPositiveIntervalOrTimeout,
  ];
  for (const test of syncTests) {
    test();
    console.log(`  ok - ${test.name}`);
  }

  const asyncTests = [
    testWaitForStaticDeployResolvesImmediatelyWhenAlreadyCurrent,
    testWaitForStaticDeployRetriesUntilTheVersionMatches,
    testWaitForStaticDeployToleratesAFetchFailureAndKeepsPolling,
    testWaitForStaticDeployThrowsOnTimeout,
  ];
  for (const test of asyncTests) {
    await test();
    console.log(`  ok - ${test.name}`);
  }

  console.log('test_wait_for_static_deploy.js: all tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
