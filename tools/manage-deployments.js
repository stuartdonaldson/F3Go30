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

const TARGETS = {
  template: { scriptIdKey: 'templateScriptId', label: 'TEMPLATE', emoji: '📋', deploymentIdKey: 'templateDeploymentId' },
  test:     { scriptIdKey: 'testScriptId',     label: 'TEST',     emoji: '🧪',  deploymentIdKey: 'testDeploymentId' },
};

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
 * Each script project (template, test) is expected to carry exactly one active named
 * deployment (excluding the @HEAD test-deployment entry clasp always lists). Rather than
 * storing its ID in local.settings.json (which goes stale the moment a deployment is
 * recreated), look it up fresh from `clasp deployments` every time — it must be run after
 * .clasp.json has been written for the target scriptId.
 */
function findActiveDeploymentId_(claspEnv) {
  const output = execSync('clasp deployments', { cwd: ROOT, env: claspEnv }).toString();
  const deploymentLines = output
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('-') && !line.includes('@HEAD'));

  if (deploymentLines.length === 0) {
    throw new Error('No active (non-@HEAD) deployment found — create one via the script editor first.');
  }
  if (deploymentLines.length > 1) {
    throw new Error(`Expected exactly one active deployment, found ${deploymentLines.length}:\n${deploymentLines.join('\n')}`);
  }

  const match = deploymentLines[0].match(/^-\s*(\S+)/);
  if (!match) {
    throw new Error(`Could not parse deployment ID from: ${deploymentLines[0]}`);
  }
  return match[1];
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
// Deploy
// ─────────────────────────────────────────────────────────────────────────

function deploy(targetKey, options = {}) {
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

  stampVersion(label, { versionOverride: version });

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
  execSync(
    `clasp deploy --deploymentId ${deploymentId} --description "v${version} GO30-APP"`,
    { stdio: 'inherit', cwd: ROOT, env: claspEnv }
  );
  console.log(`\n✅ ${label} named deployment updated.`);

  saveDeploymentId_(targetKey, deploymentId);
  console.log(`💾 ${TARGETS[targetKey].deploymentIdKey} saved to local.settings.json`);

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

  if (action !== 'exit') deploy(action);
}

// ─────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const options = { skipBump: args.includes('--skip-bump') };

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
  TARGETS,
};
