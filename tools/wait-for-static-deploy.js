#!/usr/bin/env node
/**
 * Polls the live GitHub Pages static check-in page until it's actually serving a specific build
 * — GitHub Pages/its CDN has a propagation delay after `npm run deploy:sit`/`deploy:prod`
 * publishes (tools/publish-static-pages.js), so a script (or a human) checking the page
 * immediately after a deploy can hit a stale cached edge and wrongly conclude a fix didn't ship
 * (F3Go30-g9bi, 2026-08-11: this was previously improvised as an inline poll loop every time a
 * live check needed to confirm a fresh deploy had actually landed).
 *
 * Fetches the built page's STATIC_BUILD_VERSION_ stamp directly (the same placeholder
 * tools/build-static-pages.js replaces) via a plain HTTPS GET + regex — no browser needed, so
 * this is fast standalone or as a precursor to a manual/Playwright screenshot check against the
 * real deployed URL. NOT needed by tests/playwright/*.spec.js's live-SIT specs themselves —
 * those serve static-pages/src/ (unbuilt) from a local throwaway HTTP server directly against
 * the live GAS backend, sidestepping GitHub Pages/its CDN entirely (see static-checkin.spec.js's
 * and announcement-splash-live-check.spec.js's own docstrings) — this tool is only for verifying
 * the actual publicly-served artifact.
 *
 * Usage:
 *   node tools/wait-for-static-deploy.js [--env sit|prod] [--version X.Y.Z[.B]] [--interval 5] [--timeout 180]
 *
 * Defaults: --env sit, --version read from script/version.js's current APP_VERSION (i.e. "the
 * build manage-deployments.js just stamped"), --interval 5 (seconds), --timeout 180 (seconds).
 * Exits 0 once the live page reports the expected version, non-zero on timeout or a bad --env.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const VERSION_PATH = path.join(ROOT, 'script', 'version.js');
const STATIC_BASE_URL = 'https://f3go30.github.io/static-pages/dist/';

/** Reads the currently-stamped APP_VERSION straight out of script/version.js (same source
 * manage-deployments.js's stampVersion() writes) — this is "the version to wait for" by default,
 * since the whole point is confirming the deploy that JUST ran has propagated. */
function readCurrentVersion_(versionPath) {
  const src = fs.readFileSync(versionPath || VERSION_PATH, 'utf8');
  const match = src.match(/const APP_VERSION\s*=\s*'([^']+)'/);
  if (!match) throw new Error('APP_VERSION not found in ' + (versionPath || VERSION_PATH));
  return match[1];
}

/** Extracts the STATIC_BUILD_VERSION_ stamp from a built static page's raw HTML. Returns null
 * for unbuilt source (the placeholder is never replaced) or a response that doesn't look like
 * this page at all (e.g. a 404 page, or GitHub Pages' own "not found" HTML). */
function extractDeployedVersion_(html) {
  const match = /var STATIC_BUILD_VERSION_ = "([^"]*)"/.exec(html || '');
  if (!match || !match[1]) return null;
  return match[1];
}

function fetchText_(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } }, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

function parseArgs_(argv) {
  const args = { env: 'sit', version: null, intervalSec: 5, timeoutSec: 180 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--env') args.env = argv[++i];
    else if (argv[i] === '--version') args.version = argv[++i];
    else if (argv[i] === '--interval') args.intervalSec = Number(argv[++i]);
    else if (argv[i] === '--timeout') args.timeoutSec = Number(argv[++i]);
  }
  if (args.env !== 'sit' && args.env !== 'prod') {
    throw new Error(`--env must be 'sit' or 'prod', got '${args.env}'`);
  }
  if (!Number.isFinite(args.intervalSec) || args.intervalSec <= 0) {
    throw new Error(`--interval must be a positive number of seconds, got '${args.intervalSec}'`);
  }
  if (!Number.isFinite(args.timeoutSec) || args.timeoutSec <= 0) {
    throw new Error(`--timeout must be a positive number of seconds, got '${args.timeoutSec}'`);
  }
  return args;
}

function sleep_(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

/** Core poll loop, dependency-injected (fetchText/sleep) so it's unit-testable without a real
 * network call or a real wall-clock wait — see test/test_wait_for_static_deploy.js. */
async function waitForStaticDeploy_(opts) {
  const { env, version, intervalSec, timeoutSec, fetchText, sleep, log } = opts;
  const doLog = log || (() => {});
  const doSleep = sleep || sleep_;
  const url = `${STATIC_BASE_URL}${env}/index.html?cachebust=${Date.now()}`;
  const startedAt = Date.now();
  let attempt = 0;
  for (;;) {
    attempt++;
    let deployedVersion = null;
    try {
      const html = await fetchText(url);
      deployedVersion = extractDeployedVersion_(html);
    } catch (err) {
      doLog(`  attempt ${attempt}: fetch failed (${err.message})`);
    }
    if (deployedVersion === version) {
      doLog(`✅ ${env} is serving v${version} (attempt ${attempt})`);
      return { ok: true, attempts: attempt, version: deployedVersion };
    }
    doLog(`  attempt ${attempt}: ${env} is serving ${deployedVersion || '(unknown)'}, waiting for v${version}...`);
    if (Date.now() - startedAt + intervalSec * 1000 > timeoutSec * 1000) {
      throw new Error(`Timed out after ${attempt} attempts (${timeoutSec}s) waiting for ${env} to serve v${version} — last seen: ${deployedVersion || '(none)'}`);
    }
    await doSleep(intervalSec * 1000);
  }
}

async function main() {
  const args = parseArgs_(process.argv.slice(2));
  const version = args.version || readCurrentVersion_();
  console.log(`Waiting for https://f3go30.github.io/static-pages/dist/${args.env}/ to serve v${version} (poll every ${args.intervalSec}s, timeout ${args.timeoutSec}s)...`);
  try {
    await waitForStaticDeploy_({
      env: args.env, version, intervalSec: args.intervalSec, timeoutSec: args.timeoutSec,
      fetchText: fetchText_, log: console.log,
    });
    process.exit(0);
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { readCurrentVersion_, extractDeployedVersion_, parseArgs_, waitForStaticDeploy_ };
