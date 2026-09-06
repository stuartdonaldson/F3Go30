/**
 * The one owning outcome classifier and retry policy for this project's test harness
 * (F3Go30-emwk.6, realizes H6 / H7 / H8 — see docs/atdd/harness-design.md §9a).
 *
 * `I12` — one owning helper. Nothing else in this repository decides whether a red result is an
 * assertion failure or a boundary fault: no spec `catch`, no per-test `try`, no ad hoc string
 * match in a runner script. Both runners feed their executions through `classifyExecution()` here,
 * and every consumer (the Playwright reporter, tools/test-outcome-report.js) reads the same
 * verdict.
 *
 * `I6` — the retry numbers live in exactly one place: `RETRY_POLICY` below. `playwright.config.js`
 * reads it; it is never re-typed as a literal in a project definition.
 *
 * `H4`/`H5` (F3Go30-emwk.10) — the per-test duration ceiling lives in exactly one place too:
 * `DURATION_CEILING_MS` below. `playwright.config.js` reads it for the `no_live_session` project's
 * `timeout` (`ceilingMsFor('no_live_session')`) instead of the literal `30000` that used to sit
 * there — the exact "number repeated in two files" defect the operator check for this stage warns
 * against, once a ceiling is declared at all. `tools/test-outcome-report.js` reads the same export
 * (via `isOverCeiling()`/`summarize()`) to classify and print over-ceiling executions as their own
 * category. The `live` project's Playwright `timeout` (120s) and `demo`'s (also 120s) are a
 * *different* mechanism — Playwright's own hang-safety-net, documented in `playwright.config.js`
 * as "GAS editor is slow to initialise" — and are deliberately left alone: `H4`'s ceiling is a
 * *reported budget* ("a harness-reported failure, not a slow pass"), not a kill switch, so an
 * over-budget live test is flagged, not aborted mid-run. Four live specs already self-declare a
 * `test.describe.configure({ timeout })` above the project default (120s/240s) for exactly this
 * reason, predating this bead; those are the tests most likely to need an `H5` waiver below.
 *
 * ## The three outcome classes (`H6`)
 *
 * | Class | Meaning |
 * |---|---|
 * | `pass` | The behaviour under test held. |
 * | `assertion failure` | The behaviour under test did not hold — this project's defect. |
 * | `boundary fault` | The run never got a fair chance: the external service (Apps Script /exec, Google Drive/Sheets, the network) was unavailable, rate-limited, erroring or answering with something that is not the contract. Not this project's defect, and not a pass either. |
 *
 * A boundary fault is still red. It is never converted to a pass and never suppressed — the point
 * of the class is that a red run can say *why* it is red, so that "10% of our runs fail for
 * reasons that are not the code" becomes a printed number rather than folklore.
 *
 * ## How a failure is classified — two independent kinds of evidence
 *
 * 1. **Signature evidence** (always available): the failure message matches one of
 *    `BOUNDARY_SIGNATURES` — Apps Script's own error pages, Google quota/authorization errors,
 *    transport-level socket/DNS errors, Chromium `net::ERR_*`, a navigation timeout against a
 *    Google origin, or a JSON parse failure on a live response (the live endpoint answered with an
 *    HTML error page where the contract says JSON).
 * 2. **Probe evidence** (live tier only, gathered once per run, never per test): the deployment
 *    the live tier targets is asked `?cmd=version` after the run. If the boundary cannot answer
 *    with a healthy version response, then every live-tier failure in that run is a boundary fault
 *    by definition, whatever its message said. This is what makes a mis-pointed or dead deployment
 *    classify correctly instead of surfacing as N assertion failures.
 *
 * Signature evidence alone can never see a *silent* boundary problem; probe evidence alone cannot
 * attribute a single flaky 503 inside an otherwise healthy run. Both are needed, and both are
 * owned here.
 *
 * Extending the signature list is the intended maintenance path — add a row to
 * `BOUNDARY_SIGNATURES` with a stable id, never a `catch` in a spec.
 */

'use strict';

const OUTCOME = {
  PASS: 'pass',
  ASSERTION_FAILURE: 'assertion_failure',
  BOUNDARY_FAULT: 'boundary_fault',
  SKIPPED: 'skipped',
};

const OUTCOME_LABEL = {
  [OUTCOME.PASS]: 'pass',
  [OUTCOME.ASSERTION_FAILURE]: 'assertion failure',
  [OUTCOME.BOUNDARY_FAULT]: 'boundary fault',
  [OUTCOME.SKIPPED]: 'skipped',
};

/**
 * `I6` single source for every retry number in this project. Keyed by Playwright project name
 * (the tier names declared in tests/playwright/tiers.js) plus the node runner's pseudo-tier.
 *
 * Retry applies to the **live tier only**, and it is bounded: one retry, two attempts total. The
 * network-free tier must never retry — a flaky network-free test is a defect in that test, and
 * retrying it would hide exactly the signal the fast gate exists to give. The node suite is
 * network-free by construction and `node --test` has no retry mechanism; it is recorded here as
 * `0` so the table is the complete answer to "what retries in this project".
 */
const RETRY_POLICY = {
  live: { retries: 1, reason: 'crosses the Google boundary; one bounded retry absorbs a transient 5xx / edge-propagation race' },
  no_live_session: { retries: 0, reason: 'network-free — a flake here is a defect in the test, not the boundary' },
  demo: { retries: 0, reason: 'purpose exclusion, not a tier member; screenshots are re-run by hand' },
  node: { retries: 0, reason: 'network-free; node --test has no retry mechanism' },
};

/** Tiers a retry may be applied to. Anything else must be 0 — asserted by retriesFor(). */
const RETRYABLE_TIERS = ['live'];

/** The bounded ceiling. A policy above this is a bug, not a tuning choice. */
const MAX_RETRIES = 2;

function retriesFor(tier) {
  const entry = RETRY_POLICY[tier];
  if (!entry) throw new Error(`No retry policy declared for tier '${tier}' (tests/harness/outcomes.js RETRY_POLICY)`);
  if (entry.retries > 0 && !RETRYABLE_TIERS.includes(tier)) {
    throw new Error(`Retry is declared for non-retryable tier '${tier}' — retry applies to the live tier only`);
  }
  if (entry.retries > MAX_RETRIES) {
    throw new Error(`Retry policy for '${tier}' (${entry.retries}) exceeds MAX_RETRIES (${MAX_RETRIES})`);
  }
  return entry.retries;
}

/**
 * `H4` single source for every per-test duration ceiling in this project (F3Go30-emwk.10). Two
 * values, milliseconds — a test that crosses an external boundary gets more room than one that
 * does not, because the boundary round trip is the cost this ceiling is bounding, not the code
 * under test:
 *
 *   - `live`  — 60s. Any tier `isBoundaryCrossingTier()` calls live-by-construction (the `live`
 *     Playwright project, plus a JUnit-sourced execution attributed to any tier other than
 *     `no_live_session`/`node`).
 *   - `other` — 30s. `no_live_session` and `node` — no external round trip, so no extra room.
 *
 * These are `H4`'s stated defaults ("Defaults to adopt: 60s live / 30s otherwise",
 * docs/atdd/harness-design.md §9a) — adopted verbatim, not tuned. Raising either value to make an
 * over-budget test disappear is exactly the silent exemption `H5` prohibits; the correct move for
 * an over-budget test is the `H5` resolution order (`T6` → `T12` → `T21`), and only then a named
 * waiver in docs/atdd/harness-design.md §9a's waiver table.
 */
const DURATION_CEILING_MS = {
  live: 60000,
  other: 30000,
};

/**
 * The ceiling that applies to one execution's tier, `H4`'s single source. Mirrors
 * `isBoundaryCrossingTier()`'s live-by-construction rule: only `no_live_session` and `node` get
 * the tighter `other` ceiling.
 */
function ceilingMsFor(tier) {
  return isBoundaryCrossingTier(tier) ? DURATION_CEILING_MS.live : DURATION_CEILING_MS.other;
}

/**
 * `H4`: is this execution over its ceiling? Skipped executions and executions with no recorded
 * duration are never over ceiling — there is nothing to budget against.
 * @param {object} execution  {tier, durationMs, status}
 */
function isOverCeiling(execution) {
  if (!execution || execution.status === 'skipped') return false;
  const ms = Number(execution.durationMs) || 0;
  if (ms <= 0) return false;
  return ms > ceilingMsFor(execution.tier);
}

/**
 * Boundary signatures. Each row is `{id, pattern}`; `id` names the boundary condition and is what
 * the summary prints, so a boundary fault says which boundary and how it broke.
 */
const BOUNDARY_SIGNATURES = [
  // --- Apps Script / Google product error surfaces -------------------------------------------
  { id: 'gas-file-unavailable', pattern: /Sorry, unable to open the file at this time/i },
  { id: 'gas-page-not-found', pattern: /(Google Drive)?\s*-?\s*Page Not Found/i },
  { id: 'gas-script-function-not-found', pattern: /Script function not found/i },
  { id: 'gas-authorization-required', pattern: /Authorization is required to perform that action/i },
  { id: 'gas-quota', pattern: /(Service invoked too many times|Rate Limit Exceeded|too many times for one day|Service using too much computer time)/i },
  { id: 'gas-exec-timeout', pattern: /Exceeded maximum execution time/i },
  { id: 'gas-internal', pattern: /(We're sorry, a server error occurred|Service Spreadsheets failed|Internal error|Document is currently locked)/i },

  // --- HTTP status evidence ------------------------------------------------------------------
  { id: 'http-5xx', pattern: /\b(50[0234]|429)\b[^\n]{0,40}(Internal Server Error|Bad Gateway|Service Unavailable|Gateway Time-?out|Too Many Requests)/i },
  { id: 'http-5xx-status', pattern: /status(Code)?[^\n]{0,12}\b(500|502|503|504|429)\b/i },

  // --- Transport / DNS / TLS ------------------------------------------------------------------
  { id: 'socket', pattern: /\b(ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|EHOSTUNREACH|ENETUNREACH|socket hang up|read ECONN)\b/ },
  { id: 'tls', pattern: /\b(CERT_HAS_EXPIRED|UNABLE_TO_VERIFY_LEAF_SIGNATURE|ERR_TLS)/ },
  { id: 'chromium-net', pattern: /net::ERR_[A-Z_]+/ },

  // --- Navigation / request timeouts against an external origin --------------------------------
  { id: 'nav-timeout-external', pattern: /(Timeout|Timed out)[^\n]{0,80}(https?:\/\/)?(script|docs|drive|accounts|www)\.google(usercontent)?\.com/i },
  { id: 'request-timeout-external', pattern: /apiRequestContext[^\n]{0,120}(script|docs|drive)\.google\.com/i },

  // --- Contract-shaped evidence ---------------------------------------------------------------
  // The live endpoint answered with something that is not JSON where the contract says JSON —
  // in practice an Apps Script HTML error page. That is the boundary misbehaving, not an
  // assertion about product behaviour being wrong.
  { id: 'non-json-live-response', pattern: /(Unexpected token|Unexpected end of JSON input|is not valid JSON)/i },
];

/**
 * Classify a failure message on signature evidence alone.
 * @returns {{outcome: string, signal: string|null}}
 */
function classifyFailureMessage(message) {
  const text = String(message || '');
  for (const sig of BOUNDARY_SIGNATURES) {
    if (sig.pattern.test(text)) {
      return { outcome: OUTCOME.BOUNDARY_FAULT, signal: sig.id };
    }
  }
  return { outcome: OUTCOME.ASSERTION_FAILURE, signal: null };
}

/**
 * The single classification entry point. Every execution produced by either runner goes through
 * this function and nothing else.
 *
 * @param {object} execution  {status: 'passed'|'failed'|'skipped', failureMessage, tier}
 * @param {object} [context]  {boundaryHealthy: true|false|null} — the once-per-run probe result;
 *                            `null`/absent means "not probed", and only signature evidence is used.
 * @returns {{outcome: string, signal: string|null}}
 */
function classifyExecution(execution, context) {
  const status = execution && execution.status;
  if (status === 'skipped') return { outcome: OUTCOME.SKIPPED, signal: null };
  if (status !== 'failed') return { outcome: OUTCOME.PASS, signal: null };

  const bySignature = classifyFailureMessage(execution.failureMessage);
  if (bySignature.outcome === OUTCOME.BOUNDARY_FAULT) return bySignature;

  const probed = context && context.boundaryHealthy;
  if (probed === false && isBoundaryCrossingTier(execution.tier)) {
    return { outcome: OUTCOME.BOUNDARY_FAULT, signal: 'boundary-probe-unhealthy' };
  }
  return bySignature;
}

/** Tiers whose executions cross an external boundary, and are therefore eligible for probe
 * evidence and for retry. Mirrors tests/playwright/tiers.js's live-by-construction rule: only the
 * explicitly network-free tiers are excluded. */
function isBoundaryCrossingTier(tier) {
  return tier !== 'no_live_session' && tier !== 'node';
}

/**
 * Roll a list of classified executions into the run summary `H8` requires.
 * Executions must already carry `.outcome` (set via classifyExecution).
 */
function summarize(executions) {
  const counts = { [OUTCOME.PASS]: 0, [OUTCOME.ASSERTION_FAILURE]: 0, [OUTCOME.BOUNDARY_FAULT]: 0, [OUTCOME.SKIPPED]: 0 };
  let totalMs = 0;
  let failedMs = 0;
  let boundaryMs = 0;
  let retried = 0;
  let extraAttempts = 0;
  const signals = {};
  // H4: over-ceiling is orthogonal to pass/assertion_failure/boundary_fault — a slow *pass* is
  // exactly the case H4 exists to stop being invisible — so it is counted separately, never
  // folded into `counts`.
  let overCeilingLive = 0;
  let overCeilingOther = 0;

  for (const e of executions) {
    counts[e.outcome] = (counts[e.outcome] || 0) + 1;
    const ms = Number(e.durationMs) || 0;
    totalMs += ms;
    if (e.outcome === OUTCOME.ASSERTION_FAILURE || e.outcome === OUTCOME.BOUNDARY_FAULT) failedMs += ms;
    if (e.outcome === OUTCOME.BOUNDARY_FAULT) {
      boundaryMs += ms;
      if (e.signal) signals[e.signal] = (signals[e.signal] || 0) + 1;
    }
    const attempts = Number(e.attempts) || 1;
    if (attempts > 1) {
      retried += 1;
      extraAttempts += attempts - 1;
    }
    if (isOverCeiling(e)) {
      if (isBoundaryCrossingTier(e.tier)) overCeilingLive += 1;
      else overCeilingOther += 1;
    }
  }

  const executed = counts[OUTCOME.PASS] + counts[OUTCOME.ASSERTION_FAILURE] + counts[OUTCOME.BOUNDARY_FAULT];
  const failed = counts[OUTCOME.ASSERTION_FAILURE] + counts[OUTCOME.BOUNDARY_FAULT];
  return {
    counts,
    executed,
    failed,
    failureRate: executed ? failed / executed : 0,
    boundaryShareOfFailures: failed ? counts[OUTCOME.BOUNDARY_FAULT] / failed : 0,
    totalMs,
    failedMs,
    boundaryMs,
    failedWallTimeShare: totalMs ? failedMs / totalMs : 0,
    retried,
    extraAttempts,
    signals,
    overCeilingLive,
    overCeilingOther,
    overCeiling: overCeilingLive + overCeilingOther,
  };
}

function pct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

function secs(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** The printed block. `H8`: every run prints the execution failure rate and the share of wall
 * time spent on failed executions. */
function formatSummary(summary, opts) {
  const o = opts || {};
  const lines = [];
  lines.push('');
  lines.push('─── outcome summary (H6/H7/H8) ' + '─'.repeat(38));
  lines.push(`  source(s):            ${(o.sources || []).join(', ') || '(none)'}`);
  lines.push(`  executions:           ${summary.executed}` + (summary.counts[OUTCOME.SKIPPED] ? ` (+${summary.counts[OUTCOME.SKIPPED]} skipped)` : ''));
  lines.push(`  pass:                 ${summary.counts[OUTCOME.PASS]}`);
  lines.push(`  assertion failure:    ${summary.counts[OUTCOME.ASSERTION_FAILURE]}`);
  lines.push(`  boundary fault:       ${summary.counts[OUTCOME.BOUNDARY_FAULT]}`);
  lines.push(`  execution failure rate: ${pct(summary.failureRate)} (${summary.failed} of ${summary.executed})`);
  lines.push(`  boundary share of failures: ${summary.failed ? pct(summary.boundaryShareOfFailures) : 'n/a'}`);
  lines.push(`  wall time on failed executions: ${secs(summary.failedMs)} of ${secs(summary.totalMs)} (${pct(summary.failedWallTimeShare)})`);
  lines.push(`  retried executions:   ${summary.retried} (${summary.extraAttempts} extra attempt(s); policy: live=${RETRY_POLICY.live.retries}, all other tiers=0)`);
  lines.push(
    `  over ceiling (H4):    ${summary.overCeiling} (${summary.overCeilingLive} live > ${secs(DURATION_CEILING_MS.live)}, ${summary.overCeilingOther} other > ${secs(DURATION_CEILING_MS.other)})`
  );
  if (o.boundaryHealthy === false) {
    lines.push(`  boundary probe:       UNHEALTHY — ${o.boundaryProbeDetail || 'no healthy version response'}`);
  } else if (o.boundaryHealthy === true) {
    lines.push(`  boundary probe:       healthy (${o.boundaryProbeDetail || 'version responded'})`);
  }
  const sigIds = Object.keys(summary.signals);
  if (sigIds.length) {
    lines.push(`  boundary signals:     ${sigIds.map((s) => `${s}×${summary.signals[s]}`).join(', ')}`);
  }
  lines.push('─'.repeat(68));
  lines.push('');
  return lines.join('\n');
}

module.exports = {
  OUTCOME,
  OUTCOME_LABEL,
  RETRY_POLICY,
  RETRYABLE_TIERS,
  MAX_RETRIES,
  retriesFor,
  DURATION_CEILING_MS,
  ceilingMsFor,
  isOverCeiling,
  BOUNDARY_SIGNATURES,
  classifyFailureMessage,
  classifyExecution,
  isBoundaryCrossingTier,
  summarize,
  formatSummary,
};
