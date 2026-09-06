const assert = require('node:assert/strict');

// Covers the one owning outcome classifier and retry policy (tests/harness/outcomes.js,
// F3Go30-emwk.6 — H6/H7/H8). Network-free by construction: every input here is a literal
// execution record, so this file runs in the fast tier alongside the rest of test/.

const {
  OUTCOME,
  RETRY_POLICY,
  retriesFor,
  DURATION_CEILING_MS,
  ceilingMsFor,
  isOverCeiling,
  classifyFailureMessage,
  classifyExecution,
  summarize,
  formatSummary,
} = require('../tests/harness/outcomes.js');

// --- retry policy (H7): bounded, one place, live tier only ------------------------------------

assert.equal(retriesFor('live'), 1, 'live tier retries once');
assert.equal(retriesFor('no_live_session'), 0, 'network-free tier never retries');
assert.equal(retriesFor('node'), 0, 'node suite never retries');
assert.equal(retriesFor('demo'), 0, 'purpose exclusion never retries');
assert.throws(() => retriesFor('made-up-tier'), /No retry policy declared/);

// A retry count smuggled onto a non-live tier must fail loudly rather than take effect.
const savedNoLive = RETRY_POLICY.no_live_session.retries;
RETRY_POLICY.no_live_session.retries = 1;
assert.throws(() => retriesFor('no_live_session'), /retry applies to the live tier only/i);
RETRY_POLICY.no_live_session.retries = savedNoLive;

// A policy above the bounded ceiling is a bug, not a tuning choice.
const savedLive = RETRY_POLICY.live.retries;
RETRY_POLICY.live.retries = 9;
assert.throws(() => retriesFor('live'), /exceeds MAX_RETRIES/);
RETRY_POLICY.live.retries = savedLive;

// --- duration ceiling (H4/H5, F3Go30-emwk.10): one place, two values, two consumers -------------

assert.equal(DURATION_CEILING_MS.live, 60000, 'H4 default: 60s for a boundary-crossing tier');
assert.equal(DURATION_CEILING_MS.other, 30000, 'H4 default: 30s otherwise');
assert.equal(ceilingMsFor('live'), 60000);
assert.equal(ceilingMsFor('no_live_session'), 30000);
assert.equal(ceilingMsFor('node'), 30000);
// tests/playwright/tiers.js's live-by-construction rule: anything not explicitly network-free
// gets the boundary-crossing (60s) ceiling, never the tight one, by default.
assert.equal(ceilingMsFor('some-future-tier'), 60000);

assert.equal(isOverCeiling({ tier: 'live', status: 'passed', durationMs: 59999 }), false);
assert.equal(isOverCeiling({ tier: 'live', status: 'passed', durationMs: 60001 }), true, 'a slow PASS is still over ceiling');
assert.equal(isOverCeiling({ tier: 'live', status: 'failed', durationMs: 60001 }), true);
assert.equal(isOverCeiling({ tier: 'no_live_session', status: 'passed', durationMs: 30001 }), true);
assert.equal(isOverCeiling({ tier: 'no_live_session', status: 'passed', durationMs: 29999 }), false);
assert.equal(isOverCeiling({ tier: 'live', status: 'skipped', durationMs: 999999 }), false, 'skipped is never over ceiling');
assert.equal(isOverCeiling({ tier: 'live', status: 'passed', durationMs: 0 }), false, 'no recorded duration is never over ceiling');
assert.equal(isOverCeiling(null), false);

// --- signature evidence (H6) -------------------------------------------------------------------

const boundaryMessages = [
  'Sorry, unable to open the file at this time. Please check the address and try again.',
  'Error: Service invoked too many times for one day: urlfetch.',
  'page.goto: net::ERR_CONNECTION_RESET at https://script.google.com/macros/s/AKfy/exec',
  'FetchError: request to https://script.google.com failed, reason: ECONNRESET',
  'apiRequestContext.post: Timeout 30000ms exceeded https://script.google.com/macros/s/x/exec',
  'SyntaxError: Unexpected token \'<\', "<!DOCTYPE "... is not valid JSON',
  'Error: Request failed with statusCode 503',
];
for (const m of boundaryMessages) {
  const v = classifyFailureMessage(m);
  assert.equal(v.outcome, OUTCOME.BOUNDARY_FAULT, `expected a boundary fault for: ${m}`);
  assert.ok(v.signal, 'a boundary fault names the signal that classified it');
}

const assertionMessages = [
  'expect(received).toBe(expected)\n\nExpected: true\nReceived: false',
  'Error: expect(locator).toBeVisible() failed\nLocator: locator(\'#step-checkin\')',
  'AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: 3 !== 4',
];
for (const m of assertionMessages) {
  const v = classifyFailureMessage(m);
  assert.equal(v.outcome, OUTCOME.ASSERTION_FAILURE, `expected an assertion failure for: ${m}`);
  assert.equal(v.signal, null);
}

// --- probe evidence: an unhealthy boundary reclassifies live-tier failures ----------------------

const plainFailure = { status: 'failed', tier: 'live', failureMessage: 'expect(received).toBe(true)' };
assert.equal(classifyExecution(plainFailure, { boundaryHealthy: true }).outcome, OUTCOME.ASSERTION_FAILURE);
assert.equal(classifyExecution(plainFailure, { boundaryHealthy: null }).outcome, OUTCOME.ASSERTION_FAILURE);
const probed = classifyExecution(plainFailure, { boundaryHealthy: false });
assert.equal(probed.outcome, OUTCOME.BOUNDARY_FAULT, 'unhealthy boundary makes a live failure a boundary fault');
assert.equal(probed.signal, 'boundary-probe-unhealthy');

// ...but never a network-free one: those cannot have been hurt by the boundary being down.
assert.equal(
  classifyExecution({ status: 'failed', tier: 'no_live_session', failureMessage: 'expect(x).toBe(y)' }, { boundaryHealthy: false }).outcome,
  OUTCOME.ASSERTION_FAILURE
);
assert.equal(
  classifyExecution({ status: 'failed', tier: 'node', failureMessage: 'expect(x).toBe(y)' }, { boundaryHealthy: false }).outcome,
  OUTCOME.ASSERTION_FAILURE
);

// A boundary fault is never converted to a pass, whatever the evidence says.
assert.equal(classifyExecution({ status: 'passed', tier: 'live' }, { boundaryHealthy: false }).outcome, OUTCOME.PASS);
assert.equal(classifyExecution({ status: 'skipped', tier: 'live' }, {}).outcome, OUTCOME.SKIPPED);
assert.notEqual(probed.outcome, OUTCOME.PASS);

// --- the summary (H8) ---------------------------------------------------------------------------

const executions = [
  { status: 'passed', tier: 'node', durationMs: 1000, attempts: 1 },
  { status: 'passed', tier: 'live', durationMs: 3000, attempts: 2 },
  { status: 'failed', tier: 'live', durationMs: 4000, attempts: 2, failureMessage: 'net::ERR_TIMED_OUT' },
  { status: 'failed', tier: 'node', durationMs: 2000, attempts: 1, failureMessage: 'expect(a).toBe(b)' },
  { status: 'skipped', tier: 'live', durationMs: 0, attempts: 1 },
  // A slow PASS — H4/H5's whole reason for existing: this must show up as its own category, not
  // vanish into `counts[OUTCOME.PASS]`.
  { status: 'passed', tier: 'live', durationMs: 61000, attempts: 1 },
].map((e) => {
  const v = classifyExecution(e, { boundaryHealthy: true });
  return Object.assign({}, e, { outcome: v.outcome, signal: v.signal });
});

const s = summarize(executions);
assert.equal(s.executed, 5, 'skipped executions are not counted as executions');
assert.equal(s.counts[OUTCOME.PASS], 3);
assert.equal(s.counts[OUTCOME.ASSERTION_FAILURE], 1);
assert.equal(s.counts[OUTCOME.BOUNDARY_FAULT], 1);
assert.equal(s.failed, 2);
assert.equal(s.failureRate, 0.4);
assert.equal(s.boundaryShareOfFailures, 0.5);
assert.equal(s.totalMs, 71000);
assert.equal(s.failedMs, 6000);
assert.equal(s.retried, 2, 'attempt counts above 1 are counted as retried executions');
assert.equal(s.extraAttempts, 2);
assert.deepEqual(s.signals, { 'chromium-net': 1 });
// H4/H5: the slow pass is counted as its own category, still counted as a PASS above (H4 is
// orthogonal to H6's outcome classes), and attributed to the live ceiling, not the tight one.
assert.equal(s.overCeiling, 1);
assert.equal(s.overCeilingLive, 1);
assert.equal(s.overCeilingOther, 0);

const printed = formatSummary(s, { sources: ['unit'] });
assert.match(printed, /execution failure rate: 40\.0% \(2 of 5\)/);
assert.match(printed, /boundary fault:\s+1/);
assert.match(printed, /over ceiling \(H4\):\s+1 \(1 live > 60\.0s, 0 other > 30\.0s\)/);

// An empty run must not divide by zero.
const empty = summarize([]);
assert.equal(empty.failureRate, 0);
assert.equal(empty.failedWallTimeShare, 0);
assert.equal(empty.overCeiling, 0);
assert.match(formatSummary(empty, {}), /execution failure rate: 0\.0%/);
assert.match(formatSummary(empty, {}), /over ceiling \(H4\):\s+0/);

console.log('test_outcome_classifier: all assertions passed');
