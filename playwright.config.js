const { defineConfig } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const {
  NO_LIVE_SESSION,
  LIVE,
  PURPOSE_EXCLUDED,
  classify,
} = require('./tests/playwright/tiers.js');
// Retry numbers live in exactly one place (I6) — tests/harness/outcomes.js RETRY_POLICY. Never
// type a retry count as a literal in a project below; retriesFor() also enforces "live tier only"
// and the bounded ceiling (F3Go30-emwk.6, H7).
// The H4 duration ceiling likewise lives in exactly one place (F3Go30-emwk.10, I6) —
// tests/harness/outcomes.js DURATION_CEILING_MS. no_live_session's `timeout` below reads it
// instead of the literal 30000 that used to sit here, which is what the operator check for this
// stage names as the exact defect it exists to catch ("a number repeated in two files"). `live`
// and `demo`'s 120000 are Playwright's own hang-safety-net (see the projects below), a different
// mechanism from H4's *reported budget* — left untouched.
const { retriesFor, ceilingMsFor } = require('./tests/harness/outcomes.js');

const authFile = path.resolve(__dirname, '.auth/user.json');

// Split per tier (F3Go30-emwk.3, realizes H1/H3/H7 reachability). Project membership is computed
// from tests/playwright/tiers.js — the single place both runners read the classification from
// (I6) — never hand-duplicated here. Anything not explicitly no_live_session is live by
// construction, so a spec dropped in tests/playwright/ with no entry in tiers.js lands in the
// live (heavy, attended) project, never silently in the fast one.
const specDir = path.resolve(__dirname, 'tests/playwright');
const allSpecs = fs
  .readdirSync(specDir)
  .filter((f) => f.endsWith('.spec.js'))
  .sort();

const noLiveSessionSpecs = allSpecs.filter((f) => classify(f) === NO_LIVE_SESSION);
const liveSpecs = allSpecs.filter((f) => classify(f) === LIVE);
// Purpose-excluded specs (demo-screenshots.spec.js) get their own project so pnpm run
// demo:screenshots keeps working — but this project is never named by test:local, test:live or
// test:regression (F3Go30-emwk.5), so it is a tier member of neither.
const purposeExcludedSpecs = Object.keys(PURPOSE_EXCLUDED).filter((f) => allSpecs.includes(f));

const haveAuth = fs.existsSync(authFile);
if (!haveAuth) {
  console.error(
    '\nNOTE: .auth/user.json not found — the live tier project will fail on first use. Run: node authenticate.js\n'
  );
}

module.exports = defineConfig({
  testDir: './tests/playwright',
  expect: { timeout: 15000 },
  // Playwright wipes `outputDir` at the start of every run — point it at a subfolder, never at
  // `test-results/` itself, or it deletes the node tier's JUnit output that also lives there
  // (F3Go30-emwk.4).
  outputDir: 'test-results/playwright-artifacts',
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'test-results/playwright-html' }],
    ['junit', { outputFile: 'test-results/playwright-junit.xml' }],
    // Records one execution record per test (status, tier, attempt count, wall time, failure
    // message) for the one owning classifier — it classifies nothing itself (F3Go30-emwk.6, I12).
    ['./tests/harness/playwright-outcome-reporter.js', { outputFile: 'test-results/outcomes-playwright.json' }],
  ],

  projects: [
    {
      // network-free tier: headless, no storageState, parallel — must run to completion
      // unattended with no .auth/user.json present (F3Go30-emwk.3 AC).
      name: NO_LIVE_SESSION,
      testMatch: noLiveSessionSpecs,
      fullyParallel: true,
      retries: retriesFor(NO_LIVE_SESSION),
      workers: undefined,
      timeout: ceilingMsFor(NO_LIVE_SESSION), // H4 ceiling (F3Go30-emwk.10) — single source, tests/harness/outcomes.js
      use: {
        headless: true,
        viewport: { width: 1280, height: 900 },
        video: 'retain-on-failure',
        screenshot: 'only-on-failure',
      },
    },
    {
      // live tier: real Google session, heavy/attended mode preserved exactly as before the split.
      name: LIVE,
      testMatch: liveSpecs,
      fullyParallel: false,
      retries: retriesFor(LIVE),
      workers: 1,
      timeout: 120000, // GAS editor is slow to initialise — Playwright's own hang safety-net,
      // deliberately NOT DURATION_CEILING_MS.live (60s, H4/F3Go30-emwk.10): H4 is a reported
      // *budget*, not a kill switch (see tests/harness/outcomes.js). An over-60s live test still
      // completes and is reported over-ceiling; it is only aborted past 120s of real hang.
      use: {
        storageState: authFile,
        headless: false, // GAS editor requires a real viewport; headless blocks some UI interactions
        viewport: { width: 1280, height: 900 },
        video: 'retain-on-failure',
        screenshot: 'only-on-failure',
      },
    },
    {
      // Purpose exclusion (demo-screenshots.spec.js) — not a tier member; kept selectable only by
      // its own pnpm run demo:screenshots script (which passes the file path + --headed).
      name: 'demo',
      testMatch: purposeExcludedSpecs,
      fullyParallel: false,
      retries: retriesFor('demo'),
      workers: 1,
      timeout: 120000,
      use: {
        storageState: authFile,
        headless: false,
        viewport: { width: 1280, height: 900 },
        video: 'retain-on-failure',
        screenshot: 'only-on-failure',
      },
    },
  ],
});
