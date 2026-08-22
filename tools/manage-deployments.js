#!/usr/bin/env node
/**
 * F3Go30 deployment config. The pipeline itself lives in the shared `gas-deploy` package (see its
 * README, and best-practices/gas-deployment/RECOMMENDATION.md); this file is only what is
 * specific to this project.
 *
 *   pnpm run deploy:sit | deploy:prod
 *   node tools/manage-deployments.js --summary --env sit    # read-only, deploys nothing
 *
 * Public envs are sit/prod; internal target keys are test/template (the two script projects) —
 * envAliases maps between them. The retired `month` target (ADR-010, F3Go30-shsx) is absent by
 * design — see docs/deployment-model.md.
 */

'use strict';
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { runCli, constStamper } = require('gas-deploy');
const { staticEntryUrl } = require('./static-urls.js');
const ROOT = path.join(__dirname, '..');
const VERSION_PATH = path.join(ROOT, 'script', 'version.js');
const call = (args) => execSync(`node tools/callWebapp.js ${args}`, { stdio: 'inherit', cwd: ROOT });

const config = {
  root: ROOT,
  stamper: constStamper({ file: 'script/version.js' }),
  describeDeployment: (version) => `v${version} GO30-APP`,
  envAliases: { sit: 'test', prod: 'template' },
  targets: {
    template: { scriptIdKey: 'templateScriptId', label: 'TEMPLATE', emoji: '📋', counter: 'version', deploymentIdKey: 'templateDeploymentId', sheetIdKey: 'templateSpreadsheetId', staticEnv: 'prod' },
    test:     { scriptIdKey: 'testScriptId',     label: 'TEST',     emoji: '🧪', counter: 'build',   deploymentIdKey: 'testDeploymentId',     sheetIdKey: 'testSpreadsheetId',     staticEnv: 'sit'  },
  },
  // --summary only, display-only: flags live-vs-local divergence. Never read back on deploy.
  readLocalVersion: () => {
    const src = fs.readFileSync(VERSION_PATH, 'utf8');
    const g = (n) => (src.match(new RegExp(`const ${n}\\s*=\\s*'([^']+)'`)) || [])[1];
    return { version: g('APP_VERSION'), now: g('APP_VERSION_DATE') };
  },
  extraRows: ({ target }) => [
    { label: 'Static page', value: target.staticEnv && staticEntryUrl(target.staticEnv), missing: '(static hosting not configured for this target)' },
  ],
  // Regenerates the "How it Works" panels from docs/Go30-Intro.md (F3Go30-e3co) — must be IN
  // the push, hence prePush.
  prePush: [
    { name: 'Sync How it Works panels', run: () => execSync('node tools/sync-how-it-works.js', { stdio: 'inherit', cwd: ROOT }) },
  ],
  postDeploy: [
    // Wipes PaxCache + the layout/full-roster blobs so code just pushed that changed cache shape
    // can't trip over a stale entry (F3Go30-x2vd). AFTER the deploy — wiping first just lets the
    // still-live old code repopulate it.
    { name: 'Invalidate PaxCache/layout caches', run: ({ target }) => call(`invalidateAllCache --env ${target.staticEnv}`),
      retryCommand: 'node tools/callWebapp.js invalidateAllCache --env <env>' },

    // Bounds trigger growth to the prev/current/next-month window (2026-08-20 SIT quota incident:
    // nothing swept except on demand, so triggers crept toward the per-script quota).
    { name: 'Sync tracker onEdit/form-submit triggers', run: ({ target }) => call(`syncTrackerTriggers --env ${target.staticEnv}`),
      retryCommand: 'node tools/callWebapp.js syncTrackerTriggers --env <env>' },

    { name: 'Stamp WEBAPP_URL (PROD only)', retryCommand: 'node tools/callWebapp.js setWebappUrl --env prod',
      run: ({ targetKey }) => { if (targetKey === 'template') call('setWebappUrl --env prod'); } },

    // The static front end shares this package.json counter, so it ships in the same deploy and
    // the two can never drift. --skip-bump: the pipeline already bumped.
    { name: 'Publish static pages', required: true,
      run: ({ target }) => execSync(`node ${path.join(__dirname, 'publish-static-pages.js')} --env ${target.staticEnv} --skip-bump`,
        { stdio: 'inherit', cwd: ROOT }) },
  ],
};

if (require.main === module) {
  runCli(config).catch(err => {
    if (err && (err.name === 'ExitPromptError' || (err.message || '').includes('force closed'))) return console.log('\n❌ Cancelled.');
    console.error('❌ Error:', err.message);
    process.exit(1);
  });
}

module.exports = { config };
