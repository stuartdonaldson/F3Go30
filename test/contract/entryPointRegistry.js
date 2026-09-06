/**
 * entryPointRegistry.js — the authoritative enumeration of this project's state-modifying entry
 * points (F3Go30-emwk.8; realizes H12, feeds the T17 half of the gap-diff; single-source per I6).
 *
 * WHAT THIS REPLACES. Until this file existed, the enumeration lived as prose in the project
 * `CLAUDE.md` §Web app calls and as a hand-authored table in
 * `docs/atdd/project-testing-guide.md` §7 — exactly the hand-maintained list H12 exists to
 * remove. Both are now *views* of this file, and `test/test_entry_point_registry_view.js` fails
 * loudly when §7's numbers disagree with the counts here. GActionSheet's own §7 view drifted
 * silently once (32/22 stated against an actual 37/13) before it was guarded; that is the failure
 * mode being anticipated here, not a hypothetical.
 *
 * SCOPE — state-modifying only, and the judgement is recorded, not hidden. A read-only route,
 * a page render or a menu item that only reports is NOT an entry point for T17, and every one of
 * them is enumerated in `ENTRY_POINT_READ_ONLY_EXEMPT` below with the reason. Putting the
 * exemptions in a machine-readable map rather than a prose comment is the point: an exemption is
 * a *claim* that something writes nothing, and a claim should be auditable.
 *
 * F3Go30-specific judgement (harness-design.md §9b): `script/WebApp.js` dispatches 26 `cmd=admin`
 * actions, and most of them are operator and test *tooling* rather than product surface. They are
 * registered anyway — they modify durable state, which is the criterion — and then deferred with
 * a reason, because "this is tooling" is an argument about priority, not about whether the entry
 * point exists. That keeps the enumeration honest and moves the argument into
 * `ENTRY_POINT_DEFERRED` where it can be read.
 *
 * DEFERRAL. `ENTRY_POINT_DEFERRED` names every registered entry point with no charter-journey
 * call-site today. Each carries a reason and a tracking bead, so the T17 diff is green **by
 * declaration** rather than by omission. Two kinds live there, labelled inline:
 *   • `[backlog]`  — a real gap; the bead converts it to a tagged call-site.
 *   • `[permanent]` — driving it inside a suite run is destructive or meaningless; the rationale
 *                     is the claim and it stays deferred.
 * Umbrella bead: F3Go30-y8j7, partitioned by call-site class into .1–.4.
 *
 * CLASSES. `ENTRY_POINT_CLASSES` maps each key to one of the six call-site classes named in
 * testing guide §7. The §7 table is computed against these; a new class here needs a new §7 row.
 *
 * ENUMERATION. `node test/contract/entryPointRegistry.js` prints one key per line; `--counts`
 * prints the per-class totals the §7 view states; `--json` prints the whole thing.
 */

'use strict';

/** The six call-site classes, in the order testing guide §7 lists them. */
const CLASS_CHECKIN = 'cmd=checkin doPost actions';
const CLASS_SIGNUP = 'cmd=signup doPost actions';
const CLASS_ADMIN = 'cmd=admin doPost actions';
const CLASS_ROUTES = 'doGet / doPost routes';
const CLASS_TRIGGERS = 'installable and simple triggers';
const CLASS_MENU = 'sheet menu items';

const ENTRY_POINT_CLASS_ORDER = [
  CLASS_CHECKIN,
  CLASS_SIGNUP,
  CLASS_ADMIN,
  CLASS_ROUTES,
  CLASS_TRIGGERS,
  CLASS_MENU,
];

/**
 * Every state-modifying entry point in the project, key → description.
 *
 * Key shape: `<class-prefix>.<action-or-function>` for routed actions, or the bare GAS function
 * name for triggers and menu items (which is what an operator actually types into the Apps Script
 * editor's run-function picker). Descriptions carry a `[category]` tag first, matching the
 * reference implementation's convention.
 */
const ENTRY_POINT_REGISTRY = {
  // ── cmd=checkin doPost actions (script/dashboardWebapp.js) ────────────────────────────────
  'checkin.identify':
    '[checkin] handleCheckinIdentify_ — resolves the PAX and, through resolveOrCreateCheckinSessionGuid_, creates or touches their CheckinSessions row. State-modifying despite the read-ish name',
  'checkin.checkin':
    '[checkin] handleCheckinSubmit_ — writes a day value into the tracker row and patches the PAX\'s cached row (the core daily write)',
  'checkin.bonusAdd':
    '[checkin] handleBonusAdd_ — appends a Bonus Tracker entry and credits its type\'s points for the period',
  'checkin.bonusEdit':
    '[checkin] handleBonusEdit_ — edits or clears an existing bonus entry, located by identity; includes the cross-month row-relocation path',
  'checkin.clientTelemetry':
    '[checkin] handleClientTelemetryPost_ — writes a client telemetry record to the log, deduped by the client-minted id',
  'checkin.siteFeedback':
    '[checkin] handleSiteFeedback_ — accepts a site-feedback report from the settings menu and dispatches the notification email',

  // ── cmd=signup doPost actions (script/WebApp.js → script/signupWebapp.js) ─────────────────
  'signup.identify':
    '[signup] handleSignupIdentify_ — matches on F3 name AND email (anti-enumeration) and resolves or creates the check-in session guid',
  'signup.save':
    '[signup] handleSignupSave_ — writes the PAX\'s team, goals and profile for the target month, mints the identity token and the personal check-in link',
  'signup.feedback':
    '[signup] handleSignupFeedback_ — accepts feedback from the signup surface',

  // ── cmd=admin doPost actions (script/WebApp.js) ───────────────────────────────────────────
  'admin.bootstrapSecret':
    '[admin] one-time write of the admin secret script property — the only admin action not itself secret-gated',
  'admin.setScriptProperties':
    '[admin] writes arbitrary script properties on the target script project',
  'admin.runAutoGenerate':
    '[admin] runs autoGenerateNextMonthTracker on demand — creates real-today\'s-month+1\'s tracker, spreadsheet, form and triggers',
  'admin.createTrackerForMonth':
    '[admin] creates a tracker for an explicitly named month (the backfill path for a month runAutoGenerate skipped)',
  'admin.cleanupTracker':
    '[admin] removes a tracker\'s TrackerDB and PaxDB rows and optionally trashes the spreadsheet and its linked HC Form',
  'admin.deleteOrphanedTriggers':
    '[admin] deletes project triggers whose target spreadsheet no longer exists',
  'admin.syncTrackerTriggers':
    '[admin] runs planTrackerTriggerSync_ and applies it — backfills edit triggers on active rows, cleans up aged-out ones',
  'admin.invalidateAllCache':
    '[admin] wipes PaxCache and the dashboard\'s full-roster cache keys, forcing a cold rebuild',
  'admin.setWebappUrl':
    '[admin] writes the WEBAPP_URL script property that every generated link resolves against',
  'admin.setContextDate':
    '[admin] persists a contextDate override into the ns-resolved Config sheet; refuses on PROD',
  'admin.setConfigValue':
    '[admin] writes an arbitrary Config sheet row (the generic form of setContextDate); refuses on PROD',
  'admin.resetCheckinSession':
    '[admin] clears a PAX\'s CheckinSessions row so the next identify mints a fresh guid',
  'admin.runScanTrackers':
    '[admin] rescans the tracker folder and upserts TrackerDB, preserving rows it did not scan',
  'admin.sortTracker':
    '[admin] re-sorts a tracker sheet\'s rows in place',
  'admin.runMinusOneCheck':
    '[admin] runs the markEmptyCellsAsMinusOne sweep on demand, writing -1 into elapsed blank cells',
  'admin.runNagCheck':
    '[admin] runs the nag sweep on demand, sending reminder email',
  'admin.runPaxCachePurge':
    '[admin] runs the stale-PaxCache purge on demand',
  'admin.benchmarkPropertiesService':
    '[admin] writes and reads throwaway script properties to time PropertiesService',
  'admin.copyTemplate':
    '[admin] provisions a namespace environment — copies the Template plus recent trackers and registers the NamespaceDB row (ADR-014 D6)',
  'admin.teardownEnvironment':
    '[admin] tears a namespace environment down — removes the NamespaceDB row first (the safety cut), then trashes the Drive folder',

  // ── routes (script/WebApp.js) ─────────────────────────────────────────────────────────────
  'route.doPost':
    '[route] doPost — the single front door: parses the body, gates cmd=admin on the secret, emits the client-version entry log without ever logging postData.contents, and dispatches to the three cmd handlers',

  // ── installable and simple triggers ───────────────────────────────────────────────────────
  handleTrackerEdit_:
    '[trigger] forSpreadsheet().onEdit() handler (TrackerEditTrigger.js) — updates the PAX row and cache on a genuine Sheets-UI edit. Never fires for API writes (ADR-013)',
  handleFormSubmit_:
    '[trigger] forSpreadsheet().onFormSubmit() handler (addResponseOnSubmit.js) — writes the Responses row and dispatches the settings/goal-reuse email; resolves its spreadsheet from the event\'s own range',
  autoGenerateNextMonthTracker:
    '[trigger] monthly time-based handler (CreateNewTracker.js) — creates next month\'s tracker and emails Site Q',
  markEmptyCellsAsMinusOne:
    '[trigger] daily time-based handler (markMinusOne.js) — writes -1 into elapsed blank tracker cells; dispatches via TrackerDB + openById, not the active spreadsheet (ADR-010)',
  sendNagEmail:
    '[trigger] daily time-based handler (nag.js) — sends the reminder email for the resolved tracker',
  purgeStalePaxCache:
    '[trigger] time-based handler (PaxCache.js) — deletes PaxCache entries past their age bound',
  cleanupStaleCheckinSessions:
    '[trigger] time-based handler (CheckinSessions.js) — removes expired CheckinSessions rows',

  // ── sheet menu items (script/onOpen.js; owner-only submenu) ───────────────────────────────
  copyAndInit:
    '[menu] "Copy and Initialize" — creates a new month\'s tracker spreadsheet, its linked form, short URL and triggers. Sends no email (the operator is present); that is autoGenerateNextMonthTracker\'s job',
  initializeTemplateDispatchTriggers:
    '[menu] "Initialize Nightly Triggers (Template only)" — installs the nightly dispatch triggers on the Template project',
  initializeMonthlyTrigger:
    '[menu] "Initialize Monthly Trigger" — installs the monthly auto-generate trigger',
  clearAllTriggers:
    '[menu] "Clear All Triggers" — deletes every trigger in the Apps Script project',
  invalidateCacheMenuAction:
    '[menu] "Invalidate Cache" — the menu twin of admin.invalidateAllCache',
  setContextDateMenuAction:
    '[menu] "Set Test Context Date..." — validates the entered date and writes the Config override; refuses on PROD before prompting',
};

/** Which call-site class each registered entry point belongs to. */
const ENTRY_POINT_CLASSES = {
  'checkin.identify': CLASS_CHECKIN,
  'checkin.checkin': CLASS_CHECKIN,
  'checkin.bonusAdd': CLASS_CHECKIN,
  'checkin.bonusEdit': CLASS_CHECKIN,
  'checkin.clientTelemetry': CLASS_CHECKIN,
  'checkin.siteFeedback': CLASS_CHECKIN,

  'signup.identify': CLASS_SIGNUP,
  'signup.save': CLASS_SIGNUP,
  'signup.feedback': CLASS_SIGNUP,

  'admin.bootstrapSecret': CLASS_ADMIN,
  'admin.setScriptProperties': CLASS_ADMIN,
  'admin.runAutoGenerate': CLASS_ADMIN,
  'admin.createTrackerForMonth': CLASS_ADMIN,
  'admin.cleanupTracker': CLASS_ADMIN,
  'admin.deleteOrphanedTriggers': CLASS_ADMIN,
  'admin.syncTrackerTriggers': CLASS_ADMIN,
  'admin.invalidateAllCache': CLASS_ADMIN,
  'admin.setWebappUrl': CLASS_ADMIN,
  'admin.setContextDate': CLASS_ADMIN,
  'admin.setConfigValue': CLASS_ADMIN,
  'admin.resetCheckinSession': CLASS_ADMIN,
  'admin.runScanTrackers': CLASS_ADMIN,
  'admin.sortTracker': CLASS_ADMIN,
  'admin.runMinusOneCheck': CLASS_ADMIN,
  'admin.runNagCheck': CLASS_ADMIN,
  'admin.runPaxCachePurge': CLASS_ADMIN,
  'admin.benchmarkPropertiesService': CLASS_ADMIN,
  'admin.copyTemplate': CLASS_ADMIN,
  'admin.teardownEnvironment': CLASS_ADMIN,

  'route.doPost': CLASS_ROUTES,

  handleTrackerEdit_: CLASS_TRIGGERS,
  handleFormSubmit_: CLASS_TRIGGERS,
  autoGenerateNextMonthTracker: CLASS_TRIGGERS,
  markEmptyCellsAsMinusOne: CLASS_TRIGGERS,
  sendNagEmail: CLASS_TRIGGERS,
  purgeStalePaxCache: CLASS_TRIGGERS,
  cleanupStaleCheckinSessions: CLASS_TRIGGERS,

  copyAndInit: CLASS_MENU,
  initializeTemplateDispatchTriggers: CLASS_MENU,
  initializeMonthlyTrigger: CLASS_MENU,
  clearAllTriggers: CLASS_MENU,
  invalidateCacheMenuAction: CLASS_MENU,
  setContextDateMenuAction: CLASS_MENU,
};

/**
 * Registered entry points with NO charter-journey call-site today, each with a reason and a
 * tracking bead. `[backlog]` converts; `[permanent]` does not. Umbrella: F3Go30-y8j7.
 */
const ENTRY_POINT_DEFERRED = {
  // F3Go30-y8j7.1 closed all five product-route deferrals: checkin.bonusAdd/bonusEdit are now
  // driven live by static-checkin.spec.js's settings-menu test (add then edit, through the real
  // UI); checkin.clientTelemetry is driven by checkin-advanced-grid.spec.js's telemetry-flush
  // test (upload + resend-dedupe, proving the end-to-end gap the old reason named); checkin.
  // siteFeedback was already driven by static-checkin.spec.js's settings-menu test (SIT's Email
  // Test Mode redirects delivery, so the assumed send-must-be-suppressed-first blocker did not
  // actually apply); signup.feedback turned out to carry no email side effect at all
  // (handleSignupFeedback_ only writes feedbackRating/feedbackComment onto the row on file) and
  // is now driven directly by static-signup.spec.js since the front end has no UI hook for it.

  // ── admin actions (F3Go30-y8j7.2) ─────────────────────────────────────────────────────────
  'admin.bootstrapSecret':
    '[permanent] one-time secret bootstrap; driving it mid-suite rewrites the admin secret every later call depends on — F3Go30-y8j7.2',
  'admin.setScriptProperties':
    '[permanent] writes arbitrary deployment-wide script properties; a run that drives it can leave the shared SIT deployment in a state no later spec expects — F3Go30-y8j7.2',
  'admin.runAutoGenerate':
    '[backlog] creates a real tracker, spreadsheet, form and triggers; currently blocked outright on SIT by the Apps Script per-script trigger quota (bd memory F3Go30-sit-trigger-quota-exceeded) — F3Go30-y8j7.2',
  'admin.createTrackerForMonth':
    '[backlog] driven only by an operator from the command line (tools/callWebapp.js, the backfill path for a skipped month). The charter join at F3Go30-emwk.9 found no journey drives it: copy-and-init.spec.js runs the copyAndInit MENU entry through the GAS editor, never this admin route, so the covered claim stage 3 authored for it was unearned. Same SIT trigger-quota block as runAutoGenerate — F3Go30-y8j7.2',
  'admin.cleanupTracker':
    '[backlog] exercised for real by tools/smokeTestNamespace.js\'s teardown; needs tagging there rather than a new call-site — F3Go30-y8j7.2',
  'admin.deleteOrphanedTriggers':
    '[permanent] deletes triggers project-wide on the shared deployment, outside any per-run sandbox — F3Go30-y8j7.2',
  'admin.syncTrackerTriggers':
    '[permanent] same shared-trigger-state objection as deleteOrphanedTriggers; the decision function planTrackerTriggerSync_ is fully node-tested, which is where the logic actually lives — F3Go30-y8j7.2',
  'admin.setWebappUrl':
    '[permanent] rewrites the URL every generated link resolves against for the whole deployment — F3Go30-y8j7.2',
  'admin.setContextDate':
    '[backlog] node-tested including its PROD refusal (test_set_context_date_admin.js); no live call-site asserts the stored value actually changes what a page resolves — F3Go30-y8j7.2',
  'admin.resetCheckinSession':
    '[backlog] no call-site; would pair naturally with a signup or check-in journey that needs a cold session — F3Go30-y8j7.2',
  'admin.runScanTrackers':
    '[backlog] exercised by tools/smokeTestNamespace.js provisioning; needs tagging there — F3Go30-y8j7.2',
  'admin.sortTracker':
    '[backlog] no call-site and no node test; a genuine gap, low blast radius — F3Go30-y8j7.2',
  'admin.runMinusOneCheck':
    '[backlog] the sweep\'s dispatch and cell logic are node-tested (test_mark_minus_one.js); the live wiring is not — F3Go30-y8j7.2',
  'admin.runNagCheck':
    '[permanent] sends real reminder email to real PAX from whichever environment runs it; not drivable in a suite without an email sink — F3Go30-y8j7.2',
  'admin.runPaxCachePurge':
    '[backlog] no call-site; the purge bound is node-tested — F3Go30-y8j7.2',
  'admin.benchmarkPropertiesService':
    '[permanent] a performance probe that asserts nothing; a tagged call-site would record coverage of a measurement, not a behaviour — F3Go30-y8j7.2',
  'admin.copyTemplate':
    '[backlog] tools/smokeTestNamespace.js provisions through it every run; needs tagging there — F3Go30-y8j7.2',
  'admin.teardownEnvironment':
    '[backlog] same — the teardown half of the same tool — F3Go30-y8j7.2',

  // ── triggers (F3Go30-y8j7.3) ──────────────────────────────────────────────────────────────
  handleFormSubmit_:
    '[backlog] handler logic is node-tested (test_form_submit_dispatch.js, test_add_response_on_submit.js); nothing proves the installed trigger fires against a real Form submission — F3Go30-y8j7.3',
  autoGenerateNextMonthTracker:
    '[backlog] same body as admin.runAutoGenerate, reached from the monthly trigger; blocked on the SIT trigger quota — F3Go30-y8j7.3',
  markEmptyCellsAsMinusOne:
    '[backlog] node-tested including the TrackerDB dispatch (ADR-010); no live call-site — F3Go30-y8j7.3',
  sendNagEmail:
    '[permanent] the trigger form of runNagCheck — sends real email; same objection — F3Go30-y8j7.3',
  purgeStalePaxCache:
    '[backlog] no live call-site; the age bound is node-tested — F3Go30-y8j7.3',
  cleanupStaleCheckinSessions:
    '[backlog] no live call-site; the expiry decision is node-tested (test_checkin_sessions.js) — F3Go30-y8j7.3',

  // ── menu items (F3Go30-y8j7.4) ────────────────────────────────────────────────────────────
  initializeTemplateDispatchTriggers:
    '[permanent] installs deployment-wide triggers; driving it mid-suite mutates shared trigger state, and the SIT project is already at its trigger quota — F3Go30-y8j7.4',
  initializeMonthlyTrigger:
    '[permanent] same shared-trigger-state objection — F3Go30-y8j7.4',
  clearAllTriggers:
    '[permanent] deletes every trigger in the project; running it would break every subsequent trigger-dependent behaviour on that deployment — F3Go30-y8j7.4',
  invalidateCacheMenuAction:
    '[backlog] the menu twin of admin.invalidateAllCache, which pax-history-reload-live-check.spec.js does cover through the admin route; the menu wrapper itself is undriven and is reachable from the same GAS-editor harness copy-and-init uses — F3Go30-y8j7.4',
  setContextDateMenuAction:
    '[backlog] validator and PROD guard are node-tested (test_onopen_context_date_menu.js); the menu wiring is not — F3Go30-y8j7.4',
};

/**
 * Entry points deliberately NOT registered, because they modify no durable state. An entry here
 * is a *claim* that a call-site is read-only; the reason is the justification for that claim.
 * Kept machine-readable so the exemption is auditable (I6) rather than living in prose nothing
 * reads. Adding a route here that in fact writes is the failure this map makes visible.
 */
const ENTRY_POINT_READ_ONLY_EXEMPT = {
  'checkin.dashboard': 'handleCheckinDashboard_ — renders the dashboard payload; reads only',
  'checkin.paxGoals': 'handlePaxGoals_ — returns the PAX\'s stored goals; reads only',
  'checkin.monthGrid': 'handleMonthGrid_ — returns a whole-month grid; reads only',
  'checkin.bonusList': 'handleBonusList_ — lists bonus entries for a month; reads only',
  'admin.listTriggers': 'enumerates project triggers; reads only',
  'admin.getConfigValue': 'reads one Config row back (the read half of setConfigValue)',
  'admin.listSheets': 'enumerates sheets in the resolved spreadsheet; reads only',
  'admin.getSheet': 'returns a sheet\'s values; reads only',
  'admin.getSheetHeaders': 'returns a sheet\'s header row; reads only',
  'admin.getSheetFormulas': 'returns a sheet\'s formulas; reads only',
  'route.doGet.version':
    'cmd=version — returns the stamped build identity with no secret (gas-deploy RECOMMENDATION §3.2); reads only',
  'route.doGet.signup': 'cmd=signup page render / static redirect; writes nothing',
  'route.doGet.checkin': 'cmd=checkin page render / static redirect; writes nothing',
  'route.doGet.home': 'the no-cmd landing page; writes nothing',
  onOpen:
    'simple trigger — builds the F3 Go30 menu and writes one activity-log line. No product state; the menu items it registers ARE registered above',
  showAbout: 'menu item — displays the About dialog; writes nothing',
};

/** Per-class counts, plus the totals testing guide §7 and harness-design.md §9b state. */
function registryCounts() {
  const byClass = {};
  for (const className of ENTRY_POINT_CLASS_ORDER) {
    byClass[className] = { total: 0, deferred: 0, covered: 0 };
  }
  for (const key of Object.keys(ENTRY_POINT_REGISTRY)) {
    const className = ENTRY_POINT_CLASSES[key];
    const bucket = byClass[className];
    bucket.total += 1;
    if (Object.prototype.hasOwnProperty.call(ENTRY_POINT_DEFERRED, key)) bucket.deferred += 1;
  }
  for (const className of ENTRY_POINT_CLASS_ORDER) {
    byClass[className].covered = byClass[className].total - byClass[className].deferred;
  }
  const total = Object.keys(ENTRY_POINT_REGISTRY).length;
  const deferred = Object.keys(ENTRY_POINT_DEFERRED).length;
  return { byClass, total, deferred, covered: total - deferred };
}

/**
 * Structural self-checks. Throw rather than return a verdict, so a violation cannot be logged
 * and ignored. Called by test/test_entry_point_registry_view.js.
 */
function assertRegistryWellFormed() {
  const problems = [];

  for (const key of Object.keys(ENTRY_POINT_REGISTRY)) {
    if (!ENTRY_POINT_CLASSES[key]) problems.push(`${key}: registered but has no call-site class`);
    else if (!ENTRY_POINT_CLASS_ORDER.includes(ENTRY_POINT_CLASSES[key])) {
      problems.push(`${key}: class "${ENTRY_POINT_CLASSES[key]}" is not one of the six declared classes`);
    }
  }
  for (const key of Object.keys(ENTRY_POINT_CLASSES)) {
    if (!ENTRY_POINT_REGISTRY[key]) problems.push(`${key}: has a class but is not in the registry`);
  }
  for (const [key, reason] of Object.entries(ENTRY_POINT_DEFERRED)) {
    if (!ENTRY_POINT_REGISTRY[key]) {
      problems.push(`${key}: deferred but not registered — a deferral must name a real entry point`);
    }
    if (!/F3Go30-[a-z0-9]+(\.\d+)?/.test(reason)) {
      problems.push(`${key}: deferral carries no tracking bead id`);
    }
    if (!/^\[(backlog|permanent)\]/.test(reason)) {
      problems.push(`${key}: deferral must open with [backlog] or [permanent]`);
    }
  }
  for (const key of Object.keys(ENTRY_POINT_READ_ONLY_EXEMPT)) {
    if (ENTRY_POINT_REGISTRY[key]) {
      problems.push(`${key}: claimed read-only AND registered as state-modifying — pick one`);
    }
  }

  if (problems.length) {
    throw new Error('entry-point registry is malformed:\n  - ' + problems.join('\n  - '));
  }
}

module.exports = {
  ENTRY_POINT_REGISTRY,
  ENTRY_POINT_DEFERRED,
  ENTRY_POINT_CLASSES,
  ENTRY_POINT_CLASS_ORDER,
  ENTRY_POINT_READ_ONLY_EXEMPT,
  CLASS_CHECKIN,
  CLASS_SIGNUP,
  CLASS_ADMIN,
  CLASS_ROUTES,
  CLASS_TRIGGERS,
  CLASS_MENU,
  registryCounts,
  assertRegistryWellFormed,
};

if (require.main === module) {
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(registryCounts(), null, 2) + '\n');
  } else if (process.argv.includes('--counts')) {
    const counts = registryCounts();
    for (const className of ENTRY_POINT_CLASS_ORDER) {
      const c = counts.byClass[className];
      process.stdout.write(`${className}\t${c.total}\t${c.covered}\t${c.deferred}\n`);
    }
    process.stdout.write(`TOTAL\t${counts.total}\t${counts.covered}\t${counts.deferred}\n`);
  } else {
    process.stdout.write(Object.keys(ENTRY_POINT_REGISTRY).sort().join('\n') + '\n');
  }
}
