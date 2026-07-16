#!/usr/bin/env node
/**
 * F3Go30 user-facing timing comparison — GAS webapp surface vs. static-pages surface (SIT).
 *
 * Drives a real browser (Playwright/Chromium) through repeated sign-in -> check-in -> dashboard
 * sessions against the live SIT deployment, alternating which front end is used (the GAS
 * HtmlService webapp vs. static-pages/src/index.html served cross-origin) and which of 3 fixture
 * PAX accounts is used, to see:
 *   - how consistent step timings are run-to-run
 *   - whether one PAX's check-in measurably affects the very next dashboard load for a
 *     *different* PAX hitting the same SIT backend (dashboardWebapp.js/PaxCache.js keep a
 *     server-side CacheService roster cache shared across ALL sessions regardless of which
 *     front end reached it — see FULL_ROSTER_CACHE_TTL_SECONDS_ in dashboardWebapp.js)
 *   - the typical GAS-vs-static difference for the same operations against the same backend
 *
 * One "iteration" = one full session pair:
 *   1. Primary account signs in fresh (typed identify)          -> signInMs
 *   2. Primary checks in today (alternating hit/miss)             -> checkin1Ms
 *      (awaits the actual "checkin" API response before proceeding — see CLAUDE.md note below)
 *   3. Primary opens the dashboard                                -> dashboard1Ms
 *   4. Secondary account "logs in" via a freshly minted identity token (?id=), simulating a
 *      different PAX opening their own saved bookmark right after the primary's write -> tokenLoginMs
 *   5. Secondary checks in today (alternating hit/miss)           -> checkin2Ms
 *   6. Secondary opens the dashboard                              -> dashboard2Ms
 *
 * Each account in a pair runs in its own fresh, isolated browser context (no shared cookies/
 * localStorage) — a faithful stand-in for two different PAX on two different devices.
 *
 * The primary/secondary check-in write always happens immediately before that same account's own
 * dashboard load — submitCheckin_ (CheckinApp.html/static-pages) invalidates the client's own
 * per-month cache on a successful save, so the dashboard load after it is a real fetch, not a
 * cache hit. Waiting for the checkin POST's response (not just the click) before moving on is
 * what "wait until the check-in has registered" means here.
 *
 * Usage:
 *   node tools/perfTiming.js [iterations] [--local-static]
 *     --local-static  serve static-pages/src/index.html from a local http.createServer()
 *                     instead of the real published SIT GitHub Pages URL. Useful for quick
 *                     iteration without a `npm run deploy:sit` publish step, but understates
 *                     real-world latency (no network hop/CDN/TLS/DNS) — the default (real
 *                     published URL) is what should be used for recorded comparison runs.
 *
 * Output:
 *   tools/perf-results/perf-timing-<timestamp>.csv     — one row per iteration
 *   tools/perf-results/perf-timing-<timestamp>.summary.md — computed stats + notes
 */

'use strict';

const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const STATIC_DIR = path.join(ROOT, 'static-pages', 'src');
const RESULTS_DIR = path.join(ROOT, 'tools', 'perf-results');

// Real published SIT static surface (GitHub Pages) — see script/version.js's
// STATIC_PAGES_BASE_URL_ and tools/publish-static-pages.js for how it gets there.
const SIT_STATIC_PAGES_URL = 'https://f3go30.github.io/static-pages/dist/sit';

const ACCOUNTS = [
  { f3Name: 'NoSadClown', email: 'nosadclown@example.com' },
  { f3Name: 'TokenFlowTest', email: 'tokenflowtest@example.com' },
  { f3Name: 'PerfTestGamma', email: 'perftestgamma@example.com' },
];

const NAV_TIMEOUT = 45000;

function loadSettings() {
  const p = path.join(ROOT, 'local.settings.json');
  if (!fs.existsSync(p)) throw new Error('local.settings.json not found');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** Static file server — origin is http://127.0.0.1:<port>, a genuinely different origin from
 *  script.google.com, same as tests/playwright/static-checkin.spec.js. */
function startStaticServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = req.url.split('?')[0];
      const file = path.join(STATIC_DIR, urlPath === '/' ? '/index.html' : urlPath);
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function dismissGasBanner(page) {
  const dismissBtn = page.getByRole('button', { name: 'Dismiss' });
  if (await dismissBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await dismissBtn.click();
  }
}

function gasFrame(page) {
  return page.frameLocator('iframe').frameLocator('iframe');
}

/** Mints a fresh identity-token session via the same public identify call the real client makes
 *  (see static-checkin.spec.js's beforeAll) — used to simulate "opening a saved bookmark link". */
async function mintToken(gasExecUrl, account) {
  const guid = crypto.randomUUID();
  const res = await fetch(gasExecUrl + '?cmd=checkin', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'identify', f3Name: account.f3Name, email: account.email, guid }),
  });
  const json = await res.json();
  if (!json.matched) {
    throw new Error(`mintToken: ${account.f3Name} did not match — is it signed up for the current SIT month?`);
  }
  return json.identityToken;
}

function checkinResponsePredicate(res) {
  if (!res.url().includes('cmd=checkin') || res.request().method() !== 'POST') return false;
  const body = res.request().postData() || '';
  return body.includes('"action":"checkin"');
}

// ── GAS surface (nested HtmlService iframe sandbox) ─────────────────────────────────────────

async function gasSignIn(page, gasCheckinUrl, account) {
  const t0 = Date.now();
  await page.goto(gasCheckinUrl, { waitUntil: 'load', timeout: NAV_TIMEOUT });
  await dismissGasBanner(page);
  let app = gasFrame(page);
  await app.locator('#idF3Name').fill(account.f3Name);
  await app.locator('#idEmail').fill(account.email);
  // 'load' rather than 'networkidle' — the check-in step's own background dashboard prefetch
  // (prefetchDashboard_) keeps the network busy right after this navigation lands, so
  // 'networkidle' can time out even though the page itself is already usable.
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'load', timeout: NAV_TIMEOUT }),
    app.locator('#identifyBtn').click(),
  ]);
  app = gasFrame(page);
  await app.locator('#step-checkin').waitFor({ state: 'visible', timeout: NAV_TIMEOUT });
  return Date.now() - t0;
}

async function gasTokenLogin(page, gasCheckinUrl, token) {
  const t0 = Date.now();
  await page.goto(`${gasCheckinUrl}&id=${token}`, { waitUntil: 'load', timeout: NAV_TIMEOUT });
  await dismissGasBanner(page);
  const app = gasFrame(page);
  await app.locator('#step-checkin').waitFor({ state: 'visible', timeout: NAV_TIMEOUT });
  return Date.now() - t0;
}

async function gasCheckin(page, value) {
  const app = gasFrame(page);
  const btnId = value === 1 ? '#todayYesBtn' : '#todayNoBtn';
  const t0 = Date.now();
  const [res] = await Promise.all([
    page.waitForResponse(checkinResponsePredicate, { timeout: NAV_TIMEOUT }),
    app.locator(btnId).click(),
  ]);
  await res.finished();
  return Date.now() - t0;
}

async function gasDashboard(page) {
  const app = gasFrame(page);
  const t0 = Date.now();
  await app.locator('#dashboardBtn').click();
  await app.locator('#step-dashboard').waitFor({ state: 'visible', timeout: NAV_TIMEOUT });
  return Date.now() - t0;
}

// ── Static surface (static-pages/src/index.html, cross-origin) ─────────────────────────────

function staticPageUrl(staticOrigin, gasExecUrl, token) {
  const base = `${staticOrigin}/index.html?webapp=${encodeURIComponent(gasExecUrl)}`;
  return token ? `${base}&id=${token}` : base;
}

async function staticSignIn(page, staticOrigin, gasExecUrl, account) {
  const t0 = Date.now();
  await page.goto(staticPageUrl(staticOrigin, gasExecUrl), { waitUntil: 'load', timeout: NAV_TIMEOUT });
  await page.locator('#step-identify').waitFor({ state: 'visible', timeout: NAV_TIMEOUT });
  await page.locator('#idF3Name').fill(account.f3Name);
  await page.locator('#idEmail').fill(account.email);
  await page.locator('#identifyBtn').click();
  await page.locator('#step-checkin').waitFor({ state: 'visible', timeout: NAV_TIMEOUT });
  return Date.now() - t0;
}

async function staticTokenLogin(page, staticOrigin, gasExecUrl, token) {
  const t0 = Date.now();
  await page.goto(staticPageUrl(staticOrigin, gasExecUrl, token), { waitUntil: 'load', timeout: NAV_TIMEOUT });
  await page.locator('#step-checkin').waitFor({ state: 'visible', timeout: NAV_TIMEOUT });
  return Date.now() - t0;
}

async function staticCheckin(page, value) {
  const btnId = value === 1 ? '#todayYesBtn' : '#todayNoBtn';
  const t0 = Date.now();
  const [res] = await Promise.all([
    page.waitForResponse(checkinResponsePredicate, { timeout: NAV_TIMEOUT }),
    page.locator(btnId).click(),
  ]);
  await res.finished();
  return Date.now() - t0;
}

async function staticDashboard(page) {
  const t0 = Date.now();
  await page.locator('#dashboardBtn').click();
  await page.locator('#step-dashboard').waitFor({ state: 'visible', timeout: NAV_TIMEOUT });
  return Date.now() - t0;
}

// ── Stats / output ───────────────────────────────────────────────────────────────────────────

const STEP_COLUMNS = ['signInMs', 'checkin1Ms', 'dashboard1Ms', 'tokenLoginMs', 'checkin2Ms', 'dashboard2Ms', 'totalMs'];
const CSV_COLUMNS = ['iteration', 'surface', 'primary', 'secondary', 'primaryValue', 'secondaryValue',
  ...STEP_COLUMNS, 'error', 'timestamp'];

function toCsv(rows) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map((c) => {
      const v = row[c] === undefined ? '' : row[c];
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','));
  }
  return lines.join('\n') + '\n';
}

function stats(nums) {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / sorted.length;
  const variance = sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / sorted.length;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return {
    n: sorted.length,
    mean: Math.round(mean),
    median: Math.round(median),
    stdev: Math.round(Math.sqrt(variance)),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p95: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)],
  };
}

function buildSummary(rows) {
  const ok = rows.filter((r) => !r.error);
  const bySurface = { gas: ok.filter((r) => r.surface === 'gas'), static: ok.filter((r) => r.surface === 'static') };
  let md = `# Perf timing summary\n\n`;
  md += `Total iterations: ${rows.length} (${ok.length} succeeded, ${rows.length - ok.length} errored)\n\n`;

  for (const col of STEP_COLUMNS) {
    md += `## ${col}\n\n`;
    md += `| surface | n | mean | median | stdev | min | max | p95 |\n`;
    md += `|---|---|---|---|---|---|---|---|\n`;
    for (const surface of ['gas', 'static']) {
      const s = stats(bySurface[surface].map((r) => r[col]).filter((v) => typeof v === 'number'));
      if (!s) { md += `| ${surface} | 0 | - | - | - | - | - | - |\n`; continue; }
      md += `| ${surface} | ${s.n} | ${s.mean} | ${s.median} | ${s.stdev} | ${s.min} | ${s.max} | ${s.p95} |\n`;
    }
    md += '\n';
  }

  if (rows.length - ok.length > 0) {
    md += `## Errors\n\n`;
    for (const r of rows.filter((r) => r.error)) {
      md += `- iteration ${r.iteration} (${r.surface}, ${r.primary}->${r.secondary}): ${r.error}\n`;
    }
    md += '\n';
  }
  return md;
}

function printSummary(rows) {
  console.log('\n' + buildSummary(rows));
}

// ── Main loop ─────────────────────────────────────────────────────────────────────────────────

async function run() {
  const args = process.argv.slice(2);
  const useLocalStatic = args.includes('--local-static');
  const iterations = Number(args.find((a) => !a.startsWith('--'))) || 20;
  const settings = loadSettings();
  const deploymentId = settings.testDeploymentId;
  if (!deploymentId || String(deploymentId).startsWith('<')) {
    throw new Error('testDeploymentId not set in local.settings.json — run npm run deploy:sit first');
  }
  const gasExecUrl = `https://script.google.com/macros/s/${deploymentId}/exec`;
  const gasCheckinUrl = `${gasExecUrl}?cmd=checkin`;

  let server = null;
  let staticOrigin;
  if (useLocalStatic) {
    server = await startStaticServer();
    staticOrigin = `http://127.0.0.1:${server.address().port}`;
    console.log(`Static surface served from local server ${staticOrigin} (SIT backend ${gasExecUrl})`);
  } else {
    staticOrigin = SIT_STATIC_PAGES_URL;
    console.log(`Static surface served from real published SIT deployment ${staticOrigin} (SIT backend ${gasExecUrl})`);
  }

  const browser = await chromium.launch({ headless: true });
  const rows = [];
  let checkinCount = 0;
  const nextValue = () => (checkinCount++ % 2 === 0 ? 1 : 0);

  for (let i = 0; i < iterations; i++) {
    const surface = i % 2 === 0 ? 'gas' : 'static';
    const primary = ACCOUNTS[i % 3];
    const secondary = ACCOUNTS[(i + 1) % 3];
    const primaryValue = nextValue();
    const secondaryValue = nextValue();

    const row = {
      iteration: i + 1,
      surface,
      primary: primary.f3Name,
      secondary: secondary.f3Name,
      primaryValue: primaryValue === 1 ? 'hit' : 'miss',
      secondaryValue: secondaryValue === 1 ? 'hit' : 'miss',
      timestamp: new Date().toISOString(),
      error: '',
    };

    let ctx1, ctx2;
    const runStart = Date.now();
    try {
      ctx1 = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page1 = await ctx1.newPage();
      if (surface === 'gas') {
        row.signInMs = await gasSignIn(page1, gasCheckinUrl, primary);
        row.checkin1Ms = await gasCheckin(page1, primaryValue);
        row.dashboard1Ms = await gasDashboard(page1);
      } else {
        row.signInMs = await staticSignIn(page1, staticOrigin, gasExecUrl, primary);
        row.checkin1Ms = await staticCheckin(page1, primaryValue);
        row.dashboard1Ms = await staticDashboard(page1);
      }
      await ctx1.close();
      ctx1 = null;

      const token = await mintToken(gasExecUrl, secondary);
      ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page2 = await ctx2.newPage();
      if (surface === 'gas') {
        row.tokenLoginMs = await gasTokenLogin(page2, gasCheckinUrl, token);
        row.checkin2Ms = await gasCheckin(page2, secondaryValue);
        row.dashboard2Ms = await gasDashboard(page2);
      } else {
        row.tokenLoginMs = await staticTokenLogin(page2, staticOrigin, gasExecUrl, token);
        row.checkin2Ms = await staticCheckin(page2, secondaryValue);
        row.dashboard2Ms = await staticDashboard(page2);
      }
      await ctx2.close();
      ctx2 = null;

      row.totalMs = Date.now() - runStart;
    } catch (err) {
      row.error = String((err && err.message) || err);
      row.totalMs = Date.now() - runStart;
    } finally {
      if (ctx1) await ctx1.close().catch(() => {});
      if (ctx2) await ctx2.close().catch(() => {});
    }

    rows.push(row);
    const line = row.error
      ? `ERROR: ${row.error}`
      : `signIn ${row.signInMs}ms  checkin1 ${row.checkin1Ms}ms  dash1 ${row.dashboard1Ms}ms  ` +
        `token ${row.tokenLoginMs}ms  checkin2 ${row.checkin2Ms}ms  dash2 ${row.dashboard2Ms}ms  total ${row.totalMs}ms`;
    console.log(`[${row.iteration}/${iterations}] ${surface.padEnd(6)} ${primary.f3Name}->${secondary.f3Name}  ${line}`);
  }

  await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const csvPath = path.join(RESULTS_DIR, `perf-timing-${stamp}.csv`);
  const summaryPath = path.join(RESULTS_DIR, `perf-timing-${stamp}.summary.md`);
  fs.writeFileSync(csvPath, toCsv(rows));
  fs.writeFileSync(summaryPath, buildSummary(rows));
  console.log(`\nWrote ${csvPath}\nWrote ${summaryPath}`);
  printSummary(rows);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
