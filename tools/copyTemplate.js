#!/usr/bin/env node
/**
 * Stands up a new environment's files: copies the Template spreadsheet (+ bound script) and
 * the N most recent real monthly trackers into a new sibling Drive folder, then rebuilds that
 * copy's TrackerDB/PaxDB from scratch using only the copied trackers.
 *
 * Does NOT touch triggers, HC Forms, TinyURL short links, or deploy anything — see
 * docs/OPERATIONS.md §CopyTemplate for the manual steps to actually bring the new environment
 * live once you're ready.
 *
 * Usage:
 *   node tools/copyTemplate.js <folderName> [--env sit|prod] [--tracker-count 3]
 *
 * Default --env is sit. Use --env prod to copy from real production (the intended use case —
 * PROD's TrackerDB holds the real monthly tracker history; SIT's is contaminated with
 * SIT-only test rows layered on inherited prod history).
 */

'use strict';

const { post, loadSettings, ENV_MAP } = require('./callWebapp.js');

function parseArgs_(argv) {
  const args = argv.slice(2);
  const folderName = args.find(a => !a.startsWith('--'));
  if (!folderName) {
    console.error('Usage: copyTemplate.js <folderName> [--env sit|prod] [--tracker-count 3]');
    process.exit(1);
  }

  const envIdx = args.indexOf('--env');
  const env = envIdx !== -1 ? args[envIdx + 1] : 'sit';
  if (!ENV_MAP[env]) {
    console.error(`❌ Unknown env "${env}". Use sit or prod.`);
    process.exit(1);
  }

  const countIdx = args.indexOf('--tracker-count');
  const trackerCount = countIdx !== -1 ? parseInt(args[countIdx + 1], 10) : 3;

  return { folderName, env, trackerCount };
}

async function main() {
  const { folderName, env, trackerCount } = parseArgs_(process.argv);
  const settings = loadSettings();
  const { deploymentIdKey, adminSecretKey } = ENV_MAP[env];
  const deploymentId = settings[deploymentIdKey];
  const adminSecret = settings[adminSecretKey];

  if (!deploymentId || deploymentId.startsWith('<')) {
    throw new Error(`${deploymentIdKey} is not set in local.settings.json`);
  }
  if (!adminSecret) {
    throw new Error(`${adminSecretKey} is not set in local.settings.json`);
  }

  console.log(`🗂️  CopyTemplate — ${env.toUpperCase()} — folder "${folderName}", ${trackerCount} most recent trackers`);
  const url = `https://script.google.com/macros/s/${deploymentId}/exec?cmd=admin`;
  const result = await post(url, { action: 'copyTemplate', adminSecret, folderName, trackerCount });

  if (!result?.ok) {
    console.error(`❌ ${result?.error || 'unknown error'}: ${result?.detail || ''}`);
    (result?.log || []).forEach(line => console.log('   ' + line));
    process.exit(1);
  }

  (result.log || []).forEach(line => console.log('   ' + line));
  console.log('');
  console.log(`✓ New folder:   ${result.result.newFolderUrl}`);
  console.log(`✓ New Template: ${result.result.newTemplateUrl}`);
  console.log(`✓ Copied trackers (${result.result.copiedTrackers.length}):`);
  result.result.copiedTrackers.forEach(t => {
    console.log(`   - ${t.spreadsheetName} (${t.newSheetId}) — ${t.totalPax} PAX, ${t.totalTeams} teams`);
  });
}

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error:', err.message || JSON.stringify(err));
    process.exit(1);
  });
}
