/**
 * Playwright reporter that records one execution record per test — status, tier, attempt count,
 * wall time and failure message — for the one owning classifier in tests/harness/outcomes.js
 * (F3Go30-emwk.6, H6/H7/H8).
 *
 * This reporter classifies nothing and prints nothing. It is a *recorder*: Playwright is the only
 * place the attempt count (`result.retry`) is observable, so the record is captured here and the
 * verdict is left to `classifyExecution()`, which tools/test-outcome-report.js applies once per
 * run with the boundary-probe evidence attached (`I12` — one owning helper; a reporter that
 * classified on its own would be a second one).
 *
 * Output: `test-results/outcomes-playwright.json` (override with `OUTCOMES_JSON`).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_OUT = path.resolve(__dirname, '../../test-results/outcomes-playwright.json');

function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return String(s || '').replace(/\[[0-9;]*m/g, '');
}

function projectNameOf(test) {
  try {
    if (test.parent && typeof test.parent.project === 'function') {
      const p = test.parent.project();
      if (p && p.name) return p.name;
    }
  } catch (e) {
    /* fall through to titlePath */
  }
  const tp = typeof test.titlePath === 'function' ? test.titlePath() : [];
  return tp[1] || 'unknown';
}

class OutcomeRecorder {
  constructor(options) {
    this.outFile = (options && options.outputFile) || process.env.OUTCOMES_JSON || DEFAULT_OUT;
    this.records = new Map();
  }

  onTestEnd(test, result) {
    // Called once per attempt. Later attempts overwrite the status/message (the final attempt is
    // the run's verdict) while wall time accumulates across every attempt actually spent.
    const key = test.id || test.titlePath().join(' › ');
    const prior = this.records.get(key);
    const messages = (result.errors || [])
      .map((e) => stripAnsi(e.message || e.value || ''))
      .filter(Boolean);
    this.records.set(key, {
      name: test.titlePath().filter(Boolean).slice(1).join(' › '),
      tier: projectNameOf(test),
      status: result.status === 'interrupted' || result.status === 'timedOut' ? 'failed' : result.status,
      rawStatus: result.status,
      attempts: (result.retry || 0) + 1,
      durationMs: (prior ? prior.durationMs : 0) + (result.duration || 0),
      failureMessage: messages.join('\n'),
      runner: 'playwright',
    });
  }

  async onEnd() {
    const records = Array.from(this.records.values());
    fs.mkdirSync(path.dirname(this.outFile), { recursive: true });
    fs.writeFileSync(this.outFile, JSON.stringify({ runner: 'playwright', executions: records }, null, 2));
  }
}

module.exports = OutcomeRecorder;
