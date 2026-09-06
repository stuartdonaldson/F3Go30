#!/usr/bin/env node
/**
 * Prints the run's outcome summary — pass / assertion failure / boundary fault, the execution
 * failure rate, and the share of wall time spent on failed executions (F3Go30-emwk.6; H6/H8).
 *
 * This tool owns no classification logic of its own: it collects execution records from whatever
 * the runners produced, gathers the once-per-run boundary evidence, and hands both to
 * `classifyExecution()` in tests/harness/outcomes.js (`I12`).
 *
 * Sources
 *   --junit <file>      a JUnit XML file (the node tier writes test-results/node-junit.xml).
 *                       Executions read from JUnit have no attempt count — the node tier does not
 *                       retry (RETRY_POLICY.node = 0), so attempts is 1 by construction.
 *   --outcomes <file>   an execution-record JSON written by tests/harness/playwright-outcome-reporter.js.
 * Either flag may be repeated. Missing files are reported and skipped, never fatal: this tool is
 * a reporter, and it must not be able to turn a green run red or a red run green. It always
 * exits 0 — the runner's own exit code is the run's verdict.
 *
 *   --tier <name>       tier attributed to JUnit-sourced executions (default: node)
 *   --env sit|prod      which deployment the boundary probe asks (default: sit)
 *   --no-probe          skip the boundary probe (offline / CI without credentials)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { classifyExecution, summarize, formatSummary, isOverCeiling, OUTCOME } = require(path.join(ROOT, 'tests/harness/outcomes.js'));

const PROBE_TIMEOUT_MS = 20000;

function parseArgs(argv) {
  const out = { junit: [], outcomes: [], tier: 'node', env: 'sit', probe: true };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--junit') out.junit.push(argv[++i]);
    else if (a === '--outcomes') out.outcomes.push(argv[++i]);
    else if (a === '--tier') out.tier = argv[++i];
    else if (a === '--env') out.env = argv[++i];
    else if (a === '--no-probe') out.probe = false;
  }
  return out;
}

function unescapeXml(s) {
  return String(s || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

function attr(tagText, name) {
  const m = tagText.match(new RegExp(`${name}="([^"]*)"`));
  return m ? unescapeXml(m[1]) : '';
}

/** Minimal JUnit reader — enough for the two shapes this project emits, no XML dependency. */
function parseJunit(xml, tier) {
  const executions = [];
  const re = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1];
    const body = m[3] || '';
    const name = [attr(attrs, 'classname'), attr(attrs, 'name')].filter(Boolean).join(' › ');
    const durationMs = Math.round((parseFloat(attr(attrs, 'time')) || 0) * 1000);
    let status = 'passed';
    let failureMessage = '';
    if (/<skipped\b/.test(body)) {
      status = 'skipped';
    } else {
      const f = body.match(/<(failure|error)\b([^>]*)>([\s\S]*?)<\/\1>|<(failure|error)\b([^>]*)\/>/);
      if (f) {
        status = 'failed';
        const fAttrs = f[2] || f[5] || '';
        failureMessage = [attr(fAttrs, 'message'), unescapeXml(f[3] || '')].filter(Boolean).join('\n');
      }
    }
    executions.push({ name, tier, status, attempts: 1, durationMs, failureMessage, runner: 'junit' });
  }
  return executions;
}

function readOutcomesJson(file) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(parsed.executions) ? parsed.executions : [];
}

function deploymentIdFor(env) {
  const p = path.join(ROOT, 'local.settings.json');
  if (!fs.existsSync(p)) return null;
  const s = JSON.parse(fs.readFileSync(p, 'utf8'));
  return env === 'prod' ? s.templateDeploymentId : s.testDeploymentId;
}

/**
 * The once-per-run boundary probe (see tests/harness/outcomes.js §"probe evidence"). Asks the
 * deployment the live tier targets for its own version — the unauthenticated `cmd=version` route
 * added for deploy verification. Returns {healthy: true|false|null, detail}. `null` = not probed.
 */
async function probeBoundary(env) {
  const id = deploymentIdFor(env);
  if (!id || String(id).startsWith('<')) {
    return { healthy: null, detail: `no ${env} deployment id in local.settings.json — not probed` };
  }
  const url = `https://script.google.com/macros/s/${id}/exec?cmd=version`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ac.signal });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (e) {
      json = null;
    }
    if (!res.ok) return { healthy: false, detail: `${env} /exec?cmd=version → HTTP ${res.status}` };
    if (!json || json.ok !== true || !json.version) {
      return { healthy: false, detail: `${env} /exec?cmd=version → non-contract response (${text.slice(0, 60).replace(/\s+/g, ' ')}…)` };
    }
    return { healthy: true, detail: `${env} v${json.version} (${json.target || 'target?'})` };
  } catch (e) {
    return { healthy: false, detail: `${env} /exec?cmd=version → ${e.name === 'AbortError' ? `no answer in ${PROBE_TIMEOUT_MS}ms` : e.message}` };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const executions = [];
  const sources = [];

  for (const f of args.junit) {
    const abs = path.resolve(ROOT, f);
    if (!fs.existsSync(abs)) {
      console.error(`[outcome-report] no JUnit at ${f} — skipped`);
      continue;
    }
    const found = parseJunit(fs.readFileSync(abs, 'utf8'), args.tier);
    executions.push(...found);
    sources.push(`${f} (${found.length})`);
  }
  for (const f of args.outcomes) {
    const abs = path.resolve(ROOT, f);
    if (!fs.existsSync(abs)) {
      console.error(`[outcome-report] no execution records at ${f} — skipped`);
      continue;
    }
    const found = readOutcomesJson(abs);
    executions.push(...found);
    sources.push(`${f} (${found.length})`);
  }

  if (!executions.length) {
    console.error('[outcome-report] no execution records found — nothing to classify');
    return;
  }

  // Probe evidence is gathered once per run, and only when a boundary-crossing execution actually
  // failed: a green run must never pay for a network round trip.
  const needsProbe =
    args.probe &&
    executions.some((e) => e.status === 'failed' && e.tier !== 'no_live_session' && e.tier !== 'node');
  const probe = needsProbe ? await probeBoundary(args.env) : { healthy: null, detail: 'not needed' };

  for (const e of executions) {
    const verdict = classifyExecution(e, { boundaryHealthy: probe.healthy });
    e.outcome = verdict.outcome;
    e.signal = verdict.signal;
  }

  const summary = summarize(executions);
  process.stdout.write(
    formatSummary(summary, {
      sources,
      boundaryHealthy: needsProbe ? probe.healthy : null,
      boundaryProbeDetail: probe.detail,
    })
  );

  const notable = executions.filter(
    (e) => e.outcome === OUTCOME.BOUNDARY_FAULT || e.outcome === OUTCOME.ASSERTION_FAILURE
  );
  for (const e of notable) {
    const label = e.outcome === OUTCOME.BOUNDARY_FAULT ? 'BOUNDARY FAULT' : 'assertion failure';
    console.log(
      `  ${label}${e.signal ? ` [${e.signal}]` : ''} · ${e.tier} · ${e.attempts} attempt(s) · ${e.name}`
    );
  }
  if (notable.length) console.log('');

  // H4/H5: over-ceiling is its own category, reported whether the execution passed or failed —
  // a slow pass is exactly what a silent budget would hide (docs/atdd/harness-design.md §9a).
  const overCeiling = executions.filter(isOverCeiling);
  for (const e of overCeiling) {
    console.log(`  OVER CEILING (H4) · ${e.tier} · ${(e.durationMs / 1000).toFixed(1)}s · ${e.name}`);
  }
  if (overCeiling.length) console.log('');
}

main().catch((e) => {
  // A reporter must never decide a run's fate. Report the failure and exit 0.
  console.error(`[outcome-report] reporting failed: ${e && e.stack ? e.stack : e}`);
});
