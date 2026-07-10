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
 *     [--source-template-id <id>] [--kind smoke|regional|demo]
 *
 * Default --env is sit — the deployment that *executes* the request and owns the destination
 * NamespaceDB registry the new environment is written into (ADR-014 D6). Default
 * --source-template-id is PROD's Template spreadsheet id (`templateSpreadsheetId` in
 * local.settings.json) — the typical flow is SIT copying PROD, never SIT copying itself.
 * Pass --source-template-id explicitly to copy from somewhere else (e.g. chaining a copy from
 * an already-provisioned namespace). Default --kind is 'smoke'.
 */

'use strict';

const { post, loadSettings, ENV_MAP } = require('./callWebapp.js');

const FLAGS_WITH_VALUES_ = ['--env', '--tracker-count', '--source-template-id', '--kind'];

function parseArgs_(argv, settings) {
  const args = argv.slice(2);
  const folderName = args.find((a, i) => !a.startsWith('--') && !FLAGS_WITH_VALUES_.includes(args[i - 1]));
  if (!folderName) {
    console.error('Usage: copyTemplate.js <folderName> [--env sit|prod] [--tracker-count 3] [--source-template-id <id>] [--kind smoke|regional|demo]');
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

  const sourceIdx = args.indexOf('--source-template-id');
  const sourceTemplateId = sourceIdx !== -1 ? args[sourceIdx + 1] : settings.templateSpreadsheetId;
  if (!sourceTemplateId || sourceTemplateId.startsWith('<')) {
    console.error('❌ No source template id: pass --source-template-id or set templateSpreadsheetId in local.settings.json');
    process.exit(1);
  }

  const kindIdx = args.indexOf('--kind');
  const kind = kindIdx !== -1 ? args[kindIdx + 1] : 'smoke';

  return { folderName, env, trackerCount, sourceTemplateId, kind };
}

async function main() {
  const settings = loadSettings();
  const { folderName, env, trackerCount, sourceTemplateId, kind } = parseArgs_(process.argv, settings);
  const { deploymentIdKey, adminSecretKey } = ENV_MAP[env];
  const deploymentId = settings[deploymentIdKey];
  const adminSecret = settings[adminSecretKey];

  if (!deploymentId || deploymentId.startsWith('<')) {
    throw new Error(`${deploymentIdKey} is not set in local.settings.json`);
  }
  if (!adminSecret) {
    throw new Error(`${adminSecretKey} is not set in local.settings.json`);
  }

  console.log(`🗂️  CopyTemplate — ${env.toUpperCase()} — folder "${folderName}", ${trackerCount} most recent trackers from ${sourceTemplateId} (kind=${kind})`);
  const url = `https://script.google.com/macros/s/${deploymentId}/exec?cmd=admin`;
  const result = await post(url, { action: 'copyTemplate', adminSecret, folderName, trackerCount, sourceTemplateId, kind });

  if (!result?.ok) {
    console.error(`❌ ${result?.error || 'unknown error'}: ${result?.detail || ''}`);
    (result?.log || []).forEach(line => console.log('   ' + line));
    process.exit(1);
  }

  (result.log || []).forEach(line => console.log('   ' + line));
  console.log('');
  console.log(`✓ New folder:   ${result.result.newFolderUrl}`);
  console.log(`✓ New Template: ${result.result.newTemplateUrl}`);
  console.log(`✓ Registered NamespaceDB row: NameSpace="${result.result.nameSpace}" (Kind=${result.result.kind})`);
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
