#!/usr/bin/env node
/**
 * F3Go30-i5md.6 — namespace-scoped smoke test: provisions an on-demand test environment
 * (CopyTemplate.js, ADR-014 D6) from PROD's real recent trackers and live-verifies the three
 * deferred smoke-coverage bugs that the old single-shared SMOKE_MODE tracker design could not
 * represent:
 *
 *   - F3Go30-jldr:   check-in day:'today' against the namespace's own copied *current* month
 *                    tracker (real calendar day columns, not a synthetic next-month tracker).
 *   - F3Go30-4j4o.1: bonusAdd/bonusList against that same namespace-scoped tracker (bonus
 *                    resolution is date-based — resolveDashboardMonth_ — and namespace trackers
 *                    carry no smoke-exclusion tag, unlike the old SMOKE_MODE design).
 *   - F3Go30-4j4o.2: cross-month bonus-edit relocation (findBonusRowByIdentity_), using the
 *                    same test PAX registered into TWO of the namespace's copied months at once
 *                    via the new targetMonth:'explicit' + targetSheetId seam
 *                    (resolveSignupMonths_, F3Go30-i5md.6 decision) — no new admin/write
 *                    surface area, just another value of the existing targetMonth enum.
 *
 * Usage:
 *   node tools/smokeTestNamespace.js [--env sit]
 *   node tools/smokeTestNamespace.js --cleanup-only --folder-url <url> --ns <namespace>
 *
 * Provisioning always sources from PROD's Template (settings.templateSpreadsheetId) — SIT is
 * the destination registry (ADR-014 D6) — but runs entirely against --env (default sit)'s
 * webapp deployment. Only touch --env prod on explicit instruction.
 *
 * Teardown for whole namespaced environments (F3Go30-i5md.4) isn't built yet — this script
 * prints the exact manual cleanup steps (Drive folder to trash + NamespaceDB row to delete)
 * and pauses for a human to perform + confirm them, same as smokeTest.js's existing human
 * review pause.
 */

'use strict';

const readline = require('readline');
const { post: httpPost, loadSettings, ENV_MAP } = require('./callWebapp.js');

function parseArgs_(argv) {
  const args = argv.slice(2);
  let env = 'sit';
  let cleanupOnly = false;
  let folderUrl = null;
  let ns = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--env' && args[i + 1]) { env = args[++i]; }
    else if (args[i] === '--cleanup-only') { cleanupOnly = true; }
    else if (args[i] === '--folder-url' && args[i + 1]) { folderUrl = args[++i]; }
    else if (args[i] === '--ns' && args[i + 1]) { ns = args[++i]; }
  }

  if (!ENV_MAP[env]) {
    console.error(`❌ Unknown env "${env}". Use sit or prod.`);
    process.exit(1);
  }

  return { env, cleanupOnly, folderUrl, ns };
}

async function callAdmin(action, extraBody, { env, settings }) {
  const { deploymentIdKey, adminSecretKey } = ENV_MAP[env];
  const deploymentId = settings[deploymentIdKey];
  const adminSecret = settings[adminSecretKey];
  if (!deploymentId || deploymentId.startsWith('<')) throw new Error(`${deploymentIdKey} is not set`);
  if (!adminSecret) throw new Error(`${adminSecretKey} is not set`);
  const url = `https://script.google.com/macros/s/${deploymentId}/exec?cmd=admin`;
  return httpPost(url, { action, adminSecret, ...extraBody });
}

/** Local-midnight "YYYY-MM-DD". */
function isoDate_(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "YYYY-MM" key for the month-selection comparison below (mirrors monthKey_ in signupWebapp.js). */
function monthKey_(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Minimal tab-separated parse — good enough for TrackerDB's own values (no embedded tabs). */
function parseTsv_(csv) {
  return (csv || '').split('\n').filter((l) => l.length).map((line) => line.split('\t'));
}

/**
 * Reads the namespace's own copied TrackerDB (via the admin getSheet action against the newly
 * copied Template id) and shapes each row to {sheetId, spreadsheetName, startDate} — needed to
 * pick a genuinely distinct second month for the 4j4o.2 cross-month scenario, since
 * copyTemplateToNewEnvironment_'s copiedTrackers response doesn't carry startDate itself.
 */
async function fetchTrackerDbRows_(newTemplateId, { env, settings }) {
  const resp = await callAdmin('getSheet', { sheetId: newTemplateId, sheetName: 'TrackerDB' }, { env, settings });
  if (!resp?.ok) throw new Error(`Failed to read namespace TrackerDB: ${resp?.error || 'unknown error'}`);
  const rows = parseTsv_(resp.csv);
  if (!rows.length) return [];
  const headers = rows[0].map((h) => String(h || '').trim().toLowerCase());
  const startDateIdx = headers.indexOf('startdate');
  const sheetIdIdx = headers.indexOf('sheetid');
  const nameIdx = headers.indexOf('spreadsheetname');
  return rows.slice(1)
    .filter((r) => r[sheetIdIdx])
    .map((r) => ({
      sheetId: r[sheetIdIdx],
      spreadsheetName: nameIdx >= 0 ? r[nameIdx] : '',
      startDate: new Date(r[startDateIdx]),
    }));
}

/** Mirrors resolveSignupMonths_'s current-month pick: most recent StartDate not in the future. */
function pickCurrentRow_(trackerRows, now) {
  const nowKey = monthKey_(now);
  const eligible = trackerRows.filter((r) => !isNaN(r.startDate.getTime()) && monthKey_(r.startDate) <= nowKey);
  eligible.sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
  return eligible[0] || null;
}

async function humanConfirm_(message) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    console.log('');
    console.log(message);
    rl.question('→ Press Enter once done: ', () => { rl.close(); resolve(); });
  });
}

async function main() {
  const { env, cleanupOnly, folderUrl, ns: cleanupNs } = parseArgs_(process.argv);
  const settings = loadSettings();

  if (cleanupOnly) {
    console.log(`🧹 Cleanup-only mode — ${env.toUpperCase()}`);
    if (!folderUrl || !cleanupNs) {
      console.error('❌ --cleanup-only requires --folder-url <url> and --ns <namespace>.');
      process.exit(1);
    }
    console.log(printManualCleanup_(folderUrl, cleanupNs, env));
    return;
  }

  console.log(`🧪 Namespace smoke test (F3Go30-i5md.6) — ${env.toUpperCase()}`);
  console.log('');

  const sourceTemplateId = settings.templateSpreadsheetId;
  if (!sourceTemplateId || String(sourceTemplateId).startsWith('<')) {
    console.error('❌ templateSpreadsheetId (PROD Template id) is not set in local.settings.json.');
    process.exit(1);
  }

  const folderName = `i5md6-smoke-${isoDate_(new Date())}-${Date.now()}`;

  // Step 1: Provision
  console.log(`1️⃣  Provisioning namespace "${folderName}" from PROD Template ${sourceTemplateId}...`);
  const provision = await callAdmin('copyTemplate', {
    folderName,
    sourceTemplateId,
    trackerCount: 3,
    kind: 'smoke',
  }, { env, settings });
  if (!provision?.ok) {
    console.error(`❌ Provisioning failed: ${provision?.error || 'unknown error'} ${provision?.detail || ''}`);
    process.exit(1);
  }
  const result = provision.result;
  const ns = result.nameSpace;
  console.log(`   ✓ Namespace registered: ${ns}`);
  console.log(`   ✓ Folder: ${result.newFolderUrl}`);
  console.log(`   ✓ Copied ${result.copiedTrackers.length} tracker(s):`);
  result.copiedTrackers.forEach((t) => console.log(`     - ${t.spreadsheetName} (${t.newSheetId}) — ${t.totalPax} PAX`));

  if (result.copiedTrackers.length < 1) {
    console.error('❌ No trackers were copied — cannot proceed (need at least a current month).');
    console.log(printManualCleanup_(result.newFolderUrl, ns, env));
    process.exit(1);
  }

  const { deploymentIdKey } = ENV_MAP[env];
  const deploymentId = settings[deploymentIdKey];
  const signupUrl = `https://script.google.com/macros/s/${deploymentId}/exec?cmd=signup`;
  const checkinUrl = `https://script.google.com/macros/s/${deploymentId}/exec?cmd=checkin`;

  const pax = { f3Name: 'NsSmokeTest', email: 'nssmoketest@example.com', team: 'Smoke Team NS', teamType: 'other' };
  let monthB = null;

  try {
    const trackerRows = await fetchTrackerDbRows_(result.newTemplateId, { env, settings });
    const currentRow = pickCurrentRow_(trackerRows, new Date());
    if (!currentRow) throw new Error('Could not resolve a current-month row in the namespace TrackerDB.');
    monthB = trackerRows.find((r) => r.sheetId !== currentRow.sheetId && !isNaN(r.startDate.getTime())) || null;

    // Step 2: jldr — sign up + check in against the namespace's own 'current' month, via
    // targetMonth:'current' (NOT 'smoke') — this is the whole fix: 'current' resolves within
    // THIS namespace's copied TrackerDB, whose current-month tracker carries real calendar day
    // columns, unlike the old design's always-next-month synthetic smoke tracker.
    console.log('');
    console.log("2️⃣  F3Go30-jldr — signup + check-in 'today' against namespace current month...");
    const identify1 = await httpPost(signupUrl, { action: 'identify', ns, f3Name: pax.f3Name, email: pax.email });
    if (!identify1?.ok) throw new Error(`identify failed: ${identify1?.error || 'unknown error'}`);
    if (identify1.matched) throw new Error(`${pax.f3Name} unexpectedly already exists — namespace is not clean`);

    const save = await httpPost(signupUrl, {
      action: 'save', ns, f3Name: pax.f3Name, email: pax.email,
      targetMonth: 'current', teamType: pax.teamType, team: pax.team,
      who: 'NS smoke WHO', what: 'NS smoke WHAT', how: 'NS smoke HOW', phone: '', nag: false,
    });
    if (!save?.ok) throw new Error(`signup save failed: ${save?.error || 'unknown error'}`);
    console.log(`   ✓ Signed up into ${save.savedMonth}`);

    const checkinIdentify = await httpPost(checkinUrl, { action: 'identify', ns, f3Name: pax.f3Name, email: pax.email, targetMonth: 'current' });
    if (!checkinIdentify?.matched) throw new Error(`checkin identify failed: ${checkinIdentify?.error || 'not matched'}`);

    const checkin = await httpPost(checkinUrl, { action: 'checkin', ns, f3Name: pax.f3Name, email: pax.email, day: 'today', value: 1, targetMonth: 'current' });
    if (!checkin?.ok) throw new Error(`check-in failed: ${checkin?.error || 'unknown error'} (this is exactly the jldr day_column_not_found failure mode if it recurs)`);
    console.log("   ✓ Checked in for 'today' — jldr's day_column_not_found bug does not reproduce against the namespace's current-month tracker");

    // Step 3: 4j4o.1 — bonus actions against the same namespace-scoped tracker.
    console.log('');
    console.log('3️⃣  F3Go30-4j4o.1 — bonusAdd/bonusList against namespace tracker...');
    const whenIsoA = isoDate_(new Date());
    const bonusAdd = await httpPost(checkinUrl, {
      action: 'bonusAdd', ns, f3Name: pax.f3Name, email: pax.email,
      type: 'Fellowship', whenIso: whenIsoA, message: 'NS smoke fellowship', link: '',
    });
    if (!bonusAdd?.ok) throw new Error(`bonusAdd failed: ${bonusAdd?.error || 'unknown error'} (this is exactly the 4j4o.1 not_found failure mode if it recurs)`);
    const bonusListA = await httpPost(checkinUrl, { action: 'bonusList', ns, f3Name: pax.f3Name, email: pax.email });
    const entryA = bonusListA?.ok && (bonusListA.entries || []).find((en) => en.rowIndex === bonusAdd.rowIndex);
    if (!entryA) throw new Error('bonus entry did not read back after add');
    console.log(`   ✓ Bonus entry added and read back (row ${bonusAdd.rowIndex}) — 4j4o.1 does not reproduce against a namespace tracker`);

    // Step 4: 4j4o.2 — cross-month relocation. Needs a second copied month distinct from
    // 'current' (resolved above from the namespace's own TrackerDB, not guessed from
    // copiedTrackers order).
    console.log('');
    console.log('4️⃣  F3Go30-4j4o.2 — cross-month bonus-edit relocation...');
    if (!monthB) {
      console.log('   ⚠️  Only one distinct month was copied — cannot exercise cross-month relocation this run. Skipping (not a failure; re-run when trackerCount yields ≥2 distinct months).');
    } else {
      // Register the same PAX into monthB via targetMonth:'explicit' + targetSheetId — the new
      // seam (F3Go30-i5md.6 decision), not a new admin action.
      const saveB = await httpPost(signupUrl, {
        action: 'save', ns, f3Name: pax.f3Name, email: pax.email,
        targetMonth: 'explicit', targetSheetId: monthB.sheetId,
        teamType: pax.teamType, team: pax.team,
        who: 'NS smoke WHO', what: 'NS smoke WHAT', how: 'NS smoke HOW', phone: '', nag: false,
      });
      if (!saveB?.ok) throw new Error(`explicit-month signup failed: ${saveB?.error || 'unknown error'}`);
      console.log(`   ✓ Same PAX also registered into ${saveB.savedMonth} (${monthB.spreadsheetName})`);

      // monthB's own start-of-month date is guaranteed to exist as a Tracker row there and to
      // fall inside monthB's own date range for resolveDashboardMonth_.
      const whenIsoB = isoDate_(monthB.startDate);

      const edit = await httpPost(checkinUrl, {
        action: 'bonusEdit', ns, f3Name: pax.f3Name, email: pax.email,
        rowIndex: bonusAdd.rowIndex, type: entryA.type, whenIso: whenIsoB, message: entryA.message, link: entryA.link,
        originalWhenIso: whenIsoA,
        original: { type: entryA.type, whenIso: whenIsoA, message: entryA.message, link: entryA.link },
      });
      if (!edit?.ok) throw new Error(`cross-month bonusEdit failed: ${edit?.error || 'unknown error'} (this is exactly the 4j4o.2 gap this run verifies)`);

      const bonusListBAfter = await httpPost(checkinUrl, { action: 'bonusList', ns, f3Name: pax.f3Name, email: pax.email, dateISO: whenIsoB });
      const relocated = bonusListBAfter?.ok && (bonusListBAfter.entries || []).find((en) => en.message === entryA.message);
      if (!relocated) throw new Error(`bonus entry did not appear in ${monthB.spreadsheetName} after cross-month edit`);

      const bonusListAAfter = await httpPost(checkinUrl, { action: 'bonusList', ns, f3Name: pax.f3Name, email: pax.email, dateISO: whenIsoA });
      const stillInA = bonusListAAfter?.ok && (bonusListAAfter.entries || []).some((en) => en.message === entryA.message);
      if (stillInA) throw new Error('bonus entry still present in the original month after cross-month edit — relocation left a duplicate');

      console.log(`   ✓ Bonus entry relocated from current month into ${monthB.spreadsheetName} with no duplicate left behind — findBonusRowByIdentity_'s cross-month relocation is live-verified`);
    }

    console.log('');
    console.log('='.repeat(80));
    console.log('✅ Namespace smoke test complete — jldr / 4j4o.1' + (monthB ? ' / 4j4o.2' : '') + ' live-verified');
    console.log('='.repeat(80));
  } catch (err) {
    console.error('');
    console.error(`❌ ${err.message}`);
    console.error('Namespace left in place for debugging — see cleanup steps below.');
  }

  await humanConfirm_(printManualCleanup_(result.newFolderUrl, ns, env));
}

function printManualCleanup_(folderUrl, ns, env) {
  return [
    '📋 MANUAL TEARDOWN (F3Go30-i5md.4 automation not built yet):',
    `  1. Trash the Drive folder (removes the copied Template + all copied trackers): ${folderUrl}`,
    `  2. Delete the NameSpace="${ns}" row from ${env.toUpperCase()}'s Template spreadsheet's NamespaceDB sheet.`,
    '     (Deleting the row alone makes the namespace unresolvable immediately, even before Drive trashing finishes.)',
  ].join('\n');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error:', err.message || JSON.stringify(err));
    process.exit(1);
  });
}

module.exports = { parseArgs_, isoDate_ };
