#!/usr/bin/env node
/**
 * F3Go30 Deployment Manager
 *
 * Run via npm scripts:
 *   npm run push            # stamp TEMPLATE + clasp push -f to template scriptId
 *   npm run deploy:month    # stamp MONTH    + clasp push -f to month scriptId
 *   npm run deploy:test     # stamp TEST     + clasp push -f to test scriptId
 *
 * Direct invocation:
 *   node tools/manage-deployments.js --deploy-template
 *   node tools/manage-deployments.js --deploy-month
 *   node tools/manage-deployments.js --deploy-test
 *
 * Prerequisites:
 *   - local.settings.json at project root with all six ID fields populated
 *   - clasp authenticated (clasp login)
 *   - @inquirer/prompts installed (npm install)
 */

const { execSync }  = require('child_process');
const fs            = require('fs');
const path          = require('path');

const ROOT          = path.join(__dirname, '..');
const SETTINGS_PATH = path.join(ROOT, 'local.settings.json');
const CLASP_PATH    = path.join(ROOT, '.clasp.json');
const VERSION_PATH  = path.join(ROOT, 'script', 'version.js');
const PKG_PATH      = path.join(ROOT, 'package.json');

const TARGETS = {
  template: { scriptIdKey: 'templateScriptId', label: 'TEMPLATE', emoji: '📋' },
  month:    { scriptIdKey: 'monthScriptId',    label: 'MONTH',    emoji: '📅' },
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
// Deploy
// ─────────────────────────────────────────────────────────────────────────

function deploy(targetKey) {
  const { scriptIdKey, label, emoji } = TARGETS[targetKey];
  const settings = loadSettings();
  const scriptId = settings[scriptIdKey];

  if (!scriptId || scriptId.startsWith('<')) {
    console.error(`❌  ${scriptIdKey} is not set in local.settings.json`);
    process.exit(1);
  }

  console.log(`\n${emoji}  Deploying to ${label} (${scriptId.slice(0, 12)}…)\n`);

  writeClasp(scriptId);
  console.log(`✅ .clasp.json written (rootDir: script, scriptId: ${scriptId.slice(0, 12)}…)`);

  stampVersion(label);

  console.log('\n🚀 Running: clasp push -f\n');
  execSync('clasp push -f', { stdio: 'inherit', cwd: ROOT });

  console.log(`\n✅ ${label} push complete.`);
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
      { name: '📅 Month     — push to month scriptId (MONTH stamp)',       value: 'month'    },
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

  if (args.includes('--deploy-template')) return deploy('template');
  if (args.includes('--deploy-month'))    return deploy('month');
  if (args.includes('--deploy-test'))     return deploy('test');

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
  TARGETS,
};
