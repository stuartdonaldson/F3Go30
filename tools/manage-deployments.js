#!/usr/bin/env node
/**
 * F3Go30 Deployment Manager
 *
 * Run via npm scripts:
 *   npm run push            # bump patch, reset build + stamp TEMPLATE + clasp push -f to template scriptId
 *   npm run deploy:test     # bump build only          + stamp TEST     + clasp push -f to test scriptId
 *
 * package.json carries two counters: "version" (semver, PROD-facing) and "build" (a plain
 * integer, SIT-facing). A test (SIT) deploy leaves "version" untouched and bumps "build"
 * instead (unless --skip-bump), so repeated SIT deploys between PROD releases don't burn
 * through patch numbers; the SIT-stamped APP_VERSION is `${version}.${build}` (e.g. "2.3.13.7"),
 * so each SIT push is still uniquely identifiable. A template (PROD) deploy bumps the patch
 * segment of "version" (unless --skip-bump) and *always* resets "build" back to 0 — even under
 * --skip-bump — since shipping to PROD closes out the SIT cycle for whatever version is being
 * released; PROD only ever sees the bare patch version, never a build suffix.
 *
 * Direct invocation:
 *   node tools/manage-deployments.js --deploy-template
 *   node tools/manage-deployments.js --deploy-test
 *   node tools/manage-deployments.js --summary --env sit|prod   # read-only: no push, no deploy
 *
 * Prerequisites:
 *   - local.settings.json at project root with templateScriptId/templateSpreadsheetId and
 *     testScriptId/testSpreadsheetId populated. No deployment ID fields needed — each script
 *     project must carry exactly one active named deployment, looked up fresh via
 *     `clasp deployments` on every deploy (see findActiveDeploymentId_).
 *   - clasp authenticated (clasp login)
 *   - @inquirer/prompts installed (npm install)
 */

const { execSync }  = require('child_process');
const fs            = require('fs');
const os            = require('os');
const path          = require('path');
const { staticEntryUrl } = require('./static-urls.js');
// Reuse the one HTTP client (RECOMMENDATION.md §3.3) rather than building a second — the same
// POST→GET-redirect-following, secret-free `post()` callWebapp.js already uses to talk to the
// webapp is what assertDeployedVersion_ polls with below.
const { post: postWebapp_ } = require('./callWebapp.js');

const ROOT          = path.join(__dirname, '..');
const SETTINGS_PATH = path.join(ROOT, 'local.settings.json');
const CLASP_PATH    = path.join(ROOT, '.clasp.json');
const VERSION_PATH  = path.join(ROOT, 'script', 'version.js');
const PKG_PATH      = path.join(ROOT, 'package.json');

// clasp reads its credential file from the `clasp_config_auth` env var (lower-case, exact
// match — see @google/clasp's commands/program.js: `new Option('-A, --auth <file>', ...)
// .env('clasp_config_auth')`). CLASP_CONFIG is not a real clasp variable; setting it is a no-op
// that silently falls back to the default ~/.clasprc.json.
function expandHome_(p) {
  return p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

function resolveClaspAuthPath_(settings) {
  const claspAuth = settings.claspAuth;
  if (!claspAuth) {
    console.error('❌  claspAuth is not set in local.settings.json');
    process.exit(1);
  }
  return expandHome_(claspAuth);
}

// monthScriptId/monthSpreadsheetId are retired (ADR-010, F3Go30-shsx) — no separate script
// project for the live month tracker exists anymore, so there is no third TARGETS entry for it.
// The settings keys are left in local.settings.json/its .example as historical residue; see
// docs/deployment-model.md.
const TARGETS = {
  template: { scriptIdKey: 'templateScriptId', label: 'TEMPLATE', emoji: '📋', deploymentIdKey: 'templateDeploymentId', sheetIdKey: 'templateSpreadsheetId', staticEnv: 'prod' },
  test:     { scriptIdKey: 'testScriptId',     label: 'TEST',     emoji: '🧪',  deploymentIdKey: 'testDeploymentId',     sheetIdKey: 'testSpreadsheetId',     staticEnv: 'sit'  },
};

// --summary --env <sit|prod> maps the public env names onto the internal target keys above.
const ENV_TO_TARGET = { sit: 'test', prod: 'template' };

// ─────────────────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────────────────

function loadSettings() {
  if (!fs.existsSync(SETTINGS_PATH)) {
    console.error(`❌  local.settings.json not found at ${SETTINGS_PATH}`);
    console.error('    Copy local.settings.json.example and populate the ID fields.');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
}

// ─────────────────────────────────────────────────────────────────────────
// .clasp.json
// ─────────────────────────────────────────────────────────────────────────

function writeClasp(scriptId) {
  fs.writeFileSync(CLASP_PATH, JSON.stringify({ scriptId, rootDir: 'script' }, null, 2) + '\n', 'utf8');
}

// ─────────────────────────────────────────────────────────────────────────
// version.js stamping
// ─────────────────────────────────────────────────────────────────────────

function stampVersion(label, options = {}) {
  const pkgPath = options.pkgPath || PKG_PATH;
  const versionPath = options.versionPath || VERSION_PATH;
  const now = options.now || new Date().toISOString();

  const pkg     = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  // versionOverride lets callers stamp a display string that differs from the bare
  // package.json "version" — e.g. deploy()'s SIT path appends ".<build>".
  const version = options.versionOverride || pkg.version || '0.0.0';

  let src = fs.readFileSync(versionPath, 'utf8');

  src = replaceConst(src, 'APP_VERSION',      `'${version}'`);
  src = replaceConst(src, 'APP_VERSION_DATE', `'${now}'`);
  src = replaceConst(src, 'APP_DEPLOY_TARGET', `'${label}'`);

  fs.writeFileSync(versionPath, src, 'utf8');
  console.log(`📝 version.js stamped: v${version}  ${now}  ${label}`);

  return { version, now, label };
}

/**
 * Increments the patch segment of package.json's semver "version" field and writes it back.
 * Called by deploy()'s template (PROD) path only (unless --skip-bump) — see bumpBuildNumber_
 * for the SIT-side counter, which this does not touch.
 */
function bumpPatchVersion_(pkgPath) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const parts = String(pkg.version || '0.0.0').split('.');
  const patch = (parseInt(parts[2], 10) || 0) + 1;
  const newVersion = `${parts[0]}.${parts[1]}.${patch}`;

  pkg.version = newVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

  return newVersion;
}

/**
 * Increments package.json's "build" field (a plain integer, not part of semver "version") and
 * writes it back. Called by deploy()'s test (SIT) path only (unless --skip-bump) — this is what
 * lets repeated SIT deploys get unique, traceable APP_VERSION stamps (`${version}.${build}`)
 * without burning through the PROD-facing patch counter on every SIT push.
 */
function bumpBuildNumber_(pkgPath) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const build = (parseInt(pkg.build, 10) || 0) + 1;

  pkg.build = build;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

  return build;
}

/**
 * Resets package.json's "build" counter to 0. Called unconditionally (even under --skip-bump)
 * by deploy()'s template (PROD) path — shipping to PROD closes out the SIT cycle for whatever
 * version is being released, so the next SIT deploy after a PROD release starts back at
 * "<version>.1" instead of continuing an old count.
 */
function resetBuildNumber_(pkgPath) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.build = 0;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
}

/**
 * Replace the value of a `const NAME = <value>;` line.
 * If the const doesn't exist, it is appended before the trailing blank line/EOF.
 */
function replaceConst(src, name, value) {
  const re = new RegExp(`^(const ${name}\\s*=\\s*)([^;]+)(;)`, 'm');
  if (re.test(src)) {
    return src.replace(re, `$1${value}$3`);
  }
  // Append before trailing newline
  return src.trimEnd() + `\nconst ${name.padEnd(18)} = ${value};\n`;
}

// ─────────────────────────────────────────────────────────────────────────
// Named deployment lookup
// ─────────────────────────────────────────────────────────────────────────

/**
 * Parses `clasp deployments` output into `{ id, revision }` entries, skipping the @HEAD
 * test-deployment entry clasp always lists. A line looks like:
 *   - AKfycbzwlKLu...UZA @269 - v2.5.0.9 GO30-APP
 */
function parseDeploymentsOutput_(output) {
  return output
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('-') && !line.includes('@HEAD'))
    .map(line => {
      const match = line.match(/^-\s*(\S+)\s+@(\d+)/);
      return match ? { id: match[1], revision: match[2], raw: line } : { id: null, revision: null, raw: line };
    });
}

/**
 * Each script project (template, test) is expected to carry exactly one active named
 * deployment (excluding the @HEAD test-deployment entry clasp always lists). Rather than
 * storing its ID in local.settings.json (which goes stale the moment a deployment is
 * recreated), look it up fresh from `clasp deployments` every time — it must be run after
 * .clasp.json has been written for the target scriptId.
 */
function findActiveDeploymentId_(claspEnv) {
  const output = execSync('clasp deployments', { cwd: ROOT, env: claspEnv }).toString();
  const deployments = parseDeploymentsOutput_(output);

  if (deployments.length === 0) {
    throw new Error('No active (non-@HEAD) deployment found — create one via the script editor first.');
  }
  if (deployments.length > 1) {
    throw new Error(`Expected exactly one active deployment, found ${deployments.length}:\n${deployments.map(d => d.raw).join('\n')}`);
  }
  if (!deployments[0].id) {
    throw new Error(`Could not parse deployment ID from: ${deployments[0].raw}`);
  }
  return deployments[0].id;
}

/**
 * Revision resolution (RECOMMENDATION.md §3.1): `clasp deploy`'s own stdout is parsed first for
 * the revision it just created; if that misses (a clasp output-format change, a swallowed
 * newline, etc.), `listDeployments` (a `clasp deployments` re-run, injected so this is testable
 * without a real clasp call) is consulted and the revision read back off the matching row.
 * Returns null — printed as "(unresolved)" by printDeploySummary_ — only if both miss.
 */
function resolveRevision_(deployStdout, deploymentId, listDeployments) {
  const match = (deployStdout || '').match(/@(\d+)\b/);
  if (match) return match[1];

  const found = parseDeploymentsOutput_(listDeployments()).find(d => d.id === deploymentId);
  return found ? found.revision : null;
}

// ─────────────────────────────────────────────────────────────────────────
// Deploy verification (RECOMMENDATION.md §3.2 — assert the version actually serving)
// ─────────────────────────────────────────────────────────────────────────

function sleep_(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

/**
 * Polls the deployment's cmd=version route (script/WebApp.js's handleVersionRequest_) until it
 * reports the exact version *and* target just stamped, or the timeout expires. This is what
 * turns "clasp deploy exited 0" into "the webapp is actually serving what we just pushed" — the
 * gap RECOMMENDATION.md §3.2 identifies as #13: a deployment silently converted to a library, an
 * edge that hasn't propagated, or a named deployment left pointing at an older version would all
 * report success under the old exit-code-only check.
 *
 * Dependency-injected (postFn/sleep) so the match/mismatch/timeout paths are unit-testable
 * without a real network call — see test/test_assert_deployed_version.js. Reuses
 * tools/callWebapp.js's post() (§3.3) rather than a second HTTP client.
 */
async function assertDeployedVersion_(deploymentId, expectedVersion, expectedTarget, options = {}) {
  const { postFn = postWebapp_, intervalSec = 5, timeoutSec = 60, sleep = sleep_, log = () => {} } = options;
  const url = `https://script.google.com/macros/s/${deploymentId}/exec?cmd=version`;
  const startedAt = Date.now();
  let attempt = 0;
  let lastResult = null;

  for (;;) {
    attempt++;
    try {
      lastResult = await postFn(url, { action: 'version' });
    } catch (err) {
      log(`  attempt ${attempt}: request failed (${err.message})`);
      lastResult = null;
    }

    if (lastResult && lastResult.ok && lastResult.version === expectedVersion && lastResult.target === expectedTarget) {
      return { ok: true, attempts: attempt, version: lastResult.version, target: lastResult.target, deploymentId: lastResult.deploymentId };
    }

    const seen = lastResult && typeof lastResult === 'object'
      ? `version=${lastResult.version || '(none)'} target=${lastResult.target || '(none)'}`
      : '(no response)';
    log(`  attempt ${attempt}: expected version=${expectedVersion} target=${expectedTarget}, got ${seen}`);

    if (Date.now() - startedAt + intervalSec * 1000 > timeoutSec * 1000) {
      throw new Error(
        `assertDeployedVersion_ timed out after ${attempt} attempts (${timeoutSec}s): ` +
        `expected version=${expectedVersion} target=${expectedTarget}, last seen ${seen}`
      );
    }
    await sleep(intervalSec * 1000);
  }
}

/**
 * Single, non-polling cmd=version query for --summary (RECOMMENDATION.md §3.2 work item 5):
 * "what is deployed right now?" doesn't need to poll for propagation — nothing was just
 * deployed — it just needs one honest read of the live state, or a clear "(unreachable)" if the
 * webapp can't be reached at all.
 */
async function queryLiveVersion_(deploymentId, options = {}) {
  const { postFn = postWebapp_ } = options;
  const url = `https://script.google.com/macros/s/${deploymentId}/exec?cmd=version`;
  try {
    const result = await postFn(url, { action: 'version' });
    if (result && result.ok) return { version: result.version, target: result.target };
  } catch {
    // fall through to null below
  }
  return null;
}

// A freshly created/updated Apps Script deployment can take a few seconds to propagate on
// Google's edge, so the very next HTTPS call against it may 404/error transiently.
function execSyncWithRetry_(command, options, { attempts = 3, delayMs = 5000 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return execSync(command, options);
    } catch (err) {
      if (attempt === attempts) throw err;
      console.log(
        `\n⚠️  Command failed (attempt ${attempt}/${attempts}), retrying in ${delayMs / 1000}s…`
      );
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
    }
  }
}

function saveDeploymentId_(targetKey, deploymentId) {
  const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  settings[TARGETS[targetKey].deploymentIdKey] = deploymentId;
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

// ─────────────────────────────────────────────────────────────────────────
// Deploy summary (RECOMMENDATION.md §3.1 — the standard deploy summary)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Prints the standard eight-row post-deploy summary. The deployment ID is always printed in
 * full — never truncated — because it has to be pasteable straight into tools/callWebapp.js or a
 * bug report. Rows whose input is absent print an explanatory placeholder, never a broken URL.
 */
function printDeploySummary_(targetKey, { version, now, deploymentId, revision, scriptId, settings }) {
  const { label, emoji, staticEnv, sheetIdKey } = TARGETS[targetKey];
  const sheetId = settings[sheetIdKey];

  const scriptProjectLine = scriptId
    ? `${scriptId.slice(0, 12)}…   https://script.google.com/home/projects/${scriptId}/edit`
    : '(scriptId not set in local.settings.json)';
  const webappLine = deploymentId
    ? `https://script.google.com/macros/s/${deploymentId}/exec`
    : '(deployment ID unavailable)';
  const staticLine = staticEnv
    ? staticEntryUrl(staticEnv)
    : '(static hosting not configured for this target)';
  const spreadsheetLine = sheetId
    ? `https://docs.google.com/spreadsheets/d/${sheetId}/edit`
    : `(${sheetIdKey} not set in local.settings.json)`;

  console.log(`\n${emoji}  ${label} deploy summary`);
  console.log(`   Product version: v${version}`);
  console.log(`   Stamped at:      ${now}`);
  console.log(`   Deployment ID:   ${deploymentId || '(unavailable)'}`);
  console.log(`   Revision:        ${revision ? '@' + revision : '(unresolved)'}`);
  console.log(`   Script project:  ${scriptProjectLine}`);
  console.log(`   Webapp:          ${webappLine}`);
  console.log(`   Static page:     ${staticLine}`);
  console.log(`   Spreadsheet:     ${spreadsheetLine}\n`);
}

// ─────────────────────────────────────────────────────────────────────────
// Deploy
// ─────────────────────────────────────────────────────────────────────────

async function deploy(targetKey, options = {}) {
  const { scriptIdKey, label, emoji } = TARGETS[targetKey];
  const settings = loadSettings();
  const scriptId = settings[scriptIdKey];

  if (!scriptId || scriptId.startsWith('<')) {
    console.error(`❌  ${scriptIdKey} is not set in local.settings.json`);
    process.exit(1);
  }

  const claspAuthPath = resolveClaspAuthPath_(settings);
  const claspEnv = { ...process.env, clasp_config_auth: claspAuthPath };

  console.log(`\n${emoji}  Deploying to ${label} (${scriptId.slice(0, 12)}…)\n`);

  writeClasp(scriptId);
  console.log(`✅ .clasp.json written (rootDir: script, scriptId: ${scriptId.slice(0, 12)}…)`);

  // TEST (SIT) bumps the build counter and leaves "version" alone; TEMPLATE (PROD) bumps the
  // patch version and always resets build to 0 — see bumpBuildNumber_/resetBuildNumber_/
  // bumpPatchVersion_ above for why these are split.
  let version;
  if (targetKey === 'test') {
    if (!options.skipBump) {
      const build = bumpBuildNumber_(PKG_PATH);
      console.log(`🔢 build number bumped to ${build}`);
    }
    const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
    version = `${pkg.version}.${pkg.build || 0}`;
  } else {
    if (!options.skipBump) {
      const bumped = bumpPatchVersion_(PKG_PATH);
      console.log(`🔢 package.json version bumped to v${bumped}`);
    }
    resetBuildNumber_(PKG_PATH);
    console.log('🔢 build counter reset to 0');
    version = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8')).version;
  }

  const { now } = stampVersion(label, { versionOverride: version });

  // Regenerate the "How it Works" panels/static page from docs/Go30-Intro.md (F3Go30-e3co) so
  // any edit to the canonical source lands on every deploy without a manual sync step.
  execSync('node tools/sync-how-it-works.js', { stdio: 'inherit', cwd: ROOT });

  console.log(`\n🚀 Running: clasp push -f  (clasp_config_auth=${claspAuthPath})\n`);
  execSync('clasp push -f', {
    stdio: 'inherit',
    cwd: ROOT,
    env: claspEnv,
  });

  console.log(`\n✅ ${label} push complete.`);

  console.log(`\n🔎 Looking up active deployment for ${label}…\n`);
  const deploymentId = findActiveDeploymentId_(claspEnv);
  console.log(`\n🌐 Updating named deployment ${deploymentId.slice(0, 12)}…\n`);
  // Captured (not 'inherit') so the revision number clasp reports (e.g. "...@269.") can be
  // parsed out for the deploy summary below; still echoed to stdout so nothing is lost.
  const deployOutput = execSync(
    `clasp deploy --deploymentId ${deploymentId} --description "v${version} GO30-APP"`,
    { cwd: ROOT, env: claspEnv }
  ).toString();
  process.stdout.write(deployOutput);
  const revision = resolveRevision_(deployOutput, deploymentId, () =>
    execSync('clasp deployments', { cwd: ROOT, env: claspEnv }).toString()
  );
  console.log(`\n✅ ${label} named deployment updated.`);

  saveDeploymentId_(targetKey, deploymentId);
  console.log(`💾 ${TARGETS[targetKey].deploymentIdKey} saved to local.settings.json`);

  // Clears PaxCache (PropertiesService) plus the Tracker/Responses layout + full-roster
  // CacheService blobs for every active tracker on this target, so code just pushed here that
  // changed cache shape/serialization can never leave a stale/incompatible entry behind for the
  // next request to trip over (F3Go30-x2vd was exactly this: a fix landed on PROD without this
  // step, and the wipe had to be run by hand afterward). Must run after the deploy above, not
  // before — wiping first just lets the still-live old code repopulate a stale entry.
  const invalidateEnv = targetKey === 'template' ? 'prod' : 'sit';
  console.log(`\n🧹 Invalidating PaxCache/layout caches on ${label}…`);
  execSyncWithRetry_(`node tools/callWebapp.js invalidateAllCache --env ${invalidateEnv}`, {
    stdio: 'inherit',
    cwd: ROOT,
  });

  // Bounds per-tracker onEdit/form-submit trigger growth to the previous/current/next-month
  // window on every deploy (F3Go30 2026-08-20 SIT quota incident — nothing previously ran this
  // sweep except on-demand, so leaked/out-of-window triggers accumulated toward the
  // 20-triggers/user/script Apps Script quota unnoticed). See TrackerTriggerLifecycle.js.
  console.log(`\n🧹 Syncing tracker onEdit/form-submit triggers on ${label}…`);
  execSyncWithRetry_(`node tools/callWebapp.js syncTrackerTriggers --env ${invalidateEnv}`, {
    stdio: 'inherit',
    cwd: ROOT,
  });

  if (targetKey === 'template') {
    console.log('\n🔗 Setting WEBAPP_URL script property on PROD…');
    execSyncWithRetry_('node tools/callWebapp.js setWebappUrl --env prod', {
      stdio: 'inherit',
      cwd: ROOT,
    });
  }

  // The static check-in front end (static-pages/) shares this same package.json version/build
  // counter (build-static-pages.js's versionStringFor) — publish it as part of the same
  // deploy rather than as a separate step, so the two spaces never drift out of sync (a
  // static-only publish that skipped this would either reuse a stale build stamp or need its
  // own bump of the same counter, double-counting against the next real deploy). --skip-bump
  // here because deploy() already bumped/reset the counter above; publishStaticPages_ just
  // builds+publishes whatever package.json now says. test (SIT) publishes the sit/ bundle only;
  // template (PROD) publishes the prod/ bundle only — matches which script project was pushed.
  const staticEnv = targetKey === 'template' ? 'prod' : 'sit';
  console.log(`\n📄 Publishing static pages (${staticEnv})…\n`);
  execSync(
    `node ${path.join(__dirname, 'publish-static-pages.js')} --env ${staticEnv} --skip-bump`,
    { stdio: 'inherit', cwd: ROOT }
  );

  // Deploy verification (RECOMMENDATION.md §3.2) — the mandatory last step before the summary.
  // Polls cmd=version until the webapp itself confirms it is serving the version *and* target
  // just stamped; the target check is what catches deploying to the wrong environment, which no
  // prior version of this script could detect. On mismatch the deploy fails loudly (non-zero
  // exit, expected-vs-actual) but still prints the summary so the operator can see what *is*
  // deployed.
  console.log(`\n🔍 Verifying ${label} is actually serving v${version}…`);
  let verified;
  try {
    verified = await assertDeployedVersion_(deploymentId, version, label, { log: console.log });
    console.log(`✅ ${label} verified — serving v${verified.version} (target ${verified.target})`);
  } catch (err) {
    console.error(`\n❌ Deploy verification failed: ${err.message}`);
    printDeploySummary_(targetKey, { version, now, deploymentId, revision, scriptId, settings });
    process.exitCode = 1;
    return;
  }

  // Report what the server confirmed, not what was stamped locally (RECOMMENDATION.md §3.2's
  // closing rule: "the verified version ... feed[s] the summary").
  printDeploySummary_(targetKey, { version: verified.version, now, deploymentId, revision, scriptId, settings });
}

// ─────────────────────────────────────────────────────────────────────────
// Summary (read-only — no push, no clasp deploy, no post-deploy hooks)
// ─────────────────────────────────────────────────────────────────────────

/** `--summary --env <sit|prod>`: answers "what is deployed right now?" without deploying
 * anything. Still needs .clasp.json pointed at the target scriptId to run `clasp deployments`,
 * and still resolves the revision via the same stdout-then-fallback strategy deploy() uses
 * (there being no `clasp deploy` stdout to parse here, it goes straight to the fallback). */
async function summary(targetKey) {
  const { scriptIdKey, label, emoji } = TARGETS[targetKey];
  const settings = loadSettings();
  const scriptId = settings[scriptIdKey];

  if (!scriptId || scriptId.startsWith('<')) {
    console.error(`❌  ${scriptIdKey} is not set in local.settings.json`);
    process.exit(1);
  }

  const claspAuthPath = resolveClaspAuthPath_(settings);
  const claspEnv = { ...process.env, clasp_config_auth: claspAuthPath };

  console.log(`\n${emoji}  Reading current ${label} deployment state (${scriptId.slice(0, 12)}…)…`);
  writeClasp(scriptId);

  const deploymentId = findActiveDeploymentId_(claspEnv);
  // There is no `clasp deploy` stdout to parse here (nothing was just deployed), so this goes
  // straight to the fallback branch of resolveRevision_.
  const revision = resolveRevision_('', deploymentId, () =>
    execSync('clasp deployments', { cwd: ROOT, env: claspEnv }).toString()
  );

  const versionSrc = fs.readFileSync(VERSION_PATH, 'utf8');
  const versionMatch = versionSrc.match(/const APP_VERSION\s*=\s*'([^']+)'/);
  const dateMatch = versionSrc.match(/const APP_VERSION_DATE\s*=\s*'([^']+)'/);
  const localVersion = versionMatch ? versionMatch[1] : '(unknown)';
  const now = dateMatch ? dateMatch[1] : '(unknown)';

  // Read-only version check (RECOMMENDATION.md §3.2 work item 5): a single, non-polling
  // cmd=version query — nothing was just deployed, so there's no propagation race to wait out —
  // reporting what the server confirms rather than what local version.js says, and flagging any
  // divergence (someone deployed from elsewhere, or a deploy half-failed).
  const live = await queryLiveVersion_(deploymentId);
  let version = localVersion;
  if (live) {
    version = live.version;
    if (live.version !== localVersion) {
      console.log(`⚠️  Live ${label} reports v${live.version}, but local script/version.js says v${localVersion} — deployed from elsewhere, or a deploy half-failed.`);
    }
  } else {
    console.log(`⚠️  Could not reach ${label}'s cmd=version route — reporting local script/version.js instead.`);
  }

  printDeploySummary_(targetKey, { version, now, deploymentId, revision, scriptId, settings });
}

// ─────────────────────────────────────────────────────────────────────────
// Interactive menu (no-flag invocation)
// ─────────────────────────────────────────────────────────────────────────

async function interactiveMenu() {
  let select;
  try {
    ({ select } = require('@inquirer/prompts'));
  } catch {
    console.error('❌  @inquirer/prompts is not installed. Run: npm install');
    process.exit(1);
  }

  const action = await select({
    message: 'Deploy target:',
    choices: [
      { name: '📋 Template  — push to template scriptId (TEMPLATE stamp)', value: 'template' },
      { name: '🧪 Test      — push to test scriptId (TEST stamp)',         value: 'test'     },
      { name: '❌ Exit',                                                   value: 'exit'     },
    ],
  });

  if (action !== 'exit') await deploy(action);
}

// ─────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const options = { skipBump: args.includes('--skip-bump') };

  if (args.includes('--summary')) {
    const envIdx = args.indexOf('--env');
    const env = envIdx !== -1 ? args[envIdx + 1] : null;
    const targetKey = ENV_TO_TARGET[env];
    if (!targetKey) {
      console.error(`❌  --summary requires --env sit|prod, got '${env}'`);
      process.exit(1);
    }
    return summary(targetKey);
  }

  if (args.includes('--deploy-template')) return deploy('template', options);
  if (args.includes('--deploy-test'))     return deploy('test', options);

  await interactiveMenu();
}

if (require.main === module) {
  main().catch(err => {
    if (err && (err.name === 'ExitPromptError' || err.message?.includes('force closed'))) {
      console.log('\n❌ Cancelled.');
      return;
    }
    console.error('❌ Error:', err.message);
    process.exit(1);
  });
}

module.exports = {
  replaceConst,
  stampVersion,
  bumpPatchVersion_,
  bumpBuildNumber_,
  resetBuildNumber_,
  printDeploySummary_,
  assertDeployedVersion_,
  queryLiveVersion_,
  parseDeploymentsOutput_,
  resolveRevision_,
  TARGETS,
};
