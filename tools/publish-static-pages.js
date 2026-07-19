#!/usr/bin/env node
/**
 * Publishes the built static-pages/dist/<env>/ output to the sibling f3go30/static-pages repo
 * (local.settings.json's staticPagesRepoPath, e.g. ../F3Static), which is what GitHub Pages
 * actually serves (https://f3go30.github.io/static-pages/dist/<sit|prod>/ — see
 * script/version.js's STATIC_PAGES_BASE_URL_).
 *
 * Normally invoked automatically, once per target, as the last step of manage-deployments.js's
 * deploy() (npm run deploy:sit / deploy:prod) — with --skip-bump, since deploy() already
 * bumped/reset package.json's "build" counter for this push. There's no real use case for
 * publishing static-page content on its own: it shares the same version/build counter as the
 * GAS webapp (build-static-pages.js's versionStringFor stamps `<version>.<build>` for SIT, bare
 * `<version>` for PROD), so a publish that didn't go through deploy() would either reuse a
 * stale build stamp or need to bump the same counter itself, double-counting against the next
 * real deploy. Direct invocation exists only for recovery — e.g. retrying a publish whose git
 * push to F3Static failed after a deploy() already ran (pass --skip-bump then too, since the
 * counter was already bumped/reset by that deploy; bumpBuildNumber_, imported below, is what
 * --skip-bump's absence would trigger for a genuinely standalone bump).
 *
 * Runs tools/build-static-pages.js first (so dist/ is never stale), then copies each requested
 * env's folder into <staticPagesRepoPath>/dist/<env>/, and commits + pushes from that repo.
 *
 * Usage:
 *   node tools/publish-static-pages.js [--env sit|prod|all] [--skip-bump]
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { bumpBuildNumber_ } = require('./manage-deployments.js');

const ROOT = path.resolve(__dirname, '..');
const DIST_ROOT = path.join(ROOT, 'static-pages', 'dist');
const SETTINGS_PATH = path.join(ROOT, 'local.settings.json');
const PKG_PATH = path.join(ROOT, 'package.json');

function loadSettings() {
  if (!fs.existsSync(SETTINGS_PATH)) {
    console.error(`❌  local.settings.json not found at ${SETTINGS_PATH}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
}

function copyDir(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  const envIdx = args.indexOf('--env');
  const env = envIdx !== -1 ? args[envIdx + 1] : 'all';
  const envs = env === 'all' ? ['sit', 'prod'] : [env];

  const settings = loadSettings();
  if (!settings.staticPagesRepoPath) {
    console.error('❌  staticPagesRepoPath is not set in local.settings.json');
    process.exit(1);
  }
  const staticRepo = path.resolve(ROOT, settings.staticPagesRepoPath);
  if (!fs.existsSync(path.join(staticRepo, '.git'))) {
    console.error(`❌  ${staticRepo} does not look like a git checkout (no .git found)`);
    process.exit(1);
  }

  if (!args.includes('--skip-bump')) {
    const build = bumpBuildNumber_(PKG_PATH);
    console.log(`🔢 build number bumped to ${build}`);
  }

  // Build only the env(s) being published — not always `--env all`. Since build-static-pages.js
  // now bakes each env's webapp /exec URL from its deployment ID (F3Go30-6bl6), building `all`
  // during a single-env publish (e.g. npm run deploy:sit) would require the *other* env's
  // deployment ID to be configured too, and fail the deploy if it isn't.
  console.log('🔨 Building static pages...');
  execSync(`node ${path.join(__dirname, 'build-static-pages.js')} --env ${env}`, { cwd: ROOT, stdio: 'inherit' });

  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));

  envs.forEach((e) => {
    const src = path.join(DIST_ROOT, e);
    const dest = path.join(staticRepo, 'dist', e);
    if (!fs.existsSync(src)) {
      console.error(`❌  ${src} not found — build did not produce it`);
      process.exit(1);
    }
    copyDir(src, dest);
    console.log(`📦 copied static-pages/dist/${e} -> ${path.relative(ROOT, dest)}`);
  });

  const status = execSync('git status --porcelain', { cwd: staticRepo }).toString().trim();
  if (!status) {
    console.log('✅ F3Static working tree already matches build output — nothing to publish.');
    return;
  }

  execSync('git add dist', { cwd: staticRepo, stdio: 'inherit' });
  const message = `Publish static pages v${pkg.version}.${pkg.build || 0} (${envs.join(', ')})`;
  execSync(`git commit -m ${JSON.stringify(message)}`, { cwd: staticRepo, stdio: 'inherit' });
  execSync('git push', { cwd: staticRepo, stdio: 'inherit' });
  console.log(`🚀 Published to F3Static and pushed.`);
}

main();
