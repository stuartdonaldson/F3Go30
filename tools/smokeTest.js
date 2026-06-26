#!/usr/bin/env node
/**
 * F3Go30 smoke test automation — runs the full smoke test flow (steps 1–5),
 * pauses for human review of the tracker spreadsheet, then completes teardown.
 *
 * Usage:
 *   node tools/smokeTest.js [--env sit|prod]
 *   node tools/smokeTest.js --teardown [--env sit|prod]  # skip to teardown if already in smoke mode
 *
 * Default: --env sit
 * Smoke mode uses the auto-generate path (same as the time-based trigger),
 * not the menu copyAndInit. The human pause at step 6 is the natural moment
 * to open the spreadsheet and exercise the menu path manually if desired.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const { post, loadSettings, ENV_MAP } = require('./callWebapp.js');

const ROOT = path.join(__dirname, '..');

function parseArgs_(argv) {
  const args = argv.slice(2);
  let teardownMode = false;
  let env = 'sit';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--teardown' || args[i] === '--off') {
      teardownMode = true;
    } else if (args[i] === '--env' && args[i + 1]) {
      env = args[i + 1];
      i++;
    }
  }

  if (!ENV_MAP[env]) {
    console.error(`❌ Unknown env "${env}". Use sit or prod.`);
    process.exit(1);
  }

  return { teardownMode, env };
}

async function callAdmin_(action, extraBody, { env, settings }) {
  const { deploymentIdKey, adminSecretKey } = ENV_MAP[env];
  const deploymentId = settings[deploymentIdKey];
  const adminSecret = settings[adminSecretKey];

  if (!deploymentId || deploymentId.startsWith('<')) {
    throw new Error(`${deploymentIdKey} is not set in local.settings.json`);
  }
  if (!adminSecret) {
    throw new Error(`${adminSecretKey} is not set in local.settings.json`);
  }

  const url = `https://script.google.com/macros/s/${deploymentId}/exec?cmd=admin`;
  const payload = { action, adminSecret, ...extraBody };

  return post(url, payload);
}

async function pollForTrackerId_(maxAttempts = 12, delayMs = 5000, { env, settings }) {
  for (let i = 0; i < maxAttempts; i++) {
    const result = await callAdmin_('getSmokeStatus', {}, { env, settings });
    if (result?.smokeTrackerId) {
      return result.smokeTrackerId;
    }
    if (i < maxAttempts - 1) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return null;
}

function spreadsheetUrl_(trackerId) {
  return `https://docs.google.com/spreadsheets/d/${trackerId}/edit`;
}

async function humanPause_(spreadsheetUrl) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    console.log('');
    console.log('='.repeat(80));
    console.log('📋 HUMAN REVIEW PAUSE');
    console.log('='.repeat(80));
    console.log(`Smoke tracker spreadsheet: ${spreadsheetUrl}`);
    console.log('');
    console.log('✓ Review complete and verified? Press Enter to proceed with teardown.');
    console.log('✓ Press Ctrl+C to abort teardown (manual cleanup will be required).');
    console.log('');

    rl.question('→ ', () => {
      rl.close();
      resolve();
    });
  });
}

async function queryAxiomForErrors_(env, settings, since = '5m') {
  const axPath = path.join(ROOT, 'tools', 'query_axiom.py');
  const axiomToken = settings.axiomQueryToken;

  if (!axiomToken) {
    console.log('⚠️  axiomQueryToken not in local.settings.json; skipping error log check');
    return;
  }

  return new Promise((resolve) => {
    const python = spawn('python3', [
      axPath,
      '--since', since,
      '--side', 'gas',
      '--name', 'error',
      '--name', 'fail',
    ]);

    let stdout = '';
    let stderr = '';
    python.stdout.on('data', (data) => { stdout += data.toString(); });
    python.stderr.on('data', (data) => { stderr += data.toString(); });
    python.on('close', (code) => {
      if (code === 0) {
        console.log('📊 Recent error logs:');
        console.log(stdout);
      } else {
        console.log(`⚠️  Axiom query exited ${code}:`);
        if (stderr) console.log(stderr);
      }
      resolve();
    });
  });
}

async function main() {
  const { teardownMode, env } = parseArgs_(process.argv);

  try {
    const settings = loadSettings();

    if (teardownMode) {
      console.log(`🧹 Teardown mode — ${env.toUpperCase()}`);
      console.log('');

      const status = await callAdmin_('getSmokeStatus', {}, { env, settings });
      if (!status?.smokeTrackerId) {
        console.log('⚠️  No smoke tracker active (smokeTrackerId is not set).');
        console.log('    Clearing SMOKE_MODE anyway.');
      } else {
        console.log(`Cleaning up tracker: ${status.smokeTrackerId}`);
        const cleanup = await callAdmin_(
          'cleanupTracker',
          { sheetId: status.smokeTrackerId, trashSpreadsheet: true },
          { env, settings }
        );
        if (!cleanup?.ok) {
          console.error(`❌ Cleanup failed: ${cleanup?.error || 'unknown error'}`);
          process.exit(1);
        }
      }

      const clear = await callAdmin_(
        'setScriptProperties',
        { properties: { SMOKE_MODE: '', SMOKE_TRACKER_ID: '' } },
        { env, settings }
      );
      if (!clear?.ok) {
        console.error(`❌ Failed to clear smoke properties: ${clear?.error || 'unknown error'}`);
        process.exit(1);
      }

      const final = await callAdmin_('getSmokeStatus', {}, { env, settings });
      console.log('');
      console.log(`✓ Teardown complete. Final status: ${JSON.stringify(final)}`);
      return;
    }

    console.log(`🧪 Smoke Test — ${env.toUpperCase()}`);
    console.log('');

    // Step 1: Activate
    console.log('1️⃣  Activating smoke mode...');
    console.log(`   $ node tools/callWebapp.js setScriptProperties --env ${env} --body '{"properties":{"SMOKE_MODE":"true"}}'`);
    const activate = await callAdmin_(
      'setScriptProperties',
      { properties: { SMOKE_MODE: 'true' } },
      { env, settings }
    );
    if (!activate || !activate.ok) {
      throw new Error(`Failed to activate smoke mode: ${activate?.error || 'no response'}`);
    }
    console.log('   ✓ Smoke mode activated');

    // Step 2: Confirm
    console.log('');
    console.log('2️⃣  Confirming smoke environment...');
    console.log(`   $ node tools/callWebapp.js getSmokeStatus --env ${env}`);
    const status = await callAdmin_('getSmokeStatus', {}, { env, settings });
    if (!status?.smokeMode) {
      throw new Error('getSmokeStatus returned smokeMode !== true');
    }
    console.log(`   ✓ smokeMode: ${status.smokeMode}`);
    console.log(`   ✓ smokeTrackerId: ${status.smokeTrackerId || '(not yet created)'}`);

    // Step 3: Generate tracker via auto-generate
    console.log('');
    console.log('3️⃣  Creating tracker via auto-generate...');
    console.log(`   $ node tools/callWebapp.js runAutoGenerate --env ${env}`);
    console.log('   (waiting for response — this can take 60+ seconds if TinyURL is slow)');
    const autoGen = await callAdmin_('runAutoGenerate', {}, { env, settings });
    if (!autoGen?.ok) {
      console.error(
        `❌ runAutoGenerate failed. Likely cause: IS_TEMPLATE_HOST not set in Script Properties.`
      );
      console.error(`   Response: ${autoGen?.error || 'unknown error'}`);
      console.error('');
      console.error('   Aborting without cleanup (smoke mode still active for debugging).');
      process.exit(1);
    }
    console.log('   ✓ Tracker creation initiated');

    // Step 4: Poll for tracker ID
    console.log('');
    console.log('4️⃣  Waiting for tracker spreadsheet to be created (polling every 10s)...');
    console.log(`   $ node tools/callWebapp.js getSmokeStatus --env ${env}`);
    const trackerId = await pollForTrackerId_(12, 10000, { env, settings });
    if (!trackerId) {
      console.error('❌ Timeout waiting for SMOKE_TRACKER_ID. Checking Axiom logs for errors...');
      console.error('');

      // Try to pull error logs from Axiom
      await queryAxiomForErrors_(env, settings, '5m');

      console.error('');
      console.error('   Aborting without cleanup (smoke mode still active for debugging).');
      process.exit(1);
    }
    console.log(`   ✓ Tracker created: ${trackerId}`);

    // Step 5a: Identify (prefill lookup — tests the read path)
    console.log('');
    console.log('5️⃣a Testing identify (prefill lookup)...');
    console.log(`   $ node tools/callWebapp.js identify --cmd signup --env ${env} --body '{"f3Name":"SmokeTest","email":"smoke@example.com"}'`);

    // Call signup endpoint directly (not via admin callAdmin_)
    const { deploymentIdKey } = ENV_MAP[env];
    const deploymentId = settings[deploymentIdKey];
    const signupUrl = `https://script.google.com/macros/s/${deploymentId}/exec?cmd=signup`;

    const identify = await post(signupUrl, { action: 'identify', f3Name: 'SmokeTest', email: 'smoke@example.com' });
    if (!identify?.ok) {
      console.error(`❌ Identify failed: ${identify?.error || 'unknown error'}`);
      process.exit(1);
    }
    console.log('   ✓ Identify returned ok');

    // Step 5b: Save test PAX signup (tests the full write path — Responses + Tracker row)
    console.log('');
    console.log('5️⃣b Saving test PAX signup...');
    console.log(`   $ node tools/callWebapp.js save --cmd signup --env ${env} --body '{"f3Name":"SmokeTest","email":"smoke@example.com","targetMonth":"current",...}'`);

    const save = await post(signupUrl, {
      action: 'save',
      f3Name: 'SmokeTest',
      email: 'smoke@example.com',
      targetMonth: 'current',
      teamType: 'other',
      team: 'Smoke Test',
      who: 'Smoke test WHO',
      what: 'Smoke test WHAT',
      how: 'Smoke test HOW',
      phone: '',
      nag: false,
    });
    if (!save?.ok) {
      console.error(`❌ Save failed: ${save?.error || 'unknown error'}`);
      process.exit(1);
    }
    console.log('   ✓ Test PAX written to Responses and Tracker');

    // Step 5c: Verify Tracker sheet has the test PAX row
    console.log('');
    console.log('5️⃣c Verifying Tracker sheet...');
    console.log(`   $ node tools/callWebapp.js getSheet --env ${env} --body '{"sheetId":"${trackerId}","sheetName":"Tracker"}'`);
    const sheet = await callAdmin_(
      'getSheet',
      { sheetId: trackerId, sheetName: 'Tracker' },
      { env, settings }
    );
    if (!sheet?.ok) {
      console.error(`❌ Failed to fetch Tracker sheet: ${sheet?.error || 'unknown error'}`);
      process.exit(1);
    }
    const rows = sheet.csv ? sheet.csv.split('\n').length : 0;
    console.log(`   ✓ Tracker sheet has ${rows} rows`);
    console.log('');
    console.log('Tracker sheet preview (TSV):');
    console.log('---');
    if (sheet.csv) {
      console.log(sheet.csv);
    }
    console.log('---');

    // Step 6: Human pause
    const url = spreadsheetUrl_(trackerId);
    await humanPause_(url);

    // Step 7: Cleanup
    console.log('');
    console.log('7️⃣  Cleaning up tracker...');
    const cleanup = await callAdmin_(
      'cleanupTracker',
      { sheetId: trackerId, trashSpreadsheet: true },
      { env, settings }
    );
    if (!cleanup?.ok) {
      console.error(`❌ Cleanup failed: ${cleanup?.error || 'unknown error'}`);
      process.exit(1);
    }
    console.log('   ✓ Tracker removed from TrackerDB');
    console.log('   ✓ PaxDB entries cleaned');
    console.log('   ✓ Spreadsheet trashed');

    // Step 8: Clear properties
    console.log('');
    console.log('8️⃣  Clearing smoke mode properties...');
    const clear = await callAdmin_(
      'setScriptProperties',
      { properties: { SMOKE_MODE: '', SMOKE_TRACKER_ID: '' } },
      { env, settings }
    );
    if (!clear?.ok) {
      throw new Error(`Failed to clear smoke properties: ${clear?.error || 'unknown error'}`);
    }
    console.log('   ✓ Properties cleared');

    // Step 9: Confirm clean
    console.log('');
    console.log('9️⃣  Confirming clean state...');
    const final = await callAdmin_('getSmokeStatus', {}, { env, settings });
    console.log(`   ✓ smokeMode: ${final.smokeMode}`);
    console.log(`   ✓ smokeTrackerId: ${final.smokeTrackerId || '(not set)'}`);

    console.log('');
    console.log('='.repeat(80));
    console.log('✅ Smoke test complete!');
    console.log('='.repeat(80));
  } catch (err) {
    console.error('');
    console.error(`❌ ${err.message || JSON.stringify(err)}`);
    console.error('');
    console.error('Smoke mode may still be active. To clean up manually:');
    console.error(`  node tools/smokeTest.js --teardown --env ${parseArgs_(process.argv).env}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error:', err.message || JSON.stringify(err));
    process.exit(1);
  });
}

module.exports = { callAdmin_, pollForTrackerId_ };
