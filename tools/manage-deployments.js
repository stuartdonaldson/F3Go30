#!/usr/bin/env node
/**
 * F3Go30 Deployment Manager
 *
 * Run via npm scripts:
 *   npm run push            # bump patch + stamp TEMPLATE + clasp push -f to template scriptId
 *   npm run deploy:test     # bump patch + stamp TEST     + clasp push -f to test scriptId
 *
 * Every deploy bumps package.json's patch version first (unless --skip-bump), so each pushed/
 * deployed version is unique and traceable via APP_VERSION in the stamped version.js and the
 * named deployment's `clasp deploy --description`. release:patch/minor/major already bump via
 * `npm version`, so they pass --skip-bump to avoid double-bumping.
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
  template: { scriptIdKey: 'templateScriptId', label: 'TEMPLATE', emoji: '📋' },
  test:     { scriptIdKey: 'testScriptId',     label: 'TEST',     emoji: '🧪' },
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
  const version = pkg.version || '0.0.0';

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
 * Every deploy() call bumps this first (unless --skip-bump), so each pushed/deployed version is
 * unique and traceable — see APP_VERSION in the stamped version.js and the named deployment's
 * `clasp deploy --description`.
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

  // Every deploy gets a unique version unless the caller already bumped via `npm version`
  // (release:patch/minor/major) — see bumpPatchVersion_ above.
  if (!options.skipBump) {
    const bumped = bumpPatchVersion_(PKG_PATH);
    console.log(`🔢 package.json version bumped to v${bumped}`);
  }

  const { version } = stampVersion(label);

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
  TARGETS,
};
