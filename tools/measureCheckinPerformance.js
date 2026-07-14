#!/usr/bin/env node
/**
 * measureCheckinPerformance.js — repeatable check-in->dashboard performance harness
 *
 * Measures the returning-user token flow (page load -> auto-identify -> check-in -> dashboard)
 * with per-request TTFB and total timings for GAS + googleusercontent hosts.
 * Prints a measurement window for Axiom correlation via tools/query_axiom.py.
 *
 * Usage:
 *   node tools/measureCheckinPerformance.js <F3Name> [--env sit|prod] [--rounds N]
 *
 * Examples:
 *   node tools/measureCheckinPerformance.js TestPax
 *   node tools/measureCheckinPerformance.js TestPax --env prod --rounds 3
 *
 * Output: timing table + Axiom window for correlation with tools/query_axiom.py
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { chromium } = require('playwright');
const { post: httpPost, loadSettings, ENV_MAP } = require('./callWebapp.js');

const ROOT = path.join(__dirname, '..');
const SETTINGS_PATH = path.join(ROOT, 'local.settings.json');

function parseArgs_(argv) {
  const args = argv.slice(2);
  const f3Name = args.find(a => !a.startsWith('--'));
  if (!f3Name) {
    console.error('Usage: measureCheckinPerformance.js <F3Name> [--env sit|prod] [--rounds N]');
    process.exit(1);
  }

  const envIdx = args.indexOf('--env');
  const env = envIdx !== -1 ? args[envIdx + 1] : 'sit';
  if (!ENV_MAP[env]) {
    console.error(`❌  Unknown env "${env}". Use sit or prod.`);
    process.exit(1);
  }

  const roundsIdx = args.indexOf('--rounds');
  const rounds = roundsIdx !== -1 ? parseInt(args[roundsIdx + 1], 10) : 1;
  if (isNaN(rounds) || rounds < 1) {
    console.error('❌  --rounds must be a positive number');
    process.exit(1);
  }

  return { f3Name, env, rounds };
}

async function mintToken(f3Name, email, env) {
  const { deploymentIdKey } = ENV_MAP[env];
  const settings = loadSettings();
  const deploymentId = settings[deploymentIdKey];

  if (!deploymentId || deploymentId.startsWith('<')) {
    throw new Error(`${deploymentIdKey} not set in local.settings.json`);
  }

  const url = `https://script.google.com/macros/s/${deploymentId}/exec?cmd=checkin`;
  const result = await httpPost(url, {
    action: 'identify',
    f3Name,
    email,
    targetMonth: 'current',
  });

  if (!result || !result.token) {
    throw new Error(`Failed to mint token: ${JSON.stringify(result)}`);
  }

  return result.token;
}

async function getCheckinUrl(token, env) {
  const { deploymentIdKey } = ENV_MAP[env];
  const settings = loadSettings();
  const deploymentId = settings[deploymentIdKey];

  if (!deploymentId || deploymentId.startsWith('<')) {
    throw new Error(`${deploymentIdKey} not set in local.settings.json`);
  }

  return `https://script.google.com/macros/s/${deploymentId}/exec?cmd=checkin&id=${token}`;
}

// Intercept requests and capture timing metrics
function capturePerformance_(page) {
  const requests = {};

  page.on('response', response => {
    const url = response.url();
    const timing = response.timing();

    // Extract host for grouping
    const host = new URL(url).hostname;
    const isRelevant = host.includes('script.google.com') || host.includes('googleusercontent.com');

    if (isRelevant) {
      if (!requests[host]) {
        requests[host] = [];
      }

      // Calculate TTFB and total
      const ttfb = timing ? (timing.responseStart - timing.requestStart) : 0;
      const total = timing ? (timing.responseEnd - timing.requestStart) : 0;

      requests[host].push({
        url: new URL(url).pathname + new URL(url).search,
        status: response.status(),
        ttfb: Math.round(ttfb),
        total: Math.round(total),
      });
    }
  });

  return requests;
}

async function runRound(f3Name, email, env, roundNum) {
  console.error(`\n→ Round ${roundNum}...`);

  const token = await mintToken(f3Name, email, env);
  const checkinUrl = await getCheckinUrl(token, env);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const startTime = new Date();
  // Capture metrics
  const requestMetrics = capturePerformance_(page);

  try {
    // Navigate to check-in page
    await page.goto(checkinUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for dashboard to load (or check-in form if not auto-identified)
    await page.waitForSelector('[data-testid="dashboard"], [data-testid="checkin-form"]', {
      timeout: 20000,
    }).catch(() => null);

    // If on check-in form, auto-identify and proceed to dashboard
    const checkinForm = page.locator('[data-testid="checkin-form"]');
    const isDashboard = page.locator('[data-testid="dashboard"]');

    if (await checkinForm.isVisible().catch(() => false)) {
      // Fill and submit form
      const dayInput = page.locator('input[name="day"]');
      const whyInput = page.locator('textarea[name="why"]');
      const submitBtn = page.locator('button[type="submit"]:not([disabled])').first();

      if (await dayInput.isVisible()) {
        await dayInput.fill('5');
      }
      if (await whyInput.isVisible()) {
        await whyInput.fill('Performance test');
      }
      if (await submitBtn.isVisible()) {
        await submitBtn.click();
      }

      // Wait for dashboard
      await isDashboard.waitFor({ timeout: 10000 }).catch(() => null);
    }
  } catch (err) {
    console.error(`⚠️  Navigation error: ${err.message}`);
  }

  await browser.close();
  const endTime = new Date();

  return {
    duration: endTime - startTime,
    window: [startTime.toISOString(), endTime.toISOString()],
    requests: requestMetrics,
  };
}

function formatRequestTable(requests) {
  const lines = [];
  for (const [host, reqs] of Object.entries(requests)) {
    lines.push(`\n  ${host}:`);
    for (const req of reqs) {
      lines.push(
        `    ${req.status} ${req.url.substring(0, 60).padEnd(60)}  ` +
        `TTFB: ${String(req.ttfb).padStart(4)}ms  Total: ${String(req.total).padStart(4)}ms`
      );
    }
  }
  return lines.join('\n');
}

async function main() {
  const { f3Name, env, rounds } = parseArgs_(process.argv);

  // Use deterministic test email
  const email = `perf-test-${Date.now()}@f3.local`;

  console.error(`\nF3 Name: ${f3Name}`);
  console.error(`Environment: ${env.toUpperCase()}`);
  console.error(`Rounds: ${rounds}`);
  console.error(`\nStarting performance measurement...`);

  const results = [];
  for (let i = 1; i <= rounds; i++) {
    try {
      const result = await runRound(f3Name, email, env, i);
      results.push(result);
    } catch (err) {
      console.error(`❌  Round ${i} failed: ${err.message}`);
      process.exit(1);
    }
  }

  // Print results
  console.log('\n=== Check-in Performance Results ===\n');

  results.forEach((result, idx) => {
    console.log(`Round ${idx + 1}: ${result.duration}ms`);
    console.log(formatRequestTable(result.requests));
  });

  // Print Axiom correlation window
  if (results.length > 0) {
    const first = new Date(results[0].window[0]);
    const last = new Date(results[results.length - 1].window[1]);

    console.log('\n=== Axiom Correlation Window ===\n');
    console.log('Run this to correlate with GAS logs:');
    console.log(
      `python tools/query_axiom.py --since 30m --where ` +
      `"_time >= '${first.toISOString()}' and _time <= '${last.toISOString()}'"`
    );
    console.log();
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('❌', err.message);
    process.exit(1);
  });
}

module.exports = { parseArgs_, mintToken, getCheckinUrl, runRound };
