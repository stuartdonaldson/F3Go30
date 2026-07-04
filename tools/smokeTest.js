#!/usr/bin/env node
/**
 * F3Go30 smoke test automation — runs the full smoke test flow: tracker creation, then signup,
 * check-in, and bonus-entry workflows across 3 teams of 3 PAX each, then pauses for human review
 * of the tracker spreadsheet, then completes teardown.
 *
 * Usage:
 *   node tools/smokeTest.js [--env sit|prod]
 *   node tools/smokeTest.js --teardown [--env sit|prod]  # skip to teardown if already in smoke mode
 *
 * Default: --env sit
 * Smoke mode uses the auto-generate path (same as the time-based trigger),
 * not the menu copyAndInit. The human pause before teardown is the natural moment
 * to open the spreadsheet and exercise the menu path manually if desired.
 *
 * Workflow coverage: 9 test PAX (3 teams x 3 PAX) sign up, each is checked in for today, and
 * one bonus entry of each type (EHing FNG, Fellowship, Q Point, Inspire) is added — one type
 * per recipient PAX, spread across teams. One of those entries is then edited in place
 * (same-month — see the cross-month note below) and the dashboard/board view is loaded and
 * checked for the expected roster/team shape. Each step's write is verified by reading it back
 * through the same webapp read path a real user would hit (identify / bonusList / dashboard),
 * not by re-deriving expected sheet contents — the human pause is reserved for what only a
 * human can judge (the Bonus Tracker's spilled-formula Multiplier/Uncapped Points/Complete
 * columns).
 *
 * NOT covered: cross-month bonus edits (an edit whose date moves the entry into a different
 * month's Bonus Tracker sheet — see handleBonusEdit_'s add-then-clear relocation in
 * dashboardWebapp.js). This smoke run is deliberately a single isolated tracker month, and the
 * public signup action only supports targetMonth 'current'/'next'/'smoke' — there's no way to
 * put the same test PAX into a second, genuinely separate synthetic month without either
 * touching a real production month or adding new write-capable admin/signup surface area. If
 * that relocation path regresses again, it needs either that new surface area or a live check
 * against real (already-existing) adjacent months instead.
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

/**
 * @param {string} spreadsheetUrl
 * @param {Array<string>} [checklist] Specific things only a human can judge (e.g. spilled-formula
 *   output) — printed as a numbered list so the reviewer knows exactly what to look at, rather
 *   than re-deriving it from the smoke test's own automated assertions above.
 */
async function humanPause_(spreadsheetUrl, checklist) {
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
    if (checklist && checklist.length) {
      console.log('Please verify by eye (these can\'t be checked automatically):');
      checklist.forEach((item, i) => console.log(`  ${i + 1}. ${item}`));
      console.log('');
    }
    console.log('✓ Review complete and verified? Press Enter to proceed with teardown.');
    console.log('✓ Press Ctrl+C to abort teardown (manual cleanup will be required).');
    console.log('');

    rl.question('→ ', () => {
      rl.close();
      resolve();
    });
  });
}

/**
 * Builds 3 teams of 3 test PAX each — enough to exercise per-team grouping (Tracker sort,
 * dashboard team rollups) without the volume of a real month.
 * @returns {Array<{f3Name:string, email:string, team:string, teamType:string}>}
 */
function buildPaxPlan_() {
  const teamLetters = ['A', 'B', 'C'];
  const pax = [];
  teamLetters.forEach((letter) => {
    for (let i = 1; i <= 3; i++) {
      pax.push({
        f3Name: `Smoke${letter}${i}`,
        email: `smoke${letter.toLowerCase()}${i}@example.com`,
        team: `Smoke Team ${letter}`,
        teamType: 'other',
      });
    }
  });
  return pax;
}

/**
 * One bonus entry of each type (BONUS_TYPE_RULES_ in bonusWebapp.js), assigned to different
 * recipients spread across teams rather than piling all 4 onto one PAX — so a Tracker-level
 * regression that only breaks one recipient's row doesn't hide behind the other 3 types working.
 * @param {Array} pax From buildPaxPlan_ — indices below assume the 3-teams-of-3 layout.
 */
function buildBonusPlan_(pax) {
  return [
    { pax: pax[0], type: 'EHing FNG', message: 'Smoke test EH', link: 'https://example.com/smoke-eh' },
    { pax: pax[3], type: 'Fellowship', message: 'Smoke test fellowship', link: '' },
    { pax: pax[6], type: 'Q Point', message: 'Smoke test Q point', link: 'https://example.com/smoke-q' },
    { pax: pax[1], type: 'Inspire', message: 'Smoke test inspire', link: 'https://example.com/smoke-inspire' },
  ];
}

/** Local-midnight "YYYY-MM-DD", matching bonusWebapp.js's formatBonusDateLocal_ convention. */
function todayIso_() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

    // Signup/check-in/bonus endpoints are called directly (not via admin callAdmin_) — they
    // need no admin secret, same as a real PAX hitting the webapp.
    const { deploymentIdKey } = ENV_MAP[env];
    const deploymentId = settings[deploymentIdKey];
    const signupUrl = `https://script.google.com/macros/s/${deploymentId}/exec?cmd=signup`;
    const checkinUrl = `https://script.google.com/macros/s/${deploymentId}/exec?cmd=checkin`;

    const pax = buildPaxPlan_();
    const teamNames = [...new Set(pax.map((p) => p.team))];

    // Step 5: Sign up 3 teams of 3 PAX each (tests the full signup write path — Responses +
    // Tracker row — repeated across every team, not just one PAX)
    console.log('');
    console.log(`5️⃣  Signing up ${pax.length} test PAX across ${teamNames.length} teams (3 each)...`);
    for (const p of pax) {
      console.log(`   $ node tools/callWebapp.js identify --cmd signup --env ${env} --body '{"f3Name":"${p.f3Name}","email":"${p.email}"}'`);
      const identify = await post(signupUrl, { action: 'identify', f3Name: p.f3Name, email: p.email });
      if (!identify?.ok) {
        console.error(`❌ Identify failed for ${p.f3Name}: ${identify?.error || 'unknown error'}`);
        process.exit(1);
      }
      if (identify.matched) {
        console.error(`❌ ${p.f3Name} unexpectedly already exists — smoke tracker is not clean.`);
        process.exit(1);
      }

      const save = await post(signupUrl, {
        action: 'save',
        f3Name: p.f3Name,
        email: p.email,
        // 'smoke' resolves straight to SMOKE_TRACKER_ID (see selectTargetMonth_,
        // signupWebapp.js) rather than 'current' — auto-generate always dates the smoke
        // tracker at *next* month's start (CreateNewTracker.js), so 'current' would resolve
        // to whatever the real production current-month tracker is instead, silently writing
        // this test PAX into it. Only the explicit 'smoke' selector is guaranteed correct
        // regardless of what date the smoke tracker landed on.
        targetMonth: 'smoke',
        teamType: p.teamType,
        team: p.team,
        who: 'Smoke test WHO',
        what: 'Smoke test WHAT',
        how: 'Smoke test HOW',
        phone: '',
        nag: false,
      });
      if (!save?.ok) {
        console.error(`❌ Save failed for ${p.f3Name}: ${save?.error || 'unknown error'}`);
        process.exit(1);
      }

      // Verify the round trip through PaxDB (same read path signup's own prefill uses) —
      // catches a team/teamType mismatch, not just a write failure.
      const verify = await post(signupUrl, { action: 'identify', f3Name: p.f3Name, email: p.email });
      if (!verify?.matched || verify.data.team !== p.team) {
        console.error(`❌ ${p.f3Name} team mismatch after save: expected "${p.team}", got "${verify?.data?.team}"`);
        process.exit(1);
      }
      console.log(`   ✓ ${p.f3Name} → ${p.team}`);
    }
    console.log(`   ✓ All ${pax.length} PAX signed up, team assignment verified for each`);

    // Step 6: Check in every PAX for today (tests the check-in write path across every team)
    console.log('');
    console.log(`6️⃣  Checking in all ${pax.length} PAX for today...`);
    for (const p of pax) {
      const identify = await post(checkinUrl, { action: 'identify', f3Name: p.f3Name, email: p.email, targetMonth: 'smoke' });
      if (!identify?.matched) {
        console.error(`❌ Check-in identify failed for ${p.f3Name}: ${identify?.error || 'not matched'}`);
        process.exit(1);
      }
      if (identify.team !== p.team) {
        console.error(`❌ ${p.f3Name} Tracker team mismatch: expected "${p.team}", got "${identify.team}"`);
        process.exit(1);
      }

      const checkin = await post(checkinUrl, { action: 'checkin', f3Name: p.f3Name, email: p.email, day: 'today', value: 1, targetMonth: 'smoke' });
      if (!checkin?.ok) {
        console.error(`❌ Check-in failed for ${p.f3Name}: ${checkin?.error || 'unknown error'}`);
        process.exit(1);
      }

      const verify = await post(checkinUrl, { action: 'identify', f3Name: p.f3Name, email: p.email, targetMonth: 'smoke' });
      if (verify.todayStatus !== 'done') {
        console.error(`❌ ${p.f3Name} todayStatus after check-in: expected "done", got "${verify.todayStatus}"`);
        process.exit(1);
      }
      console.log(`   ✓ ${p.f3Name} (${p.team}) checked in — today: done`);
    }
    console.log(`   ✓ All ${pax.length} PAX checked in for today`);

    // Step 7: One bonus entry of each type, spread across different recipients/teams
    console.log('');
    console.log('7️⃣  Adding one bonus entry of each type (EHing FNG, Fellowship, Q Point, Inspire)...');
    const bonuses = buildBonusPlan_(pax);
    const whenIso = todayIso_();
    for (const b of bonuses) {
      const add = await post(checkinUrl, {
        action: 'bonusAdd',
        f3Name: b.pax.f3Name,
        email: b.pax.email,
        type: b.type,
        whenIso: whenIso,
        message: b.message,
        link: b.link,
        targetMonth: 'smoke',
      });
      if (!add?.ok) {
        console.error(`❌ ${b.type} bonus add failed for ${b.pax.f3Name}: ${add?.error || 'unknown error'}`);
        process.exit(1);
      }

      const list = await post(checkinUrl, { action: 'bonusList', f3Name: b.pax.f3Name, email: b.pax.email, targetMonth: 'smoke' });
      const entry = list?.ok && (list.entries || []).find((en) => en.rowIndex === add.rowIndex);
      if (!entry || entry.type !== b.type || entry.message !== b.message) {
        console.error(`❌ ${b.type} bonus for ${b.pax.f3Name} did not read back correctly (row ${add.rowIndex})`);
        process.exit(1);
      }
      console.log(`   ✓ ${b.type} bonus recorded for ${b.pax.f3Name} (${b.pax.team}), row ${add.rowIndex}, complete=${entry.complete}`);
    }
    console.log('   ✓ All 4 bonus types recorded and read back correctly');

    // Step 8: Edit one of the just-added bonus entries in place (same month — the cross-month
    // relocation path (findBonusRowByIdentity_/handleBonusEdit_'s add-then-clear move) needs a
    // second, genuinely separate month this isolated single-tracker smoke run can't safely stand
    // up — see tools/README or the F3Go30 bonus row-relocation investigation for why. This at
    // least exercises editBonusEntry_'s live write path, which previously had zero live coverage
    // despite being the code that shipped the original "that entry no longer belongs to you" bug.
    console.log('');
    console.log('8️⃣  Editing one bonus entry (same month)...');
    const editTarget = bonuses[0]; // the EHing FNG entry for pax[0]
    const beforeEdit = await post(checkinUrl, { action: 'bonusList', f3Name: editTarget.pax.f3Name, email: editTarget.pax.email, targetMonth: 'smoke' });
    const originalEntry = beforeEdit?.ok && (beforeEdit.entries || []).find((en) => en.type === editTarget.type && en.message === editTarget.message);
    if (!originalEntry) {
      console.error(`❌ Could not find the ${editTarget.type} entry for ${editTarget.pax.f3Name} to edit`);
      process.exit(1);
    }
    const updatedMessage = editTarget.message + ' (edited)';
    const edit = await post(checkinUrl, {
      action: 'bonusEdit',
      f3Name: editTarget.pax.f3Name,
      email: editTarget.pax.email,
      rowIndex: originalEntry.rowIndex,
      type: originalEntry.type,
      whenIso: originalEntry.whenIso,
      message: updatedMessage,
      link: originalEntry.link,
      originalWhenIso: originalEntry.whenIso,
      original: { type: originalEntry.type, whenIso: originalEntry.whenIso, message: originalEntry.message, link: originalEntry.link },
      targetMonth: 'smoke',
    });
    if (!edit?.ok) {
      console.error(`❌ Bonus edit failed for ${editTarget.pax.f3Name}: ${edit?.error || 'unknown error'}`);
      process.exit(1);
    }
    const afterEdit = await post(checkinUrl, { action: 'bonusList', f3Name: editTarget.pax.f3Name, email: editTarget.pax.email, targetMonth: 'smoke' });
    const editedEntry = afterEdit?.ok && (afterEdit.entries || []).find((en) => en.rowIndex === originalEntry.rowIndex);
    if (!editedEntry || editedEntry.message !== updatedMessage) {
      console.error(`❌ Bonus edit for ${editTarget.pax.f3Name} did not read back correctly (row ${originalEntry.rowIndex})`);
      process.exit(1);
    }
    if ((afterEdit.entries || []).length !== 1) {
      console.error(`❌ ${editTarget.pax.f3Name} has ${afterEdit.entries.length} bonus entries after edit — expected exactly 1 (edit must not create a duplicate row)`);
      process.exit(1);
    }
    console.log(`   ✓ ${editTarget.type} bonus for ${editTarget.pax.f3Name} edited in place (row ${originalEntry.rowIndex}), message updated and read back correctly`);

    // Step 9: Dashboard/board view — previously never exercised live at all (resolveCheckin
    // IdentityFull_'s uncached full-roster read, and its new cache, had zero live verification).
    console.log('');
    console.log('9️⃣  Loading the dashboard/board view...');
    const dashPax = pax[0];
    const dashboard = await post(checkinUrl, { action: 'dashboard', f3Name: dashPax.f3Name, email: dashPax.email, targetMonth: 'smoke' });
    if (!dashboard?.ok) {
      console.error(`❌ Dashboard load failed for ${dashPax.f3Name}: ${dashboard?.error || 'unknown error'}`);
      process.exit(1);
    }
    if (dashboard.f3Name !== dashPax.f3Name || dashboard.team !== dashPax.team) {
      console.error(`❌ Dashboard identity mismatch: expected ${dashPax.f3Name}/${dashPax.team}, got ${dashboard.f3Name}/${dashboard.team}`);
      process.exit(1);
    }
    const boardTotal = (dashboard.paxBoard || []).reduce((sum, group) => sum + group.members.length, 0);
    if (boardTotal !== pax.length) {
      console.error(`❌ Dashboard paxBoard has ${boardTotal} PAX across all teams — expected ${pax.length}`);
      process.exit(1);
    }
    const myTeamNames = (dashboard.myTeam || []).map((m) => m.name).sort();
    const expectedTeamNames = pax.filter((p) => p.team === dashPax.team).map((p) => p.f3Name).sort();
    if (JSON.stringify(myTeamNames) !== JSON.stringify(expectedTeamNames)) {
      console.error(`❌ Dashboard myTeam mismatch: expected [${expectedTeamNames}], got [${myTeamNames}]`);
      process.exit(1);
    }
    console.log(`   ✓ Dashboard loaded for ${dashPax.f3Name}: ${boardTotal} PAX across ${dashboard.paxBoard.length} teams, myTeam has ${myTeamNames.length} of ${dashPax.team}`);

    // Step 9 (continued): pull Tracker + Bonus Tracker previews for the human review pause below
    console.log('');
    console.log('   Fetching Tracker and Bonus Tracker previews...');
    const trackerSheet = await callAdmin_('getSheet', { sheetId: trackerId, sheetName: 'Tracker' }, { env, settings });
    if (trackerSheet?.ok) {
      console.log('');
      console.log('Tracker sheet preview (TSV):');
      console.log('---');
      console.log(trackerSheet.csv);
      console.log('---');
    } else {
      console.error(`⚠️  Failed to fetch Tracker sheet preview: ${trackerSheet?.error || 'unknown error'}`);
    }
    const bonusSheet = await callAdmin_('getSheet', { sheetId: trackerId, sheetName: 'Bonus Tracker' }, { env, settings });
    if (bonusSheet?.ok) {
      console.log('');
      console.log('Bonus Tracker sheet preview (TSV):');
      console.log('---');
      console.log(bonusSheet.csv);
      console.log('---');
    } else {
      console.error(`⚠️  Failed to fetch Bonus Tracker sheet preview: ${bonusSheet?.error || 'unknown error'}`);
    }

    // Step 10: Human pause
    const url = spreadsheetUrl_(trackerId);
    await humanPause_(url, [
      `Tracker sheet: all 9 PAX present, 3 per team (${teamNames.join(', ')}), each showing today's check-in filled in.`,
      'Tracker sheet columns C–F (Fellowship/Q Point/Inspire/EHing FNG month-to-date totals): the one bonus each recipient PAX earned shows up as a nonzero total for that PAX\'s row.',
      'Bonus Tracker sheet: 4 rows, one per type, with columns B–E (Period/Uncapped Points/Multiplier/Complete — a spilled formula, not written by this script) computed correctly for each type\'s rules (EHing FNG x5 + link, Fellowship x1 no link, Q Point x1 + link, Inspire x1 + link), and the edited EHing FNG row shows the "(edited)" message.',
    ]);

    // Step 11: Cleanup
    console.log('');
    console.log('1️⃣1️⃣ Cleaning up tracker...');
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

    // Step 12: Clear properties
    console.log('');
    console.log('1️⃣2️⃣ Clearing smoke mode properties...');
    const clear = await callAdmin_(
      'setScriptProperties',
      { properties: { SMOKE_MODE: '', SMOKE_TRACKER_ID: '' } },
      { env, settings }
    );
    if (!clear?.ok) {
      throw new Error(`Failed to clear smoke properties: ${clear?.error || 'unknown error'}`);
    }
    console.log('   ✓ Properties cleared');

    // Step 13: Confirm clean
    console.log('');
    console.log('1️⃣3️⃣ Confirming clean state...');
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
