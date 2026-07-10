#!/usr/bin/env node
/**
 * F3Go30 web app caller — handles any cmd endpoint (admin, signup, ...)
 *
 * Usage:
 *   node tools/callWebapp.js <action> [--cmd admin|signup|...] [--env sit|prod] [--body '{"key":"val"}'] [--ns <namespace>]
 *
 * --cmd defaults to "admin". For cmd=admin the admin secret is read from
 * local.settings.json and injected into the payload automatically.
 *
 * --ns is a convenience shorthand for the request-follows-ns pattern (ADR-014 D1/D3): it's
 * merged into the payload as `ns`, exactly as if `--body '{"ns":"<namespace>"}'` had been
 * passed — lets a namespace-scoped test environment (F3Go30-i5md.6) be addressed without
 * hand-writing ns into every --body JSON string. --body still wins if both set `ns`.
 *
 * Examples:
 *   node tools/callWebapp.js cleanupTracker --body '{"sheetId":"<id>","trashSpreadsheet":true}'
 *   node tools/callWebapp.js teardownEnvironment --body '{"nameSpace":"<ns>","trashFolder":true}'
 *   node tools/callWebapp.js getSheet --body '{"sheetName":"Tracker"}'
 *   node tools/callWebapp.js runScanTrackers --env prod
 *   node tools/callWebapp.js identify --cmd signup --body '{"f3Name":"Test","email":"t@t.com"}'
 *   node tools/callWebapp.js identify --cmd checkin --ns smoke-2026-07-09 --body '{"f3Name":"Test","email":"t@t.com","targetMonth":"current"}'
 */

'use strict';

const https   = require('https');
const fs      = require('fs');
const path    = require('path');

const ROOT          = path.join(__dirname, '..');
const SETTINGS_PATH = path.join(ROOT, 'local.settings.json');

const ENV_MAP = {
  sit:  { deploymentIdKey: 'testDeploymentId',      adminSecretKey: 'testAdminSecret' },
  prod: { deploymentIdKey: 'templateDeploymentId',  adminSecretKey: 'templateAdminSecret' },
};

function parseArgs_(argv) {
  const args = argv.slice(2);
  const action = args.find(a => !a.startsWith('--'));
  if (!action) {
    console.error('Usage: callWebapp.js <action> [--cmd admin|signup] [--env sit|prod] [--body \'{"key":"val"}\']');
    process.exit(1);
  }

  const cmdIdx = args.indexOf('--cmd');
  const cmd = cmdIdx !== -1 ? args[cmdIdx + 1] : 'admin';

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

  const nsIdx = args.indexOf('--ns');
  if (nsIdx !== -1) {
    extraBody = { ns: args[nsIdx + 1], ...extraBody };
  }

  return { action, cmd, env, extraBody };
}

function buildPayload_(action, cmd, extraBody, adminSecret) {
  if (cmd === 'admin') {
    return { action, adminSecret, ...extraBody };
  }
  return { action, ...extraBody };
}

function loadSettings() {
  if (!fs.existsSync(SETTINGS_PATH)) {
    console.error(`❌  local.settings.json not found at ${SETTINGS_PATH}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
}

// POST to GAS web app. GAS responds with a 302 redirect to a GET-only echo endpoint —
// follow as GET, never pin the method through the redirect.
// Timeout: 60s for admin actions (e.g., runAutoGenerate) that may wait on slow external services
function post(url, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const parsed  = new URL(url);
    let timedOut = false;

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
        if (timedOut) return;
        if (res.statusCode === 301 || res.statusCode === 302) {
          res.resume();
          return get(res.headers['location']).then(resolve, reject);
        }
        collectBody(res).then(resolve, reject);
      }
    );
    req.setTimeout(120000, () => {
      timedOut = true;
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function get(url) {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const req = https.get(url, res => {
      if (timedOut) return;
      if (res.statusCode === 301 || res.statusCode === 302) {
        res.resume();
        return get(res.headers['location']).then(resolve, reject);
      }
      collectBody(res).then(resolve, reject);
    });
    req.setTimeout(120000, () => {
      timedOut = true;
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.on('error', reject);
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
  const { action, cmd, env, extraBody } = parseArgs_(process.argv);
  const settings = loadSettings();
  const { deploymentIdKey, adminSecretKey } = ENV_MAP[env];

  const deploymentId = settings[deploymentIdKey];
  if (!deploymentId || deploymentId.startsWith('<')) {
    console.error(`❌  ${deploymentIdKey} is not set in local.settings.json.`);
    console.error('    Run the deploy script for this environment first.');
    process.exit(1);
  }

  let adminSecret = null;
  if (cmd === 'admin') {
    adminSecret = settings[adminSecretKey];
    if (!adminSecret) {
      console.error(`❌  ${adminSecretKey} is not set in local.settings.json.`);
      process.exit(1);
    }
  }

  const url     = `https://script.google.com/macros/s/${deploymentId}/exec?cmd=${cmd}`;
  const payload = buildPayload_(action, cmd, extraBody, adminSecret);

  console.error(`→ ${env.toUpperCase()}  cmd=${cmd}  ${action}`);

  const result = await post(url, payload);
  console.log(JSON.stringify(result, null, 2));

  if (result && result.ok === false) process.exit(1);
}

if (require.main === module) {
  main().catch(err => {
    console.error('❌', err.message);
    process.exit(1);
  });
}

module.exports = { parseArgs_, buildPayload_, post, loadSettings, ENV_MAP };
