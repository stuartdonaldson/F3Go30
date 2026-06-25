#!/usr/bin/env node
/**
 * F3Go30 Admin POST caller
 *
 * Usage:
 *   node tests/callAdmin.js <action> [--env sit|prod] [--body '{"key":"val"}']
 *
 * Examples:
 *   node tests/callAdmin.js getSmokeStatus
 *   node tests/callAdmin.js setScriptProperties --body '{"properties":{"SMOKE_MODE":"true"}}'
 *   node tests/callAdmin.js cleanupTracker --body '{"sheetId":"<id>","trashSpreadsheet":true}'
 *   node tests/callAdmin.js runScanTrackers --env prod
 *
 * Reads testDeploymentId / templateDeploymentId and testAdminSecret / templateAdminSecret
 * from local.settings.json. Run npm run deploy:test (or push) first to populate the IDs.
 */

'use strict';

const https   = require('https');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');

const ROOT          = path.join(__dirname, '..');
const SETTINGS_PATH = path.join(ROOT, 'local.settings.json');

const ENV_MAP = {
  sit:  { deploymentIdKey: 'testDeploymentId',      adminSecretKey: 'testAdminSecret' },
  prod: { deploymentIdKey: 'templateDeploymentId',  adminSecretKey: 'templateAdminSecret' },
};

function loadSettings() {
  if (!fs.existsSync(SETTINGS_PATH)) {
    console.error(`❌  local.settings.json not found at ${SETTINGS_PATH}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const action = args.find(a => !a.startsWith('--'));
  if (!action) {
    console.error('Usage: callAdmin.js <action> [--env sit|prod] [--body \'{"key":"val"}\']');
    process.exit(1);
  }

  const envIdx = args.indexOf('--env');
  const env = envIdx !== -1 ? args[envIdx + 1] : 'sit';
  if (!ENV_MAP[env]) {
    console.error(`❌  Unknown env "${env}". Use sit or prod.`);
    process.exit(1);
  }

  const bodyIdx = args.indexOf('--body');
  let extraBody = {};
  if (bodyIdx !== -1) {
    try {
      extraBody = JSON.parse(args[bodyIdx + 1]);
    } catch {
      console.error('❌  --body must be valid JSON.');
      process.exit(1);
    }
  }

  return { action, env, extraBody };
}

// POST to Google Apps Script web app. GAS responds with a 302 redirect to a GET-only
// echo endpoint — follow as GET, never pin the method through the redirect.
function post(url, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const parsed  = new URL(url);

    const req = https.request(
      {
        hostname: parsed.hostname,
        path:     parsed.pathname + parsed.search,
        method:   'POST',
        headers:  {
          'Content-Type':   'text/plain',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
      },
      res => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          res.resume();
          return get(res.headers['location']).then(resolve, reject);
        }
        collectBody(res).then(resolve, reject);
      }
    );
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        res.resume();
        return get(res.headers['location']).then(resolve, reject);
      }
      collectBody(res).then(resolve, reject);
    }).on('error', reject);
  });
}

function collectBody(res) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(JSON.parse(text));
      } catch {
        resolve(text);
      }
    });
    res.on('error', reject);
  });
}

async function main() {
  const { action, env, extraBody } = parseArgs(process.argv);
  const settings = loadSettings();
  const { deploymentIdKey, adminSecretKey } = ENV_MAP[env];

  const deploymentId = settings[deploymentIdKey];
  if (!deploymentId || deploymentId.startsWith('<')) {
    console.error(`❌  ${deploymentIdKey} is not set in local.settings.json.`);
    console.error('    Run the deploy script for this environment first.');
    process.exit(1);
  }

  const adminSecret = settings[adminSecretKey];
  if (!adminSecret) {
    console.error(`❌  ${adminSecretKey} is not set in local.settings.json.`);
    process.exit(1);
  }

  const url     = `https://script.google.com/macros/s/${deploymentId}/exec?cmd=admin`;
  const payload = { action, adminSecret, ...extraBody };

  console.error(`→ ${env.toUpperCase()}  ${action}`);

  const result = await post(url, payload);
  console.log(JSON.stringify(result, null, 2));

  if (result && result.ok === false) process.exit(1);
}

main().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
