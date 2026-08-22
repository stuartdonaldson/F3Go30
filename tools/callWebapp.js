#!/usr/bin/env node
/**
 * F3Go30 web app caller — a thin wrapper over gas-deploy's lib/webapp.js.
 *
 * URL resolution, secret injection, the POST→GET redirect and the non-JSON-response diagnostic
 * all live in the package (RECOMMENDATION.md §3.3). What stays here is this project's own
 * vocabulary: which envs exist, which settings keys hold their secrets, and which cmd endpoints
 * are secret-gated.
 *
 * Usage:
 *   node tools/callWebapp.js <action> [--cmd admin|signup|checkin|version] [--env sit|prod]
 *                                     [--body '{"key":"val"}'] [--ns <namespace>]
 *
 * --cmd defaults to "admin". --ns is shorthand for the request-follows-ns pattern (ADR-014
 * D1/D3): merged into the payload as `ns`, exactly as `--body '{"ns":"…"}'` would be. --body
 * still wins if both set it.
 *
 * Examples:
 *   node tools/callWebapp.js runScanTrackers --env prod
 *   node tools/callWebapp.js getSheet --body '{"sheetName":"Tracker"}'
 *   node tools/callWebapp.js identify --cmd signup --body '{"f3Name":"Test","email":"t@t.com"}'
 *   node tools/callWebapp.js version --cmd version --env sit     # no secret sent
 */

'use strict';

const path = require('path');
const { webapp } = require('gas-deploy');
const callWebappCli = require('gas-deploy/bin/call-webapp.js');

const ROOT = path.join(__dirname, '..');

/**
 * `secretKey` is what the package reads; `adminSecretKey` is the same value under this project's
 * original name, kept because copyTemplate.js, smokeTestNamespace.js and three
 * tests/playwright/*-live-check.spec.js suites destructure it to build their own payloads.
 */
const ENV_MAP = {
  sit:  { deploymentIdKey: 'testDeploymentId',     secretKey: 'testAdminSecret',     adminSecretKey: 'testAdminSecret',     scriptIdKey: 'testScriptId'     },
  prod: { deploymentIdKey: 'templateDeploymentId', secretKey: 'templateAdminSecret', adminSecretKey: 'templateAdminSecret', scriptIdKey: 'templateScriptId' },
};

const config = {
  root: ROOT,
  envMap: ENV_MAP,
  authField: 'adminSecret',
  // Only cmd=admin gates on the secret. cmd=signup/checkin are public user-facing endpoints and
  // cmd=version is deliberately ungated (§3.2) — none of them should ever receive the secret.
  securedCmds: ['admin'],
};

if (require.main === module) {
  callWebappCli.run(config).catch(err => {
    console.error('❌', err.message);
    process.exit(1);
  });
}

/**
 * Back-compat surface for this project's other tools and live-check specs
 * (copyTemplate.js, measureCheckinPerformance.js, smokeTestNamespace.js, and the
 * tests/playwright/*-live-check.spec.js suites) which build and post their own payloads.
 * Thin delegations to the package — no transport or auth logic of its own.
 */
function loadSettings() {
  return JSON.parse(require('fs').readFileSync(path.join(ROOT, 'local.settings.json'), 'utf8'));
}

function buildPayload_(action, cmd, extraBody, adminSecret) {
  return webapp.buildPayload({
    action,
    extraBody,
    secret: config.securedCmds.includes(cmd) ? adminSecret : undefined,
    authField: config.authField,
  });
}

module.exports = { post: webapp.post, buildPayload_, loadSettings, ENV_MAP, config };
